#  QX Ultimate - Enterprise AI Platform

แพลตฟอร์ม AI ระดับองค์กรที่รวมจุดแข็งจาก SILELO + AETHER + QX

## ⚡ คุณสมบัติหลัก

- **8 โมเดล AI** - Qwen3.5, DeepSeek, Gemini, Grok, Kimi, GLM, MiniMax, GPT-OSS
- **50+ Plugins** - เชื่อมต่อ Gmail, GitHub, Slack, Jira, Notion และอื่นๆ
- **Team AI** - 8 ฝ่าย 50 AI Agents
- **Multi-Language** - รองรับ 30+ ภาษา พร้อม Voice
- **Enterprise Security** - Zero Data Retention, OAuth 2.0

## 📋 ข้อกำหนดระบบ

- Node.js >= 18.0.0
- npm >= 9.0.0
- RAM 2GB+ (แนะนำ 4GB)

## 🚀 การติดตั้ง

```bash
# 1. Clone หรือดาวน์โหลดโปรเจกต์
git clone <repository-url>
cd qx-ultimate

# 2. ติดตั้ง dependencies
npm install

# 3. ตั้งค่า environment variables
cp .env.example .env
# แก้ไข .env และใส่ API Keys

# 4. เริ่มเซิร์ฟเวอร์
npm start
```

## 🔧 การใช้งาน

เปิดเบราว์เซอร์: `http://localhost:10000`

### ตั้งค่า API Keys

1. **OpenRouter** (แนะนำ):
   - ลงทะเบียนที่ https://openrouter.ai
   - รับ API Key
   - ใส่ใน `.env`: `OPENROUTER_API_KEY=sk-or-xxx`

2. **DashScope (Qwen)**:
   - ลงทะเบียนที่ https://dashscope.aliyun.com
   - ใส่ใน `.env`: `DASHSCOPE_API_KEY=sk-xxx`

##  เอกสารเพิ่มเติม

- [README-DEPLOY.md](./README-DEPLOY.md) - คู่มือ Deploy
- [REPO-PREP.md](./REPO-PREP.md) - การเตรียม Repository

## 🛡️ ความปลอดภัย

- API Keys เก็บใน `.env` เท่านั้น
- ไม่เก็บข้อมูลผู้ใช้ในเซิร์ฟเวอร์
- รองรับ OAuth 2.0 สำหรับ Plugins

##  ติดต่อ

- Email: support@qx-enterprise.com
- Documentation: https://docs.qx-enterprise.com

## 📄 License

MIT License - See [LICENSE](./LICENSE) file