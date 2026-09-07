# Multi-Model Hub — ใช้ 10 โมเดลทีเดียวผ่าน API เดียว

รันโมเดล LLM 10 ตัว (ในเครื่อง) พร้อมกันผ่าน Router ตัวเดียว — เข้ากันได้กับ
OpenAI API (ใช้กับแอป/ไลบรารีที่มีอยู่ได้เลย) และมี **โหมด Ensemble** เรียกทุกโมเดลพร้อมกัน

## ไฟล์ในโปรเจกต์

```
multimodel-hub/
├── models.yaml        # ตั้งค่า 10 โมเดล + กฎการเลือก (task keywords, ลำดับความสำคัญ)
├── router.py          # Router API (Flask) — auto / เจาะจงโมเดล / ensemble
├── pull_models.sh     # ดาวน์โหลดโมเดลทั้งหมดลง Ollama
├── mock_ollama.py     # (สำหรับทดสอบโดยไม่ต้องโหลดโมเดลจริง)
└── README.md
```

## 1) ติดตั้ง

```bash
# ติดตั้ง Ollama ก่อน
# Windows: https://ollama.com/download  |  macOS: brew install ollama  |  Linux: curl -fsSL https://ollama.com/install.sh | sh

# ดาวน์โหลดโมเดลทั้ง 10 ตัว (~256GB รวมกัน — โหลดทีละตัวได้เลย)
chmod +x pull_models.sh && ./pull_models.sh
```

> 💡 **เรื่องหน่วยความจำ:** Ollama จะโหลดโมเดลเข้าหน่วยความจำเฉพาะตอนถูกเรียก
> และ**เก็บโมเดลที่เพิ่งใช้ไว้** — Router จะจัดการให้อัตโนมัติ
> - RAM 8-16GB → ใช้ได้ทีละ 1 ตัว (สลับอัตโนมัติ)
> - RAM 32GB+ → เก็บ 2-3 ตัวพร้อมกัน
> - RAM 64GB+ → เก็บ 4-6 ตัว / ใช้ ensemble กับกลุ่มเล็ก
> - RAM 256GB+ → โหลดพร้อมกันทั้ง 10 ตัว
>
> ตั้งค่า `OLLAMA_KEEP_ALIVE` (วินาที) เพื่อควบคุมว่าเก็บโมเดลค้างไว้นานแค่ไหน

## 2) รัน

```bash
# เทอร์มินัล 1: รัน Ollama (เปิดไว้ตลอด)
ollama serve

# เทอร์มินัล 2: รัน Router
python router.py        # เปิดที่ http://localhost:8080
```

## 3) ใช้งาน — 3 โหมด

### 🔀 โหมด A: Auto (แนะนำ) — Router เลือกโมเดลให้ตามงาน
```bash
curl -X POST localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"ช่วยเขียนฟังก์ชัน Python แก้ bug"}]}'
```
ผลลัพธ์: Router ตรวจจับงาน `code` → เลือก **DeepSeek Coder 16B** อัตโนมัติ

| งานที่ตรวจจับ | โมเดลที่เลือก |
|---|---|
| เขียนโค้ด (code) | DeepSeek Coder 16B / Qwen 2.5 Coder 32B |
| ภาษาไทย (thai) | Qwen 2.5 Coder 32B / Qwen 3 14B |
| เหตุผล/วิเคราะห์ (reasoning) | DeepSeek R1 14B |
| ทั่วไป/เร็ว (general/fast) | Phi 4 14B / Gemma 3 12B |

### 🎯 โหมด B: เจาะจงโมเดล
```bash
curl -X POST localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-r1:14b","messages":[{"role":"user","content":"พิสูจน์สมการนี้"}]}'
```

### 🧠 โหมด C: Ensemble — เรียกทุกโมเดลพร้อมกัน (parallel)
```bash
curl -X POST localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"ensemble","messages":[{"role":"user","content":"อธิบายเรื่องนี้ให้เข้าใจง่าย"}]}'
```
ผลลัพธ์: คืนคำตอบจากทั้ง 10 โมเดลใน response เดียว — เปรียบเทียบ/โหวตหาคำตอบที่ดีที่สุดได้

## 4) ใช้กับแอป OpenAI-compatible ใดๆ

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8080/v1", api_key="unused")
r = client.chat.completions.create(
    model="auto",   # หรือ "ensemble"
    messages=[{"role": "user", "content": "เขียนโค้ดให้หน่อย"}],
)
print(r.choices[0].message.content)
```

## 5) API เพิ่มเติม

| Endpoint | คำอธิบาย |
|---|---|
| `GET /models` | รายการ 10 โมเดล + สถานะว่าโหลดค้างอยู่หรือไม่ |
| `GET /health` | เช็คสถานะ |

## ปรับแต่ง

แก้ `models.yaml` ได้ทั้งหมด: เพิ่ม/ลดโมเดล, เปลี่ยนคำสำคัญตรวจจับงาน (ภาษาไทย+อังกฤษ),
เรียงลำดับความสำคัญของบทบาท (role_priority)
