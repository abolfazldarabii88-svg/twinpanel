# Mmdi Control Center

A standalone local control panel project stored inside this repository.

## Isolation
- All project files live under `mmdi-control-center/`.
- This project does not modify TwinPanel's existing application files.
- No credentials, API keys, bot tokens, proxy secrets, or session files belong in Git.
- Runtime secrets must be stored locally in an ignored environment/config file.

## Planned modules
- Network manager: direct/system VPN/manual proxy profiles and independent connectivity checks.
- Telegram manager: Bot API and MTProto configuration kept separate.
- AI manager: AI Router endpoint, model and API key configuration.
- MCP manager: server lifecycle, tool inventory, access controls and health checks.
- Diagnostics and local backups.

## Status
Initial isolated project scaffold. Integration with the existing MmdiBot backend is not yet connected.
