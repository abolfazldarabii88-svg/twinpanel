import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError
from telethon.tl.functions.account import UpdateNotifySettingsRequest
from telethon.tl.functions.messages import MarkDialogUnreadRequest
from telethon.tl.types import InputNotifyPeer, InputPeerNotifySettings
from telethon.utils import get_display_name, get_peer_id
from python_socks import ProxyType

client = None
connected = False
connecting = False
me = None
dialogs_cache = {}
media_data_cache = {}
pending_auth = asyncio.Queue()
tasks = set()
diagnostic_stage = "ready"
last_message = "برای اتصال، API ID و API Hash را وارد کن."

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()

def event(name, value):
    emit({"event": name, "data": value})

def status(message=None):
    return {
        "connected": connected,
        "connecting": connecting,
        "engine": "Telethon",
        "stage": "connected" if connected else ("authorizing" if connecting else "ready"),
        "diagnosticStage": diagnostic_stage,
        "message": message or last_message
    }

def set_status(stage, message):
    global diagnostic_stage, last_message
    diagnostic_stage, last_message = stage, message
    event("status", status(message))

async def ask(kind, label, link=None):
    packet = {"type": kind, "label": label}
    if link:
        packet["link"] = link
    event("prompt", packet)
    while True:
        answer = await pending_auth.get()
        if answer.get("type") == "cancel":
            raise asyncio.CancelledError()
        if answer.get("type") == kind:
            return str(answer.get("value") or "").strip()

async def ensure_dialogs(limit=1000):
    global dialogs_cache
    if not client or not connected:
        raise RuntimeError("ابتدا حساب تلگرام را متصل کن.")
    rows = []
    async for dialog in client.iter_dialogs(limit=max(1, min(int(limit or 80), 1000))):
        entity = dialog.entity
        try:
            peer_id = str(get_peer_id(entity))
        except Exception:
            peer_id = str(dialog.id)
        dialogs_cache[peer_id] = entity
        title = "Saved Messages" if getattr(entity, "id", None) == getattr(me, "id", None) and getattr(entity, "username", None) is None else (dialog.name or get_display_name(entity) or "گفتگو")
        last = dialog.message
        preview = ""
        if last:
            preview = (last.message or "").strip()
            if not preview and last.media:
                preview = "رسانه / فایل"
            preview = preview[:240]
        rows.append({
            "id": peer_id,
            "title": title,
            "unreadCount": int(dialog.unread_count or 0),
            "lastMessage": preview,
            "isSavedMessages": bool(getattr(entity, "id", None) == getattr(me, "id", None)),
            "type": "user" if getattr(entity, "first_name", None) is not None else ("channel" if getattr(entity, "broadcast", False) else "chat")
        })
    return rows

def entity_for(chat_id):
    key = str(chat_id)
    entity = dialogs_cache.get(key)
    if entity is not None:
        return entity
    if not client:
        raise RuntimeError("ابتدا حساب تلگرام را متصل کن.")
    return int(key)

async def handle(method, args):
    global client, connected, connecting, me, diagnostic_stage, last_message
    if method == "status":
        return status()
    if method == "profile":
        if not client or not connected or not me:
            raise RuntimeError("ابتدا حساب تلگرام را متصل کن.")
        full = await client.get_me()
        return {"id": str(full.id), "name": get_display_name(full), "username": getattr(full, "username", None), "firstName": getattr(full, "first_name", None), "lastName": getattr(full, "last_name", None), "isPremium": bool(getattr(full, "premium", False)), "bot": bool(getattr(full, "bot", False))}
    if method == "credentials-status":
        return {"saved": False}
    if method == "connect":
        if connected:
            return status()
        if connecting:
            raise RuntimeError("تلاش اتصال قبلی هنوز فعال است.")
        api_id = int(args.get("apiId") or 0)
        api_hash = str(args.get("apiHash") or "").strip()
        if api_id <= 0 or len(api_hash) != 32:
            raise RuntimeError("API ID یا API Hash معتبر نیست.")
        connecting = True
        set_status("starting", "در حال آماده‌سازی اتصال Telethon…")
        data_dir = Path(os.environ.get("TWINPANEL_DATA_DIR", str(Path.home() / ".twinpanel" / "telegram-native")))
        data_dir.mkdir(parents=True, exist_ok=True)
        proxy_cfg = args.get("proxy") or {}
        proxy = None
        ptype = str(proxy_cfg.get("type") or "").lower()
        if ptype in ("http", "socks5"):
            host, port = str(proxy_cfg.get("server") or "").strip(), int(proxy_cfg.get("port") or 0)
            if not host or not 1 <= port <= 65535:
                raise RuntimeError("تنظیمات پروکسی معتبر نیست.")
            proxy_type = ProxyType.HTTP if ptype == "http" else ProxyType.SOCKS5
            proxy = (proxy_type, host, port, True, proxy_cfg.get("username") or None, proxy_cfg.get("password") or None)
        client = TelegramClient(str(data_dir / "twinpanel_telethon"), api_id, api_hash, proxy=proxy, connection_retries=3, request_retries=3, timeout=20)
        await client.connect()
        if await client.is_user_authorized():
            me = await client.get_me()
        elif str(args.get("loginMethod") or "phone").lower() == "qr":
            set_status("awaiting-qr", "QR ورود آماده می‌شود…")
            qr = await client.qr_login()
            event("prompt", {"type": "qr", "label": "ورود امن با QR تلگرام", "link": qr.url})
            try:
                me = await qr.wait(timeout=120)
            except SessionPasswordNeededError:
                password = await ask("password", "رمز تأیید دومرحله‌ای")
                await client.sign_in(password=password)
                me = await client.get_me()
        else:
            phone = await ask("phone", "شماره تلفن با کد کشور")
            await client.send_code_request(phone)
            code = await ask("code", "کد ورود تلگرام")
            try:
                await client.sign_in(phone=phone, code=code)
            except SessionPasswordNeededError:
                password = await ask("password", "رمز تأیید دومرحله‌ای")
                await client.sign_in(password=password)
            me = await client.get_me()
        connected = True
        connecting = False

        async def publish_message_update(kind, message, chat_id):
            try:
                body = (message.message or "").strip()
                if not body and message.media:
                    body = "رسانه / فایل"
                item = {
                    "kind": kind,
                    "chatId": str(chat_id or ""),
                    "id": str(message.id),
                    "date": int(message.date.timestamp()) if message.date else int(time.time()),
                    "outgoing": bool(message.out),
                    "text": body[:4096],
                    "contentType": type(message.media).__name__ if message.media else "text"
                }
                event("update", item)
            except Exception:
                pass

        async def on_new_message(update_event):
            await publish_message_update("new", update_event.message, update_event.chat_id)

        async def on_edited_message(update_event):
            await publish_message_update("edit", update_event.message, update_event.chat_id)

        async def on_deleted_messages(update_event):
            for message_id in update_event.deleted_ids or []:
                event("update", {"kind": "delete", "chatId": str(update_event.chat_id or ""), "id": str(message_id)})

        client.add_event_handler(on_new_message, events.NewMessage)
        client.add_event_handler(on_edited_message, events.MessageEdited)
        client.add_event_handler(on_deleted_messages, events.MessageDeleted)
        event("prompt", {"type": "cancelled"})
        set_status("connected", "حساب تلگرام با موفقیت متصل شد.")
        return {**status(), "account": getattr(me, "first_name", "") or get_display_name(me), "userId": str(me.id)}
    if method == "auth-input":
        await pending_auth.put({"type": args.get("type"), "value": args.get("value")})
        return {"ok": True}
    if method == "cancel":
        await pending_auth.put({"type": "cancel", "value": ""})
        return status("درخواست اتصال لغو شد.")
    if method == "diagnostics":
        return {"stage": diagnostic_stage, "message": last_message, "engine": "Telethon"}
    if method in ("list-chats", "search-chats"):
        limit = args.get("limit", 80 if method == "list-chats" else 30)
        rows = await ensure_dialogs(1000)
        if method == "search-chats":
            q = str(args.get("query") or "").strip().casefold()
            rows = [r for r in rows if q in r["title"].casefold() or q in r["lastMessage"].casefold()]
            return rows[:max(1, min(int(limit or 30), 100))]
        return rows[:max(1, min(int(limit or 80), 1000))]
    if method in ("history", "preview", "history-before"):
        entity = entity_for(args.get("chatId"))
        limit = max(1, min(int(args.get("limit") or 40), 100))
        offset_id = int(args.get("offsetId") or 0)
        messages = await client.get_messages(entity, limit=limit, offset_id=offset_id)
        result = []
        for msg in messages:
            text = (msg.message or "").strip()
            if not text and msg.media:
                text = "رسانه / فایل"
            item = {
                "id": str(msg.id),
                "chatId": str(args.get("chatId")),
                "date": int(msg.date.timestamp()) if msg.date else int(time.time()),
                "outgoing": bool(msg.out),
                "text": text[:4096],
                "contentType": type(msg.media).__name__ if msg.media else "text"
            }
            cache_key = str(args.get("chatId")) + ":" + str(msg.id)
            is_image = bool(msg.photo or (msg.document and str(getattr(msg.file, "mime_type", "")).startswith("image/")))
            is_video = bool(msg.video or (msg.document and str(getattr(msg.file, "mime_type", "")).startswith("video/")))
            if is_video:
                item["contentType"] = "video"
            if is_image or is_video:
                if cache_key in media_data_cache:
                    item["mediaDataUrl"] = media_data_cache[cache_key]
                else:
                    try:
                        media_bytes = await client.download_media(msg, file=bytes)
                        max_size = 8 * 1024 * 1024 if is_video else 4 * 1024 * 1024
                        if media_bytes and len(media_bytes) <= max_size:
                            mime = getattr(msg.file, "mime_type", None) or ("video/mp4" if is_video else "image/jpeg")
                            data_url = "data:" + mime + ";base64," + base64.b64encode(media_bytes).decode("ascii")
                            media_data_cache[cache_key] = data_url
                            item["mediaDataUrl"] = data_url
                            if len(media_data_cache) > 150:
                                media_data_cache.pop(next(iter(media_data_cache)))
                    except Exception:
                        pass
            result.append(item)
        return result
    if method == "send-text":
        entity = entity_for(args.get("chatId"))
        body = str(args.get("text") or "").strip()
        if not body or len(body) > 4096:
            raise RuntimeError("متن پیام خالی است یا بیش از حد طولانی است.")
        msg = await client.send_message(entity, body)
        return {"id": str(msg.id), "text": body}
    if method == "reply-text":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        body = str(args.get("text") or "").strip()
        if message_id <= 0 or not body or len(body) > 4096:
            raise RuntimeError("شناسهٔ پیام یا متن پاسخ معتبر نیست.")
        msg = await client.send_message(entity, body, reply_to=message_id)
        return {"id": str(msg.id), "text": body, "replyToMessageId": str(message_id)}
    if method == "edit-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        body = str(args.get("text") or "").strip()
        if message_id <= 0 or not body or len(body) > 4096:
            raise RuntimeError("شناسهٔ پیام یا متن ویرایش معتبر نیست.")
        edited = await client.edit_message(entity, message_id, body)
        return {"id": str(edited.id), "text": body}
    if method == "delete-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        await client.delete_messages(entity, [message_id], revoke=True)
        return {"ok": True, "id": str(message_id)}
    if method == "forward-message":
        source = entity_for(args.get("chatId"))
        target = entity_for(args.get("targetChatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        forwarded = await client.forward_messages(target, [message_id], from_peer=source)
        item = forwarded[0] if isinstance(forwarded, list) else forwarded
        return {"ok": True, "id": str(item.id) if item else ""}
    if method == "pin-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        pinned = bool(args.get("pinned", True))
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        await client.pin_message(entity, message_id, notify=False) if pinned else await client.unpin_message(entity, message_id)
        return {"ok": True, "id": str(message_id), "pinned": pinned}
    if method == "send-media":
        entity = entity_for(args.get("chatId"))
        file_path = Path(str(args.get("filePath") or "")).resolve()
        if not file_path.is_file():
            raise RuntimeError("فایل انتخاب‌شده پیدا نشد.")
        msg = await client.send_file(entity, str(file_path), caption=str(args.get("caption") or "")[:1024])
        return {"id": str(msg.id)}
    if method == "set-chat-unread":
        entity = entity_for(args.get("chatId"))
        input_peer = await client.get_input_entity(entity)
        unread = bool(args.get("unread", False))
        if unread:
            await client(MarkDialogUnreadRequest(peer=input_peer, unread=True))
        else:
            await client.send_read_acknowledge(input_peer)
        return {"ok": True, "chatId": str(args.get("chatId")), "unread": unread}
    if method == "mute-chat":
        entity = entity_for(args.get("chatId"))
        mute_until = int(time.time()) + 31536000 if args.get("muted") else 0
        input_peer = await client.get_input_entity(entity)
        await client(UpdateNotifySettingsRequest(InputNotifyPeer(input_peer), InputPeerNotifySettings(mute_until=mute_until)))
        return {"ok": True}
    if method == "close":
        if client:
            await client.disconnect()
        client = None
        connected = False
        connecting = False
        return {"ok": True}
    raise RuntimeError("عملیات ناشناخته است: " + str(method))

async def main():
    async def process(req):
        request_id = req.get("id")
        try:
            result = await handle(str(req.get("method") or ""), req.get("args") or {})
            emit({"id": request_id, "ok": True, "result": result})
        except asyncio.CancelledError:
            emit({"id": request_id, "ok": False, "error": "فرایند ورود لغو شد."})
        except Exception as exc:
            global connecting
            connecting = False
            set_status("error", str(exc)[:240] or "اتصال ناموفق بود.")
            emit({"id": request_id, "ok": False, "error": str(exc)[:500] or "خطای نامشخص"})

    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if not line:
            break
        try:
            req = json.loads(line)
        except Exception:
            continue
        task = asyncio.create_task(process(req))
        tasks.add(task)
        task.add_done_callback(tasks.discard)
    if client:
        await client.disconnect()
    for task in list(tasks):
        task.cancel()

if __name__ == "__main__":
    asyncio.run(main())
