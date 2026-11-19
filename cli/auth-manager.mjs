#!/usr/bin/env node
/**
 * Anti-Claude — Unified Antigravity Desktop (Electron) & CLI (agy) Account Switcher
 * Zero-dependency multi-account manager with lossless `go-keyring-base64:` Keyring sync
 * and Electron Desktop session metadata sync (Node.js >= 22).
 *
 * Compatible with existing `~/.gemini/auth_profiles/<email>/` & `~/.gemini/google_accounts.json` layouts.
 *
 * Commands (via `node install.mjs auth ...` or `node cli/auth-manager.mjs ...`):
 *   auth [list|status]                              List saved accounts and Desktop/CLI sync status
 *   auth save [name]                                Snapshot the currently signed-in account into the pool
 *   auth switch <index|name> [--restart] [--scope=both|cli|desktop]
 *                                                   Switch account (auto-backs up active account first)
 *   auth next [--restart] [--scope=both|cli|desktop] Rotate to the next saved account
 *   auth import <file> [name]                       Import an oauth_creds.json or antigravity_keyring.json profile
 *   auth remove <index|name> [--force]              Remove a profile from the pool
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GO_KEYRING_PREFIX = 'go-keyring-base64:';
export const KEYRING_SERVICE = 'gemini';
export const KEYRING_ACCOUNT = 'antigravity';

const DEFAULT_SCOPE =
  'https://www.googleapis.com/auth/cloud-platform openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

/* -------------------------------------------------------------------------- */
/* Platform Paths                                                             */
/* -------------------------------------------------------------------------- */

export function getDesktopAppDataDir(homeDir = os.homedir(), platform = process.platform) {
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Antigravity');
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Antigravity');
  }
  return path.join(homeDir, '.config', 'Antigravity');
}

/* -------------------------------------------------------------------------- */
/* Codec & Format Conversion                                                  */
/* -------------------------------------------------------------------------- */

export function decodeKeyringPayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const jsonText = trimmed.startsWith(GO_KEYRING_PREFIX)
      ? Buffer.from(trimmed.slice(GO_KEYRING_PREFIX.length), 'base64').toString('utf8')
      : trimmed;
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function encodeKeyringPayload(obj, { base64 = true } = {}) {
  const jsonText = JSON.stringify(obj);
  if (!base64) return jsonText;
  return `${GO_KEYRING_PREFIX}${Buffer.from(jsonText, 'utf8').toString('base64')}`;
}

export function extractEmailFromIdToken(idToken) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.email === 'string' && payload.email.trim() ? payload.email.trim() : null;
  } catch {
    return null;
  }
}

export function toAntigravityFormat(credsObj, email = '') {
  if (!credsObj || typeof credsObj !== 'object') return null;
  /* Already in native Antigravity keyring format */
  if (credsObj.token && typeof credsObj.token === 'object') {
    const copy = JSON.parse(JSON.stringify(credsObj));
    const inferredEmail = email || copy.id_token_email || extractEmailFromIdToken(copy.id_token);
    if (inferredEmail && !copy.id_token_email) copy.id_token_email = inferredEmail;
    if (!copy.auth_method) copy.auth_method = 'consumer';
    return copy;
  }
  const expiryMs = Number(credsObj.expiry_date) || Date.now() + 3600 * 1000;
  const expiryIso = new Date(expiryMs).toISOString();
  const out = {
    token: {
      access_token: String(credsObj.access_token || ''),
      token_type: String(credsObj.token_type || 'Bearer'),
      refresh_token: String(credsObj.refresh_token || ''),
      expiry: expiryIso
    },
    auth_method: 'consumer'
  };
  if (email) out.id_token_email = email;
  return out;
}

export function toStandardFormat(agyObj) {
  if (!agyObj || typeof agyObj !== 'object') return null;
  /* Already in standard oauth_creds.json format */
  if (!agyObj.token && (agyObj.access_token || agyObj.refresh_token)) {
    return JSON.parse(JSON.stringify(agyObj));
  }
  const tok = agyObj.token || {};
  const parsedExpiry = Date.parse(tok.expiry || '');
  const expiryDate = Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 3600 * 1000;
  return {
    access_token: String(tok.access_token || ''),
    scope: DEFAULT_SCOPE,
    token_type: String(tok.token_type || 'Bearer'),
    expiry_date: expiryDate,
    refresh_token: String(tok.refresh_token || '')
  };
}

/* -------------------------------------------------------------------------- */
/* Keyring Backends                                                           */
/* -------------------------------------------------------------------------- */

export function createSystemKeyring({ platform = process.platform, mockFile = process.env.ANTI_CLAUDE_MOCK_KEYRING_FILE } = {}) {
  if (mockFile) {
    return {
      get(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          const store = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
          return store[`${service}:${account}`] ?? null;
        } catch {
          return null;
        }
      },
      set(password, service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        let store = {};
        try {
          store = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
        } catch {}
        store[`${service}:${account}`] = password;
        fs.mkdirSync(path.dirname(mockFile), { recursive: true });
        fs.writeFileSync(mockFile, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
        return true;
      },
      clear(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          const store = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
          delete store[`${service}:${account}`];
          fs.writeFileSync(mockFile, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch {}
        return true;
      }
    };
  }

  if (platform === 'darwin') {
    return {
      get(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          return execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
            encoding: 'utf8',
            timeout: 4000,
            stdio: ['ignore', 'pipe', 'ignore']
          }).trim();
        } catch {
          return null;
        }
      },
      set(password, service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          execFileSync('security', ['add-generic-password', '-s', service, '-a', account, '-w', password, '-U'], {
            timeout: 4000,
            stdio: 'ignore'
          });
          return true;
        } catch {
          return false;
        }
      },
      clear(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          execFileSync('security', ['delete-generic-password', '-s', service, '-a', account], {
            timeout: 4000,
            stdio: 'ignore'
          });
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  if (platform === 'linux') {
    return {
      get(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          return execFileSync('secret-tool', ['lookup', 'service', service, 'username', account], {
            encoding: 'utf8',
            timeout: 4000,
            stdio: ['ignore', 'pipe', 'ignore']
          }).trim();
        } catch {
          return null;
        }
      },
      set(password, service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          const r = spawnSync('secret-tool', ['store', `--label=${service}`, 'service', service, 'username', account], {
            input: password,
            encoding: 'utf8',
            timeout: 4000,
            stdio: ['pipe', 'ignore', 'ignore']
          });
          return r.status === 0;
        } catch {
          return false;
        }
      },
      clear(service = KEYRING_SERVICE, account = KEYRING_ACCOUNT) {
        try {
          execFileSync('secret-tool', ['clear', 'service', service, 'username', account], {
            timeout: 4000,
            stdio: 'ignore'
          });
          return true;
        } catch {
          return false;
        }
      }
    };
  }

  return {
    get() {
      return null;
    },
    set() {
      return false;
    },
    clear() {
      return false;
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Desktop Process Helpers                                                    */
/* -------------------------------------------------------------------------- */

function detectDesktopRunning(platform = process.platform) {
  if (platform === 'darwin') {
    try {
      const out = execFileSync('pgrep', ['-f', '/Applications/Antigravity.app/Contents/MacOS/Antigravity'], {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      return Boolean(out);
    } catch {
      return false;
    }
  }
  return false;
}

function restartDesktopApp(platform = process.platform) {
  if (platform !== 'darwin') {
    return { restarted: false, reason: 'manual_restart_required_on_platform' };
  }
  const appPath = '/Applications/Antigravity.app';
  if (!fs.existsSync(appPath)) {
    return { restarted: false, reason: 'antigravity_app_not_installed' };
  }
  try {
    execFileSync('osascript', ['-e', 'tell application "Antigravity" to quit'], {
      timeout: 5000,
      stdio: 'ignore'
    });
  } catch {}
  /* Detach relaunch so caller can finish cleanly */
  try {
    const child = spawn(
      '/bin/sh',
      ['-c', 'sleep 1.2; /usr/bin/open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0'],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
    return { restarted: true, cdpEnabled: true };
  } catch (err) {
    return { restarted: false, reason: String(err?.message || err) };
  }
}

/* -------------------------------------------------------------------------- */
/* Auth Manager Core                                                          */
/* -------------------------------------------------------------------------- */

function readJsonSafe(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function writeFileSecure(p, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode });
  try {
    fs.chmodSync(tmp, mode);
  } catch {}
  fs.renameSync(tmp, p);
}

function sanitizeProfileName(name) {
  const s = String(name || '').trim();
  if (!s || s === '.' || s === '..' || /[/\\]/.test(s)) return null;
  return s;
}

export function createAuthManager({
  homeDir = os.homedir(),
  platform = process.platform,
  desktopAppDataDir = null,
  keyring = createSystemKeyring({ platform }),
  isDesktopRunning = () => detectDesktopRunning(platform),
  relaunchDesktop = () => restartDesktopApp(platform)
} = {}) {
  const geminiDir = path.join(homeDir, '.gemini');
  const profilesDir = path.join(geminiDir, 'auth_profiles');
  const accountsJson = path.join(geminiDir, 'google_accounts.json');
  const credsFile = path.join(geminiDir, 'oauth_creds.json');
  const idFile = path.join(geminiDir, 'google_account_id');
  const jetskiTokenFile = path.join(geminiDir, 'jetski-standalone-oauth-token');
  const mcpTokenCache = path.join(geminiDir, 'mcp-oauth-tokens-v2.json');

  const appDataDir = desktopAppDataDir || getDesktopAppDataDir(homeDir, platform);
  const appStorageFile = path.join(appDataDir, 'app_storage.json');
  const credScopeFile = path.join(appDataDir, 'credential-user-scope');

  function getProfiles() {
    if (!fs.existsSync(profilesDir)) return [];
    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();
  }

  function getAccountsData() {
    const data = readJsonSafe(accountsJson, null);
    if (data && typeof data === 'object') {
      return {
        active: typeof data.active === 'string' ? data.active : null,
        old: Array.isArray(data.old) ? data.old.filter((x) => typeof x === 'string') : []
      };
    }
    return { active: null, old: [] };
  }

  function saveAccountsData(data) {
    writeFileSecure(accountsJson, `${JSON.stringify(data, null, 2)}\n`, 0o644);
  }

  function readLiveKeyring() {
    const raw = keyring.get(KEYRING_SERVICE, KEYRING_ACCOUNT);
    if (!raw) return null;
    return decodeKeyringPayload(raw);
  }

  function readDesktopMeta() {
    const appStorage = readJsonSafe(appStorageFile, null);
    const scopeRaw = readTextSafe(credScopeFile);
    return {
      appDataDirExists: fs.existsSync(appDataDir),
      lastLoginUsername:
        typeof appStorage?.['jetski.onboarding.lastLoginUsername'] === 'string'
          ? appStorage['jetski.onboarding.lastLoginUsername'].trim() || null
          : null,
      lastLoginIsGcpTos: appStorage?.['jetski.onboarding.lastLoginIsGcpTos'] ?? null,
      credentialUserScope: scopeRaw ? scopeRaw.trim() || null : null
    };
  }

  function resolveTarget(targetArg) {
    const profiles = getProfiles();
    if (!profiles.length) return { error: 'no_profiles_found' };
    const raw = String(targetArg || '').trim();
    if (!raw) return { error: 'missing_target' };
    if (profiles.includes(raw)) return { name: raw, dir: path.join(profilesDir, raw) };
    if (/^\d+$/.test(raw)) {
      const idx = Number(raw) - 1;
      if (idx >= 0 && idx < profiles.length) {
        return { name: profiles[idx], dir: path.join(profilesDir, profiles[idx]) };
      }
      return { error: `index_out_of_range (1-${profiles.length})` };
    }
    return { error: `account_not_found: ${raw}` };
  }

  function snapshotProfile(profileName, { keyringObj = null, standardObj = null, jetskiObj = null, desktopMeta = null } = {}) {
    const clean = sanitizeProfileName(profileName);
    if (!clean) return { ok: false, error: 'invalid_profile_name' };
    const dir = path.join(profilesDir, clean);
    fs.mkdirSync(dir, { recursive: true });

    const agyPayload =
      keyringObj ||
      (jetskiObj ? toAntigravityFormat(jetskiObj, clean) : null) ||
      (standardObj ? toAntigravityFormat(standardObj, clean) : null);
    const stdPayload = standardObj || (agyPayload ? toStandardFormat(agyPayload) : null);

    if (!agyPayload && !stdPayload) return { ok: false, error: 'no_credentials_to_save' };
    if (agyPayload) {
      writeFileSecure(path.join(dir, 'antigravity_keyring.json'), `${JSON.stringify(agyPayload, null, 2)}\n`, 0o600);
    }
    if (stdPayload) {
      writeFileSecure(path.join(dir, 'oauth_creds.json'), `${JSON.stringify(stdPayload, null, 2)}\n`, 0o600);
    }
    if (jetskiObj) {
      writeFileSecure(path.join(dir, 'jetski-standalone-oauth-token'), `${JSON.stringify(jetskiObj, null, 2)}\n`, 0o600);
    }
    if (desktopMeta && (desktopMeta.lastLoginUsername || desktopMeta.credentialUserScope)) {
      const metaOut = {
        lastLoginUsername: desktopMeta.lastLoginUsername || clean,
        lastLoginIsGcpTos: desktopMeta.lastLoginIsGcpTos ?? 'false',
        credentialUserScope: desktopMeta.credentialUserScope || null
      };
      writeFileSecure(path.join(dir, 'desktop_meta.json'), `${JSON.stringify(metaOut, null, 2)}\n`, 0o600);
    }
    if (fs.existsSync(idFile)) {
      fs.copyFileSync(idFile, path.join(dir, 'google_account_id'));
    }
    return { ok: true, name: clean, dir };
  }

  function applyDesktopSession(targetName, targetDir, nextKeyringObj) {
    const result = { synced: false, appStorageUpdated: false, scopeAction: 'skipped', jetskiTokenSynced: false };

    /* 1. Sync ~/.gemini/jetski-standalone-oauth-token if target has one or standalone file already exists */
    const targetJetskiPath = path.join(targetDir, 'jetski-standalone-oauth-token');
    if (fs.existsSync(targetJetskiPath)) {
      const raw = readTextSafe(targetJetskiPath);
      if (raw !== null) {
        writeFileSecure(jetskiTokenFile, raw, 0o600);
        result.jetskiTokenSynced = true;
      }
    } else if (fs.existsSync(jetskiTokenFile) && nextKeyringObj?.token) {
      const synced = {
        token: nextKeyringObj.token,
        auth_method: nextKeyringObj.auth_method || 'consumer'
      };
      writeFileSecure(jetskiTokenFile, `${JSON.stringify(synced, null, 2)}\n`, 0o600);
      result.jetskiTokenSynced = true;
    }

    if (!fs.existsSync(appDataDir)) {
      return result;
    }

    const savedMeta = readJsonSafe(path.join(targetDir, 'desktop_meta.json'), null);

    /* 2. Update app_storage.json login username so Desktop UI & onboarding stay aligned */
    if (fs.existsSync(appStorageFile)) {
      const appStorage = readJsonSafe(appStorageFile, null);
      if (appStorage && typeof appStorage === 'object' && !Array.isArray(appStorage)) {
        const nextUser = savedMeta?.lastLoginUsername || nextKeyringObj?.id_token_email || targetName;
        if (nextUser) {
          appStorage['jetski.onboarding.lastLoginUsername'] = nextUser;
          if (savedMeta?.lastLoginIsGcpTos !== undefined && savedMeta?.lastLoginIsGcpTos !== null) {
            appStorage['jetski.onboarding.lastLoginIsGcpTos'] = String(savedMeta.lastLoginIsGcpTos);
          }
          writeFileSecure(appStorageFile, JSON.stringify(appStorage), 0o644);
          result.appStorageUpdated = true;
        }
      }
    }

    /* 3. Restore target's credential-user-scope (or clear stale scope so Desktop re-derives it cleanly) */
    if (savedMeta?.credentialUserScope) {
      writeFileSecure(credScopeFile, savedMeta.credentialUserScope, 0o600);
      result.scopeAction = 'restored';
    } else if (fs.existsSync(credScopeFile)) {
      fs.rmSync(credScopeFile, { force: true });
      result.scopeAction = 'cleared_for_rebind';
    }

    result.synced = result.appStorageUpdated || result.jetskiTokenSynced || result.scopeAction !== 'skipped';
    return result;
  }

  function inspectStatus() {
    const profiles = getProfiles();
    const data = getAccountsData();
    const live = readLiveKeyring();
    const liveEmail = live?.id_token_email || null;
    const desktop = readDesktopMeta();
    const activeAccount = data.active || liveEmail || desktop.lastLoginUsername || null;
    return {
      ok: true,
      activeAccount,
      recordedActive: data.active,
      liveKeyringEmail: liveEmail,
      liveKeyringPresent: Boolean(live),
      keyringInSync: Boolean(liveEmail && data.active && liveEmail === data.active),
      desktop: {
        appDataDirExists: desktop.appDataDirExists,
        lastLoginUsername: desktop.lastLoginUsername,
        hasCredentialScope: Boolean(desktop.credentialUserScope),
        inSyncWithKeyring: Boolean(
          liveEmail && desktop.lastLoginUsername && liveEmail === desktop.lastLoginUsername
        )
      },
      profileCount: profiles.length,
      profiles: profiles.map((name, i) => {
        const dir = path.join(profilesDir, name);
        return {
          index: i + 1,
          name,
          active: name === activeAccount,
          hasKeyringPayload: fs.existsSync(path.join(dir, 'antigravity_keyring.json')),
          hasOAuthCreds: fs.existsSync(path.join(dir, 'oauth_creds.json')),
          hasDesktopMeta: fs.existsSync(path.join(dir, 'desktop_meta.json'))
        };
      })
    };
  }

  function saveCurrent(explicitName = '') {
    const live = readLiveKeyring();
    const std = readJsonSafe(credsFile, null);
    const jetski = readJsonSafe(jetskiTokenFile, null);
    const desktop = readDesktopMeta();

    if (!live && !std && !jetski) {
      return { ok: false, error: 'no_active_credentials_found (sign in via Antigravity Desktop or `agy` first)' };
    }

    const data = getAccountsData();
    const jetskiEmail = extractEmailFromIdToken(jetski?.id_token);
    const inferredName =
      sanitizeProfileName(explicitName) ||
      sanitizeProfileName(live?.id_token_email) ||
      sanitizeProfileName(desktop.lastLoginUsername) ||
      sanitizeProfileName(jetskiEmail) ||
      sanitizeProfileName(data.active);

    if (!inferredName) {
      return { ok: false, error: 'cannot_infer_account_name: pass an explicit name (`auth save <email-or-alias>`)' };
    }

    /* Only attach desktopMeta/jetski token if they belong to the same account (or no conflict) */
    const matchingDesktop =
      !desktop.lastLoginUsername || desktop.lastLoginUsername === inferredName ? desktop : null;
    const matchingJetski = !jetskiEmail || jetskiEmail === inferredName ? jetski : null;

    const snap = snapshotProfile(inferredName, {
      keyringObj: live,
      standardObj: std,
      jetskiObj: matchingJetski,
      desktopMeta: matchingDesktop
    });
    if (!snap.ok) return snap;

    if (data.active && data.active !== inferredName && !data.old.includes(data.active)) {
      data.old.push(data.active);
    }
    data.active = inferredName;
    data.old = data.old.filter((x) => x !== inferredName);
    saveAccountsData(data);

    const sources = [];
    if (live) sources.push('keyring');
    if (std) sources.push('cli-file');
    if (matchingDesktop?.appDataDirExists) sources.push('desktop');
    if (matchingJetski) sources.push('jetski-token');

    return {
      ok: true,
      action: 'saved',
      account: inferredName,
      source: sources.join('+'),
      profileDir: snap.dir
    };
  }

  function switchAccount(targetArg, { scope = 'both', restartDesktop = false } = {}) {
    const normalizedScope = ['both', 'cli', 'desktop'].includes(scope) ? scope : 'both';
    const resolved = resolveTarget(targetArg);
    if (resolved.error) return { ok: false, error: resolved.error };
    const { name: targetName, dir: targetDir } = resolved;

    const targetKeyringJson = readJsonSafe(path.join(targetDir, 'antigravity_keyring.json'), null);
    const targetOauthJson = readJsonSafe(path.join(targetDir, 'oauth_creds.json'), null);
    const targetJetskiJson = readJsonSafe(path.join(targetDir, 'jetski-standalone-oauth-token'), null);
    if (!targetKeyringJson && !targetOauthJson && !targetJetskiJson) {
      return { ok: false, error: `missing_credentials_for: ${targetName}` };
    }

    const data = getAccountsData();
    const liveBefore = readLiveKeyring();
    const desktopBefore = readDesktopMeta();
    const currentActive = data.active || liveBefore?.id_token_email || desktopBefore.lastLoginUsername || null;

    /* Back up the active account's freshest credentials (live keyring + desktop metadata) before switching */
    let backedUp = null;
    if (currentActive && currentActive !== targetName) {
      const stdBefore = readJsonSafe(credsFile, null);
      const jetskiBefore = readJsonSafe(jetskiTokenFile, null);
      const jetskiEmail = extractEmailFromIdToken(jetskiBefore?.id_token);
      if (liveBefore || stdBefore || jetskiBefore) {
        const snap = snapshotProfile(currentActive, {
          keyringObj: liveBefore,
          standardObj: stdBefore,
          jetskiObj: !jetskiEmail || jetskiEmail === currentActive ? jetskiBefore : null,
          desktopMeta:
            !desktopBefore.lastLoginUsername || desktopBefore.lastLoginUsername === currentActive
              ? desktopBefore
              : null
        });
        if (snap.ok) backedUp = currentActive;
      }
    }

    const nextKeyringObj =
      targetKeyringJson ||
      (targetJetskiJson ? toAntigravityFormat(targetJetskiJson, targetName) : null) ||
      toAntigravityFormat(targetOauthJson, targetName);
    const nextStandardObj = targetOauthJson || toStandardFormat(nextKeyringObj);

    /* Keyring `gemini:antigravity` is shared by both Antigravity Desktop 2.0 and agy CLI */
    const keyringUpdated = keyring.set(
      encodeKeyringPayload(nextKeyringObj, { base64: true }),
      KEYRING_SERVICE,
      KEYRING_ACCOUNT
    );

    let cliFileUpdated = false;
    let cacheCleared = false;
    if (normalizedScope === 'both' || normalizedScope === 'cli') {
      if (nextStandardObj) {
        writeFileSecure(credsFile, `${JSON.stringify(nextStandardObj, null, 2)}\n`, 0o600);
        cliFileUpdated = true;
      }
      const targetIdFile = path.join(targetDir, 'google_account_id');
      if (fs.existsSync(targetIdFile)) {
        fs.copyFileSync(targetIdFile, idFile);
      } else if (fs.existsSync(idFile)) {
        fs.rmSync(idFile, { force: true });
      }
      if (fs.existsSync(mcpTokenCache)) {
        try {
          fs.rmSync(mcpTokenCache, { force: true });
          cacheCleared = true;
        } catch {}
      }
    }

    let desktopSync = { skipped: 'scope_cli_only' };
    let desktopRestart = { skipped: true };
    let desktopRestartRequired = false;
    if (normalizedScope === 'both' || normalizedScope === 'desktop') {
      desktopSync = applyDesktopSession(targetName, targetDir, nextKeyringObj);
      const running = Boolean(isDesktopRunning());
      if (running && restartDesktop) {
        desktopRestart = relaunchDesktop();
        desktopRestartRequired = !desktopRestart.restarted;
      } else if (running) {
        desktopRestartRequired = true;
      }
    }

    if (currentActive && currentActive !== targetName && !data.old.includes(currentActive)) {
      data.old.push(currentActive);
    }
    data.active = targetName;
    data.old = data.old.filter((x) => x !== targetName);
    saveAccountsData(data);

    return {
      ok: true,
      scope: normalizedScope,
      action: currentActive === targetName ? 'reapplied' : 'switched',
      from: currentActive,
      to: targetName,
      backedUp,
      keyringUpdated,
      cliFileUpdated,
      cacheCleared,
      desktopSync,
      desktopRestartRequired,
      desktopRestart
    };
  }

  function switchNext(opts = {}) {
    const profiles = getProfiles();
    if (!profiles.length) return { ok: false, error: 'no_profiles_found' };
    const status = inspectStatus();
    const current = status.activeAccount;
    const idx = current ? profiles.indexOf(current) : -1;
    const nextName = profiles[(idx + 1) % profiles.length];
    if (profiles.length === 1 && nextName === current) {
      return { ok: false, error: 'only_one_account_available', active: current };
    }
    return switchAccount(nextName, opts);
  }

  function importProfile(filePath, explicitName = '') {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `file_not_found: ${filePath || ''}` };
    const parsed = readJsonSafe(filePath, null);
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid_json_credentials' };
    const isNative = Boolean(parsed.token && typeof parsed.token === 'object');
    const name =
      sanitizeProfileName(explicitName) ||
      sanitizeProfileName(parsed.id_token_email) ||
      sanitizeProfileName(extractEmailFromIdToken(parsed.id_token)) ||
      sanitizeProfileName(path.basename(filePath, path.extname(filePath)));
    if (!name) return { ok: false, error: 'invalid_profile_name' };
    const snap = snapshotProfile(name, isNative ? { keyringObj: parsed } : { standardObj: parsed });
    if (!snap.ok) return snap;
    return { ok: true, action: 'imported', account: name, profileDir: snap.dir };
  }

  function removeProfile(targetArg, { force = false } = {}) {
    const resolved = resolveTarget(targetArg);
    if (resolved.error) return { ok: false, error: resolved.error };
    const data = getAccountsData();
    if (data.active === resolved.name && !force) {
      return { ok: false, error: `cannot_remove_active_account: ${resolved.name} (pass --force to override)` };
    }
    fs.rmSync(resolved.dir, { recursive: true, force: true });
    data.old = data.old.filter((x) => x !== resolved.name);
    if (data.active === resolved.name) data.active = null;
    saveAccountsData(data);
    return { ok: true, action: 'removed', account: resolved.name };
  }

  function prepareNewAccountLogin({ restartDesktop = false } = {}) {
    /* Always snapshot the currently signed-in account first so nothing is ever lost */
    let backedUp = null;
    const live = readLiveKeyring();
    const std = readJsonSafe(credsFile, null);
    const jetski = readJsonSafe(jetskiTokenFile, null);
    if (live || std || jetski) {
      const saved = saveCurrent();
      if (!saved.ok) {
        return { ok: false, error: `backup_before_new_login_failed: ${saved.error}` };
      }
      backedUp = saved.account;
    }

    const keyringCleared = typeof keyring.clear === 'function' ? keyring.clear(KEYRING_SERVICE, KEYRING_ACCOUNT) : false;
    for (const f of [credsFile, idFile, jetskiTokenFile, mcpTokenCache, credScopeFile]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {}
    }

    if (fs.existsSync(appStorageFile)) {
      const appStorage = readJsonSafe(appStorageFile, null);
      if (appStorage && typeof appStorage === 'object' && !Array.isArray(appStorage)) {
        delete appStorage['jetski.onboarding.lastLoginUsername'];
        writeFileSecure(appStorageFile, JSON.stringify(appStorage), 0o644);
      }
    }

    const data = getAccountsData();
    if (data.active && !data.old.includes(data.active)) data.old.push(data.active);
    data.active = null;
    saveAccountsData(data);

    let desktopRestart = { skipped: true };
    if (restartDesktop && isDesktopRunning()) {
      desktopRestart = relaunchDesktop();
    }

    return {
      ok: true,
      action: 'prepared_new_login',
      backedUp,
      keyringCleared,
      desktopRestart
    };
  }

  return {
    inspectStatus,
    saveCurrent,
    switchAccount,
    switchNext,
    importProfile,
    removeProfile,
    prepareNewAccountLogin
  };
}

function parseScopeFlag(argv) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--scope=')) return a.slice('--scope='.length).trim();
    if (a === '--scope' && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1].trim();
  }
  return 'both';
}

export function runAuthCli(argv, opts = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const scope = parseScopeFlag(argv);
  const restartDesktop = flags.has('--restart');
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scope') {
      i++;
      continue;
    }
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  const sub = positional[0] || 'list';
  const mgr = createAuthManager(opts);

  if (sub === 'list' || sub === 'status') {
    return mgr.inspectStatus();
  }
  if (sub === 'save') {
    return mgr.saveCurrent(positional[1] || '');
  }
  if (sub === 'switch' || sub === 'use') {
    return mgr.switchAccount(positional[1], { scope, restartDesktop });
  }
  if (sub === 'next') {
    return mgr.switchNext({ scope, restartDesktop });
  }
  if (sub === 'import') {
    return mgr.importProfile(positional[1], positional[2] || '');
  }
  if (sub === 'remove' || sub === 'rm') {
    return mgr.removeProfile(positional[1], { force: flags.has('--force') });
  }
  /* Shorthand: `auth 1` or `auth user@gmail.com` */
  return mgr.switchAccount(sub, { scope, restartDesktop });
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  const res = runAuthCli(process.argv.slice(2));
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exitCode = 1;
}
