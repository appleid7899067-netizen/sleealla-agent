#!/bin/bash
# pull_models.sh — ดาวน์โหลดโมเดลทั้ง 10 ตัวลง Ollama
# (ดาวน์โหลดทีละตัว ใช้ได้ทันทีที่โหลดเสร็จ ไม่ต้องรอให้ครบ)
set -e

echo "📦 ติดตั้ง Ollama ก่อน: https://ollama.com/download"
echo ""

MODELS=(
  "deepseek-coder-v2:16b"
  "deepseek-r1:14b"
  "qwen2.5-coder:32b"
  "qwen3:14b"
  "llama3.1:70b"
  "gemma3:12b"
  "mistral-large:123b"
  "codellama:70b"
  "qwen2.5:72b"
  "phi4:14b"
)

for m in "${MODELS[@]}"; do
  echo "⬇️  กำลังโหลด: $m"
  ollama pull "$m"
  echo "✅ เสร็จ: $m"
done

echo ""
echo "🎉 ครบทั้ง ${#MODELS[@]} ตัวแล้ว!"
echo "รัน router:  python router.py"
echo "ทดสอบ:       curl -X POST localhost:8080/v1/chat/completions -H 'Content-Type: application/json' -d '{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"เขียนโค้ด Python ให้หน่อย\"}]}'"
