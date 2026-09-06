require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.'))); // Serve static files (index.html, skills.js)

// ===== MODEL CONFIGURATION =====
const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    key: process.env.OPENROUTER_API_KEY,
    model: 'deepseek/deepseek-chat-v3.5:free' // หรือโมเดลอื่นตามชอบ
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

// ฟังก์ชันเรียก AI พร้อม Fallback
async function callAI(messages, preferredProvider = 'openrouter', attempt = 0) {
  const provider = PROVIDERS[preferredProvider];
  
  if (!provider || !provider.key) {
    // ถ้าคีย์ไม่มี หรือ provider ผิด ให้ลองตัวถัดไป
    const fallbacks = Object.keys(PROVIDERS).filter(k => k !== preferredProvider && PROVIDERS[k].key);
    if (fallbacks.length > 0 && attempt < 2) {
      console.log(`️ ${preferredProvider} ไม่พร้อม, สลับไป ${fallbacks[0]}`);
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
      body: JSON.stringify({
        model: provider.model,
        messages: messages,
        stream: true
      })
    });

    if (!response.ok) throw new Error(`${provider.name} Error: ${response.status}`);
    return response;
  } catch (error) {
    // ถ้า error ให้ลอง fallback
    const fallbacks = Object.keys(PROVIDERS).filter(k => k !== preferredProvider && PROVIDERS[k].key);
    if (fallbacks.length > 0 && attempt < 2) {
      console.log(`⚠️ ${provider.name} ล้มเหลว (${error.message}), ลอง ${fallbacks[0]}`);
      return callAI(messages, fallbacks[0], attempt + 1);
    }
    throw error;
  }
}

// ===== API ROUTES =====

// 1. Chat Endpoint (Proxy)
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, provider } = req.body;
    const response = await callAI(messages, provider);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Pipe stream จาก AI กลับไปหา Frontend
    response.body.pipe(res);
  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Check Status (ให้ frontend รู้ว่าตัวไหนพร้อมใช้)
app.get('/api/status', (req, res) => {
  const status = Object.entries(PROVIDERS).map(([key, p]) => ({
    id: key,
    name: p.name,
    model: p.model,
    ready: !!p.key
  }));
  res.json({ providers: status });
});

// Fallback for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Sleealla Agent running on port ${PORT}`);
  console.log(`🔑 OpenRouter: ${PROVIDERS.openrouter.key ? '✅' : '❌'}`);
  console.log(`🔑 Qwen: ${PROVIDERS.qwen.key ? '✅' : '❌'}`);
  console.log(`🔑 NVIDIA: ${PROVIDERS.nvidia.key ? '✅' : '❌'}`);
});