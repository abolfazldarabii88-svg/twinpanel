# Telegram Web parity plan for TwinPanel

## Goal and reference

Rebuild the Telegram Web experience inside TwinPanel's native Telegram pane, using the official Telegram Web K implementation matrix as the initial capability inventory. Telegram Web A and Web K are separate clients and may differ; before declaring pixel/behavior parity, lock the exact reference build and compare screenshots and workflows against it.

**Status rule:** a checkbox is complete only after implementation, automated checks where possible, and a real-account test. This document is a backlog, not a claim that these features already work.

## Current baseline (observed from TwinPanel source)

- [x] Telethon-based account connection/authentication flow exists.
- [x] Chat/dialog list and text history loading exist.
- [x] Text message sending exists.
- [x] Older-message pagination is wired through the native UI, Electron IPC, service and Telethon bridge; scroll position is retained when older messages are prepended (automated/build and real-account verification still pending).
- [x] Outgoing text messages can be selected and edited or deleted through native UI controls and Telethon operations (server-side permissions and real-account behavior still need testing).
- [x] Account profile summary endpoint exists.
- [x] Limited photo/video previews and manual/automatic refresh were added on the v1.5.9 work branch.
- [ ] Full Telegram Web parity is not yet implemented or verified.

## P0 — Core client and reliability

- [ ] Stable sign-in: phone/code, 2FA password, QR sign-in if supported by chosen implementation, logout, session restore, expired-session handling.
- [ ] Connection state, reconnect/backoff, offline state, network errors, proxy support and clear diagnostics.
- [ ] Live updates without polling-only behavior: new/edit/delete messages, typing, online/last-seen changes, read state, reactions, chat list changes.
- [ ] Dialog list: private chats, groups, supergroups, channels, bots, Saved Messages, archived chats, unread counters, drafts, pinned chats, mute indicators.
- [ ] Chat folders: create/edit/reorder, include/exclude rules, shared folder links, pinned chats in folders.
- [ ] Chat list search, global search, in-chat search, date search, hashtag search, public-post search where API permits.
- [x] Basic older-message history pagination with scroll-position preservation (verification pending).
- [ ] Jump-to-date, unread divider, jump to latest, and efficient rendering of very long histories.
- [x] Send, edit and delete outgoing messages (code implemented; real-account verification pending).
- [ ] Reply/quote, forward, pin/unpin, copy text/link, select multiple, report, save/forward attribution choices.
- [ ] Per-chat cloud drafts and local draft restoration.
- [ ] Correct delivery/read states, typing indicators and read receipts where Telegram exposes them.
- [ ] Message context menus, keyboard shortcuts, drag-and-drop and clipboard behavior.
- [ ] Responsive layout and accessible keyboard/focus behavior.

## P1 — Media and rich messages

- [ ] Photos, albums/grouped media, thumbnails, full-screen viewer, zoom, next/previous, captions and download.
- [ ] Videos with thumbnails, playback controls, seeking, speed, captions and fullscreen.
- [ ] Voice messages: playback, waveform, progress, speed and transcription when account/API supports it.
- [ ] Round video notes, audio/music files and streaming where supported.
- [ ] Documents/files: file name, size, progress, cancel/retry, download/open/save and upload.
- [ ] Stickers: static, animated and video stickers; recent/favorite packs, install/remove/reorder.
- [ ] Emoji picker, emoji search/categories, custom emoji, animated emoji and emoji suggestions.
- [ ] GIF search, saved GIFs and GIF playback.
- [ ] Link previews with large/small preview choice.
- [ ] Locations, venues, contacts/vCards and live-location display (sending depends on supported platform/API).
- [ ] Polls and quizzes: create, vote, close/reopen where allowed, results and correct-answer display.
- [ ] Dice/animated random messages, games, invoices/payments and bot-generated rich content where supported.
- [ ] Spoilers, formatting, code blocks, blockquotes, mentions, hashtags, links, bot commands and formatted dates.
- [ ] Media spoiler blur, captions above/below media, media grouping and correct service messages.
- [ ] Paid media, Stars messages, gifts, giveaways, checklists/to-do messages and other newer message types when exposed by the chosen API.
- [ ] Upload queue with progress, retry and cancellation; multiple attachment selection and send-as-file/photo options.

## P2 — Profile, chat info and management

- [ ] Full profile viewer: avatar/photo history where available, name, username(s), bio, phone visibility rules, shared media/files/links, groups in common and status.
- [ ] Edit own profile: name, bio, username, profile photos/video where supported, emoji status and profile appearance.
- [ ] Contact management: add/edit/delete contacts, notes, birthdays where available, block/unblock and report.
- [ ] Chat info screens for users, groups, channels and bots; members list, admins, permissions, invite links and shared media.
- [ ] Group creation/editing, title/description/photo, member add/remove, join/leave and invite links.
- [ ] Admin rights, banned/restricted permissions, slow mode, join requests, join-to-send, hidden members, anti-spam and recent actions where permitted.
- [ ] Channel details, discussion links, signatures, comments, channel management and statistics where permissions/API allow.
- [ ] Topics/forums: list, create/edit/delete/pin topics, topic permissions and topic-specific unread state.
- [ ] Channel direct messages / linked discussion support where available.
- [ ] Saved Messages organization and Premium tags if the account supports them.
- [ ] Archive, mute/unmute, pin/unpin, mark read/unread, clear history, delete chat and leave chat actions with confirmation.

## P3 — Stories, calls, bots and web apps

- [ ] Story list/viewer, reactions/replies, captions, forwarding, archive and story privacy/viewer details where supported.
- [ ] Story creation/editor (photo/video, text, drawing, stickers, links, location and privacy) only if supported by the chosen API and media pipeline.
- [ ] One-to-one voice/video calls and call privacy settings if the protocol/API implementation can support them.
- [ ] Group voice/video chats, participant controls, screen sharing, scheduling and stream viewing if supported.
- [ ] Bot commands/autocomplete, reply keyboards, inline keyboards, callback buttons, bot profile/commands and menu buttons.
- [ ] Inline bots and attachment-menu bots.
- [ ] Telegram Mini Apps/Web Apps: secure webview/popup, back button, theme/viewport integration, permission prompts and supported data exchange.
- [ ] Link opening, instant-view/article rendering and safe external-browser handoff.

## P4 — Settings, privacy, notifications and personalization

- [ ] Settings screens with persistence and parity-oriented navigation.
- [ ] Language selection; light/dark/custom themes; chat backgrounds/wallpapers; animations and reduced-motion/power-saving options.
- [ ] Per-chat themes, notification rules, mute duration, silent messages and notification preview settings.
- [ ] Desktop notifications, unread badges, notification click-to-open and notification permission handling.
- [ ] Privacy settings: last seen/online, profile photo, phone, bio, forwarded-message links, calls/P2P, group invites, voice messages and other available privacy controls.
- [ ] Security: two-step verification, active sessions, passkeys where supported, blocked users, login email/session controls and QR login.
- [ ] Data/storage: auto-download rules, media cache/storage controls, network/data usage and cache clearing.
- [ ] Auto-delete timers, content protection/no-forward settings and read-date privacy where available.
- [ ] Chat reaction configuration and quick-reaction choice.
- [ ] Sticker/emoji, archive and download settings.
- [ ] Multi-account switching, add/remove account and session isolation.
- [ ] Premium/Stars/gifts/subscriptions surfaces where the account and API permit them; never fake purchases or balances.

## P5 — Advanced and account-dependent parity

- [ ] Premium features: translation, voice-to-text, custom emoji, larger uploads, infinite reactions, saved-message tags and Premium status surfaces.
- [ ] Channel monetization: Stars, paid media/messages/reactions, subscriptions, gifts, boosts, giveaways and statistics when available to the account.
- [ ] Global public-post search, recommended/similar channels and shared-media search where the API exposes them.
- [ ] Business settings and quick replies only to the extent Telegram exposes write access to the account/API; view-only is not feature parity.
- [ ] New Telegram message types/features added after this inventory: review official release notes and add regression cases.

## P6 — Quality, performance and fidelity

- [ ] Match reference layout, spacing, typography, icons, menus, animations, loading states, empty states and error states.
- [ ] Correct Persian/RTL and English/LTR layout, mixed-direction text, emoji and long filenames.
- [ ] Virtualized chat/history lists, lazy media loading, bounded media cache and no unbounded base64 retention.
- [ ] Keep TwinPanel lightweight on 4 GB RAM: measure memory, CPU, GPU and idle usage before/after long sessions.
- [ ] Retry and cancellation behavior for uploads/downloads; no duplicate sends after reconnect.
- [ ] Security review: keep API hash/session data out of logs, avoid exposing local session files, protect IPC, validate file paths and sanitize rendered content.
- [ ] Automated tests for message serialization, permissions, updates, media handling, settings persistence and error cases.
- [ ] Real-account acceptance checklist covering private chat, group, channel, bot, media, reconnect and restart.
- [ ] Side-by-side comparison against the chosen official Telegram Web version; record every mismatch before marking parity complete.

## Implementation constraints

- Telegram Web is a moving target; "exactly the same" means parity with a named reference build, not every feature on every platform at once.
- Some features are Premium-only, admin-only, region-dependent or unsupported by the available Telegram API/library. These must be marked as blocked/limited rather than simulated.
- Telethon's MTProto API coverage differs from Telegram Web's internal client implementation. For full parity, evaluate whether to use Telegram's official Web client as the UI/runtime inside TwinPanel, or continue rebuilding features on Telethon. Rebuilding all Web features on Telethon is a substantial project and may never achieve exact parity for unsupported APIs.
- No feature is complete until it has a visible UI, real backend action, correct error handling and a test result.
