/*
 * SlieQwenBoss Lo8 — backend hardening layer
 * Dependency-free Node 18+ middleware. Loaded before server.js creates its HTTP server.
 *
 * Adds:
 * - security headers + strict CORS allowlist
 * - request IDs, JSON body limits, timeouts
 * - per-IP rate limiting
 * - HMAC-signed backend sessions (no plaintext passwords)
 * - server-side Qwen proxy with SSE streaming
 * - server-side MCP JSON-RPC/SSE proxy with host allowlist
 * - lightweight audit events
 * - graceful error handling / shutdown hooks
 *
 * IMPORTANT:
 * - This layer does not pretend that PostgreSQL/WAF/managed auth exists.
 * - For production, configure SESSION_SECRET, AUTH_EMAIL, AUTH_PASSWORD_SCRYPT,
 *   QWEN_API_KEY, and MCP_ALLOWED_HOSTS.
 */

'use strict';

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

const originalCreateServer = http.createServer;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const AUTH_EMAIL = process.env.AUTH_EMAIL || '';
const AUTH_PASSWORD_SCRYPT = process.env.AUTH_PASSWORD_SCRYPT || '';
const QWEN_API_KEY = process.env.QWEN_API_KEY || '';
const QWEN_API_BASE = (process.env.QWEN_API_BASE || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
const QWEN_DEFAULT_MODEL = process.env.QWEN_DEFAULT_MODEL || 'qwen-plus';
const APP_ORIGINS = new Set(
  String(process.env.APP_ORIGINS || process.env.APP_URL || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
);
const MCP_ALLOWED_HOSTS = new Set(
  String(process.env.MCP_ALLOWED_HOSTS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
);

const MAX_BODY = Math.min(2 * 1024 * 1024, Math.max(16 * 1024, Number(process.env.MAX_BODY_BYTES || 1024 * 1024)));
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = Math.min(300, Math.max(10, Number(process.env.RATE_LIMIT_PER_MIN || 60)));
const SESSION_TTL_MS = Math.min(7 * 864e5, Math.max(15 * 60_000, Number(process.env.SESSION_TTL_MS || 7 * 864e5)));
const REQUEST_TIMEOUT_MS = Math.min(120_000, Math.max(5_000, Number(process.env.REQUEST_TIMEOUT_MS || 60_000)));

const buckets = new Map();
const audit = [];
const sessions = new Map();

function logAudit(event, meta = {}) {
  const item = {
    ts: new Date().toISOString(),
    event,
    requestId: meta.requestId || null,
    ip: meta.ip || null,
    path: meta.path || null,
    ...meta
  };
  audit.unshift(item);
  if (audit.length > 500) audit.pop();
  if (process.env.AUDIT_LOG_STDOUT !== 'false') console.log(`[AUDIT] ${JSON.stringify(item)}`);
}

function getIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

function safeOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  return APP_ORIGINS.has(origin) ? origin : null;
}

function securityHeaders(req, res) {
  const origin = safeOrigin(req);
  res.setHeader('X-Request-ID', req.__requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';");
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, Mcp-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Mcp-Session-Id');
}

function limitedRate(req, res, cost = 1) {
  const ip = getIp(req);
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    b = { start: now, count: 0 };
    buckets.set(ip, b);
  }
  b.count += cost;
  if (b.count > RATE_LIMIT) {
    res.setHeader('Retry-After', String(Math.ceil((b.start + RATE_WINDOW_MS - now) / 1000)));
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'rate_limited', requestId: req.__requestId }));
    logAudit('rate_limited', { requestId: req.__requestId, ip, path: req.url });
    return false;
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request body too large'), { code: 'BODY_TOO_LARGE' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function b64u(buf) { return Buffer.from(buf).toString('base64url'); }

function signSession(payload) {
  const raw = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('base64url');
  return `${raw}.${mac}`;
}

function verifySession(token) {
  if (!SESSION_SECRET || !token || typeof token !== 'string') return null;
  const [raw, sig] = token.split('.');
  if (!raw || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(raw).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function requireSession(req, res) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const session = verifySession(token);
  if (!session) {
    json(res, 401, { ok: false, error: 'unauthorized', requestId: req.__requestId });
    logAudit('auth_denied', { requestId: req.__requestId, ip: getIp(req), path: req.url });
    return null;
  }
  return session;
}

function scryptVerify(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const N = Number(p[1]), r = Number(p[2]), pp = Number(p[3]);
  const salt = Buffer.from(p[4], 'hex');
  const expected = Buffer.from(p[5], 'hex');
  if (!N || !r || !pp || !salt.length || !expected.length) return false;
  try {
    const actual = crypto.scryptSync(password, salt, expected.length, { N, r, p: pp, maxmem: 128 * N * r + 1024 });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function authConfigured() { return Boolean(SESSION_SECRET && AUTH_EMAIL && AUTH_PASSWORD_SCRYPT); }

async function handleAuth(req, res) {
  if (req.method === 'GET' && req.url === '/api/auth/status') {
    return json(res, 200, { ok: true, configured: authConfigured(), ttlMs: SESSION_TTL_MS });
  }
  if (req.method !== 'POST' || req.url !== '/api/auth/login') return false;
  if (!authConfigured()) return json(res, 503, { ok: false, error: 'auth_not_configured', requestId: req.__requestId });

  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); }
  catch { return json(res, 400, { ok: false, error: 'invalid_json', requestId: req.__requestId }); }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (email !== AUTH_EMAIL.toLowerCase() || !password || !scryptVerify(password, AUTH_PASSWORD_SCRYPT)) {
    logAudit('login_failed', { requestId: req.__requestId, ip: getIp(req), path: req.url });
    return json(res, 401, { ok: false, error: 'invalid_credentials', requestId: req.__requestId });
  }

  const now = Date.now();
  const payload = { sub: email, iat: now, exp: now + SESSION_TTL_MS, jti: crypto.randomUUID() };
  sessions.set(payload.jti, payload.exp);
  logAudit('login_success', { requestId: req.__requestId, ip: getIp(req), path: req.url, subject: email });
  return json(res, 200, { ok: true, token: signSession(payload), expiresAt: payload.exp });
}

function allowedMcpUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) return null;
  const host = u.hostname.toLowerCase();
  if (MCP_ALLOWED_HOSTS.size && !MCP_ALLOWED_HOSTS.has(host)) return null;
  if (!MCP_ALLOWED_HOSTS.size && process.env.NODE_ENV === 'production') return null;
  return u;
}

async function handleQwen(req, res) {
  if (req.method !== 'POST') return false;
  if (!QWEN_API_KEY) return json(res, 503, { ok: false, error: 'qwen_not_configured', requestId: req.__requestId });
  if (!requireSession(req, res)) return true;

  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); }
  catch { return json(res, 400, { ok: false, error: 'invalid_json', requestId: req.__requestId }); }

  const model = String(body.model || QWEN_DEFAULT_MODEL).slice(0, 200);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length || messages.length > 100) return json(res, 400, { ok: false, error: 'messages_invalid', requestId: req.__requestId });

  const upstream = await fetch(`${QWEN_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${QWEN_API_KEY}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      model,
      messages,
      stream: body.stream !== false,
      temperature: Math.min(2, Math.max(0, Number(body.temperature ?? 0.7))),
      max_tokens: Math.min(8192, Math.max(128, Number(body.max_tokens ?? 2048)))
    })
  });

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    logAudit('qwen_upstream_error', { requestId: req.__requestId, status: upstream.status, path: req.url });
    return json(res, upstream.status >= 500 ? 502 : upstream.status, { ok: false, error: 'qwen_upstream_error', upstreamStatus: upstream.status, detail: text.slice(0, 300), requestId: req.__requestId });
  }

  const ct = upstream.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream') || body.stream === false) {
    const data = await upstream.json();
    return json(res, 200, { ok: true, requestId: req.__requestId, data });
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
  logAudit('qwen_stream_complete', { requestId: req.__requestId, path: req.url });
  return true;
}

async function handleMcp(req, res) {
  if (req.method !== 'POST') return false;
  if (!requireSession(req, res)) return true;

  let body;
  try { body = JSON.parse(await readBody(req) || '{}'); }
  catch { return json(res, 400, { ok: false, error: 'invalid_json', requestId: req.__requestId }); }

  const target = allowedMcpUrl(body.url);
  if (!target) return json(res, 400, { ok: false, error: 'mcp_url_not_allowed', hint: 'Configure MCP_ALLOWED_HOSTS on the backend', requestId: req.__requestId });

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (body.authorization) headers.Authorization = String(body.authorization).slice(0, 4096);
  if (body.sessionId) headers['Mcp-Session-Id'] = String(body.sessionId).slice(0, 512);

  const upstream = await fetch(target, { method: 'POST', headers, body: JSON.stringify(body.rpc || {}) });
  const sessionId = upstream.headers.get('Mcp-Session-Id');
  if (sessionId) res.setHeader('Mcp-Session-Id', sessionId);

  const ct = upstream.headers.get('content-type') || '';
  if (upstream.status === 202) return json(res, 202, { ok: true, requestId: req.__requestId, accepted: true, sessionId });

  const text = await upstream.text();
  if (ct.includes('text/event-stream')) {
    res.writeHead(upstream.status, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
    res.end(text);
    return true;
  }
  res.writeHead(upstream.status, { 'Content-Type': ct || 'application/json; charset=utf-8' });
  res.end(text);
  return true;
}

function wrapHandler(handler) {
  return async function hardenedHandler(req, res) {
    req.__requestId = crypto.randomUUID();
    req.__startedAt = Date.now();
    securityHeaders(req, res);

    // Prevent the legacy server from widening CORS back to '*'.
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => {
      const lower = String(name).toLowerCase();
      if (lower === 'access-control-allow-origin') return originalSetHeader(name, safeOrigin(req) || 'null');
      if (lower === 'access-control-allow-credentials') return originalSetHeader(name, 'true');
      return originalSetHeader(name, value);
    };

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!limitedRate(req, res, req.url.startsWith('/api/qwen') ? 2 : 1)) return;

    const timer = setTimeout(() => {
      if (!res.headersSent) json(res, 408, { ok: false, error: 'request_timeout', requestId: req.__requestId });
      else res.destroy();
    }, REQUEST_TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));

    try {
      if (req.url === '/api/auth/status' || req.url === '/api/auth/login') {
        const handled = await handleAuth(req, res);
        if (handled !== false) return;
      }
      if (req.url === '/api/qwen/chat') { await handleQwen(req, res); return; }
      if (req.url === '/api/mcp/proxy') { await handleMcp(req, res); return; }
      if (req.url === '/api/security/status' && req.method === 'GET') {
        return json(res, 200, { ok: true, requestId: req.__requestId, authConfigured: authConfigured(), qwenConfigured: Boolean(QWEN_API_KEY), mcpAllowlistConfigured: MCP_ALLOWED_HOSTS.size > 0, rateLimitPerMinute: RATE_LIMIT, maxBodyBytes: MAX_BODY });
      }
      if (req.url === '/api/audit/recent' && req.method === 'GET') {
        if (!requireSession(req, res)) return;
        return json(res, 200, { ok: true, items: audit.slice(0, 50) });
      }
      await handler(req, res);
    } catch (error) {
      console.error('[HARDENING]', error);
      logAudit('server_error', { requestId: req.__requestId, ip: getIp(req), path: req.url, error: error && error.message });
      if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_server_error', requestId: req.__requestId });
      else res.destroy();
    }
  };
}

http.createServer = function patchedCreateServer(handler) {
  const server = originalCreateServer.call(http, wrapHandler(handler));
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(65_000, REQUEST_TIMEOUT_MS + 5_000);
  server.keepAliveTimeout = 5_000;

  const shutdown = signal => {
    logAudit('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  return server;
};

process.on('unhandledRejection', reason => console.error('[UNHANDLED_REJECTION]', reason));
process.on('uncaughtException', error => console.error('[UNCAUGHT_EXCEPTION]', error));
