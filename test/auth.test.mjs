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
