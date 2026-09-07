require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Readable } = require('node:stream');
const { route } = require('./aether-core/intelligence-router');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const MAX_RETRIES = Number(process.env.SLEELLA_MAX_RETRIES) || 8;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    key: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3.5:free'
  },
  qwen: {
    name: 'Qwen (DashScope)',
    base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    key: process.env.DASHSCOPE_API_KEY,
    model: process.env.DASHSCOPE_MODEL || 'qwen-plus'
  },
  nvidia: {
    name: 'NVIDIA NIM',
    base: 'https://integrate.api.nvidia.com/v1',
    key: process.env.NVIDIA_API_KEY,
    model: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct'
  }
};

async function callAI(messages, preferredProvider = 'openrouter', attempt = 0) {
  const provider = PROVIDERS[preferredProvider];
  if (!provider || !provider.key) {
    const fallbacks = Object.keys(PROVIDERS).filter(k => k !== preferredProvider && PROVIDERS[k].key);
    if (fallbacks.length && attempt < MAX_RETRIES) {
      return callAI(messages, fallbacks[0], attempt + 1);
    }
    throw new Error('ไม่มี API Key ที่ใช้งานได้');
  }

  try {
    const response = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${provider.key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: provider.model, messages, stream: true })
    });

    if (!response.ok) throw new Error(`${provider.name} Error: ${response.status}`);
    return response;
  } catch (error) {
    const fallbacks = Object.keys(PROVIDERS).filter(k => k !== preferredProvider && PROVIDERS[k].key);
    if (fallbacks.length && attempt < MAX_RETRIES) {
      console.log(`⚠️ ${provider.name} ล้มเหลว (${error.message}), ลอง ${fallbacks[0]} (${attempt + 1}/${MAX_RETRIES})`);
      return callAI(messages, fallbacks[0], attempt + 1);
    }
    throw error;
  }
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'sleealla-agent', router: 'aether-inspired', maxRetries: MAX_RETRIES });
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages, provider } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }

    const latestUserMessage = [...messages].reverse().find(m => m && m.role === 'user' && typeof m.content === 'string');
    const userInput = latestUserMessage?.content || '';
    const decision = route(userInput, {
      action: provider || 'chat',
      authorized: String(process.env.SLEELLA_SECURITY_AUTHORIZED).toLowerCase() === 'true',
      retries: MAX_RETRIES,
    });

    if (!decision.gate.allowed) {
      return res.status(403).json({
        error: 'Security authorization required before execution',
        intent: decision.intent,
        lane: decision.lane,
      });
    }

    const response = await callAI(messages, provider || 'openrouter');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Sleella-Intent', decision.intent);
    res.setHeader('X-Sleella-Lane', decision.lane);
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Chat Error:', error);
    if (!res.headersSent) res.status(500).json({ error: error.message });
    else res.end();
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    providers: Object.entries(PROVIDERS).map(([key, p]) => ({
      id: key, name: p.name, model: p.model, ready: !!p.key
    })),
    router: { enabled: true, maxRetries: MAX_RETRIES, securityAuthorizationRequired: true }
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sleealla Agent running on 0.0.0.0:${PORT}`);
  console.log(`🧠 Aether-inspired router: ✅`);
  console.log(`🔁 Retry/Fallback: ${MAX_RETRIES}`);
  console.log(`🔑 OpenRouter: ${PROVIDERS.openrouter.key ? '✅' : '❌'}`);
  console.log(`🔑 Qwen: ${PROVIDERS.qwen.key ? '✅' : '❌'}`);
  console.log(`🔑 NVIDIA: ${PROVIDERS.nvidia.key ? '✅' : '❌'}`);
});
