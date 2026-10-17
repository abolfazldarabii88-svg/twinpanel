import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError
from telethon.tl.functions.account import UpdateNotifySettingsRequest
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest
from telethon.tl.functions.messages import MarkDialogUnreadRequest, SendReactionRequest, GetDialogFiltersRequest, GetScheduledHistoryRequest, DeleteScheduledMessagesRequest, ExportChatInviteRequest, EditScheduledMessageRequest, SetTypingRequest
from telethon.tl.functions.folders import EditPeerFoldersRequest
from telethon.tl.types import InputFolderPeer, InputMessagesFilterPinned
from telethon.tl.types import InputNotifyPeer, InputPeerNotifySettings, ReactionEmoji, SendMessageTypingAction
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
            "archived": bool(getattr(dialog, "folder_id", 0) == 1),
            "isPinned": bool(getattr(dialog, "is_pinned", False)),
            "muted": bool(getattr(getattr(dialog, "notify_settings", None), "mute_until", 0) and int(getattr(dialog.notify_settings, "mute_until", 0)) > int(time.time())),
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

def serialize_entities(message):
    result = []
    for entity in getattr(message, "entities", None) or []:
        item = {
            "type": type(entity).__name__,
            "offset": int(getattr(entity, "offset", 0)),
            "length": int(getattr(entity, "length", 0)),
        }
        url = getattr(entity, "url", None)
        if url:
            item["url"] = str(url)
        user_id = getattr(entity, "user_id", None)
        if user_id is not None:
            item["userId"] = str(user_id)
        if item["offset"] >= 0 and item["length"] > 0:
            result.append(item)
    return result


async def handle(method, args):
    global client, connected, connecting, me, diagnostic_stage, last_message
    if method == "status":
        return status()
    if method == "export-chat-invite-link":
        entity = entity_for(args.get("chatId"))
        peer = await client.get_input_entity(entity)
        expire_seconds = int(args.get("expireSeconds") or 0)
        usage_limit = int(args.get("usageLimit") or 0)
        if expire_seconds not in {0, 3600, 86400, 604800, 2592000}:
            raise RuntimeError("مدت اعتبار لینک دعوت معتبر نیست.")
        if usage_limit < 0 or usage_limit > 1000:
            raise RuntimeError("محدودیت استفاده باید بین ۰ تا ۱۰۰۰ باشد.")
        expire_date = int(time.time()) + expire_seconds if expire_seconds else None
        try:
            invite = await client(ExportChatInviteRequest(peer=peer, expire_date=expire_date, usage_limit=usage_limit or None))
        except Exception as exc:
            raise RuntimeError("ساخت لینک دعوت ممکن نشد؛ برای این گفتگو باید دسترسی مدیر داشته باشی.") from exc
        link = getattr(invite, "link", None)
        if not link:
            raise RuntimeError("تلگرام لینک دعوتی برنگرداند.")
        return {"link": str(link)}
    if method == "get-chat-info":
        entity = entity_for(args.get("chatId"))
        try:
            full_entity = await client.get_entity(entity)
            if getattr(full_entity, "broadcast", False) or getattr(full_entity, "megagroup", False):
                result = await client(GetFullChannelRequest(channel=full_entity))
                full_chat = result.full_chat
                participants_count = getattr(full_chat, "participants_count", None)
                about = getattr(full_chat, "about", "") or ""
                admins_count = getattr(full_chat, "admins_count", None)
            elif getattr(full_entity, "title", None) is not None:
                result = await client(GetFullChatRequest(chat_id=int(full_entity.id)))
                full_chat = result.full_chat
                participants = getattr(full_chat, "participants", None)
                participants_count = len(getattr(participants, "participants", []) or [])
                about = getattr(full_chat, "about", "") or ""
                admins_count = None
            else:
                return {"title": get_display_name(full_entity), "username": getattr(full_entity, "username", None), "type": "user", "verified": bool(getattr(full_entity, "verified", False)), "bot": bool(getattr(full_entity, "bot", False))}
            return {"title": getattr(full_entity, "title", None) or get_display_name(full_entity), "username": getattr(full_entity, "username", None), "type": "channel" if getattr(full_entity, "broadcast", False) else "group", "about": about[:3000], "participantsCount": participants_count, "adminsCount": admins_count, "verified": bool(getattr(full_entity, "verified", False)), "megagroup": bool(getattr(full_entity, "megagroup", False))}
        except Exception as exc:
            raise RuntimeError("اطلاعات کامل این گفتگو از تلگرام دریافت نشد.") from exc
    if method == "get-chat-members":
        entity = entity_for(args.get("chatId"))
        members = []
        try:
            participants = await client.get_participants(entity, limit=100)
        except Exception as exc:
            raise RuntimeError("فهرست اعضا در دسترس نیست؛ شاید این گفتگو خصوصی باشد یا تلگرام اجازه ندهد.") from exc
        for user in participants:
            name = get_display_name(user) or "کاربر"
            username = getattr(user, "username", None)
            members.append({"id": str(user.id), "name": name, "username": username, "bot": bool(getattr(user, "bot", False)), "verified": bool(getattr(user, "verified", False))})
        return {"members": members, "count": len(members), "limited": len(members) >= 100}
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
    if method == "search-global-messages":
        query = str(args.get("query") or "").strip()
        if len(query) < 2:
            raise RuntimeError("برای جستجوی سراسری حداقل دو نویسه وارد کن.")
        limit = max(1, min(int(args.get("limit") or 30), 100))
        found = []
        async for msg in client.iter_messages(None, search=query, limit=limit):
            try:
                chat = await msg.get_chat()
                chat_id = str(get_peer_id(chat)) if chat else str(msg.chat_id or "")
                if chat:
                    dialogs_cache[chat_id] = chat
                text_body = (msg.message or "").strip()
                found.append({
                    "id": str(msg.id),
                    "chatId": chat_id,
                    "title": get_display_name(chat) if chat else "گفتگو",
                    "date": int(msg.date.timestamp()) if msg.date else int(time.time()),
                    "outgoing": bool(msg.out),
                    "text": text_body[:4096] or ("رسانه / فایل" if msg.media else ""),
                    "contentType": type(msg.media).__name__ if msg.media else "text"
                })
            except Exception:
                continue
        return found
    if method == "list-dialog-folders":
        if not client or not connected:
            raise RuntimeError("ابتدا حساب تلگرام را متصل کن.")
        dialogs = await ensure_dialogs(1000)
        filters = await client(GetDialogFiltersRequest())
        result = []
        for folder in getattr(filters, "filters", []) or []:
            folder_id = int(getattr(folder, "id", 0) or 0)
            title_obj = getattr(folder, "title", "")
            title = str(getattr(title_obj, "text", title_obj) or "").strip()
            included, excluded = set(), set()
            for peer in getattr(folder, "include_peers", []) or []:
                try: included.add(str(get_peer_id(peer)))
                except Exception: pass
            for peer in getattr(folder, "exclude_peers", []) or []:
                try: excluded.add(str(get_peer_id(peer)))
                except Exception: pass
            matched = []
            for row in dialogs:
                cid = str(row["id"])
                entity = dialogs_cache.get(cid)
                if cid in excluded:
                    continue
                explicit = cid in included
                is_group = row.get("type") == "chat"
                is_channel = row.get("type") == "channel"
                is_user = row.get("type") == "user"
                matches_flags = bool(
                    (getattr(folder, "groups", False) and is_group) or
                    (getattr(folder, "broadcasts", False) and is_channel) or
                    (getattr(folder, "contacts", False) and is_user and bool(getattr(entity, "contact", False))) or
                    (getattr(folder, "non_contacts", False) and is_user and not bool(getattr(entity, "contact", False))) or
                    (getattr(folder, "bots", False) and bool(getattr(entity, "bot", False)))
                )
                if not explicit and not matches_flags:
                    continue
                if getattr(folder, "exclude_muted", False) and row.get("muted"):
                    continue
                if getattr(folder, "exclude_read", False) and int(row.get("unreadCount", 0)) == 0:
                    continue
                if getattr(folder, "exclude_archived", False) and row.get("archived"):
                    continue
                matched.append(cid)
            result.append({"id": folder_id, "title": title or f"پوشه {folder_id}", "chatIds": matched})
        return result
    if method in ("list-chats", "search-chats"):
        limit = args.get("limit", 80 if method == "list-chats" else 30)
        rows = await ensure_dialogs(1000)
        if method == "search-chats":
            q = str(args.get("query") or "").strip().casefold()
            rows = [r for r in rows if q in r["title"].casefold() or q in r["lastMessage"].casefold()]
            return rows[:max(1, min(int(limit or 30), 100))]
        return rows[:max(1, min(int(limit or 80), 1000))]
    if method == "history-around":
        entity = entity_for(args.get("chatId"))
        target_id = int(args.get("messageId") or 0)
        if target_id <= 0:
            raise RuntimeError("شناسهٔ پیام برای بازکردن نتیجه معتبر نیست.")
        messages = await client.get_messages(entity, limit=50, min_id=max(0, target_id - 25), max_id=target_id + 25)
        result = []
        for msg in messages:
            text = (msg.message or "").strip()
            if not text and msg.media:
                text = "رسانه / فایل"
            item = {"id": str(msg.id), "chatId": str(args.get("chatId")), "date": int(msg.date.timestamp()) if msg.date else int(time.time()), "outgoing": bool(msg.out), "text": text[:4096], "contentType": type(msg.media).__name__ if msg.media else "text"}
            result.append(item)
        return result
    if method == "list-pinned-messages":
        entity = entity_for(args.get("chatId"))
        result = []
        async for msg in client.iter_messages(entity, filter=InputMessagesFilterPinned, limit=100):
            body = (msg.message or "").strip()
            if not body and msg.media:
                body = "رسانه / فایل"
            result.append({"id": str(msg.id), "date": int(msg.date.timestamp()) if msg.date else int(time.time()), "text": body[:500], "outgoing": bool(msg.out), "contentType": type(msg.media).__name__ if msg.media else "text"})
        return result
    if method == "send-typing-action":
        entity = entity_for(args.get("chatId"))
        peer = await client.get_input_entity(entity)
        await client(SetTypingRequest(peer=peer, action=SendMessageTypingAction()))
        return {"ok": True}
    if method == "export-chat-history":
        entity = entity_for(args.get("chatId"))
        limit = max(1, min(int(args.get("limit") or 2000), 5000))
        rows = []
        async for msg in client.iter_messages(entity, limit=limit):
            body = (msg.message or "").strip()
            if not body and msg.media:
                body = "[رسانه / فایل: " + type(msg.media).__name__ + "]"
            rows.append({"id": str(msg.id), "date": msg.date.isoformat() if msg.date else "", "outgoing": bool(msg.out), "text": body[:4096]})
        rows.reverse()
        return {"messages": rows, "count": len(rows), "limited": len(rows) >= limit}
    if method == "search-chat-messages":
        entity = entity_for(args.get("chatId"))
        query = str(args.get("query") or "").strip()
        if len(query) < 2:
            raise RuntimeError("برای جست‌وجو دست‌کم دو نویسه وارد کن.")
        result = []
        async for msg in client.iter_messages(entity, search=query, limit=max(1, min(int(args.get("limit") or 50), 100))):
            text = (msg.message or "").strip()
            if not text and msg.media:
                text = "رسانه / فایل"
            result.append({"id": str(msg.id), "chatId": str(args.get("chatId")), "date": int(msg.date.timestamp()) if msg.date else int(time.time()), "outgoing": bool(msg.out), "text": text[:4096], "entities": serialize_entities(msg), "contentType": type(msg.media).__name__ if msg.media else "text", "searchResult": True})
        return result
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
                "entities": serialize_entities(msg),
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
    if method == "list-scheduled-messages":
        entity = entity_for(args.get("chatId"))
        peer = await client.get_input_entity(entity)
        result = await client(GetScheduledHistoryRequest(peer=peer, hash=0))
        items = []
        for msg in getattr(result, "messages", []) or []:
            items.append({"id": str(msg.id), "text": (getattr(msg, "message", "") or "")[:500], "date": int(msg.date.timestamp()) if getattr(msg, "date", None) else None})
        return items
    if method == "edit-scheduled-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        body = str(args.get("text") or "").strip()
        if message_id <= 0 or not body:
            raise RuntimeError("شناسه و متن پیام زمان‌بندی‌شده لازم است.")
        if len(body) > 4096:
            raise RuntimeError("متن پیام حداکثر می‌تواند ۴۰۹۶ نویسه باشد.")
        peer = await client.get_input_entity(entity)
        await client(EditScheduledMessageRequest(peer=peer, id=message_id, message=body))
        return {"ok": True, "id": str(message_id)}
    if method == "cancel-scheduled-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام زمان‌بندی‌شده معتبر نیست.")
        peer = await client.get_input_entity(entity)
        await client(DeleteScheduledMessagesRequest(peer=peer, id=[message_id]))
        return {"ok": True, "id": str(message_id)}
    if method == "schedule-message":
        entity = entity_for(args.get("chatId"))
        body = str(args.get("text") or "").strip()
        schedule_at = int(args.get("scheduleAt") or 0)
        if not body:
            raise RuntimeError("متن پیام خالی است.")
        if len(body) > 4096:
            raise RuntimeError("متن پیام از ۴۰۹۶ نویسه بیشتر است.")
        if schedule_at < int(time.time()) + 60:
            raise RuntimeError("زمان ارسال باید دست‌کم یک دقیقه در آینده باشد.")
        msg = await client.send_message(entity, body, schedule=datetime.fromtimestamp(schedule_at, timezone.utc))
        return {"id": str(msg.id), "scheduleAt": schedule_at}
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
    if method == "save-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        saved = await client.forward_messages("me", message_id, entity)
        saved_items = saved if isinstance(saved, list) else [saved]
        return {"ok": True, "ids": [str(item.id) for item in saved_items if item]}
    if method == "forward-message":
        source = entity_for(args.get("chatId"))
        target = entity_for(args.get("targetChatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        forwarded = await client.forward_messages(target, [message_id], from_peer=source)
        item = forwarded[0] if isinstance(forwarded, list) else forwarded
        return {"ok": True, "id": str(item.id) if item else ""}
    if method == "download-message-media":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        message = await client.get_messages(entity, ids=message_id)
        if not message or not message.media:
            raise RuntimeError("این پیام رسانه یا فایل قابل دانلود ندارد.")
        media_bytes = await client.download_media(message, file=bytes)
        if not media_bytes:
            raise RuntimeError("تلگرام فایلی برای این پیام برنگرداند.")
        if len(media_bytes) > 25 * 1024 * 1024:
            raise RuntimeError("دانلود از داخل پیش‌نمایش برای فایل‌های بالای ۲۵ مگابایت غیرفعال است.")
        mime = getattr(message.file, "mime_type", None) or "application/octet-stream"
        filename = getattr(message.file, "name", None) or f"telegram-{message_id}"
        return {"dataUrl": "data:" + mime + ";base64," + base64.b64encode(media_bytes).decode("ascii"), "fileName": filename, "mimeType": mime, "size": len(media_bytes)}
    if method == "message-link":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        username = getattr(entity, "username", None)
        if username:
            return {"url": f"https://t.me/{username}/{message_id}"}
        peer_id = str(args.get("chatId") or "")
        if peer_id.startswith("-100") and getattr(entity, "broadcast", False) or peer_id.startswith("-100") and hasattr(entity, "megagroup"):
            return {"url": f"https://t.me/c/{peer_id[4:]}/{message_id}"}
        return {"url": None}
    if method == "react-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        emoji = str(args.get("emoji") or "").strip()
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        if emoji and len(emoji) > 16:
            raise RuntimeError("واکنش انتخاب‌شده معتبر نیست.")
        reactions = [ReactionEmoji(emoticon=emoji)] if emoji else []
        await client(SendReactionRequest(peer=await client.get_input_entity(entity), msg_id=message_id, reaction=reactions))
        return {"ok": True, "id": str(message_id), "emoji": emoji}
    if method == "pin-message":
        entity = entity_for(args.get("chatId"))
        message_id = int(args.get("messageId") or 0)
        pinned = bool(args.get("pinned", True))
        if message_id <= 0:
            raise RuntimeError("شناسهٔ پیام معتبر نیست.")
        await client.pin_message(entity, message_id, notify=False) if pinned else await client.unpin_message(entity, message_id)
        return {"ok": True, "id": str(message_id), "pinned": pinned}
    if method == "send-media-batch":
        entity = entity_for(args.get("chatId"))
        raw_paths = args.get("filePaths") or []
        if not isinstance(raw_paths, list) or not raw_paths:
            raise RuntimeError("فایلی برای ارسال انتخاب نشده است.")
        if len(raw_paths) > 30:
            raise RuntimeError("در هر نوبت حداکثر ۳۰ فایل انتخاب کن.")
        paths = [Path(str(item or "")).resolve() for item in raw_paths]
        for item in paths:
            if not item.is_file():
                raise RuntimeError(f"فایل انتخاب‌شده پیدا نشد: {item.name}")
        caption = str(args.get("caption") or "")[:1024]
        sent_ids = []
        for offset in range(0, len(paths), 10):
            batch = paths[offset:offset + 10]
            captions = [caption] + [""] * (len(batch) - 1) if offset == 0 else None
            album_label = "آلبوم: " + ", ".join(item.name for item in batch[:3])
            def progress(current, total):
                event("upload-progress", {"chatId": str(args.get("chatId")), "fileName": album_label, "fileIndex": offset + 1, "fileCount": len(paths), "current": int(current), "total": int(total or 0), "percent": int(current * 100 / total) if total else 0})
            sent = await client.send_file(entity, [str(item) for item in batch], caption=captions, progress_callback=progress)
            if not isinstance(sent, list):
                sent = [sent]
            sent_ids.extend(str(item.id) for item in sent)
        return {"ids": sent_ids, "count": len(sent_ids)}
    if method == "send-media":
        entity = entity_for(args.get("chatId"))
        file_path = Path(str(args.get("filePath") or "")).resolve()
        if not file_path.is_file():
            raise RuntimeError("فایل انتخاب‌شده پیدا نشد.")
        def progress(current, total):
            event("upload-progress", {"chatId": str(args.get("chatId")), "fileName": file_path.name, "fileIndex": 1, "fileCount": 1, "current": int(current), "total": int(total or 0), "percent": int(current * 100 / total) if total else 0})
        msg = await client.send_file(entity, str(file_path), caption=str(args.get("caption") or "")[:1024], progress_callback=progress)
        return {"id": str(msg.id)}
    if method == "set-chat-pinned":
        entity = entity_for(args.get("chatId"))
        pinned = bool(args.get("pinned", True))
        if pinned:
            await client.pin_dialog(entity)
        else:
            await client.unpin_dialog(entity)
        return {"ok": True, "chatId": str(args.get("chatId")), "pinned": pinned}
    if method == "set-chat-archived":
        entity = entity_for(args.get("chatId"))
        input_peer = await client.get_input_entity(entity)
        archived = bool(args.get("archived", True))
        await client(EditPeerFoldersRequest(folder_peers=[InputFolderPeer(peer=input_peer, folder_id=1 if archived else 0)]))
        return {"ok": True, "chatId": str(args.get("chatId")), "archived": archived}
    if method == "set-chat-unread":
        entity = entity_for(args.get("chatId"))
        input_peer = await client.get_input_entity(entity)
        unread = bool(args.get("unread", False))
        if unread:
            await client(MarkDialogUnreadRequest(peer=input_peer, unread=True))
        else:
            await client.send_read_acknowledge(input_peer)
        return {"ok": True, "chatId": str(args.get("chatId")), "unread": unread}
    if method == "mute-chat-until":
        entity = entity_for(args.get("chatId"))
        seconds = int(args.get("seconds") or 0)
        allowed = {0, 3600, 28800, 172800, 31536000}
        if seconds not in allowed:
            raise RuntimeError("مدت بی‌صداکردن معتبر نیست.")
        mute_until = int(time.time()) + seconds if seconds else 0
        input_peer = await client.get_input_entity(entity)
        await client(UpdateNotifySettingsRequest(InputNotifyPeer(input_peer), InputPeerNotifySettings(mute_until=mute_until)))
        return {"ok": True, "muted": bool(seconds), "muteUntil": mute_until}
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
