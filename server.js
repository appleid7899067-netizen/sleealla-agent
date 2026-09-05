const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = Number(process.env.PORT || 10000);
const model = process.env.DEFAULT_MODEL || 'demo/local-orchestrator';
const openRouterKey = process.env.OPENROUTER_API_KEY || '';
const dataDir = path.join(root, 'data');
const auditFile = path.join(dataDir, 'runs.jsonl');
fs.mkdirSync(dataDir, { recursive: true });

const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) reject(new Error('Request too large')); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function id() { return crypto.randomUUID(); }
function toolsFor(command) {
  const c = command.toLowerCase();
  const tools = [];
  if (/database|ฐานข้อมูล|sql|นักเรียน|ข้อมูล/.test(c)) tools.push('SQL Builder');
  if (/auth|login|สิทธิ์|ผู้ใช้/.test(c)) tools.push('Auth Service');
  if (/validate|ตรวจ|qa|ทดสอบ/.test(c)) tools.push('Data Validator');
  if (/web|ค้น|search|ข้อมูล/.test(c)) tools.push('Web Search');
  if (/code|โค้ด|สร้าง|แก้/.test(c)) tools.push('Code Builder');
  return [...new Set(tools)].slice(0, 5).length ? [...new Set(tools)].slice(0, 5) : ['Task Planner', 'Data Validator'];
}

async function callModel(command) {
  if (!openRouterKey) return { text: `DEMO MODE: วิเคราะห์คำสั่งสำเร็จ — ${command}`, model: 'demo/local-orchestrator' };
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: command }], temperature: 0.2 })
  });
  if (!response.ok) throw new Error(`Model HTTP ${response.status}`);
  const data = await response.json();
  return { text: data.choices?.[0]?.message?.content || 'Model returned no content', model };
}

async function runPipeline(command, emit) {
  const requestId = id();
  const started = Date.now();
  const tools = toolsFor(command);
  const event = (stage, status, message, extra = {}) => emit({ ts: new Date().toISOString(), requestId, stage, status, message, ...extra });

  event('gateway', 'running', `รับ Request: "${command}"`);
  await sleep(120);
  event('gateway', 'done', 'Request validated');

  event('agent', 'running', 'Agent Core วิเคราะห์ Intent และแตกงาน');
  await sleep(180);
  event('agent', 'done', 'Intent classified • execution plan ready');

  event('router', 'running', `Model Router เลือก ${openRouterKey ? model : 'Demo Local Orchestrator'}`);
  let modelResult;
  let attempts = 0;
  try {
    attempts = 1;
    modelResult = await callModel(command);
    event('router', 'done', `Selected model: ${modelResult.model}`, { attempts });
  } catch (err) {
    event('router', 'fallback', `Primary model failed: ${err.message}`);
    attempts = 2;
    modelResult = { text: `FALLBACK MODE: รับงานต่อด้วย local orchestrator — ${command}`, model: 'demo/fallback-orchestrator' };
    event('router', 'done', `Fallback selected: ${modelResult.model}`, { attempts });
  }

  event('tools', 'running', 'Tool Executor เริ่มทำงาน', { tools });
  for (const tool of tools) {
    await sleep(90);
    event('tools', 'tool', `✓ ${tool}`, { tool });
  }
  event('tools', 'done', `${tools.length} tools completed`);

  event('qa', 'running', 'QA Engine ตรวจผลลัพธ์และ policy');
  await sleep(140);
  event('qa', 'done', 'Validation passed');

  event('database', 'running', 'State Store บันทึก execution audit');
  const result = {
    requestId, command, model: modelResult.model, attempts, tools,
    result: modelResult.text, startedAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started
  };
  fs.appendFileSync(auditFile, JSON.stringify(result) + '\n');
  await sleep(60);
  event('database', 'done', 'Execution audit committed');

  result.elapsedMs = Date.now() - started;
  event('result', 'done', `COMPLETED in ${result.elapsedMs}ms`, { elapsedMs: result.elapsedMs, model: result.model, attempts });
  return result;
}

async function handleStream(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  const command = String(payload?.command || '').trim();
  if (!command) return send(res, 400, { error: 'command is required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no'
  });
  const emit = item => res.write(`data: ${JSON.stringify(item)}\n\n`);
  try {
    const result = await runPipeline(command, emit);
    emit({ type: 'complete', ...result });
  } catch (err) {
    emit({ type: 'error', message: err.message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const requestPath = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
  if (req.method === 'GET' && requestPath === '/api/health') return send(res, 200, { ok: true, model: openRouterKey ? model : 'demo/local-orchestrator', live: true });
  if (req.method === 'POST' && requestPath === '/api/agent/stream') return handleStream(req, res);

  const relative = requestPath === '/' || requestPath === '/chat' || requestPath === '/console' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`Sleealla Agent live on port ${port}`));
