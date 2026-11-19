#!/usr/bin/env node
/**
 * Anti-Claude — Localhost Auth Bridge for Electron Desktop GUI
 * Zero-dependency loopback-only HTTP server (`127.0.0.1:47621`) bridging
 * `user/custom.js` (Settings -> UI Enhancements & Quota Popover) to `cli/auth-manager.mjs`.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthManager } from './auth-manager.mjs';

export const DEFAULT_BRIDGE_HOST = '127.0.0.1';
export const DEFAULT_BRIDGE_PORT = Number(process.env.ANTI_CLAUDE_AUTH_BRIDGE_PORT) || 47621;

const DEFAULT_AUTO_SWITCH = {
  enabled: false,
  thresholdUsedPct: 90,
  autoRestart: true,
  cooldownSec: 180,
  lastAutoSwitchAt: 0
};

function readJsonSafe(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

function isAllowedOrigin(origin) {
  if (!origin || origin === 'null') return true;
  return /^(file:\/\/|app:\/\/|vscode-file:\/\/|https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/i.test(origin);
}

function normalizeAutoSwitch(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const threshold = Number(src.thresholdUsedPct);
  const cooldown = Number(src.cooldownSec);
  const lastTs = Number(src.lastAutoSwitchAt);
  return {
    enabled: Boolean(src.enabled),
    thresholdUsedPct: Number.isFinite(threshold) ? Math.max(50, Math.min(100, Math.round(threshold))) : DEFAULT_AUTO_SWITCH.thresholdUsedPct,
    autoRestart: src.autoRestart !== undefined ? Boolean(src.autoRestart) : DEFAULT_AUTO_SWITCH.autoRestart,
    cooldownSec: Number.isFinite(cooldown) ? Math.max(30, Math.min(3600, Math.round(cooldown))) : DEFAULT_AUTO_SWITCH.cooldownSec,
    lastAutoSwitchAt: Number.isFinite(lastTs) && lastTs > 0 ? lastTs : 0
  };
}

function readBodyJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

export function createAuthBridgeServer({
  homeDir = os.homedir(),
  authManager = null,
  configPath = null
} = {}) {
  const mgr = authManager || createAuthManager({ homeDir });
  const cfgFile = configPath || path.join(homeDir, '.gemini', 'antigravity', 'anti-claude', 'auth-ui-config.json');

  function loadUiConfig() {
    const raw = readJsonSafe(cfgFile, {});
    return {
      autoSwitch: normalizeAutoSwitch(raw?.autoSwitch)
    };
  }

  function saveUiConfig(next) {
    const clean = { autoSwitch: normalizeAutoSwitch(next?.autoSwitch) };
    writeJsonAtomic(cfgFile, clean);
    return clean;
  }

  function sendJson(res, statusCode, payload, origin) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    };
    if (origin && isAllowedOrigin(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Vary'] = 'Origin';
    } else if (!origin) {
      headers['Access-Control-Allow-Origin'] = '*';
    }
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Anti-Claude-Bridge';
    res.writeHead(statusCode, headers);
    res.end(`${JSON.stringify(payload)}\n`);
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    if (!isAllowedOrigin(origin)) {
      return sendJson(res, 403, { ok: false, error: 'origin_not_allowed' }, '');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Anti-Claude-Bridge',
        'Access-Control-Max-Age': '600'
      });
      res.end();
      return;
    }

    const urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (req.method === 'GET' && urlPath === '/health') {
      return sendJson(res, 200, { ok: true, service: 'anti-claude-auth-bridge' }, origin);
    }

    if (req.method === 'GET' && urlPath === '/auth/status') {
      const status = mgr.inspectStatus();
      const uiCfg = loadUiConfig();
      return sendJson(res, 200, { ...status, autoSwitch: uiCfg.autoSwitch }, origin);
    }

    if (req.method === 'POST') {
      if (req.headers['x-anti-claude-bridge'] !== '1') {
        return sendJson(res, 403, { ok: false, error: 'missing_bridge_header' }, origin);
      }
      let body;
      try {
        body = await readBodyJson(req);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message }, origin);
      }

      if (urlPath === '/auth/save') {
        const result = mgr.saveCurrent(typeof body.name === 'string' ? body.name : '');
        const status = mgr.inspectStatus();
        return sendJson(res, result.ok ? 200 : 400, { ...result, status }, origin);
      }

      if (urlPath === '/auth/add-account') {
        const result = mgr.prepareNewAccountLogin({ restartDesktop: body.restartDesktop !== false });
        const status = mgr.inspectStatus();
        return sendJson(res, result.ok ? 200 : 400, { ...result, status }, origin);
      }

      if (urlPath === '/auth/switch') {
        const result = mgr.switchAccount(body.target, {
          scope: typeof body.scope === 'string' ? body.scope : 'both',
          restartDesktop: body.restartDesktop !== false
        });
        const status = mgr.inspectStatus();
        return sendJson(res, result.ok ? 200 : 400, { ...result, status }, origin);
      }

      if (urlPath === '/auth/next') {
        const result = mgr.switchNext({
          scope: typeof body.scope === 'string' ? body.scope : 'both',
          restartDesktop: body.restartDesktop !== false
        });
        const status = mgr.inspectStatus();
        return sendJson(res, result.ok ? 200 : 400, { ...result, status }, origin);
      }

      if (urlPath === '/auth/remove') {
        const result = mgr.removeProfile(body.target, { force: Boolean(body.force) });
        const status = mgr.inspectStatus();
        return sendJson(res, result.ok ? 200 : 400, { ...result, status }, origin);
      }

      if (urlPath === '/auth/config') {
        const current = loadUiConfig();
        const merged = {
          autoSwitch: Object.assign({}, current.autoSwitch, body.autoSwitch || {})
        };
        const saved = saveUiConfig(merged);
        return sendJson(res, 200, { ok: true, autoSwitch: saved.autoSwitch }, origin);
      }

      if (urlPath === '/auth/quota-check') {
        const uiCfg = loadUiConfig();
        const as = uiCfg.autoSwitch;
        const usedPct = Number(body.usedPct);
        if (!as.enabled) {
          return sendJson(res, 200, { ok: true, switched: false, reason: 'auto_switch_disabled' }, origin);
        }
        if (!Number.isFinite(usedPct) || usedPct < as.thresholdUsedPct) {
          return sendJson(
            res,
            200,
            { ok: true, switched: false, reason: 'below_threshold', usedPct, thresholdUsedPct: as.thresholdUsedPct },
            origin
          );
        }
        const now = Date.now();
        if (as.lastAutoSwitchAt && now - as.lastAutoSwitchAt < as.cooldownSec * 1000) {
          return sendJson(res, 200, { ok: true, switched: false, reason: 'cooldown_active' }, origin);
        }
        const st = mgr.inspectStatus();
        if (st.profileCount < 2) {
          return sendJson(res, 200, { ok: true, switched: false, reason: 'need_at_least_two_accounts' }, origin);
        }
        const sw = mgr.switchNext({ scope: 'both', restartDesktop: as.autoRestart });
        if (sw.ok) {
          saveUiConfig({ autoSwitch: { ...as, lastAutoSwitchAt: now } });
        }
        return sendJson(res, 200, { ...sw, switched: Boolean(sw.ok), triggerUsedPct: usedPct }, origin);
      }
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' }, origin);
  });

  return server;
}

export function startAuthBridge({
  host = DEFAULT_BRIDGE_HOST,
  port = DEFAULT_BRIDGE_PORT,
  homeDir = os.homedir(),
  authManager = null,
  configPath = null
} = {}) {
  const server = createAuthBridgeServer({ homeDir, authManager, configPath });
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        return resolve({ ok: true, alreadyRunning: true, host, port, server: null });
      }
      reject(err);
    });
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        ok: true,
        alreadyRunning: false,
        host,
        port: typeof addr === 'object' && addr ? addr.port : port,
        server
      });
    });
  });
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  startAuthBridge()
    .then((info) => {
      console.log(JSON.stringify({ ok: true, listening: !info.alreadyRunning, alreadyRunning: info.alreadyRunning, host: info.host, port: info.port }));
    })
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      process.exitCode = 1;
    });
}
