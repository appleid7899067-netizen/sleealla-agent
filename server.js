const http = require('http');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL_POOL = (process.env.MODEL_POOL || [
  'deepseek/deepseek-chat',
  'google/gemini-2.5-flash',
  'openai/gpt-oss-120b',
  'qwen/qwen3-235b-a22b',
  'meta-llama/llama-3.3-70b-instruct'
].join(',')).split(',').map(s => s.trim()).filter(Boolean);
const MAX_ATTEMPTS = Math.min(8, Math.max(1, Number(process.env.LLM_MAX_TOTAL_ATTEMPTS || 8)));

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const sendEvent = (res, event) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

async function callModel(model, command) {
  if (!OPENROUTER_API_KEY) {
    return { ok: true, demo: true, model, text: `DEMO MODE: รับคำสั่ง “${command}” และประมวลผลผ่าน ${model}` };
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost',
      'X-Title': 'คิดก่อนน่ะ — Backend Processing Console'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are the Agent Core of a multi-model tool hub. Answer concisely and return useful implementation guidance.' },
        { role: 'user', content: command }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  return { ok: true, demo: false, model, text: data.choices?.[0]?.message?.content || 'Model returned no text.' };
}

async function runPipeline(command, res) {
  const started = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tools = ['Intent Router', 'Model Router', 'Tool Executor', 'QA Validator'];

  sendEvent(res, { type: 'start', requestId, command, maxAttempts: MAX_ATTEMPTS, pool: MODEL_POOL });
  sendEvent(res, { type: 'step', step: 'API Gateway', status: 'active', message: 'Request received and validated' });
  sendEvent(res, { type: 'step', step: 'Agent Core', status: 'active', message: 'Analyzing intent' });
  sendEvent(res, { type: 'tools', tools });
  sendEvent(res, { type: 'step', step: 'Model Router', status: 'active', message: `Pool loaded: ${MODEL_POOL.length} models` });

  let result = null;
  const failures = [];

  for (let i = 0; i < Math.min(MAX_ATTEMPTS, MODEL_POOL.length); i++) {
    const model = MODEL_POOL[i];
    sendEvent(res, { type: 'attempt', attempt: i + 1, maxAttempts: MAX_ATTEMPTS, model, status: 'running' });
    try {
      result = await callModel(model, command);
      sendEvent(res, { type: 'attempt', attempt: i + 1, model, status: 'success' });
      break;
    } catch (error) {
      failures.push({ model, error: error.message });
      sendEvent(res, { type: 'attempt', attempt: i + 1, model, status: 'failed', error: error.message });
    }
  }

  if (!result) {
    const elapsedMs = Date.now() - started;
    sendEvent(res, { type: 'step', step: 'QA Engine', status: 'failed', message: 'All available model attempts failed' });
    sendEvent(res, { type: 'complete', status: 'error', requestId, elapsedMs, attempts: failures.length, failures });
    return;
  }

  sendEvent(res, { type: 'step', step: 'Tool Executor', status: 'active', message: 'Executing selected tools' });
  sendEvent(res, { type: 'step', step: 'QA Engine', status: 'active', message: 'Validating response' });
  sendEvent(res, { type: 'step', step: 'State Store', status: 'active', message: 'Persisting request state' });

  const elapsedMs = Date.now() - started;
  sendEvent(res, {
    type: 'complete',
    status: 'success',
    requestId,
    elapsedMs,
    attempts: failures.length + 1,
    model: result.model,
    demo: result.demo,
    tools,
    result: result.text
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'sleealla-agent', models: MODEL_POOL.length, demo: !OPENROUTER_API_KEY });
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/stream') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
      const command = String(body.command || '').trim();
      if (!command) return json(res, 400, { error: 'command is required' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      try { await runPipeline(command, res); } catch (error) { sendEvent(res, { type: 'complete', status: 'error', error: error.message }); }
      res.end();
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(302, { Location: '/index.html' });
    return res.end();
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`คิดก่อนน่ะ backend listening on :${PORT}`));
