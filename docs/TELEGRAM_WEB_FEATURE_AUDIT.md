# Telegram Web K feature audit for TwinPanel Native

Audit date: 2026-10-17  
Reference: [Official Telegram Web K feature inventory](https://github.com/TelegramOrg/Telegram-web-k/blob/master/TELEGRAM_FEATURES.md) and [Telegram Web K source](https://github.com/TelegramOrg/Telegram-web-k). This is an independent summary, not a copy of their implementation.

## How to read status

- **Present in code — unverified**: a visible or backend code path exists, but it has not passed a real-account acceptance test.
- **Partial**: only a narrow version of the feature exists.
- **Missing**: no complete implementation found in the current TwinPanel native pane/service/bridge.
- **Blocked / API-dependent**: may require protocol/library support, Telegram account rights, Premium, or an additional media/call runtime.
- **Verified** is reserved for features with automated checks plus a real-account test. No feature in this audit is marked Verified because no live Telegram account test was performed during this audit.

## Current native baseline checked in source

| Capability | Current evidence | Status |
|---|---|---|
| Phone/code, 2FA and QR login flow | Telethon bridge + auth prompt UI | Present in code — unverified |
| Saved API credentials / connection status / diagnostics | Electron IPC and native UI | Partial; needs restart/expired-session testing |
| Chat/dialog list | Telethon dialog iteration and cache | Present in code — unverified |
| Search within loaded chat titles and last-message snippets | search-chats filters fetched dialog rows | Partial; not Telegram global search |
| Recent message history | get_messages | Present in code — unverified |
| Older history pagination | history-before, merge and scroll restoration | Present in code — unverified |
| Send plain text | send-text | Present in code — unverified |
| Reply to selected message | reply-text plus UI state | Present in code — unverified |
| Edit/delete own message | edit-message / delete-message and UI controls | Present in code — unverified |
| Photo/video preview | Bounded media downloads to data URLs; limited size/cache | Partial |
| Send one selected file with optional caption | Native file chooser + send-media | Partial; no queue/progress/cancel |
| Mute a chat | One-year mute request | Partial; no duration picker/unmute UI |
| Profile summary | Name, username, ID, Premium/bot flags | Partial; not a full profile |
| Manual/periodic refresh | UI polling | Partial; no event-driven live update stream |
| Native pane is default, Telegram Web is fallback | TwinPanel host UI | Present in code — unverified |
| Real-account test, Windows packaged runtime test | Not performed in this audit | Not verified |

## Feature-by-feature parity inventory

### 1. Core messaging and message actions

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Plain text send/receive | Partial | Send/history code exists; live updates and account verification missing |
| Bold, italic, underline, strikethrough | Missing | Need Telegram entity parsing and rich-text composer |
| Code blocks, spoilers, blockquotes | Missing | Need entity-aware rendering and composer |
| Mentions, hashtags, links, bot commands | Partial | Plain text only; no autocomplete or structured entities |
| Reply/quote | Present in code — unverified | Basic reply to a selected message; no quote formatting/thread UI |
| Forward with/without attribution | Missing | Forward API and destination picker needed |
| Edit message text/media | Partial | Text edit path only; media caption/edit support missing |
| Delete own / delete for everyone | Partial | Delete path requests revoke; permissions and UI choices need testing |
| Pin/unpin | Missing | Message and chat pin actions absent |
| Scheduled / recurring messages | Missing | Scheduler and UI absent |
| Sent/read state and read receipts | Missing | No message status model or reliable read state |
| Typing indicators / online status | Missing | No live updates |
| Search in current conversation | Missing | Current search filters chat list only |
| Global Telegram search | Missing | No server-side message/user/channel search |
| Search by date / hashtag / public posts | Missing | No search workflows |
| Multi-select / bulk actions | Missing | No selection mode |
| Copy text / copy message link | Missing | No context menu/actions |
| Report message / user | Missing | No reporting flow |
| Save/forward attribution choices | Missing | No forwarding flow |
| Message effects / reactions / read-by list | Missing | No reaction or effect UI/API |
| Per-chat cloud drafts | Missing | Composer draft is not saved per chat |
| Context menu / shortcuts / drag-drop / clipboard | Missing | Minimal click actions only |
| Jump to latest / unread divider / jump-to-date | Missing | No unread boundary or date navigation |
| Very long history virtualization | Missing | Basic DOM rendering; performance risk |

### 2. Media, attachments and rich content

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Single photo display | Partial | Limited download size and inline preview |
| Photo albums / grouped media | Missing | Album grouping and layout absent |
| Full-screen photo viewer, zoom, next/previous | Missing | No media viewer |
| Video thumbnail, seeking, speed, fullscreen | Partial | Basic HTML video playback only |
| Voice messages / audio notes | Missing | No voice playback UI/waveform/recording |
| Round video notes | Missing | No dedicated display/recording |
| Music/audio files | Missing | Generic file label only |
| Documents and arbitrary files | Partial | Sending one selected file; received files not properly downloadable/openable |
| Upload/download progress, retry, cancel | Missing | No transfer queue |
| Multiple attachments / drag-drop | Missing | One file per chooser action |
| Send as photo vs file | Missing | No send-mode choice |
| Stickers: static, animated, video | Missing | No sticker renderer or pack manager |
| Emoji picker, categories, search, suggestions | Missing | Plain text input only |
| Custom/animated emoji and emoji sounds | Missing | No support |
| GIF search and saved GIFs | Missing | No inline bot or GIF picker |
| Link previews | Missing | No preview generation/rendering |
| Locations / venues / live location | Missing | No map/location message UI |
| Contact cards / vCards | Missing | No structured contact rendering |
| Polls / quizzes | Missing | No poll display, vote, create or results UI |
| Dice / games / invoices / payments | Missing | No rich-message renderer |
| Spoiler media / captions above media | Missing | No spoiler/media layout handling |
| Paid media / Stars / gifts / giveaways / checklists | Missing | No feature-specific UI or API paths |
| Service messages (join/leave/pin/topic changes) | Missing | No service-message rendering |
| Media cache limits / lazy load | Partial | Bridge has bounded in-memory data URL cache; renderer does not virtualize history |

### 3. Chats, folders, groups, channels and topics

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Private chats, groups, supergroups, channels, bots | Partial | Dialog list is generic; per-type actions and metadata are absent |
| Unread counts and unread markers | Missing | No unread model |
| Archived chats | Missing | No archive section/action |
| Pinned chats and custom order | Missing | No pin/reorder model |
| Chat folders and include/exclude rules | Missing | Only hard-coded category filters |
| Shared folders / folder invite links | Missing | No folder support |
| Chat list search | Partial | Local title/last-message substring match |
| Mark read/unread, clear history, delete chat, leave chat | Missing | No chat management actions |
| Chat info and shared media tabs | Missing | No details pane or shared media browser |
| Group creation/editing/photo/title/description | Missing | No group-management UI |
| Members/admins/permissions/banned users | Missing | No members or permissions screens |
| Invite links / join requests / join-to-send | Missing | No management actions |
| Slow mode / anti-spam / recent actions | Missing | No admin tooling |
| Group statistics / hidden members / content protection | Missing | No support in UI |
| Channel info, comments/discussion links, signatures | Missing | No channel-specific view/actions |
| Channel stats / subscriptions / monetization | Missing | No channel admin or monetization UI |
| Forums/topics: create/edit/delete/pin and topic permissions | Missing | No topic model/UI |
| Channel direct messages / linked discussion | Missing | No channel-DM workflow |
| Saved Messages organization / Premium tags | Partial | Shortcut only; no organization or tag UI |
| Per-chat themes/wallpaper/reactions configuration | Missing | No chat-specific settings |
| Mute/unmute with duration | Partial | Mute for a fixed year; no unmute/duration controls |

### 4. Profiles, contacts and account management

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Full profile with avatar, bio, phone visibility, common groups | Partial | Current profile endpoint is a summary only |
| View profile photos/history | Missing | No photo gallery |
| Edit own name, bio, username, profile photo | Missing | No profile editing |
| Emoji status/profile appearance | Missing | No UI |
| Add/edit/delete contacts | Missing | No contacts management |
| Block/unblock/report users | Missing | No controls |
| Multi-account support and account switching | Missing | Single Telethon service/session |
| Logout / remove account / session isolation | Partial | Close exists; user-facing logout/account management incomplete |
| Active sessions and device management | Missing | No session management |
| QR sign-in | Present in code — unverified | Flow exists; end-to-end real-account behavior still needs testing |
| Password/2FA/email/session security screens | Partial | Password prompt during login only |
| Passkeys / secret chats / Telegram Passport | Blocked / API-dependent | No current implementation; secret chats require E2E-specific support |

### 5. Stories, calls, bots and Mini Apps

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Story list/viewer/reactions/replies/archive | Missing | No stories UI or API workflow |
| Create/edit stories and story privacy | Missing | Media editor and story API absent |
| One-to-one voice/video calls | Blocked / API-dependent | No call signaling/media runtime |
| Group voice/video chats, screen sharing, scheduling | Blocked / API-dependent | No group-call runtime |
| Bot commands/autocomplete | Partial | Messages can be sent as text; no command helper |
| Reply keyboards / inline keyboards / callback buttons | Missing | No structured button renderer |
| Bot profile/commands/menu buttons | Missing | No bot details panel |
| Inline bots / attachment-menu bots | Missing | No inline query UI |
| Telegram Mini Apps/Web Apps | Missing | No secure Mini App container or Telegram WebApp bridge |
| Instant View / article reader | Missing | Links have no internal reader |
| External links / safe browser handoff | Partial | Host navigation policy exists, but native client link handling is incomplete |

### 6. Search, notifications, privacy, settings and personalization

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Global search users/chats/channels/messages | Missing | Only local chat-list filtering |
| Shared media search / search by date / hashtag | Missing | No search backend/UI |
| Similar/recommended channels/public post search | Missing | API/UI absent |
| Desktop notifications and unread badge | Missing | No notification pipeline |
| Per-chat notifications / mute duration / silent messages | Partial | Fixed mute only |
| Notification preview and sound settings | Missing | No settings UI |
| Language selection | Missing | UI is currently Persian/RTL-focused |
| Light/dark/custom themes | Partial | Host theme variables style the native pane; no full theme picker |
| Chat backgrounds / wallpapers / animations | Missing | No customization screens |
| Reduced motion / power-saving mode | Missing | No setting |
| Privacy settings (last seen, phone, photo, calls, invites) | Missing | No settings flows |
| Content protection / no-forward / auto-delete timer | Missing | No controls |
| Data/storage, auto-download, cache management | Missing | No settings or user-visible cache controls |
| Sticker/emoji/download settings | Missing | No settings |
| Premium status surfaces / translation / transcription | Partial or missing | Profile exposes a Premium flag only; feature surfaces absent |
| Stars, gifts, paid content, boosts and subscriptions | Missing | No UI or transaction workflows |
| Business hours / quick replies / business settings | Missing | No Business management UI |

### 7. UX fidelity, reliability and security

| Area | TwinPanel status | Required work |
|---|---|---|
| Live message event stream | Partial — code added, unverified | New/edit/delete events flow from Telethon through IPC to the native renderer; dialog metadata still refreshes separately |
| Reconnect/backoff/offline state | Partial | Diagnostics exist; resilient reconnect and duplicate prevention needed |
| Stable session restore / expired session | Partial | Test packaged restart, auth expiry, cancellation and re-login |
| Message rendering fidelity | Missing | Render entities, service messages, replies, reactions, media groups and rich types |
| RTL/LTR mixed text and accessibility | Partial | Audit mixed-direction text, keyboard navigation, focus, labels and screen-reader semantics |
| Loading/empty/error states | Partial | Some states exist; cover per-operation retry/cancel and offline states |
| Large history performance | Missing | Add virtualized list/windowing and incremental media loading |
| Low-memory behavior on 4 GB RAM | Not measured | Capture idle, long-history, media and reconnect memory/CPU/GPU baselines |
| IPC security and argument validation | Partial | Audit every exposed IPC path, sender checks, message IDs and file paths |
| Credential/session safety | Partial | Verify secrets never enter logs; review local session file permissions and backup/restore |
| Automated tests | Partial | Existing CI checks syntax; add behavior/unit tests for bridge/service/UI flows |
| Real Telegram acceptance tests | Not done | Must test private chat, group, channel, bot, media, reply/edit/delete, reconnect and restart |
| Reference screenshot/workflow comparison | Not done | Pin a specific Web K reference build and record mismatches |

## Recommended build order

1. **Reliability first:** session restore, robust cancellation, reconnect/error states, real-time Telethon events, deduplicated updates.
2. **Core messaging:** message context menu, forwarding, pinning, copy, read/unread state, in-chat search, per-chat drafts, reactions.
3. **Media correctness:** photo albums/viewer, downloads, voice/audio, document handling, transfer queue and progress.
4. **Chat management:** unread counts, archive/pins, folder support, chat info, members and permissions.
5. **Rich content:** stickers/emoji/GIFs, polls, locations/contacts, formatting, bot keyboards.
6. **Settings and account:** full profile, contacts, notifications, privacy, themes, storage, multi-account.
7. **Advanced Telegram surfaces:** topics, stories, calls, Mini Apps, Premium/Stars/Business where the library and account allow.
8. **Fidelity and performance:** visual comparison, keyboard/accessibility, virtualized history and 4 GB RAM profiling.

## Acceptance rule

A row may move to **Verified** only after:
1. UI and backend paths are implemented end-to-end;
2. input validation, permission errors, retries and cancellation are covered;
3. automated checks pass;
4. a real account verifies both success and failure paths;
5. the workflow is compared against the pinned Telegram Web K reference.

Do not create a release or installer while this parity work is in progress unless the user explicitly asks for one. Keep changes on the development branch/PR.
