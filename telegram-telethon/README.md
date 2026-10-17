# TwinPanel — Telethon experiment

This is a **separate proof-of-concept**. It does not replace or modify the current Electron/TDLib client. The first goal is to determine whether Telethon can connect from this machine, complete user-account login, persist a session, and read a small list of dialogs.

## Requirements

- Python 3.10 or newer
- Your own Telegram `api_id` and `api_hash` from [my.telegram.org/apps](https://my.telegram.org/apps)

## Windows PowerShell

From the repository root:

```powershell
cd telegram-telethon
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:TELEGRAM_API_ID = "YOUR_API_ID"
$env:TELEGRAM_API_HASH = "YOUR_API_HASH"
.\.venv\Scripts\python.exe main.py
```

The script asks for the phone number, Telegram login code, and (if enabled) the 2-Step Verification password. The code/password are entered interactively and are not written to source code. On success it prints the account identity and attempts to list up to 10 dialogs.

## Session security

The local session is stored under `data/twinpanel_telethon.session`. The `data/` directory is git-ignored. Treat the session file like a password: anyone who obtains it may gain access to the Telegram account. Never upload it, commit it, or send it in logs.

## What this test proves — and what it does not

- It checks whether this environment can reach Telegram through Telethon.
- It checks phone/code/2FA login and local session persistence.
- It checks basic dialog retrieval after login.
- It does **not** implement QR login or an Electron UI yet.
- It does **not** prove the old TDLib failure is fixed. If Telethon also times out, investigate network reachability/proxy/firewall before rewriting the UI.
- No API credentials are hard-coded. Do not use another person's account or credentials.

## Next step

Only after this test succeeds should we add a small local bridge between Electron and this isolated Python process. Keep the existing TDLib path untouched until the Telethon path is verified.
