# Aether → Sleella / SlieQwenBoss Lo8 Integration

Status: **active integration on branch `GM1122`**

## Source

Upstream source: `nandkishorrathodk-art/Aether-AI`

The upstream project is MIT licensed. The upstream copyright/license notice is preserved in `LICENSE-AETHER-MIT.txt` in this integration directory.

## What is being integrated

The integration follows the useful architectural parts of Aether's conversation engine:

- intent classification
- conversation/task lanes
- provider/model routing
- persistent context as an integration target
- automation as a separate execution lane
- defensive security as a separate lane
- explicit authorization gates for security actions
- retry/fallback orchestration

## Sleella implementation

`intelligence-router.js` is the first native Sleella integration layer. It does not blindly copy Aether's execution code. It provides a small, testable routing boundary that can be connected to the existing OpenRouter model pool and future agents.

Security-related requests require an explicit `authorized` signal before an execution path can be allowed. This is intentional: source material that contains automation/security execution logic is not treated as permission to execute against arbitrary targets.

## Existing Sleella components retained

- root Node/Express service
- `/health` endpoint
- OpenRouter model configuration
- Render deployment manifest
- AI model router and fallback pool
- existing skills registry

## Verification state

The integration commits prove that the files were written to GitHub. They do **not** by themselves prove that the complete Aether runtime is production-ready. Full runtime verification still requires installing the source dependencies and exercising the relevant service/test paths.
