# SlieQwenBoss Lo8 — Langchaingo + MCP Engine

This stage imports the Langchaingo + Model Context Protocol pattern from the `compose-for-agents/langchaingo` reference into SlieQwenBoss Lo8.

## What is included

- Langchaingo agent/chat pipeline
- MCP Go SDK client
- SSE connection to an MCP Gateway
- Dynamic MCP tool discovery with `ListTools`
- DuckDuckGo `search` and `fetch_content` tool adapter
- Docker Compose MCP Gateway configuration
- Containerized Go runner

## Architecture

```text
QUESTION
  -> SlieQwenBoss Lo8 Go Runner
  -> Langchaingo Agent
  -> MCP Client (SSE)
  -> Docker MCP Gateway
  -> MCP tools (DuckDuckGo)
  -> Langchaingo LLM
  -> FINAL ANSWER
```

The upstream reference uses Docker Model Runner by default and exposes the MCP gateway over SSE. This implementation keeps that same core flow while renaming the MCP client identity for SlieQwenBoss Lo8.

## Run

```sh
docker compose up --build
```

For local Go development:

```sh
go run .
```

Required environment variables:

- `QUESTION`
- `MCP_GATEWAY_URL` (default `http://localhost:8811`)
- `OPENAI_BASE_URL`
- `OPENAI_MODEL_NAME`
- `OPENAI_API_KEY` (can be the local-runner placeholder when using a compatible local endpoint)

## Important

This stage is the MCP/Langchaingo engine layer. It does not replace the existing Node backend or claim that every MCP integration in the main UI is already connected. The actual gateway, MCP servers, credentials, and runtime must be available for live tool calls.

## Source reference

Based on the `langchaingo` example in `appleid7899067-netizen/compose-for-agents`, which demonstrates Langchaingo + MCP + Docker MCP Gateway + DuckDuckGo tool routing.
