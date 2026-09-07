# Sleealla Agent — Deploy

## Render Web Service

This repository contains an Express server, so deploy it as a Render Web Service.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/health`
- Runtime port: `$PORT`

The server binds to `0.0.0.0` and defaults to port `10000`, matching Render's web-service requirements. citeturn0search0turn0search1

## Environment variables

Set provider credentials in Render Environment Variables. Do not commit real API keys.

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL` (optional)
- `DASHSCOPE_API_KEY`
- `DASHSCOPE_MODEL` (optional)
- `NVIDIA_API_KEY`
- `NVIDIA_MODEL` (optional)

## Local verification

```bash
npm install
PORT=10000 npm start
```

Then check `http://localhost:10000/health`.
