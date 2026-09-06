# AI Model Router

Adds an OpenRouter-backed `ai` command with a prioritized model fallback chain.

Configure `OPENROUTER_API_KEY` in the runtime environment, or add `openrouterAPI` to `Configurations/auth.js`.

Optional model override:

```text
OPENROUTER_MODELS=z-ai/glm-5.3-flash,minimax/minimax-m3:free,nvidia/nemotron-3-ultra:free,openai/gpt-5.6-luna

PORT=10000
# Optional: set this to enable a real OpenRouter model call.
OPENROUTER_API_KEY=
DEFAULT_MODEL=google/gemini-3.5-flash
DASHSCOPE_API_KEY=
DASHSCOPE_MODEL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b,llama-3.3-70b-versatile,qwen/qwen3.6-27b,openai/gpt-oss-20b,groq/compound-mini,llama-3.1-8b-instant
NVIDIA_API_KEY=
NVIDIA_MODEL=meta/llama-3.1-70b-instruct
OPENROUTER_API_KEY=
OPENROUTER_MODEL_FREE_LIST=OPENROUTER/FREE

```

Example:

```text
!ai explain quantum computing simply
```
