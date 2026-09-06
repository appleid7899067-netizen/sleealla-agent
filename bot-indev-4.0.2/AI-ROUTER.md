# AI Model Router

Adds an OpenRouter-backed `ai` command with a prioritized model fallback chain.

Configure `OPENROUTER_API_KEY` in the runtime environment, or add `openrouterAPI` to `Configurations/auth.js`.

Optional model override:

```text
OPENROUTER_MODELS=z-ai/glm-5.3-flash,minimax/minimax-m3:free,nvidia/nemotron-3-ultra:free,openai/gpt-5.6-luna
```

Example:

```text
!ai explain quantum computing simply
```
