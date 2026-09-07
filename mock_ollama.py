"""mock_ollama.py — จำลอง Ollama สำหรับทดสอบ router (ไม่ต้องโหลดโมเดลจริง)"""
from flask import Flask, jsonify, request

app = Flask(__name__)

MODELS = {
    "deepseek-coder-v2:16b": "DeepSeek Coder",
    "deepseek-r1:14b": "DeepSeek R1",
    "qwen2.5-coder:32b": "Qwen Coder",
    "qwen3:14b": "Qwen 3",
    "llama3.1:70b": "Llama 3.1",
    "gemma3:12b": "Gemma 3",
    "mistral-large:123b": "Mistral Large",
    "codellama:70b": "CodeLlama",
    "qwen2.5:72b": "Qwen 2.5",
    "phi4:14b": "Phi 4",
}

@app.route("/v1/chat/completions", methods=["POST"])
def chat():
    body = request.get_json()
    tag = body["model"]
    user = [m["content"] for m in body["messages"] if m["role"] == "user"][0][:40]
    name = MODELS.get(tag, tag)
    return jsonify({"choices": [{"message": {"role": "assistant",
        "content": f"[{name}] ตอบ: {user}..."}}]})

@app.route("/api/ps")
def ps():
    return jsonify({"models": [{"name": "qwen3:14b"}]})

if __name__ == "__main__":
    app.run(port=11434)
