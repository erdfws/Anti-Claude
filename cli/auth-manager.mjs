#!/usr/bin/env node
/**
 * Anti-Claude — Antigravity CLI (agy) Account Switcher
 * Zero-dependency multi-account manager with lossless `go-keyring-base64:` Keyring sync (Node.js >= 22).
 *
 * Compatible with existing `~/.gemini/auth_profiles/<email>/` & `~/.gemini/google_accounts.json` layouts.
 *
 * Commands (via `node install.mjs auth ...` or `node cli/auth-manager.mjs ...`):
 *   auth [list|status]            List saved accounts and live keyring status
 *   auth save [name]              Snapshot the currently logged-in agy account into the pool
 *   auth switch <index|name>      Switch to an account (auto-backs up the active account first)
 *   auth next                     Rotate to the next saved account
 *   auth import <file> [name]     Import an oauth_creds.json or antigravity_keyring.json profile
 *   auth remove <index|name>      Remove a profile from the pool (--force to remove active)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GO_KEYRING_PREFIX = 'go-keyring-base64:';
export const KEYRING_SERVICE = 'gemini';
export const KEYRING_ACCOUNT = 'antigravity';

const DEFAULT_SCOPE =
  'https://www.googleapis.com/auth/cloud-platform openid https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

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

export function toAntigravityFormat(credsObj, email = '') {
  if (!credsObj || typeof credsObj !== 'object') return null;
  /* Already in native Antigravity keyring format */
  if (credsObj.token && typeof credsObj.token === 'object') {
    const copy = JSON.parse(JSON.stringify(credsObj));
    if (email && !copy.id_token_email) copy.id_token_email = email;
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
      }
    };
  }

  return {
    get() {
      return null;
    },
    set() {
      return false;
    }
  };
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

export function createAuthManager({ homeDir = os.homedir(), keyring = createSystemKeyring() } = {}) {
  const geminiDir = path.join(homeDir, '.gemini');
  const profilesDir = path.join(geminiDir, 'auth_profiles');
  const accountsJson = path.join(geminiDir, 'google_accounts.json');
  const credsFile = path.join(geminiDir, 'oauth_creds.json');
  const idFile = path.join(geminiDir, 'google_account_id');
  const mcpTokenCache = path.join(geminiDir, 'mcp-oauth-tokens-v2.json');

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

  function snapshotProfile(profileName, { keyringObj = null, standardObj = null } = {}) {
    const clean = sanitizeProfileName(profileName);
    if (!clean) return { ok: false, error: 'invalid_profile_name' };
    const dir = path.join(profilesDir, clean);
    fs.mkdirSync(dir, { recursive: true });

    const agyPayload = keyringObj || (standardObj ? toAntigravityFormat(standardObj, clean) : null);
    const stdPayload = standardObj || (keyringObj ? toStandardFormat(keyringObj) : null);

    if (!agyPayload && !stdPayload) return { ok: false, error: 'no_credentials_to_save' };
    if (agyPayload) {
      writeFileSecure(path.join(dir, 'antigravity_keyring.json'), `${JSON.stringify(agyPayload, null, 2)}\n`, 0o600);
    }
    if (stdPayload) {
      writeFileSecure(path.join(dir, 'oauth_creds.json'), `${JSON.stringify(stdPayload, null, 2)}\n`, 0o600);
    }
    if (fs.existsSync(idFile)) {
      fs.copyFileSync(idFile, path.join(dir, 'google_account_id'));
    }
    return { ok: true, name: clean, dir };
  }

  function inspectStatus() {
    const profiles = getProfiles();
    const data = getAccountsData();
    const live = readLiveKeyring();
    const liveEmail = live?.id_token_email || null;
    return {
      ok: true,
      activeAccount: data.active || liveEmail || null,
      recordedActive: data.active,
      liveKeyringEmail: liveEmail,
      liveKeyringPresent: Boolean(live),
      keyringInSync: Boolean(liveEmail && data.active && liveEmail === data.active),
      profileCount: profiles.length,
      profiles: profiles.map((name, i) => {
        const dir = path.join(profilesDir, name);
        return {
          index: i + 1,
          name,
          active: name === (data.active || liveEmail),
          hasKeyringPayload: fs.existsSync(path.join(dir, 'antigravity_keyring.json')),
          hasOAuthCreds: fs.existsSync(path.join(dir, 'oauth_creds.json'))
        };
      })
    };
  }

  function saveCurrent(explicitName = '') {
    const live = readLiveKeyring();
    const std = readJsonSafe(credsFile, null);
    if (!live && !std) {
      return { ok: false, error: 'no_active_credentials_found (run `agy` to sign in first)' };
    }
    const data = getAccountsData();
    const inferredName = sanitizeProfileName(explicitName) || sanitizeProfileName(live?.id_token_email) || sanitizeProfileName(data.active);
    if (!inferredName) {
      return { ok: false, error: 'cannot_infer_account_name: pass an explicit name (`auth save <email-or-alias>`)' };
    }
    const snap = snapshotProfile(inferredName, { keyringObj: live, standardObj: std });
    if (!snap.ok) return snap;

    if (data.active && data.active !== inferredName && !data.old.includes(data.active)) {
      data.old.push(data.active);
    }
    data.active = inferredName;
    data.old = data.old.filter((x) => x !== inferredName);
    saveAccountsData(data);

    return {
      ok: true,
      action: 'saved',
      account: inferredName,
      source: live ? (std ? 'keyring+file' : 'keyring') : 'file',
      profileDir: snap.dir
    };
  }

  function switchAccount(targetArg) {
    const resolved = resolveTarget(targetArg);
    if (resolved.error) return { ok: false, error: resolved.error };
    const { name: targetName, dir: targetDir } = resolved;

    const targetKeyringJson = readJsonSafe(path.join(targetDir, 'antigravity_keyring.json'), null);
    const targetOauthJson = readJsonSafe(path.join(targetDir, 'oauth_creds.json'), null);
    if (!targetKeyringJson && !targetOauthJson) {
      return { ok: false, error: `missing_credentials_for: ${targetName}` };
    }

    const data = getAccountsData();
    const liveBefore = readLiveKeyring();
    const currentActive = data.active || liveBefore?.id_token_email || null;

    /* Back up the active account's freshest credentials (preferring live keyring!) before switching */
    let backedUp = null;
    if (currentActive && currentActive !== targetName) {
      const stdBefore = readJsonSafe(credsFile, null);
      if (liveBefore || stdBefore) {
        const snap = snapshotProfile(currentActive, { keyringObj: liveBefore, standardObj: stdBefore });
        if (snap.ok) backedUp = currentActive;
      }
    }

    const nextKeyringObj = targetKeyringJson || toAntigravityFormat(targetOauthJson, targetName);
    const nextStandardObj = targetOauthJson || toStandardFormat(targetKeyringJson);

    const keyringUpdated = keyring.set(encodeKeyringPayload(nextKeyringObj, { base64: true }), KEYRING_SERVICE, KEYRING_ACCOUNT);
    if (nextStandardObj) {
      writeFileSecure(credsFile, `${JSON.stringify(nextStandardObj, null, 2)}\n`, 0o600);
    }

    const targetIdFile = path.join(targetDir, 'google_account_id');
    if (fs.existsSync(targetIdFile)) {
      fs.copyFileSync(targetIdFile, idFile);
    } else if (fs.existsSync(idFile)) {
      fs.rmSync(idFile, { force: true });
    }

    let cacheCleared = false;
    if (fs.existsSync(mcpTokenCache)) {
      try {
        fs.rmSync(mcpTokenCache, { force: true });
        cacheCleared = true;
      } catch {}
    }

    if (currentActive && currentActive !== targetName && !data.old.includes(currentActive)) {
      data.old.push(currentActive);
    }
    data.active = targetName;
    data.old = data.old.filter((x) => x !== targetName);
    saveAccountsData(data);

    return {
      ok: true,
      action: currentActive === targetName ? 'reapplied' : 'switched',
      from: currentActive,
      to: targetName,
      backedUp,
      keyringUpdated,
      cacheCleared
    };
  }

  function switchNext() {
    const profiles = getProfiles();
    if (!profiles.length) return { ok: false, error: 'no_profiles_found' };
    const status = inspectStatus();
    const current = status.activeAccount;
    const idx = current ? profiles.indexOf(current) : -1;
    const nextName = profiles[(idx + 1) % profiles.length];
    if (profiles.length === 1 && nextName === current) {
      return { ok: false, error: 'only_one_account_available', active: current };
    }
    return switchAccount(nextName);
  }

  function importProfile(filePath, explicitName = '') {
    if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: `file_not_found: ${filePath || ''}` };
    const parsed = readJsonSafe(filePath, null);
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'invalid_json_credentials' };
    const isNative = Boolean(parsed.token && typeof parsed.token === 'object');
    const name =
      sanitizeProfileName(explicitName) ||
      sanitizeProfileName(parsed.id_token_email) ||
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

  return {
    inspectStatus,
    saveCurrent,
    switchAccount,
    switchNext,
    importProfile,
    removeProfile
  };
}

export function runAuthCli(argv, opts = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));
  const sub = positional[0] || 'list';
  const mgr = createAuthManager(opts);

  let result;
  if (sub === 'list' || sub === 'status') {
    result = mgr.inspectStatus();
  } else if (sub === 'save') {
    result = mgr.saveCurrent(positional[1] || '');
  } else if (sub === 'switch' || sub === 'use') {
    result = mgr.switchAccount(positional[1]);
  } else if (sub === 'next') {
    result = mgr.switchNext();
  } else if (sub === 'import') {
    result = mgr.importProfile(positional[1], positional[2] || '');
  } else if (sub === 'remove' || sub === 'rm') {
    result = mgr.removeProfile(positional[1], { force: flags.has('--force') });
  } else {
    /* Shorthand: `auth 1` or `auth user@gmail.com` */
    result = mgr.switchAccount(sub);
  }
  return result;
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
