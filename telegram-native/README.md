# TwinPanel Native Telegram — experimental branch

This is an experimental native Telegram client integration using Telegram's official TDLib through the Node.js `tdl` wrapper. The existing Telegram Web panel remains available and has not been removed.

## Implemented in this branch

- Embedded compact Persian RTL client rendered inside TwinPanel's existing Telegram panel; Telegram Web remains available as a fallback.
- Pinned `tdl` and `prebuilt-tdlib` dependencies, including the prebuilt Windows x64 TDLib library.
- Main-process TDLib service with a narrow, explicit IPC API.
- Interactive authorization prompts for phone number, login code, and 2-step verification password.
- Optional local SOCKS5, HTTP CONNECT, and MTProto proxy settings for TDLib. Proxy connectivity is tested with TDLib's `testProxy` before QR authentication; selecting direct mode explicitly disables any previously enabled TDLib proxy. Proxy details are not persisted or uploaded.
- TDLib-backed main chat list, search, chat history, text sending, document upload, file download request, and chat mute request.
- Local TDLib database/files under Electron's `userData`; the database encryption key and first-time API ID/API Hash credentials are protected using Electron `safeStorage` when the platform secure-storage API is available. Login codes and two-step passwords are entered per session and are not persisted.
- Preview mode uses `getChatHistory` only and deliberately does not call `openChat`, `viewMessages`, or `readChatList`.

## Important limitations — experimental client, not full Telegram parity

- The TDLib native binary has not yet been validated in a packaged Windows installer on the user's PC.
- No real Telegram login or account test has been run in this environment.
- Read-without-Seen behavior must be tested against a second Telegram client and unread counters before being promised. This code avoids explicit read-marking calls; it cannot guarantee Telegram's server-side behavior for every update/content type.
- File sending currently uses TDLib's document upload path. Photo-specific and voice-message sending, media playback/download UI, Telegram folder synchronization, and persistent study categories are not complete.
- The UI demo rows are clearly marked as demo-only and are replaced by real chat results after a successful connection.
- RAM/startup performance has not been measured.
- This client is still experimental and does not implement every official Telegram feature. It currently covers basic chat listing/search/history, text and document sending, mute settings, and QR/phone/code/2FA login. Photo-specific flows, voice messages, complete media downloads/playback, folders, reactions, calls, and some account settings are not implemented.
- The existing Telegram Web K panel is preserved and can be selected from the TwinPanel header when a full-featured web client is preferred.


## Setup

1. Install Node.js and run `npm install` from `twinpanel-desktop`.
2. Launch TwinPanel and open **تلگرام اختصاصی**.
3. On first use, enter your own Telegram API ID and API Hash from Telegram's official developer portal once. TwinPanel encrypts them locally via the operating system's secure storage; later logins can proceed straight to QR. If secure storage is unavailable, the app refuses to save the credentials.
4. If direct TDLib connectivity fails, optionally select a proxy type and enter your proxy settings. Then complete phone, code, and optional 2-step verification prompts inside the native window.

Proxy settings, login codes, and 2FA passwords are used locally and are not written to the app's connection log. Never share login codes or 2FA passwords. Do not send the TDLib database, encryption key, or session data to a remote service. The current integration does not send those items to any TwinPanel backend.

## Official references

- https://core.telegram.org/tdlib/getting-started
- https://github.com/tdlib/td
- https://www.npmjs.com/package/tdl
- https://www.npmjs.com/package/prebuilt-tdlib
