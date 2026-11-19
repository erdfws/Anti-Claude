/**
 * Antigravity CLI (agy) account switcher tests.
 * Uses a throw-away HOME and mock keyring file — never touches real user credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  GO_KEYRING_PREFIX,
  decodeKeyringPayload,
  encodeKeyringPayload,
  toAntigravityFormat,
  toStandardFormat,
  createSystemKeyring,
  createAuthManager
} from '../cli/auth-manager.mjs';
import { startAuthBridge } from '../cli/auth-bridge.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.mjs');

function makeAuthHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anti-claude-auth-test-'));
  const mockKeyringFile = path.join(home, '.mock-keyring.json');
  const keyring = createSystemKeyring({ mockFile: mockKeyringFile });
  const mgr = createAuthManager({ homeDir: home, keyring });
  return {
    home,
    mockKeyringFile,
    keyring,
    mgr,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true })
  };
}

function makeNativePayload(email, accessToken, refreshToken = 'ref-1') {
  return {
    token: {
      access_token: accessToken,
      token_type: 'Bearer',
      refresh_token: refreshToken,
      expiry: '2026-12-01T00:00:00.000Z',
      expires_in: 3599
    },
    auth_method: 'consumer',
    id_token_email: email,
    writer_id: `writer-${email}`
  };
}

test('go-keyring-base64 codec round-trips losslessly and decodes legacy plain JSON', () => {
  const obj = makeNativePayload('alice@example.com', 'tok-alice');
  const encoded = encodeKeyringPayload(obj, { base64: true });
  assert.ok(encoded.startsWith(GO_KEYRING_PREFIX));
  assert.deepEqual(decodeKeyringPayload(encoded), obj);
  assert.deepEqual(decodeKeyringPayload(JSON.stringify(obj)), obj);
  assert.equal(decodeKeyringPayload('not-json'), null);

  const std = toStandardFormat(obj);
  assert.equal(std.access_token, 'tok-alice');
  assert.equal(std.refresh_token, 'ref-1');
  const back = toAntigravityFormat(std, 'alice@example.com');
  assert.equal(back.token.access_token, 'tok-alice');
  assert.equal(back.id_token_email, 'alice@example.com');
  assert.equal(back.auth_method, 'consumer');
});

test('save, switch, next, and live-keyring auto-backup work losslessly', () => {
  const h = makeAuthHome();
  try {
    /* 1. Alice is currently signed in via agy Keyring */
    const alicePayload = makeNativePayload('alice@example.com', 'tok-alice-v1', 'ref-alice');
    h.keyring.set(encodeKeyringPayload(alicePayload));

    const savedAlice = h.mgr.saveCurrent();
    assert.equal(savedAlice.ok, true);
    assert.equal(savedAlice.account, 'alice@example.com');

    /* 2. Bob has a legacy oauth_creds.json-only profile (like Agy-CLI-Auth-Manager) */
    const bobDir = path.join(h.home, '.gemini', 'auth_profiles', 'bob@example.com');
    fs.mkdirSync(bobDir, { recursive: true });
    fs.writeFileSync(
      path.join(bobDir, 'oauth_creds.json'),
      JSON.stringify({
        access_token: 'tok-bob-v1',
        refresh_token: 'ref-bob',
        token_type: 'Bearer',
        expiry_date: Date.parse('2026-12-01T00:00:00.000Z')
      })
    );

    /* Simulate agy refreshing Alice's access token in Keyring before we switch away */
    const aliceRefreshed = makeNativePayload('alice@example.com', 'tok-alice-refreshed', 'ref-alice');
    h.keyring.set(encodeKeyringPayload(aliceRefreshed));

    /* Create stale MCP token cache to verify it gets cleared on switch */
    const cacheFile = path.join(h.home, '.gemini', 'mcp-oauth-tokens-v2.json');
    fs.writeFileSync(cacheFile, '{}');

    /* 3. Switch to Bob by 1-based index (2) */
    const swBob = h.mgr.switchAccount('2');
    assert.equal(swBob.ok, true);
    assert.equal(swBob.to, 'bob@example.com');
    assert.equal(swBob.backedUp, 'alice@example.com');
    assert.equal(swBob.keyringUpdated, true);
    assert.equal(swBob.cacheCleared, true);
    assert.equal(fs.existsSync(cacheFile), false);

    /* Verify Keyring now holds Bob in go-keyring-base64 format */
    const rawKeyring = h.keyring.get();
    assert.ok(rawKeyring.startsWith(GO_KEYRING_PREFIX));
    const liveBob = decodeKeyringPayload(rawKeyring);
    assert.equal(liveBob.token.access_token, 'tok-bob-v1');
    assert.equal(liveBob.id_token_email, 'bob@example.com');

    /* Verify Alice's refreshed token was preserved in backup */
    const savedAliceBackup = JSON.parse(
      fs.readFileSync(path.join(h.home, '.gemini', 'auth_profiles', 'alice@example.com', 'antigravity_keyring.json'), 'utf8')
    );
    assert.equal(savedAliceBackup.token.access_token, 'tok-alice-refreshed');

    /* 4. Rotate back to Alice with switchNext() */
    const swNext = h.mgr.switchNext();
    assert.equal(swNext.ok, true);
    assert.equal(swNext.to, 'alice@example.com');
    const liveAlice = decodeKeyringPayload(h.keyring.get());
    assert.equal(liveAlice.token.access_token, 'tok-alice-refreshed');
    assert.equal(liveAlice.writer_id, 'writer-alice@example.com');

    /* 5. Status check */
    const status = h.mgr.inspectStatus();
    assert.equal(status.activeAccount, 'alice@example.com');
    assert.equal(status.keyringInSync, true);
    assert.equal(status.profileCount, 2);
  } finally {
    h.cleanup();
  }
});

test('import, remove protection, and `node install.mjs auth` CLI subcommand', () => {
  const h = makeAuthHome();
  try {
    const importFile = path.join(h.home, 'charlie.json');
    fs.writeFileSync(importFile, JSON.stringify(makeNativePayload('charlie@example.com', 'tok-charlie')));

    const env = {
      ...process.env,
      HOME: h.home,
      ANTI_CLAUDE_MOCK_KEYRING_FILE: h.mockKeyringFile
    };

    const imp = spawnSync(process.execPath, [INSTALL, 'auth', 'import', importFile], { encoding: 'utf8', env });
    assert.equal(imp.status, 0, imp.stderr);
    assert.equal(JSON.parse(imp.stdout).account, 'charlie@example.com');

    const sw = spawnSync(process.execPath, [INSTALL, 'auth', 'switch', 'charlie@example.com'], { encoding: 'utf8', env });
    assert.equal(sw.status, 0, sw.stderr);
    assert.equal(JSON.parse(sw.stdout).to, 'charlie@example.com');

    /* Removing active account without --force fails safely */
    const rmBlocked = spawnSync(process.execPath, [INSTALL, 'auth', 'remove', 'charlie@example.com'], { encoding: 'utf8', env });
    assert.equal(rmBlocked.status, 1);
    assert.match(JSON.parse(rmBlocked.stdout).error, /cannot_remove_active_account/);

    /* Removing with --force succeeds */
    const rmForced = spawnSync(process.execPath, [INSTALL, 'auth', 'remove', 'charlie@example.com', '--force'], { encoding: 'utf8', env });
    assert.equal(rmForced.status, 0, rmForced.stderr);
    assert.equal(JSON.parse(rmForced.stdout).action, 'removed');
  } finally {
    h.cleanup();
  }
});

test('Electron Desktop session sync: snapshots and switches app_storage.json, credential-user-scope & jetski token', () => {
  const h = makeAuthHome();
  try {
    const appDataDir = path.join(h.home, 'Library', 'Application Support', 'Antigravity');
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.mkdirSync(path.join(h.home, '.gemini'), { recursive: true });
    const appStoragePath = path.join(appDataDir, 'app_storage.json');
    const scopePath = path.join(appDataDir, 'credential-user-scope');
    const jetskiTokenPath = path.join(h.home, '.gemini', 'jetski-standalone-oauth-token');

    /* Alice is active on both Keyring and Electron Desktop */
    fs.writeFileSync(
      appStoragePath,
      JSON.stringify({
        'jetski.onboarding.lastLoginUsername': 'alice@example.com',
        'jetski.onboarding.lastLoginIsGcpTos': 'false',
        otherKey: 'keep-me'
      })
    );
    fs.writeFileSync(scopePath, 'u_alice_scope_01');
    fs.writeFileSync(
      jetskiTokenPath,
      JSON.stringify({ token: makeNativePayload('alice@example.com', 'tok-alice').token, auth_method: 'consumer' })
    );
    h.keyring.set(encodeKeyringPayload(makeNativePayload('alice@example.com', 'tok-alice')));

    let restartCalls = 0;
    const mgr = createAuthManager({
      homeDir: h.home,
      platform: 'darwin',
      desktopAppDataDir: appDataDir,
      keyring: h.keyring,
      isDesktopRunning: () => true,
      relaunchDesktop: () => {
        restartCalls++;
        return { restarted: true, cdpEnabled: true };
      }
    });

    const saved = mgr.saveCurrent();
    assert.equal(saved.ok, true);
    assert.match(saved.source, /desktop/);

    /* Prepare Bob profile without desktop_meta.json (e.g. imported from CLI) */
    const bobDir = path.join(h.home, '.gemini', 'auth_profiles', 'bob@example.com');
    fs.mkdirSync(bobDir, { recursive: true });
    fs.writeFileSync(
      path.join(bobDir, 'antigravity_keyring.json'),
      JSON.stringify(makeNativePayload('bob@example.com', 'tok-bob'))
    );

    /* Switch to Bob without --restart: Desktop metadata updated & desktopRestartRequired=true */
    const swBob = mgr.switchAccount('bob@example.com');
    assert.equal(swBob.ok, true);
    assert.equal(swBob.desktopSync.synced, true);
    assert.equal(swBob.desktopSync.appStorageUpdated, true);
    assert.equal(swBob.desktopSync.scopeAction, 'cleared_for_rebind');
    assert.equal(swBob.desktopRestartRequired, true);
    assert.equal(restartCalls, 0);

    const storageAfterBob = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
    assert.equal(storageAfterBob['jetski.onboarding.lastLoginUsername'], 'bob@example.com');
    assert.equal(storageAfterBob.otherKey, 'keep-me');
    assert.equal(fs.existsSync(scopePath), false, 'stale scope removed so Desktop re-derives Bob scope');

    /* Switch back to Alice with --restart: restores Alice's saved credential-user-scope and triggers relaunch */
    const swAlice = mgr.switchAccount('alice@example.com', { restartDesktop: true });
    assert.equal(swAlice.ok, true);
    assert.equal(swAlice.desktopSync.scopeAction, 'restored');
    assert.equal(fs.readFileSync(scopePath, 'utf8'), 'u_alice_scope_01');
    assert.equal(swAlice.desktopRestart.restarted, true);
    assert.equal(swAlice.desktopRestartRequired, false);
    assert.equal(restartCalls, 1);

    /* --scope=cli does not touch Desktop app_storage.json */
    const swCliOnly = mgr.switchAccount('bob@example.com', { scope: 'cli' });
    assert.equal(swCliOnly.ok, true);
    assert.equal(swCliOnly.desktopSync.skipped, 'scope_cli_only');
    assert.equal(JSON.parse(fs.readFileSync(appStoragePath, 'utf8'))['jetski.onboarding.lastLoginUsername'], 'alice@example.com');
  } finally {
    h.cleanup();
  }
});

test('local auth bridge HTTP API: security headers, add-account backup, and quota-triggered auto-switch', async () => {
  const h = makeAuthHome();
  let bridge = null;
  try {
    h.keyring.set(encodeKeyringPayload(makeNativePayload('alice@example.com', 'tok-alice')));
    const bobDir = path.join(h.home, '.gemini', 'auth_profiles', 'bob@example.com');
    fs.mkdirSync(bobDir, { recursive: true });
    fs.writeFileSync(
      path.join(bobDir, 'antigravity_keyring.json'),
      JSON.stringify(makeNativePayload('bob@example.com', 'tok-bob'))
    );

    let restartCount = 0;
    const mgr = createAuthManager({
      homeDir: h.home,
      keyring: h.keyring,
      isDesktopRunning: () => true,
      relaunchDesktop: () => {
        restartCount++;
        return { restarted: true, cdpEnabled: true };
      }
    });

    bridge = await startAuthBridge({ port: 0, homeDir: h.home, authManager: mgr });
    const base = `http://${bridge.host}:${bridge.port}`;
    const post = (p, body, extraHeaders = {}) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Anti-Claude-Bridge': '1', ...extraHeaders },
        body: JSON.stringify(body)
      });

    /* Security: reject external origin & missing CSRF header */
    const badOrigin = await fetch(`${base}/auth/status`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(badOrigin.status, 403);
    const noHeader = await fetch(`${base}/auth/save`, { method: 'POST', body: '{}' });
    assert.equal(noHeader.status, 403);

    /* Save active account (Alice) */
    const saveRes = await (await post('/auth/save', {})).json();
    assert.equal(saveRes.ok, true);
    assert.equal(saveRes.account, 'alice@example.com');

    /* Enable auto-switch at 90% threshold */
    const cfgRes = await (await post('/auth/config', { autoSwitch: { enabled: true, thresholdUsedPct: 90, autoRestart: true } })).json();
    assert.equal(cfgRes.ok, true);
    assert.equal(cfgRes.autoSwitch.enabled, true);

    /* Below threshold (80%) -> no switch */
    const below = await (await post('/auth/quota-check', { usedPct: 80 })).json();
    assert.equal(below.switched, false);
    assert.equal(below.reason, 'below_threshold');

    /* At threshold (92%) -> auto-switches Alice -> Bob and restarts Desktop */
    const hit = await (await post('/auth/quota-check', { usedPct: 92 })).json();
    assert.equal(hit.switched, true);
    assert.equal(hit.to, 'bob@example.com');
    assert.equal(restartCount, 1);

    /* Immediate second check hits cooldown */
    const cool = await (await post('/auth/quota-check', { usedPct: 95 })).json();
    assert.equal(cool.switched, false);
    assert.equal(cool.reason, 'cooldown_active');

    /* Add new account backs up Bob and clears live keyring for fresh sign-in */
    const addRes = await (await post('/auth/add-account', { restartDesktop: true })).json();
    assert.equal(addRes.ok, true);
    assert.equal(addRes.backedUp, 'bob@example.com');
    assert.equal(addRes.keyringCleared, true);
    assert.equal(h.keyring.get(), null);
    assert.equal(restartCount, 2);
  } finally {
    if (bridge?.server) bridge.server.close();
    h.cleanup();
  }
});
