const { app, BrowserWindow, shell, ipcMain, Menu, dialog, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');
const { TelethonService } = require('./telegram-native/telethon-service');
// Embedded ChatGPT/Telegram media and Web Audio can otherwise remain blocked by Chromium autoplay policy.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let mainWindow;
let nativeTelegramWindow = null; // Compatibility fallback; the native client is embedded in the Telegram panel.
let nativeTelegramGuest = null;
let pendingNativeAuthPrompt = null;
let nativeAuthPromptId = 0;
const tdlibService = new TelethonService();
const nativeTelegramFile = () => pathToFileURL(path.join(__dirname, 'telegram-native', 'index.html')).href;
const nativeTelegramPreload = () => pathToFileURL(path.join(__dirname, 'preload.js')).href;
const isNativeTelegramUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' && decodeURIComponent(url.pathname).toLowerCase().endsWith('/telegram-native/index.html');
  } catch { return false; }
};
function isNativeTelegramSender(sender) {
  return !!sender && (
    (nativeTelegramWindow && !nativeTelegramWindow.isDestroyed() && sender.id === nativeTelegramWindow.webContents.id) ||
    (nativeTelegramGuest && !nativeTelegramGuest.isDestroyed() && sender.id === nativeTelegramGuest.id)
  );
}
function notifyNativeTelegram(channel, data) {
  if (nativeTelegramWindow && !nativeTelegramWindow.isDestroyed()) nativeTelegramWindow.webContents.send(channel, data);
  if (nativeTelegramGuest && !nativeTelegramGuest.isDestroyed()) nativeTelegramGuest.send(channel, data);
}
function telegramCredentialPath() {
  return path.join(app.getPath('userData'), 'telegram-native', 'api-credentials.bin');
}
function readTelegramApiCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const decrypted = safeStorage.decryptString(fs.readFileSync(telegramCredentialPath()));
    const value = JSON.parse(decrypted);
    const apiId = Number(value.apiId);
    const apiHash = String(value.apiHash || '').trim();
    if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) return null;
    return { apiId: String(apiId), apiHash };
  } catch { return null; }
}
function saveTelegramApiCredentials(apiIdValue, apiHashValue) {
  const apiId = Number(apiIdValue);
  const apiHash = String(apiHashValue || '').trim();
  if (!Number.isInteger(apiId) || apiId <= 0 || !/^[a-f0-9]{32}$/i.test(apiHash)) {
    throw new Error('API ID یا API Hash معتبر نیست.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('ذخیرهٔ امن اعتبارهای تلگرام در ویندوز در دسترس نیست؛ برای امنیت، اعتبارها ذخیره نشدند.');
  }
  const file = telegramCredentialPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify({ apiId: String(apiId), apiHash })), { mode: 0o600 });
  return { apiId: String(apiId), apiHash };
}
tdlibService.setCallbacks({
  onPrompt: prompt => {
    const packet = { id: ++nativeAuthPromptId, prompt };
    pendingNativeAuthPrompt = packet;
    notifyNativeTelegram('telegram-native:auth-prompt', packet);
  },
  onStatus: value => notifyNativeTelegram('telegram-native:status-update', value),
  onUpdate: value => notifyNativeTelegram('telegram-native:live-update', value)
});
const send = (channel, data) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data); };
const status = (state, message, extra = {}) => send('twinpanel:update-status', { state, message, ...extra });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600,
    title: 'TwinPanel — Telegram + ChatGPT', backgroundColor: '#090d18',
    icon: path.join(__dirname, 'assets', 'twinpanel.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true }
  });
  const command = name => send('twinpanel:command', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'TwinPanel', submenu: [
      { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => command('open-settings') },
      { type: 'separator' }, { role: 'quit', label: 'Exit TwinPanel' }
    ]},
    { label: 'View', submenu: [
      { label: 'Toggle Focus / Full Screen', accelerator: 'F11', click: () => { if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen()); } },
      { type: 'separator' },
      { label: 'Reload ChatGPT', accelerator: 'Ctrl+Alt+1', click: () => command('reload-gpt') },
      { label: 'Reload Telegram', accelerator: 'Ctrl+Alt+2', click: () => command('reload-telegram') },
      { label: 'Reload Both Panels', accelerator: 'Ctrl+Alt+R', click: () => command('reload-both') }
    ]}
  ]));
  // Keep the host renderer's audio output explicitly enabled.
  mainWindow.webContents.setAudioMuted(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('enter-full-screen', () => send('twinpanel:fullscreen-changed', true));
  mainWindow.on('leave-full-screen', () => send('twinpanel:fullscreen-changed', false));
  mainWindow.webContents.on('did-attach-webview', (_event, child) => {
    const identifyNativeTelegramGuest = () => {
      const isNative = isNativeTelegramUrl(child.getURL());
      if (isNative) {
        nativeTelegramGuest = child;
        if (pendingNativeAuthPrompt && !child.isDestroyed()) child.send('telegram-native:auth-prompt', pendingNativeAuthPrompt);
      } else if (nativeTelegramGuest === child) {
        nativeTelegramGuest = null;
      }
    };
    // Never inherit an accidental muted state in either embedded app.
    child.setAudioMuted(false);
    child.on('dom-ready', () => { child.setAudioMuted(false); identifyNativeTelegramGuest(); });
    child.on('did-navigate', identifyNativeTelegramGuest);
    child.on('destroyed', () => { if (nativeTelegramGuest === child) nativeTelegramGuest = null; });
    child.on('did-navigate', () => child.setAudioMuted(false));

    const identifySource = () => {
      try {
        const url = new URL(child.getURL());
        if (url.protocol !== 'https:') return null;
        if (url.hostname === 'chatgpt.com' || url.hostname === 'www.chatgpt.com') return 'chatgpt';
        if (url.hostname === 'web.telegram.org' || url.hostname.endsWith('.telegram.org')) return 'telegram';
      } catch {}
      return null;
    };

    let source = identifySource();
    let audible = false;
    let labelTimer = null;
    let destroyed = false;

    const defaultLabel = kind => kind === 'telegram' ? 'پیام صوتی تلگرام' : 'ChatGPT در حال صحبت است';
    const stopLabelPolling = () => {
      if (labelTimer) clearInterval(labelTimer);
      labelTimer = null;
    };
    const publish = (isAudible, title) => {
      if (!source) return;
      send('twinpanel:media-state', {
        source,
        audible: !!isAudible,
        title: title || (isAudible ? defaultLabel(source) : ''),
        pageTitle: (() => { try { return child.getTitle() || ''; } catch { return ''; } })()
      });
    };

    const readTelegramLabel = async () => {
      if (destroyed || !audible || source !== 'telegram') return;
      try {
        const label = await child.executeJavaScript("(() => {\n  const clean = value => (value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);\n  const generic = value => !value || /^(telegram|telegram web|audio|voice message|voice|media|play|pause|پخش|توقف|پیام صوتی|صدای تلگرام)$/i.test(value);\n  const useful = value => { const v = clean(value); return !!v && !generic(v); };\n  const active = [...document.querySelectorAll('audio,video')].filter(el => !el.paused && !el.ended);\n  const labels = [];\n  const fromMessage = bubble => {\n    if (!bubble) return [];\n    const out = [];\n    const selectors = '[class*=\"audio-title\"],[class*=\"document-name\"],[class*=\"file-name\"],[class*=\"filename\"],[class*=\"media-title\"],[class*=\"song-title\"],[class*=\"caption\"],[class*=\"message-text\"],.translatable-message';\n    for (const el of bubble.querySelectorAll(selectors)) {\n      const text = clean(el.innerText || el.textContent);\n      if (useful(text) && !/^(download|forward|reply|listen|audio|voice|play|pause|دانلود|فوروارد|پاسخ|پخش|توقف)$/i.test(text)) out.push(text);\n    }\n    return out;\n  };\n  for (const media of active) {\n    const direct = clean(media.getAttribute('aria-label') || media.getAttribute('title'));\n    if (useful(direct)) labels.push(direct);\n    const bubble = media.closest('[data-message-id]') || media.closest('.Message') || media.closest('.message');\n    labels.push(...fromMessage(bubble));\n    const src = clean(media.currentSrc || media.src);\n    if (src && !/^(blob:|data:)/i.test(src)) {\n      try {\n        const file = decodeURIComponent(new URL(src).pathname.split('/').pop() || '').replace(/\\.[a-z0-9]{1,6}$/i, '');\n        if (useful(file)) labels.push(file);\n      } catch {}\n    }\n  }\n  const match = labels.find(useful);\n  if (match) return match;\n  const meta = clean(navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title);\n  if (useful(meta) && active.length) {\n    const artist = clean(navigator.mediaSession.metadata.artist);\n    return artist && artist !== meta ? meta + ' — ' + artist : meta;\n  }\n  return '';\n})()", true);
        if (label && audible && source === 'telegram') publish(true, label);
        else if (audible && source === 'telegram') publish(true, 'رسانهٔ در حال پخش در تلگرام');
      } catch {}
    };
    const startLabelPolling = () => {
      stopLabelPolling();
      readTelegramLabel();
      labelTimer = setInterval(readTelegramLabel, 1100);
    };

    const refreshIdentity = () => {
      const next = identifySource();
      if (next === source) return;
      if (source && audible) send('twinpanel:media-state', { source, audible: false, title: '' });
      stopLabelPolling();
      source = next;
      audible = false;
    };
    child.on('did-navigate', refreshIdentity);
    child.on('did-navigate-in-page', refreshIdentity);
    child.on('page-title-updated', () => {
      if (audible && source === 'telegram') readTelegramLabel();
    });
    const updateAudibleState = nextAudible => {
      refreshIdentity();
      if (!source) return;
      const normalized = !!nextAudible;
      if (normalized === audible) return;
      audible = normalized;
      if (audible) {
        publish(true, defaultLabel(source));
        if (source === 'telegram') startLabelPolling();
      } else {
        stopLabelPolling();
        publish(false, '');
      }
    };

    // Electron's audio-state-changed event exposes the audible flag on the event
    // itself (event.audible), not as a second callback argument.
    child.on('audio-state-changed', event => {
      updateAudibleState(event?.audible);
    });

    // Keep embedded audio unmuted after navigation and when playback actually starts.
    // These events also provide a fallback if audio-state-changed is delayed or missed.
    child.on('media-started-playing', () => {
      child.setAudioMuted(false);
      refreshIdentity();
      if (source) updateAudibleState(true);
    });
    child.on('media-paused', () => {
      try {
        updateAudibleState(child.isCurrentlyAudible());
      } catch {
        updateAudibleState(false);
      }
    });
    child.on('destroyed', () => {
      destroyed = true;
      stopLabelPolling();
      if (source && audible) send('twinpanel:media-state', { source, audible: false, title: '' });
    });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/') || url.startsWith('https://chatgpt.com/') || url.startsWith('https://web.telegram.org/')) return { action: 'allow' };
    shell.openExternal(url); return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}
ipcMain.handle('twinpanel:open-native-telegram', async () => ({
  ok: true,
  embedded: true,
  url: nativeTelegramFile(),
  preload: nativeTelegramPreload()
}));
ipcMain.handle('telegram-native:status', () => tdlibService.status());
ipcMain.handle('telegram-native:credentials-status', () => ({ saved: !!readTelegramApiCredentials() }));
ipcMain.handle('telegram-native:connect', async (event, credentials = {}) => {
  let apiId = String(credentials.apiId || '').trim();
  let apiHash = String(credentials.apiHash || '').trim();
  if (apiId || apiHash) {
    const saved = saveTelegramApiCredentials(apiId, apiHash);
    apiId = saved.apiId;
    apiHash = saved.apiHash;
  } else {
    const stored = readTelegramApiCredentials();
    if (!stored) throw new Error('برای راه‌اندازی اولیه، API ID و API Hash خودت را یک بار وارد کن؛ TwinPanel آن‌ها را روی همین دستگاه رمزگذاری می‌کند.');
    apiId = stored.apiId;
    apiHash = stored.apiHash;
  }
  return tdlibService.connect({ ...credentials, apiId, apiHash }, event.sender);
});
ipcMain.handle('telegram-native:cancel-connect', () => tdlibService.cancelConnect());
ipcMain.handle('telegram-native:diagnostics', () => tdlibService.getDiagnostics());
ipcMain.handle('telegram-native:take-auth-prompt', event => {
  if (!isNativeTelegramSender(event.sender)) return null;
  return pendingNativeAuthPrompt;
});
ipcMain.handle('telegram-native:ack-auth-prompt', (event, id) => {
  if (!isNativeTelegramSender(event.sender)) return false;
  if (pendingNativeAuthPrompt && pendingNativeAuthPrompt.id === Number(id)) pendingNativeAuthPrompt = null;
  return true;
});
ipcMain.handle('telegram-native:qr-data-url', async (event, link) => {
  const value = String(link || '');
  if (!isNativeTelegramSender(event.sender)) {
    throw new Error('پنل نمایش QR معتبر نیست.');
  }
  if (!value.startsWith('tg://login?token=') || value.length > 2048) {
    tdlibService.reportStage('qr-link-invalid', 'لینک دریافتی برای ساخت QR معتبر نیست؛ محتوای لینک ثبت نشد.');
    throw new Error('لینک ورود QR تلگرام معتبر نیست.');
  }
  tdlibService.reportStage('qr-image-generating', 'لینک QR معتبر است؛ در حال ساخت تصویر…');
  try {
    const QRCode = require('qrcode');
    const dataUrl = await QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 2, width: 300 });
    tdlibService.reportStage('qr-image-generated', 'تصویر QR ساخته شد؛ منتظر بارگذاری آن در پنجره هستم…');
    return dataUrl;
  } catch {
    tdlibService.reportStage('qr-image-generation-failed', 'ساخت تصویر QR ناموفق بود؛ لینک ورود در گزارش ثبت نشد.');
    throw new Error('ساخت تصویر QR ناموفق بود. گزارش اتصال را بررسی کن.');
  }
});
ipcMain.handle('telegram-native:qr-image-status', (event, state) => {
  if (!isNativeTelegramSender(event.sender)) return false;
  const stages = {
    loaded: ['qr-image-loaded', 'تصویر QR در پنجره با موفقیت بارگذاری شد.'],
    'load-error': ['qr-image-load-failed', 'تصویر QR ساخته شد اما پنجره نتوانست آن را بارگذاری کند.']
  };
  const item = stages[String(state || '')];
  if (!item) return false;
  tdlibService.reportStage(item[0], item[1]);
  return true;
});
ipcMain.handle('telegram-native:auth-input', (_event, payload) => tdlibService.submitAuthInput(payload?.type, payload?.value));
ipcMain.handle('telegram-native:list-chats', (_event, limit) => tdlibService.listChats(limit));
ipcMain.handle('telegram-native:profile', (_event) => tdlibService.getProfile());
ipcMain.handle('telegram-native:search-chats', (_event, query) => tdlibService.searchChats(query));
ipcMain.handle('telegram-native:search-global-messages', (_event, query, limit) => tdlibService.searchGlobalMessages(query, limit));
ipcMain.handle('telegram-native:history', (_event, chatId, limit) => tdlibService.getChatHistory(chatId, limit));
ipcMain.handle('telegram-native:history-before', (_event, chatId, offsetId, limit) => tdlibService.getChatHistoryBefore(chatId, offsetId, limit));
ipcMain.handle('telegram-native:history-around', (_event, chatId, messageId) => tdlibService.getChatHistoryAround(chatId, messageId));
ipcMain.handle('telegram-native:preview', (_event, chatId, limit) => tdlibService.getUnreadPreview(chatId, limit));
ipcMain.handle('telegram-native:send-text', (_event, chatId, body) => tdlibService.sendTextMessage(chatId, body));
ipcMain.handle('telegram-native:reply-text', (_event, chatId, messageId, body) => tdlibService.replyTextMessage(chatId, messageId, body));
ipcMain.handle('telegram-native:edit-message', (_event, chatId, messageId, body) => tdlibService.editMessage(chatId, messageId, body));
ipcMain.handle('telegram-native:delete-message', (_event, chatId, messageId) => tdlibService.deleteMessage(chatId, messageId));
ipcMain.handle('telegram-native:forward-message', (_event, chatId, messageId, targetChatId) => tdlibService.forwardMessage(chatId, messageId, targetChatId));
ipcMain.handle('telegram-native:pin-message', (_event, chatId, messageId, pinned) => tdlibService.pinMessage(chatId, messageId, pinned));
ipcMain.handle('telegram-native:react-message', (_event, chatId, messageId, emoji) => tdlibService.reactMessage(chatId, messageId, emoji));
ipcMain.handle('telegram-native:message-link', (_event, chatId, messageId) => tdlibService.getMessageLink(chatId, messageId));
ipcMain.handle('telegram-native:download-message-media', (_event, chatId, messageId) => tdlibService.downloadMessageMedia(chatId, messageId));
ipcMain.handle('telegram-native:select-media', async () => {
  const result = await dialog.showOpenDialog(nativeTelegramWindow && !nativeTelegramWindow.isDestroyed() ? nativeTelegramWindow : mainWindow, {
    title: 'انتخاب فایل برای تلگرام',
    properties: ['openFile'],
    filters: [{ name: 'Media and documents', extensions: ['png','jpg','jpeg','webp','gif','mp4','mp3','ogg','opus','pdf','txt','zip','doc','docx'] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const fs = require('node:fs');
  const path = require('node:path');
  const crypto = require('node:crypto');
  const outbox = path.join(app.getPath('userData'), 'telegram-native', 'outbox');
  fs.mkdirSync(outbox, { recursive: true });
  const source = result.filePaths[0];
  const target = path.join(outbox, crypto.randomUUID() + path.extname(source));
  fs.copyFileSync(source, target);
  return { path: target, name: path.basename(source) };
});
ipcMain.handle('telegram-native:send-media', (_event, chatId, filePath, caption) => tdlibService.sendMedia(chatId, filePath, caption));
ipcMain.handle('telegram-native:mute-chat', (_event, chatId, muted) => tdlibService.setChatMuted(chatId, muted));
ipcMain.handle('telegram-native:set-chat-unread', (_event, chatId, unread) => tdlibService.setChatUnread(chatId, unread));
ipcMain.handle('telegram-native:set-chat-archived', (_event, chatId, archived) => tdlibService.setChatArchived(chatId, archived));
ipcMain.handle('twinpanel:toggle-fullscreen', event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen()); return win.isFullScreen();
});
ipcMain.handle('twinpanel:app-version', () => app.getVersion());
ipcMain.handle('twinpanel:check-updates', async () => {
  if (!app.isPackaged) { status('dev-mode', 'بررسی آپدیت فقط در نسخهٔ نصب‌شده فعال است.'); return { ok: false }; }
  try { status('checking', 'در حال بررسی نسخهٔ جدید…'); await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (error) { status('error', 'بررسی آپدیت ناموفق بود؛ انتشار GitHub را بررسی کن.'); return { ok: false, message: error.message }; }
});
ipcMain.handle('twinpanel:download-update', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (error) { status('error', 'دریافت آپدیت ناموفق بود.'); return { ok: false, message: error.message }; }
});
ipcMain.handle('twinpanel:install-update', () => { if (app.isPackaged) autoUpdater.quitAndInstall(); return { ok: true }; });
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => status('checking', 'در حال بررسی نسخهٔ جدید…'));
autoUpdater.on('update-available', info => status('available', 'نسخهٔ ' + info.version + ' پیدا شد؛ دریافت خودکار شروع می‌شود.', { version: info.version }));
autoUpdater.on('update-not-available', info => status('current', 'برنامه به‌روز است. نسخهٔ فعلی: ' + info.version));
autoUpdater.on('download-progress', progress => status('downloading', 'دریافت آپدیت: ' + Math.round(progress.percent) + '%', { percent: progress.percent }));
autoUpdater.on('update-downloaded', info => status('downloaded', 'نسخهٔ ' + info.version + ' دریافت شد؛ با بستن TwinPanel نصب می‌شود یا همین حالا نصبش کن.', { version: info.version }));
autoUpdater.on('error', error => status('error', 'خطای به‌روزرسانی: ' + (error.message || 'نامشخص')));
app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 7000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('before-quit', () => { tdlibService.close().catch(() => {}); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
