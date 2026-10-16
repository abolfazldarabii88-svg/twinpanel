# TwinPanel Native Telegram — experimental branch

This is an experimental native Telegram client integration using Telegram's official TDLib through the Node.js `tdl` wrapper. The existing Telegram Web panel remains available and has not been removed.

## Implemented in this branch

- Separate compact Persian RTL window with a connection form.
- Pinned `tdl` and `prebuilt-tdlib` dependencies, including the prebuilt Windows x64 TDLib library.
- Main-process TDLib service with a narrow, explicit IPC API.
- Interactive authorization prompts for phone number, login code, and 2-step verification password.
- TDLib-backed main chat list, search, chat history, text sending, document upload, file download request, and chat mute request.
- Local TDLib database/files under Electron's `userData`; database encryption key is encrypted using Electron `safeStorage`. API credentials are not persisted by this app.
- Preview mode uses `getChatHistory` only and deliberately does not call `openChat`, `viewMessages`, or `readChatList`.

## Important limitations — not yet production-ready

- The TDLib native binary has not yet been validated in a packaged Windows installer on the user's PC.
- No real Telegram login or account test has been run in this environment.
- Read-without-Seen behavior must be tested against a second Telegram client and unread counters before being promised. This code avoids explicit read-marking calls; it cannot guarantee Telegram's server-side behavior for every update/content type.
- File sending currently uses TDLib's document upload path. Photo-specific and voice-message sending, media playback/download UI, Telegram folder synchronization, and persistent study categories are not complete.
- The UI demo rows are clearly marked as demo-only and are replaced by real chat results after a successful connection.
- RAM/startup performance has not been measured.

## Setup

1. Install Node.js and run `npm install` from `twinpanel-desktop`.
2. Launch TwinPanel and open **تلگرام اختصاصی**.
3. Enter your Telegram API ID and API Hash obtained from Telegram's official developer portal. These are used locally by TDLib.
4. Complete phone, code, and optional 2-step verification prompts inside the native window.

Never share login codes or 2FA passwords. Do not send the TDLib database, encryption key, or session data to a remote service. The current integration does not send those items to any TwinPanel backend.

## Official references

- https://core.telegram.org/tdlib/getting-started
- https://github.com/tdlib/td
- https://www.npmjs.com/package/tdl
- https://www.npmjs.com/package/prebuilt-tdlib
