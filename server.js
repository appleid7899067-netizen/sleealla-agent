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

const parseList = (value) => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
const MODEL_POOL = parseList(process.env.MODEL_POOL).length
  ? parseList(process.env.MODEL_POOL)
  : [
      'deepseek/deepseek-chat',
      'google/gemini-2.5-flash',
      'openai/gpt-oss-120b',
      'qwen/qwen3-235b-a22b',
      'meta-llama/llama-3.3-70b-instruct'
    ];
const MOONSHOT_MODELS = parseList(process.env.MOONSHOT_MODELS);
const OPENROUTER_FREE_LIST = parseList(process.env.OPENROUTER_MODEL_FREE_LIST);
const MAX_ATTEMPTS = Math.min(8, Math.max(1, Number(process.env.LLM_MAX_TOTAL_ATTEMPTS || 8)));

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

const sendEvent = (res, event) => {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
};

async function callOpenRouter(model, messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.APP_URL || 'http://localhost',
      'X-Title': 'คิดก่อนน่ะ — Backend Processing Console'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
  const data = await response.json();
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  const text = message && message.content;
  return { ok: true, demo: false, provider: 'openrouter', model, text: text || 'Model returned no text.' };
}

async function callMoonshot(model, messages) {
  const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MOONSHOT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) throw new Error(`Moonshot HTTP ${response.status}`);
  const data = await response.json();
  const choice = data.choices && data.choices[0];
  const message = choice && choice.message;
  const text = message && message.content;
  return { ok: true, demo: false, provider: 'moonshot', model, text: text || 'Model returned no text.' };
}

function resolveModel(model) {
  if (model.startsWith('moonshot:')) return { provider: 'moonshot', id: model.slice(9) };
  if (model.startsWith('openrouter:')) return { provider: 'openrouter', id: model.slice(11) };
  if (MOONSHOT_MODELS.includes(model)) return { provider: 'moonshot', id: model };
  return { provider: 'openrouter', id: model };
}

async function callModel(model, messages) {
  const target = resolveModel(model);
  if (target.provider === 'moonshot') {
    if (!MOONSHOT_API_KEY) return { ok: true, demo: true, provider: 'moonshot', model: target.id, text: `DEMO MODE: รับคำสั่งด้วย Moonshot/${target.id} (messages: ${messages.length})` };
    return callMoonshot(target.id, messages);
  }
  if (!OPENROUTER_API_KEY) return { ok: true, demo: true, provider: 'openrouter', model: target.id, text: `DEMO MODE: รับคำสั่งด้วย OpenRouter/${target.id} (messages: ${messages.length})` };
  return callOpenRouter(target.id, messages);
}

// ─────────────────────────────────────────────
// #8 STATS DASHBOARD — in-memory stats store
// ─────────────────────────────────────────────
const stats = {
  totalRequests: 0,
  successCount: 0,
  failureCount: 0,
  demoCount: 0,
  modelUsage: {},      // { 'openrouter/deepseek-chat': count }
  skillUsage: {},      // { skillId: count }
  totalElapsedMs: 0,
  lastRequests: [],    // last 20 requests
  startedAt: Date.now()
};

function recordStat({ command, model, provider, skills, elapsedMs, success, demo }) {
  stats.totalRequests += 1;
  if (success) stats.successCount += 1; else stats.failureCount += 1;
  if (demo) stats.demoCount += 1;
  const key = `${provider}/${model}`;
  stats.modelUsage[key] = (stats.modelUsage[key] || 0) + 1;
  (skills || []).forEach(s => {
    stats.skillUsage[s.id] = (stats.skillUsage[s.id] || 0) + 1;
  });
  if (elapsedMs) stats.totalElapsedMs += elapsedMs;
  stats.lastRequests.unshift({
    ts: Date.now(),
    command: String(command || '').slice(0, 80),
    model: key,
    elapsedMs,
    success,
    demo
  });
  if (stats.lastRequests.length > 20) stats.lastRequests.pop();
}

async function runPipeline(command, res, options = {}) {
  const {
    skillMode = 'auto',
    selectedSkills = [],
    showSkills = true,
    categoryFilter = null
  } = options;

  const started = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tools = ['Intent Router', 'Skill Engine', 'Model Router', 'Tool Executor', 'QA Validator'];

  sendEvent(res, { type: 'start', requestId, command, maxAttempts: MAX_ATTEMPTS, pool: MODEL_POOL, skillMode });
  sendEvent(res, { type: 'step', step: 'API Gateway', status: 'active', message: 'Request received and validated' });
  sendEvent(res, { type: 'step', step: 'Agent Core', status: 'active', message: 'Analyzing intent' });
  sendEvent(res, { type: 'tools', tools });

  let activeSkills = [];
  let skillMatchInfo = null;

  sendEvent(res, { type: 'step', step: 'Skill Engine', status: 'active', message: 'Matching skills to command...' });

  if (skillMode === 'user' && selectedSkills.length > 0) {
    const allSkills = skillsEngine.getAllSkills();
    activeSkills = selectedSkills
      .map(id => allSkills.find(s => s.id === id))
      .filter(Boolean);

    skillMatchInfo = {
      mode: 'user',
      count: activeSkills.length,
      message: `ใช้ทักษะที่เลือก: ${activeSkills.length} รายการ`
    };
  } else if (skillMode === 'hybrid') {
    const autoMatched = skillsEngine.autoMatch(command);
    const allSkills = skillsEngine.getAllSkills();
    const userSelected = (selectedSkills || [])
      .map(id => allSkills.find(s => s.id === id))
      .filter(Boolean);

    if (autoMatched) {
      activeSkills.push(autoMatched.skill);
    }
    for (const sk of userSelected) {
      if (!activeSkills.find(s => s.id === sk.id)) {
        activeSkills.push(sk);
      }
    }

    skillMatchInfo = {
      mode: 'hybrid',
      count: activeSkills.length,
      autoMatched: autoMatched ? autoMatched.skill.title : null,
      userSelected: userSelected.length,
      message: `ผสม auto-match (${autoMatched ? 1 : 0}) + ทักษะที่เลือก (${userSelected.length})`
    };
  } else {
    const matched = skillsEngine.autoMatch(command);
    if (matched) {
      activeSkills = [matched.skill, ...(matched.alternatives || [])];
      skillMatchInfo = {
        mode: 'auto',
        count: activeSkills.length,
        primary: matched.skill,
        alternatives: matched.alternatives,
        message: matched.message,
        reason: matched.reason,
        practice: matched.practice
      };
    } else {
      skillMatchInfo = {
        mode: 'auto',
        count: 0,
        message: 'ไม่พบทักษะที่ตรงกัน ใช้ความรู้ทั่วไป'
      };
    }
  }

  if (showSkills && activeSkills.length > 0) {
    sendEvent(res, {
      type: 'skills',
      mode: skillMode,
      count: activeSkills.length,
      skills: activeSkills,
      matchInfo: skillMatchInfo
    });
  }

  sendEvent(res, {
    type: 'step',
    step: 'Skill Engine',
    status: 'success',
    message: skillMatchInfo.message
  });

  const systemPrompt = skillsEngine.buildSkillPrompt(
    activeSkills,
    'You are the Agent Core of a multi-model tool hub. Answer concisely and return useful implementation guidance. If skills are provided, you MUST incorporate them into your response and guide the user through the practice step.'
  );

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: command }
  ];

  sendEvent(res, { type: 'step', step: 'Model Router', status: 'active', message: `Pool loaded: ${MODEL_POOL.length} models` });

  let result = null;
  const failures = [];
  const attempts = Math.min(MAX_ATTEMPTS, MODEL_POOL.length);

  for (let i = 0; i < attempts; i++) {
    const model = MODEL_POOL[i];
    const target = resolveModel(model);
    sendEvent(res, { type: 'attempt', attempt: i + 1, maxAttempts: MAX_ATTEMPTS, provider: target.provider, model: target.id, status: 'running' });
    try {
      result = await callModel(model, messages);
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
  sendEvent(res, { type: 'step', step: 'State Store', status: 'active', message: 'Persisting request state' });

  recordStat({ command, model: result.model, provider: result.provider, skills: activeSkills, elapsedMs, success: true, demo: result.demo });

  sendEvent(res, {
    type: 'complete',
    status: 'success',
    requestId,
    elapsedMs,
    attempts: failures.length + 1,
    model: result.model,
    provider: result.provider,
    demo: result.demo,
    tools,
    skillMatchInfo,
    activeSkills: activeSkills.length > 0 ? activeSkills.map(s => ({ id: s.id, category: s.category, title: s.title })) : null,
    result: result.text
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ── /api/health ─────────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/health') {
    const cats = skillsEngine.getCategories();
    return json(res, 200, {
      ok: true,
      service: 'sleealla-agent',
      models: MODEL_POOL.length,
      moonshotModels: MOONSHOT_MODELS.length,
      openrouterFreeModels: OPENROUTER_FREE_LIST.length,
      openrouterConfigured: Boolean(OPENROUTER_API_KEY),
      moonshotConfigured: Boolean(MOONSHOT_API_KEY),
      demo: !OPENROUTER_API_KEY && !MOONSHOT_API_KEY,
      maxAttempts: MAX_ATTEMPTS,
      uptime: Math.round((Date.now() - stats.startedAt) / 1000),
      skills: {
        total: skillsEngine.getAllSkills().length,
        categories: cats.length,
        categoryList: cats
      }
    });
  }

  // ── /api/stats (#8) ─────────────────────────
  if (req.method === 'GET' && url.pathname === '/api/stats') {
    const avgMs = stats.totalRequests > 0
      ? Math.round(stats.totalElapsedMs / stats.totalRequests)
      : 0;
    const successRate = stats.totalRequests > 0
      ? Math.round((stats.successCount / stats.totalRequests) * 100)
      : 0;
    return json(res, 200, {
      ok: true,
      totalRequests: stats.totalRequests,
      successCount: stats.successCount,
      failureCount: stats.failureCount,
      demoCount: stats.demoCount,
      successRate,
      avgMs,
      totalElapsedMs: stats.totalElapsedMs,
      modelUsage: stats.modelUsage,
      skillUsage: stats.skillUsage,
      lastRequests: stats.lastRequests
    });
  }

  // ── /api/skills (list/search/filter) ───────
  if (req.method === 'GET' && url.pathname === '/api/skills') {
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('search');
    const topK = parseInt(url.searchParams.get('limit') || '20');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    let skills;
    if (search) {
      skills = skillsEngine.searchSkills(search, { topK: topK + offset, categories: category ? [category] : null });
    } else if (category) {
      skills = skillsEngine.getSkillsByCategory(category);
    } else {
      skills = skillsEngine.getAllSkills();
    }

    const total = skills.length;
    const paged = skills.slice(offset, offset + topK);

    return json(res, 200, {
      ok: true,
      count: paged.length,
      total,
      offset,
      limit: topK,
      skills: paged
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/skills/categories') {
    return json(res, 200, {
      ok: true,
      categories: skillsEngine.getCategories()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/skills/auto-match') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const command = String(body.command || '').trim();
        const matched = skillsEngine.autoMatch(command);
        if (!matched) {
          return json(res, 200, { ok: true, matched: null, message: 'No matching skill found' });
        }
        return json(res, 200, {
          ok: true,
          matched: {
            primary: matched.skill,
            alternatives: matched.alternatives
          }
        });
      } catch (e) {
        return json(res, 400, { error: 'Invalid JSON' });
      }
    });
    return;
  }

  // ── /api/agent/stream (SSE) ────────────────
  if (req.method === 'POST' && url.pathname === '/api/agent/stream') {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (e) { return json(res, 400, { error: 'Invalid JSON' }); }
      const command = String(body.command || '').trim();
      if (!command) return json(res, 400, { error: 'command is required' });

      const options = {
        skillMode: body.skillMode || 'auto',
        selectedSkills: Array.isArray(body.skills) ? body.skills : [],
        showSkills: body.showSkills !== false,
        categoryFilter: body.category || null
      };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      try {
        await runPipeline(command, res, options);
      } catch (error) {
        sendEvent(res, { type: 'complete', status: 'error', error: error.message });
      }
      res.end();
    });
    return;
  }

  // ── static styles.css ──────────────────────
  if (req.method === 'GET' && url.pathname === '/styles.css') {
    fs.readFile(path.join(__dirname, 'styles.css'), (error, data) => {
      if (error) return json(res, 500, { error: 'styles.css unavailable' });
      res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'max-age=86400' });
      res.end(data);
    });
    return;
  }

  // ── static index.html ───────────────────────
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (error, data) => {
      if (error) return json(res, 500, { error: 'index.html unavailable' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`คิดก่อนน่ะ backend listening on :${PORT}`));
