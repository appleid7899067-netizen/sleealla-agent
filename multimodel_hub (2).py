# -*- coding: utf-8 -*-
"""
multimodel_hub.py — ใช้ 10 โมเดล LLM พร้อมกันผ่าน API เดียว (ไฟล์เดียวจบ)
=========================================================================
รันโมเดล 10 ตัวในเครื่อง (ผ่าน Ollama) ด้วย Router ตัวเดียว + โหมด Ensemble
เรียกทุกโมเดลพร้อมกัน — เข้ากันได้กับ OpenAI API (base_url ชี้มาที่ตัวนี้ได้เลย)

คำสั่งใช้งาน:
    python multimodel_hub.py            # รัน Router (http://localhost:8080)
    python multimodel_hub.py pull       # ดาวน์โหลดโมเดลทั้ง 10 ตัวลง Ollama
    python multimodel_hub.py check      # เช็คว่า Ollama รันอยู่ไหม

ต้องการ: ติดตั้ง Ollama ก่อน  https://ollama.com/download
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests
from flask import Flask, jsonify, request

# =====================================================================
# 1) CONFIG — 10 โมเดล + กฎการเลือก (แก้ได้ตามใจ)
# =====================================================================
MODELS = [
    {"name": "DeepSeek Coder 16B",   "tag": "deepseek-coder-v2:16b", "size_gb": 10,   "rank": 1,
     "roles": ["code"],               "strengths": "เขียนโค้ดดีเยี่ยม ใกล้ GPT-4o"},
    {"name": "DeepSeek R1 14B",      "tag": "deepseek-r1:14b",       "size_gb": 8.5,  "rank": 2,
     "roles": ["reasoning"],          "strengths": "คิดลึก ให้เหตุผล แก้ปัญหา"},
    {"name": "Qwen 2.5 Coder 32B",   "tag": "qwen2.5-coder:32b",     "size_gb": 19,   "rank": 3,
     "roles": ["code", "thai"],       "strengths": "เขียนโค้ด + ภาษาไทยดีเยี่ยม"},
    {"name": "Qwen 3 14B",           "tag": "qwen3:14b",             "size_gb": 8.5,  "rank": 4,
     "roles": ["general", "thai", "code"], "strengths": "ทั่วไป + ไทยดี + โค้ดดี"},
    {"name": "Llama 3.1 70B",        "tag": "llama3.1:70b",          "size_gb": 40,   "rank": 5,
     "roles": ["general", "reasoning"], "strengths": "ฉลาดรอบด้าน ใกล้ GPT-5"},
    {"name": "Gemma 3 12B",          "tag": "gemma3:12b",            "size_gb": 7.5,  "rank": 6,
     "roles": ["general", "fast"],    "strengths": "เล็ก เร็ว ของ Google"},
    {"name": "Mistral Large 2 123B", "tag": "mistral-large:123b",    "size_gb": 70,   "rank": 7,
     "roles": ["general", "reasoning"], "strengths": "แรงสุด รอบด้าน"},
    {"name": "CodeLlama 70B",        "tag": "codellama:70b",         "size_gb": 40,   "rank": 8,
     "roles": ["code"],               "strengths": "เขียนโค้ดเน้นๆ"},
    {"name": "Qwen 2.5 72B",         "tag": "qwen2.5:72b",           "size_gb": 45,   "rank": 9,
     "roles": ["general", "thai"],    "strengths": "ภาษาไทยดีมาก รอบด้าน"},
    {"name": "Phi 4 14B",            "tag": "phi4:14b",              "size_gb": 8,    "rank": 10,
     "roles": ["fast", "general", "reasoning"], "strengths": "เล็กมาก เร็วมาก แรงเกินตัว"},
]

OLLAMA_URL = "http://localhost:11434"           # ที่อยู่ Ollama
OLLAMA_CHAT = f"{OLLAMA_URL}/v1/chat/completions"
FALLBACK_TAG = "qwen3:14b"                       # ใช้เมื่อไม่มีโมเดลตรง

# ลำดับความสำคัญบทบาท (ตัวแรก = สำคัญสุด) + คำสำคัญตรวจจับงาน (ไทย + อังกฤษ)
ROLE_PRIORITY = ["code", "thai", "reasoning", "general", "fast"]
TASK_KEYWORDS = {
    "code":      ["code", "เขียนโค้ด", "function", "python", "javascript", "bug", "error",
                  "โปรแกรม", "สคริปต์", "html", "css", "sql", "api", "debug", "unit test",
                  "โค้ด", "ดักบั๊ก", "คอมไพล์", "refactor"],
    "thai":      ["ภาษาไทย", "แปลไทย", "thai", "แปลเป็นไทย", "แต่งประโยคไทย", "คำไทย"],
    "reasoning": ["เหตุผล", "วิเคราะห์", "ตรรกะ", "พิสูจน์", "math", "logic", "puzzle",
                  "แก้ปัญหา", "เปรียบเทียบ", "ถกเถียง", "debate", "why", "สมการ"],
    "fast":      ["เร็ว", "สั้น", "quick", "short", "สรุปสั้น", "เร็วๆ"],
}

# =====================================================================
# 2) ตรรกะ Router
# =====================================================================
def detect_task(text: str) -> str:
    t = text.lower()
    scores = {role: sum(1 for w in words if w.lower() in t)
              for role, words in TASK_KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"

def pick_model(task: str) -> dict:
    """เลือกโมเดลที่ดีที่สุดตาม role_priority (ตัวแรกที่ตรง = ชนะ)"""
    for role in ROLE_PRIORITY:
        if role == task:
            for m in sorted(MODELS, key=lambda x: x["rank"]):
                if role in m["roles"]:
                    return m
    best, best_score = None, -1
    for m in MODELS:
        s = sum(1 for r in m["roles"] if r == task)
        if s > best_score:
            best, best_score = m, s
    return best or {"tag": FALLBACK_TAG, "name": "Fallback", "roles": []}

def call_model(tag: str, messages, temperature=0.7, max_tokens=2048) -> str:
    r = requests.post(OLLAMA_CHAT, json={
        "model": tag, "messages": messages,
        "temperature": temperature, "max_tokens": max_tokens, "stream": False,
    }, timeout=600)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]

# =====================================================================
# 3) API (Flask) — OpenAI-compatible
# =====================================================================
app = Flask(__name__)

@app.route("/health")
def health():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat()})

@app.route("/models")
def models():
    """รายการโมเดล + สถานะว่าโหลดค้างอยู่หรือไม่"""
    try:
        loaded = {m["name"] for m in requests.get(f"{OLLAMA_URL}/api/ps", timeout=5).json().get("models", [])}
    except Exception:
        loaded = set()
    return jsonify({
        "models": [{**{k: m[k] for k in ("name", "tag", "size_gb", "roles", "strengths")},
                    "loaded": m["name"] in loaded} for m in MODELS],
        "total": len(MODELS), "loaded_now": sorted(loaded),
    })

@app.route("/v1/chat/completions", methods=["POST"])
def chat():
    body = request.get_json(force=True) or {}
    messages = body.get("messages", [])
    model_req = body.get("model", "auto")
    ensemble = body.get("ensemble", False)
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens", 2048)
    if not messages:
        return jsonify({"error": "messages required"}), 400
    user_text = " ".join(m.get("content", "") for m in messages if m.get("role") == "user")

    # ----- โหมด Ensemble: เรียกทุกโมเดลพร้อมกัน -----
    if ensemble or model_req == "ensemble":
        targets = MODELS if model_req == "ensemble" else [m for m in MODELS if m["tag"] == model_req]
        with ThreadPoolExecutor(max_workers=len(targets)) as ex:
            futures = {ex.submit(call_model, m["tag"], messages, temperature, max_tokens): m for m in targets}
            results = []
            for f, m in futures.items():
                try:
                    results.append({"model": m["name"], "content": f.result()})
                except Exception as e:
                    results.append({"model": m["name"], "error": str(e)})
        return jsonify({
            "id": "chatcmpl-ensemble", "object": "chat.completion",
            "created": int(datetime.utcnow().timestamp()), "model": "ensemble",
            "choices": [{"index": i, "message": {"role": "assistant", "content": r.get("content", "")},
                         "finish_reason": "stop", "model": r["model"], "error": r.get("error")}
                        for i, r in enumerate(results)],
        })

    # ----- โหมด Auto / เจาะจงโมเดล -----
    if model_req == "auto":
        task = detect_task(user_text)
        chosen = pick_model(task)
        tag, note = chosen["tag"], f"auto -> {chosen['name']} (งาน: {task})"
    else:
        tag, note = model_req, f"เจาะจง: {model_req}"
    try:
        content = call_model(tag, messages, temperature, max_tokens)
    except Exception as e:
        return jsonify({"error": f"{note} | {e}"}), 502
    return jsonify({
        "id": "chatcmpl-1", "object": "chat.completion",
        "created": int(datetime.utcnow().timestamp()), "model": tag,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                     "finish_reason": "stop"}],
        "note": note,
    })

# =====================================================================
# 4) คำสั่ง CLI
# =====================================================================
def cmd_pull():
    print("📦 ดาวน์โหลดโมเดล 10 ตัวลง Ollama (โหลดทีละตัว ใช้ได้ทันทีที่เสร็จ)")
    for m in MODELS:
        print(f"⬇️  {m['tag']} ({m['size_gb']}GB) ...")
        subprocess.run(["ollama", "pull", m["tag"]], check=True)
        print(f"✅ {m['name']} เสร็จ")
    print("🎉 ครบ 10 ตัว! รัน:  python multimodel_hub.py")

def cmd_check():
    try:
        r = requests.get(f"{OLLAMA_URL}/api/version", timeout=5)
        print(f"✅ Ollama ทำงาน: {r.json().get('version')} ({OLLAMA_URL})")
        print(f"   มีโมเดล {len(MODELS)} ตัวใน config — รัน python multimodel_hub.py เพื่อเริ่ม")
    except Exception:
        print("❌ ไม่เจอ Ollama — เริ่มก่อน:  ollama serve")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "pull":
        cmd_pull()
    elif len(sys.argv) > 1 and sys.argv[1] == "check":
        cmd_check()
    else:
        print("=" * 60)
        print("  Multi-Model Hub Router — 10 โมเดล / 1 API")
        print(f"  Ollama: {OLLAMA_URL}")
        print("  โหมด:  auto | เจาะจง tag | ensemble (ทุกตัวพร้อมกัน)")
        print("  ใช้กับ OpenAI client:  base_url=http://localhost:8080/v1")
        print("=" * 60)
        app.run(host="0.0.0.0", port=8080)
