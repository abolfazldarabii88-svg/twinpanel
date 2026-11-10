# Mmdi Control Center

Standalone local-first control panel in its own folder inside the TwinPanel repository. It does not import, modify, or start TwinPanel.

## Run on Windows

1. Install Node.js 20 or newer.
2. Open PowerShell in this folder.
3. Run `npm start`.
4. Open **http://127.0.0.1:4317**.

No npm packages are required. Stop the server with Ctrl+C.

## Implemented in this version

- Local dashboard and Node.js backend.
- Configuration stored outside this repository at `%USERPROFILE%\.mmdi-control-center\config.json` on Windows.
- Secret values are masked and never returned by the config API.
- Read-only Windows VPN and WinHTTP proxy detection.
- DNS and direct HTTPS diagnostics for Telegram.
- Telegram Bot API token test using `getMe`.
- AI Router reachability test using the OpenAI-compatible `/models` endpoint.
- MCP endpoint HTTP reachability check.
- Redacted settings backup export.

## Network limitation

Manual proxy URLs are saved as profiles but this version does not route HTTP requests through them. MTProxy is for Telegram MTProto/GramJS and does not proxy Bot API HTTPS. Diagnostics use Node's default network route. Use a working Windows VPN/system route for Bot API traffic.

## Not integrated yet

This version does not start/stop MmdiBot or MCP processes, manage the MCP tool registry, edit the existing MmdiBot environment, or access Telegram sessions, databases, or memory. Existing MmdiBot data is not modified. Those integrations require exact local/deployed service control details.

## Security

- Binds to 127.0.0.1 only.
- Rejects non-local Host/Origin requests.
- Stores secrets outside Git under the current user's home directory.
- Backup deliberately redacts credentials and excludes Telegram sessions and MmdiBot data.
- Never commit `.env`, credentials, session files, databases, or backups.
