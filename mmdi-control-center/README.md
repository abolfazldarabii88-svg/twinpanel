# Mmdi Control Center

Standalone Windows-first local dashboard in this folder. It is separate from TwinPanel and does not edit TwinPanel files.

## Start

1. Install Node.js 20+ and Bun (the MmdiBot runtime).
2. Download this repository ZIP from GitHub, then extract it.
3. Open the extracted `mmdi-control-center` folder.
4. Double-click `start.bat`.
5. The dashboard opens at **http://127.0.0.1:4317**.
6. Keep the terminal window open while using the dashboard. Close it with Ctrl+C.

You can also run `node server.js` from PowerShell. No npm install is needed.

## Features

- Local-only dashboard bound to 127.0.0.1.
- Settings stored outside the repository in `%USERPROFILE%\\.mmdi-control-center\\config.json`.
- Secret values are masked in API responses; backups redact credentials.
- Detects Windows VPN profiles and WinHTTP proxy state.\n- Smart Auto mode discovers local HTTP CONNECT/SOCKS5 listeners, tests the proxy protocol, passes the selected route to the MmdiBot process, and rechecks every 15 seconds; when the detected proxy endpoint changes, it restarts MmdiBot with the new endpoint.
- Connects/disconnects Windows VPN profiles using `rasdial` (VPN credentials must already be saved in Windows if required).
- Starts and stops the local MmdiBot using the fixed command `bun run start`.
- Captures recent startup output for troubleshooting.
- When starting MmdiBot in Manual mode, passes HTTP(S)/SOCKS proxy URL through proxy environment variables. If the field contains a Telegram `https://t.me/proxy?... ` link, its server/port/secret are translated into `TELEGRAM_PROXY_IP`, `TELEGRAM_PROXY_PORT`, and `TELEGRAM_PROXY_SECRET` for GramJS.
- Tests Telegram Bot API `getMe`, OpenAI-compatible AI Router `/models`, DNS/HTTPS reachability, and MCP endpoint reachability.
- Exports a redacted settings backup.

## Configure MmdiBot

Open the **اجرای MmdiBot** tab and set the project folder. Default path is:

`%USERPROFILE%\\Desktop\\mmdi-source`

The folder must contain a `package.json` with a `start` script and a working Bun installation. The dashboard does not alter the MmdiBot database, Telegram session, history, or the project's `.env` file.

## Network behavior and limitations

- **Auto mode (recommended)**: scans local listening ports, probes HTTP CONNECT and SOCKS5, and passes the detected local proxy to MmdiBot using proxy environment variables. It rechecks every 15 seconds and restarts MmdiBot if the proxy endpoint changes. This is intended for local proxy clients such as Psiphon; it does not guarantee support for every VPN application or every HTTP client.\n- **System/VPN mode**: MmdiBot inherits the current Windows network route. The dashboard can connect/disconnect Windows VPN profiles listed by `Get-VpnConnection`; third-party VPN apps that do not register a Windows VPN profile are not controlled here.
- **Manual mode**: proxy variables are passed only to the MmdiBot process launched by this dashboard. Support depends on the HTTP client/runtime used by the project. The dashboard's own connectivity tests still use the Windows default route.
- **MTProxy**: a `t.me/proxy` link is passed to the project's GramJS MTProto configuration. MTProxy does not automatically proxy Telegram Bot API HTTPS or AI Router HTTPS requests.
- For Bot API and AI Router HTTPS connectivity, a working Windows VPN/system route is the most reliable choice unless the application's HTTP client explicitly supports the selected HTTP/SOCKS proxy.
- The MCP test checks HTTP reachability only; it does not perform the full MCP initialize/tools-list handshake or change individual tool permissions.
- Telegram/API credentials entered in this dashboard are stored for diagnostic tests. They are not written into the MmdiBot project's `.env` because the project's exact configuration mapping must be verified before safely changing that file.

## Safety

- Do not publish `%USERPROFILE%\\.mmdi-control-center\\config.json`.
- Do not commit API keys, bot tokens, proxy secrets, Telegram sessions, or database files.
- The panel binds to localhost only and does not expose a remote admin interface.
- Keep your existing MmdiBot folder and its database/session backup intact.
