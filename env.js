// ==========================================
// 🛡️ SILELO Key Manager — ตัวจัดการคีย์กลาง
// เรียกใช้ได้ทั่วระบบ — แก้ที่เดียว เปลี่ยนทั้งระบบ
// dev: อ่านจากไฟล์ .env (dotenv) — production: อ่านจาก Vercel/Render Dashboard
// ==========================================
require('dotenv').config();

const splitList = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
// ค่าที่ถูกต้อง = มีตัวอักษรจริง (ไม่ใช่ขีดเส้นประ/ว่าง)
const has = (v) => typeof v === 'string' && v.trim().length > 2 && !/^_+$/.test(v.trim());

const ENV = {
  // 🧠 AI — สมองหลัก
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    models: process.env.GROQ_MODELS || 'openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3.6-27b,groq/compound-mini',
  },
  cerebras: {
    apiKey: process.env.CEREBRAS_API_KEY || '',
    models: process.env.CEREBRAS_MODELS || 'gpt-oss-120b,gemma-4-31b',
  },
  ollama: {
    apiKey: process.env.OLLAMA_API_KEY || '',
    models: process.env.OLLAMA_MODELS || 'gpt-oss:120b,gpt-oss:20b,nemotron-3-super,gemma4:31b',
  },
  zai: {
    apiKey: process.env.ZAI_API_KEY || '',
    models: process.env.ZAI_MODELS || 'glm-4.7-flash,glm-4.5-flash',
  },
  gemini: {
    apiKeys: splitList(process.env.GEMINI_API_KEYS),
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    textModels: process.env.OPENROUTER_TEXT_MODELS || 'nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-26b-a4b-it:free',
  },
  pollinations: { model: process.env.POLLINATIONS_MODEL || 'openai' },

  // 🧠 OpenAI (สำรอง — ใส่คีย์แล้วค่อยต่อเข้า RACE)
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    ttsModel: process.env.OPENAI_TTS_MODEL || 'tts-1-hd',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'nova',
  },

  // 🤖 Azure / Copilot (สำรอง)
  azure: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
    apiKey: process.env.AZURE_OPENAI_KEY || '',
    model: process.env.AZURE_OPENAI_MODEL || 'gpt-4o',
    speechKey: process.env.AZURE_SPEECH_KEY || '',
    speechRegion: process.env.AZURE_SPEECH_REGION || 'thailand',
  },

  // 🎨 สร้างภาพ (สำรอง)
  image: {
    dallApiKey: process.env.DALL_API_KEY || '',
    stabilityApiKey: process.env.STABILITY_API_KEY || '',
  },

  // 🎙️ เสียง
  tts: {
    voice: process.env.TTS_VOICE || 'th-TH-PremwadeeNeural',
    elevenlabsKey: process.env.ELEVENLABS_API_KEY || '',
    elevenlabsModel: process.env.ELEVENLABS_MODEL || '',
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
  },

  // 🌐 LINE — บอท + LINE Login
  line: {
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID || '',
    loginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
  },

  // 🔗 OAuth — Google / Facebook
  oauth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    fbAppId: process.env.FB_APP_ID || '',
    fbAppSecret: process.env.FB_APP_SECRET || '',
  },

  // 🔐 ความปลอดภัย
  security: {
    pin: process.env.PIN_CODE || 'gamma',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    authSecret: process.env.AUTH_SECRET || '',
    authWhitelist: process.env.AUTH_WHITELIST || '',
    runSecret: process.env.RUN_SECRET || '',
    jwtSecret: process.env.JWT_SECRET || '',
  },

  // ⚙️ ระบบ
  system: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development',
    appUrl: process.env.APP_URL || '',
    sileloUrl: process.env.SILELO_URL || 'https://silelo.onrender.com',
    lang: process.env.LANG || 'th-TH',
    dbUrl: process.env.DATABASE_URL || '',
  },

  // ✅ สถานะคีย์ (ไม่โชว์ค่าจริง — บอกแค่ว่ามี/ไม่มี)
  status() {
    const s = this;
    return {
      groq: has(s.groq.apiKey),
      cerebras: has(s.cerebras.apiKey),
      ollama: has(s.ollama.apiKey),
      zai: has(s.zai.apiKey),
      gemini: s.gemini.apiKeys.length > 0,
      openrouter: has(s.openrouter.apiKey),
      pollinations: true,
      openai: has(s.openai.apiKey),
      azure: has(s.azure.apiKey),
      azureSpeech: has(s.azure.speechKey),
      elevenlabs: has(s.tts.elevenlabsKey),
      lineBot: has(s.line.accessToken),
      lineLogin: has(s.line.loginChannelId) && has(s.line.loginChannelSecret),
      google: has(s.oauth.googleClientId) && has(s.oauth.googleClientSecret),
      facebook: has(s.oauth.fbAppId) && has(s.oauth.fbAppSecret),
      authSecret: has(s.security.authSecret),
      runSecret: has(s.security.runSecret),
    };
  },

  // ✅ ตรวจสอบความครบถ้วน — แจ้งเตือนถ้าคีย์หลักขาด
  validate() {
    const st = this.status();
    const critical = [];
    if (!st.groq) critical.push('GROQ_API_KEY');
    if (!st.gemini) critical.push('GEMINI_API_KEYS');
    if (!st.runSecret) critical.push('RUN_SECRET');
    if (critical.length > 0) {
      console.warn('⚠️ [KeyManager] คีย์หลักที่ยังไม่ได้ตั้งค่า:', critical.join(', '));
      return false;
    }
    console.log('✅ [KeyManager] คีย์หลักครบถ้วน — พร้อมใช้งาน');
    return true;
  },
};

module.exports = ENV;
