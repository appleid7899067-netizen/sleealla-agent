# Aether-AI GM1122 — Checked 917-file snapshot

This repository branch `GM1122` contains the native Sleella/Aether integration layer. The full checked snapshot contains 917 files and was statically audited before this repository update.

Snapshot archive: `Aether-AI-GM1122-checked-917.zip` (generated in the ChatGPT workspace; binary archive is not embedded here because the GitHub connector cannot transfer local binary files directly).

Verified static checks:
- 917 source/archive files counted.
- Python compile-level check passed on the audited source.
- requirements parsing passed.
- Merge-conflict markers were removed from the audited source.
- Runtime/production deployment remains unverified until dependencies are installed and the service is started in a real environment.

Security note: the upstream Aether source contains command execution, desktop automation, code execution and security/bug-bounty automation. Those capabilities must remain authorization-gated and must only be used on systems/targets the operator is authorized to test.

See `aether-core/AETHER-INTEGRATION.md` for the native integration architecture.
