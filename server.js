const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const skillsEngine = require('./skills-engine.js');
const skillsData = require('./skills.js');

const initResult = skillsEngine.initSkillsEngine(skillsData.SKILLS_400 || skillsData);
console.log(`✅ Skills Engine loaded: ${initResult.totalSkills} skills, ${initResult.categories} categories`);

const PORT = Number(process.env.PORT || 10000);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY || '';
const APP_URL = process.env.APP_URL || 'http://localhost';

const parseList = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);

const MODEL_POOL = parseList(process.env.MODEL_POOL).length
  ? parseList(process.env.MODEL_POOL)
  : ['openrouter/free'];

const MOONSHOT_MODELS = parseList(process.env.MOONSHOT_MODELS);
const MAX_ATTEMPTS = Math.min(8, Math.max(1, Number(process.env.LLM_MAX_TOTAL_ATTEMPTS || 8)));
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 30000);

const json = (res, status, body) => {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(body));
};

const sendEvent = (res, event) => {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

async function fetchWithTimeout(url, options, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') throw new Error(`Request timeout after ${timeoutMs}ms`);
    throw error;
  }
}

async function callOpenRouter(model, messages, apiKey = OPENROUTER_API_KEY) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': APP_URL,
      'X-Title': 'SILELO/QX Agent Backend'
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`OpenRouter HTTP ${response.status}: ${errText}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || 'Model returned no text.';
  return { ok: true, demo: false, provider: 'openrouter', model, text };
}

async function callMoonshot(model, messages, apiKey = MOONSHOT_API_KEY) {
  if (!apiKey) throw new Error('MOONSHOT_API_KEY is not configured');
  const response = await fetchWithTimeout('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Moonshot HTTP ${response.status}: ${errText}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || 'Model returned no text.';
  return { ok: true, demo: false, provider: 'moonshot', model, text };
}

function resolveModel(model) {
  if (model.startsWith('moonshot:')) return { provider: 'moonshot', id: model.slice(9) };
  if (model.startsWith('openrouter:')) return { provider: 'openrouter', id: model.slice(11) };
  if (MOONSHOT_MODELS.includes(model)) return { provider: 'moonshot', id: model };
  return { provider: 'openrouter', id: model };
}

async function callModel(model, messages, credentials = {}) {
  const target = resolveModel(model);
  const openrouterKey = credentials.openrouterApiKey || OPENROUTER_API_KEY;
  const moonshotKey = credentials.moonshotApiKey || MOONSHOT_API_KEY;
  if (target.provider === 'moonshot') {
    return callMoonshot(target.id, messages, moonshotKey);
  }
  return callOpenRouter(target.id, messages, openrouterKey);
}

const stats = {
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  demoCount: 0,
  modelUsage: {},
  skillUsage: {},
  totalElapsedMs: 0,
  lastRequests: [],
  startedAt: Date.now()
};

function recordStat({ command, model, provider, skills, elapsedMs, success, demo }) {
  stats.totalRequests += 1;
  if (success) stats.successCount += 1; else stats.failureCount += 1;
  if (demo) stats.demoCount += 1;
  const key = `${provider}/${model}`;
  stats.modelUsage[key] = (stats.modelUsage[key] || 0) + 1;
  (skills || []).forEach(s => { stats.skillUsage[s.id] = (stats.skillUsage[s.id] || 0) + 1; });
  if (elapsedMs) stats.totalElapsedMs += elapsedMs;
  stats.lastRequests.unshift({ ts: Date.now(), command: String(command || '').slice(0, 60) + '...', model: key, elapsedMs, success, demo });
  if (stats.lastRequests.length > 30) stats.lastRequests.pop();
}

async function runPipeline(command, res, req, options = {}) {
  const { skillMode = 'auto', selectedSkills = [], showSkills = true, openrouterApiKey = '', moonshotApiKey = '' } = options;
  const started = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tools = ['Intent Router', 'Skill Engine', 'Model Router', 'Tool Executor', 'QA Validator'];
  req.on('close', () => console.log(`⚠️ Client disconnected: ${requestId}`));
  sendEvent(res, { type: 'start', requestId, command, maxAttempts: MAX_ATTEMPTS, pool: MODEL_POOL, skillMode });
  sendEvent(res, { type: 'step', step: 'API Gateway', status: 'active', message: 'Request received and validated' });
  sendEvent(res, { type: 'step', step: 'Agent Core', status: 'active', message: 'Analyzing intent' });
  sendEvent(res, { type: 'tools', tools });

  let activeSkills = [];
  let skillMatchInfo = null;
  sendEvent(res, { type: 'step', step: 'Skill Engine', status: 'active', message: 'Matching skills to command...' });

  if (skillMode === 'user' && selectedSkills.length > 0) {
    const allSkills = skillsEngine.getAllSkills();
    activeSkills = selectedSkills.map(id => allSkills.find(s => s.id === id)).filter(Boolean);
    skillMatchInfo = { mode: 'user', count: activeSkills.length, message: `ใช้ทักษะที่เลือก: ${activeSkills.length} รายการ` };
  } else if (skillMode === 'hybrid') {
    const autoMatched = skillsEngine.autoMatch(command);
    const allSkills = skillsEngine.getAllSkills();
    const userSelected = (selectedSkills || []).map(id => allSkills.find(s => s.id === id)).filter(Boolean);
    if (autoMatched) activeSkills.push(autoMatched.skill);
    for (const sk of userSelected) if (!activeSkills.find(s => s.id === sk.id)) activeSkills.push(sk);
    skillMatchInfo = { mode: 'hybrid', count: activeSkills.length, autoMatched: autoMatched ? autoMatched.skill.title : null, userSelected: userSelected.length, message: 'ผสม auto-match + ทักษะที่เลือก' };
  } else {
    const matched = skillsEngine.autoMatch(command);
    if (matched) {
      activeSkills = [matched.skill, ...(matched.alternatives || [])];
      skillMatchInfo = { mode: 'auto', count: activeSkills.length, primary: matched.skill, alternatives: matched.alternatives, message: matched.message };
    } else skillMatchInfo = { mode: 'auto', count: 0, message: 'ไม่พบทักษะที่ตรงกัน ใช้ความรู้ทั่วไป' };
  }

  if (showSkills && activeSkills.length > 0) sendEvent(res, { type: 'skills', mode: skillMode, count: activeSkills.length, skills: activeSkills, matchInfo: skillMatchInfo });
  sendEvent(res, { type: 'step', step: 'Skill Engine', status: 'success', message: skillMatchInfo.message });

  const systemPrompt = skillsEngine.buildSkillPrompt(activeSkills, 'You are the Agent Core of a multi-model tool hub. Answer concisely in Thai. If skills are provided, incorporate them and guide the user.');
  const messages = [{ role: 'system', content: systemPrompt }, { role: 'user', content: command }];
  sendEvent(res, { type: 'step', step: 'Model Router', status: 'active', message: `Pool loaded: ${MODEL_POOL.length} models` });

  let result = null;
  const failures = [];
  const attempts = Math.min(MAX_ATTEMPTS, MODEL_POOL.length);
  for (let i = 0; i < attempts; i++) {
    if (res.writableEnded) break;
    const model = MODEL_POOL[i];
    const target = resolveModel(model);
    sendEvent(res, { type: 'attempt', attempt: i + 1, maxAttempts: MAX_ATTEMPTS, provider: target.provider, model: target.id, status: 'running' });
    try {
      result = await callModel(model, messages, { openrouterApiKey, moonshotApiKey });
      sendEvent(res, { type: 'attempt', attempt: i + 1, provider: result.provider, model: result.model, status: 'success' });
      break;
    } catch (error) {
      failures.push({ model, provider: target.provider, error: error.message });
      sendEvent(res, { type: 'attempt', attempt: i + 1, provider: target.provider, model: target.id, status: 'failed', error: error.message });
    }
  }

  const elapsedMs = Date.now() - started;
  if (!result) {
    sendEvent(res, { type: 'step', step: 'QA Engine', status: 'failed', message: 'All available model attempts failed' });
    recordStat({ command, model: '-', provider: '-', skills: activeSkills, elapsedMs, success: false, demo: false });
    sendEvent(res, { type: 'complete', status: 'error', requestId, elapsedMs, attempts: failures.length, failures, skillMatchInfo });
    return;
  }
  sendEvent(res, { type: 'step', step: 'Tool Executor', status: 'active', message: 'Executing selected tools' });
  sendEvent(res, { type: 'step', step: 'QA Engine', status: 'active', message: 'Validating response' });
  recordStat({ command, model: result.model, provider: result.provider, skills: activeSkills, elapsedMs, success: true, demo: result.demo });
  sendEvent(res, { type: 'complete', status: 'success', requestId, elapsedMs, attempts: failures.length + 1, model: result.model, provider: result.provider, demo: result.demo, tools, skillMatchInfo, activeSkills: activeSkills.length > 0 ? activeSkills.map(s => ({ id: s.id, category: s.category, title: s.title })) : null, result: result.text });
}

// Browser bridge: send the API key entered in the QX Settings panel to this same-origin backend.
// The backend still prefers Render's OPENROUTER_API_KEY when configured.
const FRONTEND_AI_BRIDGE = `<script>(function(){window.callLLM=async function(message,fileAttachments){const apiKey=(window.state&&window.state.settings&&window.state.settings.apiKey)||'';const r=await fetch('/api/agent/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:String(message||''),skillMode:'auto',showSkills:false,apiKey})});if(!r.ok){throw new Error('AI backend HTTP '+r.status);}if(!r.body){throw new Error('AI backend returned no stream');}const reader=r.body.getReader();const decoder=new TextDecoder();let buffer='';let result='';let terminalError='';while(true){const x=await reader.read();if(x.done)break;buffer+=decoder.decode(x.value,{stream:true});const parts=buffer.split('\\n\\n');buffer=parts.pop()||'';for(const part of parts){for(const line of part.split('\\n')){if(!line.startsWith('data:'))continue;try{const event=JSON.parse(line.slice(5).trim());if(event.type==='complete'){if(event.status==='success')result=event.result||'';else terminalError=event.error||event.failures?.map(f=>f.error).join(' | ')||'AI backend failed';}}catch(e){}}}}if(terminalError)throw new Error(terminalError);if(!result)throw new Error('AI backend returned an empty response');return result;};})();</script>`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  const healthBody = () => ({ ok: true, service: 'silelo-qx-agent', models: MODEL_POOL.length, openrouterConfigured: Boolean(OPENROUTER_API_KEY), moonshotConfigured: Boolean(MOONSHOT_API_KEY), demo: !OPENROUTER_API_KEY && !MOONSHOT_API_KEY, maxAttempts: MAX_ATTEMPTS, uptime: Math.round((Date.now() - stats.startedAt) / 1000), skills: { total: skillsEngine.getAllSkills().length, categories: skillsEngine.getCategories().length } });
  if (req.method === 'GET' && (url.pathname === '/api/health' || url.pathname === '/health')) return json(res, 200, healthBody());

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const avgMs = stats.totalRequests > 0 ? Math.round(stats.totalElapsedMs / stats.totalRequests) : 0;
    const successRate = stats.totalRequests > 0 ? Math.round((stats.successCount / stats.totalRequests) * 100) : 0;
    return json(res, 200, { ok: true, totalRequests: stats.totalRequests, successCount: stats.successCount, failureCount: stats.failureCount, demoCount: stats.demoCount, successRate, avgMs, modelUsage: stats.modelUsage, skillUsage: stats.skillUsage, lastRequests: stats.lastRequests });
  }

  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('search');
    const topK = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    let skills;
    if (search) skills = skillsEngine.searchSkills(search, { topK: topK + offset, categories: category ? [category] : null });
    else if (category) skills = skillsEngine.getSkillsByCategory(category);
    else skills = skillsEngine.getAllSkills();
    return json(res, 200, { ok: true, count: skills.slice(offset, offset + topK).length, total: skills.length, skills: skills.slice(offset, offset + topK) });
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/categories') return json(res, 200, { ok: true, categories: skillsEngine.getCategories() });

  if (req.method === 'POST' && url.pathname === '/api/skills/auto-match') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { const body = JSON.parse(raw || '{}'); const matched = skillsEngine.autoMatch(String(body.command || '').trim()); return json(res, 200, { ok: true, matched: matched ? { primary: matched.skill, alternatives: matched.alternatives } : null }); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); } });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/agent/stream') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 2 * 1024 * 1024) { res.writeHead(413); res.end('Payload too large'); } });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
      const command = String(body.command || '').trim();
      if (!command) return json(res, 400, { error: 'command is required' });
      const options = { skillMode: body.skillMode || 'auto', selectedSkills: Array.isArray(body.skills) ? body.skills : [], showSkills: body.showSkills !== false, openrouterApiKey: String(body.apiKey || ''), moonshotApiKey: String(body.moonshotApiKey || '') };
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      try { await runPipeline(command, res, req, options); } catch (error) { sendEvent(res, { type: 'complete', status: 'error', error: error.message }); } finally { res.end(); }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/styles.css') {
    fs.readFile(path.join(__dirname, 'styles.css'), (error, data) => {
      if (error) return json(res, 500, { error: 'styles.css unavailable' });
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'max-age=86400' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (error, data) => {
      if (error) return json(res, 500, { error: 'index.html unavailable' });
      const html = data.toString('utf8').replace('</body>', `${FRONTEND_AI_BRIDGE}</body>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      res.end(html);
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`🚀 SILELO/QX Backend listening on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
