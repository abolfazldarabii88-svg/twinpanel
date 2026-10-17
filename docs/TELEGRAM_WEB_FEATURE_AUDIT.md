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
| Search within loaded chat titles and last-message snippets | search-chats filters fetched dialog rows | Partial; not Telegram global search |\n| Search text within currently loaded messages in the active conversation | Local renderer filter over loaded message text | Partial; no server-side/global search, and unloaded older messages are not searched |
| Keyboard shortcuts (Ctrl/Cmd+F, Ctrl/Cmd+K, Ctrl/Cmd+Shift+F, Ctrl/Cmd+Enter, Escape) | Native renderer key handler | Present in code — unverified; shortcut conflicts and Windows runtime behavior still need testing |
| Recent message history | get_messages | Present in code — unverified |
| Date separators in conversation history | Renderer groups adjacent messages by local calendar date | Present in code — unverified; timezone and long-history behavior still need runtime testing |
| Older history pagination | history-before, merge and scroll restoration | Present in code — unverified |
| Per-conversation scroll position | Renderer stores offsets per chat, restores them after switching chats, and persists up to 200 chat offsets in local storage across app restarts; restoration clamps to the current scroll range and preserves a valid zero offset | Present in code — unverified; storage, history refresh and long-chat behavior still need runtime testing |
| Jump to latest messages | Native conversation control scrolls to the bottom of the loaded history | Present in code — unverified; live-update and long-history behavior still need testing |
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

## Page and section inventory

This separates actual navigation/overlays in TwinPanel from Telegram Web destinations that are not implemented yet. “In code” is not a claim of live-account verification.

| Telegram-like page/section | TwinPanel today | Gap |
|---|---|---|
| All chats / conversation list | In code | Dialog list exists; parity for every chat type and full contact directory is incomplete |
| Study / personal / channel categories | In code | Local category filters; they are not Telegram cloud folders |
| Contacts | Partial | Loads the account's actual Telegram contact list, opens contacts outside existing dialogs, and can add a contact by phone number; editing/deleting contacts and contact sharing are missing |
| Saved Messages | In code | Can open Saved Messages and save messages; no complete tags/collections/organization page |
| Archived and unread chats | Partial | Filters/actions exist; exact Telegram Web archive UX and folder edge cases need testing |
| Custom Telegram folders | Partial | Existing folders can be listed and selected; folder creation, editing and sharing are missing |
| Current conversation | In code | History, search, reply, reactions, media viewer and message actions exist in varying levels of completeness |
| Profile / chat info / members | Partial | Summary dialogs only; no full profile editor or complete group/channel administration pages |
| Client settings | Partial | Auto-refresh, compact mode, light/dark theme, font size, Telegram privacy controls and a connected-device/session manager with remote logout are in code; comprehensive notification controls remain missing |
| Connection / QR / phone authorization | In code | Authentication screens exist; QR/phone login still requires Windows and real-account acceptance testing |
| Scheduled messages | Partial | A dedicated manager now lists scheduled messages with inline edit/cancel actions; scheduling still uses a text date/time prompt instead of a native date/time picker |
| Stories | Missing | No stories strip, viewer, publishing or privacy controls |
| Voice/video and group calls | Missing | No calling UI/runtime |
| Group/channel management and topics | Missing | No full admin screens, topic navigation, permissions or recent actions |
| Polls, stickers, GIFs, bots and mini apps | Partial | Native poll creation supports 2–10 options, anonymous/public voting and multiple choice; GIF search/send through Telegram's inline GIF bot is in code; poll voting/result interactions, sticker browsing, bot menus and mini apps remain missing |
| Multiple accounts and Secret Chats | Missing / protocol-dependent | Not implemented; Secret Chats cannot be treated as ordinary cloud chats |

## Feature-by-feature parity inventory

### 1. Core messaging and message actions

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Plain text send/receive | Partial | Send/history code exists; live updates and account verification missing |
| Bold, italic, underline, strikethrough | Missing | Need Telegram entity parsing and rich-text composer |
| Code blocks, spoilers, blockquotes | Missing | Need entity-aware rendering and composer |
| Mentions, hashtags, links, bot commands | Partial | Plain text only; no autocomplete or structured entities |
| Reply/quote | Present in code — unverified | Basic reply to a selected message; no quote formatting/thread UI |
| Forward with/without attribution | Partial | Forward API and exact-title destination picker implemented; no attribution-choice UI; real-account permissions/behavior unverified |
| Edit message text/media | Partial | Text edit path only; media caption/edit support missing |
| Delete own / delete for everyone | Partial | Delete path requests revoke; permissions and UI choices need testing |
| Pin/unpin message | Partial | Pin and unpin API actions and selected-message controls implemented; real-account permission checks still missing |
| Scheduled / recurring messages | Missing | Scheduler and UI absent |
| Sent/read state and read receipts | Partial | Explicit mark-chat-read/unread actions and unread-count badges implemented; live receipt/status UI and account verification remain missing |
| Typing indicators / online status | Missing | No live updates |
| Search in current conversation | Partial | Local search filters only currently loaded message text; older unloaded history, media captions and server-side search are not included |
| Global Telegram search | Missing | No server-side message/user/channel search |
| Search by date / hashtag / public posts | Missing | No search workflows |
| Multi-select / bulk actions | Partial — added in code, unverified | Selection mode supports copying selected text, saving selected messages to Saved Messages, and forwarding selected messages to a chat; no bulk delete; Shift-click range selection is supported in the loaded message list. CI and real-account behavior still need verification |
| Copy text / message link | Partial | Copy selected message text and direct link where supported implemented; context menu and links for every peer type remain missing |
| Report message / user | Missing | No reporting flow |
| Save/forward attribution choices | Partial | Basic forward-to-chat flow exists; attribution choices and save/copy workflows remain missing |
| Message effects / reactions / read-by list | Missing | No reaction or effect UI/API |
| Per-chat cloud drafts | Missing | Composer draft is not saved per chat |
| Context menu / shortcuts / drag-drop / clipboard | Missing | Minimal click actions only |
| Jump to latest / unread divider / jump-to-date | Partial | Jump-to-latest and local jump-to-date are implemented for loaded history; unread boundary and server-side date retrieval remain missing |
| Very long history virtualization | Missing | Basic DOM rendering; performance risk |

### 2. Media, attachments and rich content

| Telegram Web capability | TwinPanel status | Notes / required work |
|---|---|---|
| Single photo display | Partial | Limited download size and inline preview; loaded photo/video can now be saved from the selected message |
| Photo albums / grouped media | Missing | Album grouping and layout absent |
| Full-screen photo viewer, zoom, next/previous | Missing | No media viewer |
| Video thumbnail, seeking, speed, fullscreen | Partial | Basic HTML video playback only |
| Voice messages / audio notes | Missing | No voice playback UI/waveform/recording |
| Round video notes | Missing | No dedicated display/recording |
| Music/audio files | Missing | Generic file label only |
| Documents and arbitrary files | Partial | Sending one selected file; received media/documents up to 25 MB can be downloaded; larger files and save-dialog destination choice remain missing |
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
| Unread counts and unread markers | Partial | Dialog unread counts are rendered as badges and can be toggled read/unread; refresh consistency and real-account behavior unverified |
| Archived chats | Partial | Archive/unarchive actions and an archived filter exist; folder behavior and complete archive-page parity still need verification |
| Pinned chats and custom order | Partial | Pin/unpin chat actions and pinned-first sorting exist; drag-and-drop custom ordering is missing |
| Chat folders and include/exclude rules | Partial | Telegram custom folder filters are fetched and displayed read-only; creating/editing rules and shared folders are missing |
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


### Newly implemented in this pass
- Multiple selected files are sent as Telegram media-group albums (batches of up to 10 files).
- Selected messages can be forwarded to Saved Messages from the message action toolbar.


### Further parity additions
- Selected message can be saved to Saved Messages.
- Multiple selected files are sent as Telegram media albums in batches of up to 10.
- Chat notification mute now supports timed presets (1 hour, 8 hours, 2 days, 1 year) and unmute.

- Scheduled text messages: composer control accepts local date/time and schedules through Telegram; queue editing/cancel controls remain outstanding.

- Chat list now includes a dedicated unread-only filter using each dialog's unread count.

- Conversation pin/unpin controls added; pinned conversations sort ahead of unpinned dialogs in the list.


### Latest parity work
- Telegram custom dialog folders are requested from the account and rendered as dynamic chat-list filters. Folder matching currently handles explicit included/excluded peers, groups, broadcasts, contacts/non-contacts, bots, and exclusion flags; server-account verification remains required.
- Scheduled messages can be listed for the active conversation and canceled by message ID from the new queue control.

- Media uploads now emit progress events from Telethon through the main/preload bridge; the attachment button displays live progress for the active conversation. Multi-file album progress is per active upload segment, not a per-file queue with pause/cancel yet.

- Group/channel member inspection added through Telethon. The native pane can request up to 100 participants and show names, usernames, and bot flags. Availability depends on Telegram permissions and group/channel type; real-account verification remains pending.

- Added server-side search within the active conversation using Telegram message search (up to 100 matches), with a return-to-chat action. This is distinct from local filtering over the messages already loaded. Search behavior and pagination should still be confirmed against a live account.

- Group/channel invite link export added for accounts with the required Telegram permissions. The renderer displays the generated link in a selectable prompt and warns users to share it only with trusted people. Live permission/error handling still needs account testing.

- Scheduled-message manager now supports editing the text of a scheduled text message as well as canceling it. Editing media-based scheduled messages is not provided by this control.

- Added a pinned-messages list for the active chat (up to 100 results) with a jump-to-message action that loads the surrounding history. Actual behavior depends on Telegram permissions and message availability.

- Invite link generation now offers optional expiration (1 hour, 1 day, 1 week, 1 month, or none) and a usage limit (up to 1,000). Telegram admin rights are required; these options have not yet been validated against a live account.

- Chat information panel added for users, groups, and channels; it displays available usernames, descriptions, verification status, and group/channel participant/admin counts. Availability depends on Telegram's returned full-chat data and permissions.

- Group/channel invite-link generation added. The UI requests a link through Telegram and copies/displays it; Telegram permissions may restrict this to admins or existing invite links. Live-account verification is still pending.

- Added a native save-dialog workflow to export up to 2,000 recent messages from the active chat to UTF-8 `.txt`, in chronological order. Media is represented by a short placeholder rather than embedded. Export scope is bounded and does not yet support full account-wide export.

- Typing indicator is now sent to Telegram while composing, throttled to at most one request every 3.5 seconds per renderer session. It is best-effort and not a persistent typing state.


### Message entity rendering — 2026-10-17
- Plain-text URLs beginning with `http://`, `https://`, or `www.` are rendered as links; `www.` URLs receive an HTTPS scheme. Links open in a new browsing context with `noopener noreferrer` and no referrer.
- `@mentions` and `#hashtags` are visually highlighted in message text. These are presentation-only detections over the returned plain text; they do not yet use Telegram's server-provided entity offsets or resolve mention targets.
- Automated CI and real-account behavior must be checked after this commit. No live Telegram account was used for validation.


### Telegram formatting and entity-aware rendering — 2026-10-17
- The Telethon bridge now includes message entity metadata (type, offset/length, and optional URL/user ID) in chat history, in-chat/global search results, history-around navigation, and live message updates.
- The renderer uses Telegram-provided entities for bold, italic, code/preformatted text, underline, strikethrough, URLs, mentions, and hashtags when present; plain-text detection remains the fallback for messages without entities.
- Message text is no longer stripped in the history/search paths that return entities, so Telegram entity offsets remain aligned with the source text.
- Automated JavaScript and Python syntax checks are being rerun after the renderer fixes. No live Telegram account has been used to verify rendering.


### Message context menu — 2026-10-17
- Added a right-click menu on messages with quick actions for copy, reply, forward, save, pin, edit, and delete; actions reuse the existing tested UI handlers rather than duplicating Telegram API calls.
- Edit and delete are disabled for incoming messages, matching the existing UI permission guard. Menu placement is constrained to the visible window, and Escape, outside click, scrolling, and resize dismiss it.
- Keyboard invocation is supported through Shift+F10 / Context Menu when a message bubble has focus. Live Telegram account behavior remains unverified.


### Server-side jump to date — 2026-10-17
- The date picker first jumps to a matching message already loaded in the selected conversation. If there is no loaded match, it now requests messages from the selected local calendar day from Telegram via Telethon, rather than telling the user to load pages manually.
- Results include Telegram message entities and are capped at 100 returned messages, with a bounded server scan to avoid unbounded work on low-memory devices.
- The date interval is calculated from the desktop's local date boundaries and sent as Unix timestamps; the bridge validates the interval and uses Telegram's date offset to seek into history.
- Automated CI and a real account check are required to verify Telegram's server-side offset semantics and timezone edge cases.


### Spoilers and quote formatting — 2026-10-17
- Added rendering for Telegram spoiler entities, with click-to-reveal and click-to-hide behavior.
- Added blockquote/expandable-blockquote presentation and preformatted block styling.
- This uses Telegram-provided entity metadata when present. Overlapping/nested entity combinations and real-account appearance still require acceptance testing.


### Reaction display — 2026-10-17
- Message history, server-side in-chat/global search, date search, and live updates now serialize available Telegram reaction emoji/count/chosen metadata where supported by the returned message object.
- The native renderer displays reaction chips and clicking a chip requests that reaction through the existing Telethon action. Custom emoji reactions currently use a generic sparkle marker; choosing premium/custom emoji is not implemented.
- Reaction rendering and toggle semantics require real-account verification; syntax CI does not prove Telegram permissions or server behavior.


### Photo viewer — 2026-10-17
- Clicking an inline photo opens a fullscreen lightbox with close button, Escape handling, mouse-wheel zoom from 1× to 4×, and double-click reset.
- The viewer reuses the already downloaded/cached image data URL and does not trigger another media download. Keyboard activation is supported on the inline image.
- Multi-photo navigation, panning at high zoom, and real-account visual verification remain future work.


### Global search result presentation — 2026-10-17
- Global message search results now highlight the searched phrase safely in the message snippet and show the message date/time when returned by Telegram.
- Highlighting uses text nodes and mark elements rather than injecting message text as HTML.
- Search remains bounded to the configured result count; grouping duplicate results by conversation and server-side pagination are future improvements.

- Message context menu also includes copy-message-link and save-media actions, gated by the same per-message availability checks as the existing toolbar.


## Additional parity work (2026-10-17)

- Keyboard shortcuts: Ctrl+K focuses chat search, Ctrl+F focuses current-chat message search, Ctrl+Shift+F starts global search, Ctrl+Enter submits from the composer, Alt+Up loads older messages, Alt+Down jumps to latest, and F1 shows shortcut help. Escape closes the media viewer/context menu or clears active search where applicable.
- Keyboard navigation: Arrow keys move focus through the chat list and between focusable messages; context menus remain keyboard-operable.
- Media viewer: zoomed photos can be panned by dragging, and adjacent loaded photos can be browsed with previous/next buttons or left/right arrow keys. This navigates only media already present in the currently loaded message history; it does not fetch an entire remote album.
- Validation boundary: these UI additions are covered by repository CI syntax checks; they have not yet been exercised against a live Telegram account or a Windows device in this turn.

- Quick reactions: connected chats expose a compact set of common reactions on message hover/focus, including touch devices. Actions call the existing Telegram reaction API and report errors instead of silently pretending success.

- Chat-list context actions: right-click (or Shift+F10 / Context Menu key on a focused chat) offers mark unread/read, mute/unmute notifications, pin/unpin, and archive/unarchive. These call the existing native API and refresh the chat list only after the action resolves; failures are shown to the user.
- Chat list now visibly marks pinned and muted conversations alongside unread counts.

- Reply previews: native message serialization now carries the replied-to message ID in history/search/live updates where the underlying Telegram message exposes it. The bubble shows a compact reply reference; selecting it loads nearby history and highlights the original message when returned. The quoted original text is not fetched per message, avoiding one network request for every bubble.

- In-chat search navigation: previous/next controls cycle through matching messages already loaded in the active conversation, move focus/scroll to the selected bubble, and Enter / Shift+Enter provide keyboard navigation. This remains local-history search unless the explicit full-chat search action is used.

- Typing indicator: while composing a non-empty message in a connected real chat, the client sends Telegram's typing action at most once every 3.5 seconds; transient failures are intentionally non-blocking and do not interrupt typing.

- Composer emoji picker: a compact, keyboard-focusable emoji grid inserts the selected emoji at the current text selection, preserves surrounding text, and remains disabled until Telegram is connected.

- Multiline composer: the message field is now an auto-growing textarea capped at 140 px; Enter sends, Shift+Enter inserts a newline, restored per-chat drafts resize correctly, and the emoji picker still inserts at the current selection.

- Chat switching shortcut: Ctrl+Tab advances to the next visible conversation and Ctrl+Shift+Tab moves to the previous one, wrapping around the currently displayed chat list.

- Unread-chat navigation: Alt+Shift+Down/Up cycles through unread, non-archived conversations without marking them read; it clears global-search mode before opening the selected conversation. If there are no unread chats, it reports that instead of changing selection.

- Per-chat draft previews: locally saved drafts appear in the corresponding chat-list row with a distinct preview style, update while typing, and revert to the latest known message preview when cleared. Drafts stay local to the device; this does not send or sync them to Telegram.

- Private per-chat notes: each conversation has an optional local notes panel with character count and clear action. Notes are stored in localStorage under a conversation-specific key, loaded when switching chats, and are never sent to Telegram. The chat-list search also matches local notes; these notes remain device-local and are not synced or encrypted by this feature.
- Private notes can be toggled with Ctrl+Shift+N (Cmd+Shift+N on macOS); the shortcut focuses the note editor when opening it.
