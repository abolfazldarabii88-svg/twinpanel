"""Standalone Telethon proof-of-concept for TwinPanel.

Uses the local HTTP proxy configured by the user's VPN app (default 127.0.0.1:2081).
The proxy values can be overridden with TELEGRAM_PROXY_HOST and TELEGRAM_PROXY_PORT.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import socks
from telethon import TelegramClient
from telethon.errors import (
    ApiIdInvalidError,
    AuthKeyUnregisteredError,
    FloodWaitError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    PhoneNumberInvalidError,
    SessionPasswordNeededError,
)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SESSION_PATH = DATA_DIR / "twinpanel_telethon"
PROXY_HOST = os.getenv("TELEGRAM_PROXY_HOST", "127.0.0.1").strip()
PROXY_PORT = int(os.getenv("TELEGRAM_PROXY_PORT", "2081"))


def read_api_credentials() -> tuple[int, str]:
    raw_api_id = os.getenv("TELEGRAM_API_ID", "").strip()
    api_hash = os.getenv("TELEGRAM_API_HASH", "").strip()
    if not raw_api_id or not api_hash:
        print("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.")
        print("Set both environment variables before running this test.")
        raise SystemExit(2)
    try:
        api_id = int(raw_api_id)
    except ValueError as exc:
        raise SystemExit("TELEGRAM_API_ID must be an integer.") from exc
    return api_id, api_hash


async def main() -> int:
    api_id, api_hash = read_api_credentials()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Windows Internet Options indicates a local proxy at 127.0.0.1:2081.
    # Use HTTP proxy mode; Telethon otherwise ignores the Windows system proxy.
    proxy = (socks.HTTP, PROXY_HOST, PROXY_PORT)
    client = TelegramClient(str(SESSION_PATH), api_id, api_hash, proxy=proxy)
    try:
        print(f"Connecting to Telegram through HTTP proxy {PROXY_HOST}:{PROXY_PORT}…")
        await client.connect()
        if not await client.is_user_authorized():
            phone = input("Telegram phone number (international format): ").strip()
            if not phone:
                print("No phone number entered.")
                return 2
            try:
                await client.send_code_request(phone)
                code = input("Enter the login code sent by Telegram: ").strip()
                try:
                    await client.sign_in(phone=phone, code=code)
                except SessionPasswordNeededError:
                    password = input("Enter your Telegram 2-Step Verification password: ")
                    await client.sign_in(password=password)
            except PhoneNumberInvalidError:
                print("Telegram rejected the phone number format.")
                return 3
            except PhoneCodeInvalidError:
                print("The login code was rejected. Run again and request a fresh code.")
                return 4
            except PhoneCodeExpiredError:
                print("The login code expired. Run again to request a new code.")
                return 4
            except FloodWaitError as exc:
                print(f"Telegram rate-limited login. Wait {exc.seconds} seconds before retrying.")
                return 5

        me = await client.get_me()
        if me is None:
            print("Connected, but Telegram did not return the current account.")
            return 6

        name = " ".join(part for part in (me.first_name, me.last_name) if part)
        print("\nLOGIN SUCCESS")
        print(f"Account: {name or '(no display name)'}")
        print(f"User ID: {me.id}")
        print(f"Session file: {SESSION_PATH}.session")
        print("The session file is private: do not share it or commit it.")

        print("\nChecking dialog access…")
        count = 0
        async for dialog in client.iter_dialogs(limit=10):
            count += 1
            title = dialog.name or "(untitled chat)"
            print(f"{count:02d}. {title}")
        print(f"Dialog check complete ({count} chats returned).")
        return 0

    except ApiIdInvalidError:
        print("Telegram rejected API ID/hash. Verify them at https://my.telegram.org/apps.")
        return 10
    except (OSError, ConnectionError, TimeoutError) as exc:
        print(f"Network connection failed: {type(exc).__name__}: {exc}")
        print(f"Check that the VPN proxy is running and accepts HTTP connections at {PROXY_HOST}:{PROXY_PORT}.")
        return 11
    except AuthKeyUnregisteredError:
        print("Telegram invalidated the saved session. Delete the local session and sign in again.")
        return 12
    except Exception as exc:
        print(f"Telegram test failed: {type(exc).__name__}: {exc}")
        return 1
    finally:
        await client.disconnect()


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        print("\nCancelled.")
        raise SystemExit(130)
