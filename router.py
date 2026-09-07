"""
router.py — Multi-Model Hub Router
==================================
Unified AI gateway ที่ "ใช้ทุกโมเดลทีเดียว" ผ่าน endpoint เดียว (OpenAI-compatible)

โหมดการใช้งาน:
  model = "deepseek-r1:14b"  -> เรียกโมเดลนั้นตัวเดียว
  model = "auto"             -> Router ตรวจจับประเภทงาน แล้วเลือกโมเดลที่เหมาะที่สุด
  model = "ensemble"         -> เรียกทุกโมเดลพร้อมกัน (parallel) แล้วคืนคำตอบทั้งหมด
  ?ensemble=true + model=xxx -> เรียกเฉพาะกลุ่ม/ทุกตัวพร้อมกัน

รัน:  python router.py            (ต้องมี Ollama รันอยู่ที่ :11434)
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests
import yaml
from flask import Flask, jsonify, request

CONFIG_PATH = "models.yaml"

# ---------------- โหลด config ----------------
with open(CONFIG_PATH, encoding="utf-8") as f:
    CONFIG = yaml.safe_load(f)

MODELS = CONFIG["models"]
OLLAMA_URL = CONFIG["router"]["ollama_url"].rstrip("/")
OLLAMA_CHAT = f"{OLLAMA_URL}/v1/chat/completions"
KEYWORDS = CONFIG["router"]["task_keywords"]
ROLE_PRIORITY = CONFIG["router"]["role_priority"]

_model_map = {m["tag"]: m for m in MODELS}
_cache = {}  # กันเรียกซ้ำ
_cache_lock = threading.Lock()


# ---------------- ตรวจจับประเภทงาน ----------------
def detect_task(text: str):
    t = text.lower()
    scores = {}
    for role, words in KEYWORDS.items():
        scores[role] = sum(1 for w in words if w.lower() in t)
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "general"
    return best


def pick_model(task: str) -> dict:
    """เลือกโมเดลที่ดีที่สุดสำหรับงาน (ตาม role_priority)"""
    for role in ROLE_PRIORITY:
        if role == task:
            for m in MODELS:
                if role in m["roles"]:
                    return m
    # fallback: หาโมเดลที่ครอบคลุม task มากที่สุด
    best, best_score = None, -1
    for m in MODELS:
        s = sum(1 for r in m["roles"] if r == task)
        if s > best_score:
            best, best_score = m, s
    return best or {"tag": CONFIG["router"]["fallback_model"], "name": "Fallback"}


# ---------------- เรียก Ollama ----------------
def call_model(tag: str, messages, temperature=0.7, max_tokens=2048):
    payload = {
        "model": tag,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    r = requests.post(OLLAMA_CHAT, json=payload, timeout=600)
    r.raise_for_status()
    data = r.json()
    return data["choices"][0]["message"]["content"]


# ---------------- Flask API ----------------
app = Flask(__name__)


@app.route("/health")
def health():
    return jsonify({"status": "ok", "time": datetime.utcnow().isoformat()})


@app.route("/models")
def models():
    """รายการโมเดลทั้งหมด + สถานะ (โหลดแล้ว/ยังไม่โหลด)"""
    try:
        loaded = {m["name"] for m in requests.get(f"{OLLAMA_URL}/api/ps", timeout=5).json().get("models", [])}
    except Exception:
        loaded = set()
    out = []
    for m in MODELS:
        out.append({
            "name": m["name"], "tag": m["tag"], "size_gb": m["size_gb"],
            "roles": m["roles"], "strengths": m["strengths"],
            "loaded": m["name"] in loaded,
        })
    return jsonify({"models": out, "total": len(out), "loaded_now": sorted(loaded)})


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

    # ---------- โหมด Ensemble: เรียกทุกตัวพร้อมกัน ----------
    if ensemble or model_req == "ensemble":
        targets = MODELS if model_req in ("ensemble", "auto") else [m for m in MODELS if m["tag"] == model_req]
        with ThreadPoolExecutor(max_workers=len(targets)) as ex:
            futures = {ex.submit(call_model, m["tag"], messages, temperature, max_tokens): m for m in targets}
            results = []
            for f, m in futures.items():
                try:
                    results.append({"model": m["name"], "tag": m["tag"], "content": f.result()})
                except Exception as e:
                    results.append({"model": m["name"], "tag": m["tag"], "error": str(e)})
        return jsonify({
            "id": "chatcmpl-ensemble",
            "object": "chat.completion",
            "created": int(datetime.utcnow().timestamp()),
            "model": "ensemble",
            "choices": [{"index": i, "message": {"role": "assistant", "content": r.get("content", "")},
                         "finish_reason": "stop", "model": r["model"], "error": r.get("error")}
                        for i, r in enumerate(results)],
        })

    # ---------- โหมด Auto / เจาะจงโมเดล ----------
    if model_req == "auto":
        task = detect_task(user_text)
        chosen = pick_model(task)
        tag = chosen["tag"]
        note = f"auto → {chosen['name']} (งาน: {task})"
    else:
        tag = model_req
        chosen = {"name": model_req}
        note = f"เจาะจง: {model_req}"

    try:
        content = call_model(tag, messages, temperature, max_tokens)
    except Exception as e:
        return jsonify({"error": f"{note} | {e}"}), 502

    return jsonify({
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "created": int(datetime.utcnow().timestamp()),
        "model": tag,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                     "finish_reason": "stop"}],
        "note": note,
    })


if __name__ == "__main__":
    print("=" * 60)
    print(" Multi-Model Hub Router")
    print(f" Ollama: {OLLAMA_URL}")
    print(f" โมเดลทั้งหมด: {len(MODELS)} ตัว")
    print(" โหมด: auto | เจาะจง tag | ensemble (ใช้ทุกตัวพร้อมกัน)")
    print("=" * 60)
    app.run(host="0.0.0.0", port=8080)
