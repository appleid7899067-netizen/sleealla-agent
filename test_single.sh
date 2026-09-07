#!/bin/bash
cd /multimodel-hub
pkill -f multimodel_hub 2>/dev/null; pkill -f mock_ollama 2>/dev/null; sleep 1
python mock_ollama.py > /tmp/mock.log 2>&1 &
MOCK=$!
sleep 1.5
python multimodel_hub.py > /tmp/hub.log 2>&1 &
HUB=$!
sleep 2.5
echo "=== mock log ==="; cat /tmp/mock.log | tail -3
echo "=== hub log ==="; cat /tmp/hub.log | tail -5
echo "=== health ==="; curl -s -m5 localhost:8080/health; echo
echo "=== Auto code ==="
curl -s -m15 -X POST localhost:8080/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"ช่วยเขียนโค้ด Python แก้ bug ให้หน่อย"}]}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('note'), '|', d['choices'][0]['message']['content'][:50])"
echo "=== Ensemble ==="
curl -s -m25 -X POST localhost:8080/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"ensemble","messages":[{"role":"user","content":"สวัสดี"}]}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('answers:', len(d['choices']), 'models:', ', '.join(c['model'] for c in d['choices'][:5]))"
echo "=== /models ==="
curl -s -m10 localhost:8080/models | python3 -c "import json,sys; d=json.load(sys.stdin); print('total:', d['total'])"
kill $HUB $MOCK 2>/dev/null
echo DONE