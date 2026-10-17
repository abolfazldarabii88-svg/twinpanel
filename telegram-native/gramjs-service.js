'use strict';

// Experimental alternative to TDLib: GramJS over Telegram's WebSocket transport.
// This deliberately mirrors the existing TdlibService IPC contract so the UI can
// be tested without changing the published desktop release.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, safeStorage } = require('electron');

const SESSION_FILE = 'gramjs-session.bin';
const CONNECT_TIMEOUT_MS = 25000;
const QR_REFRESH_MS = 2800;

function redact(value) {
  return String(value || '')
    .replace(/tg:\/\/login\?token=[^\s"'<>]+/gi, '[QR_LINK_REDACTED]')
    .replace(/\b(api[_ -]?hash|auth[_ -]?key|token|password|phone(?:[_ -]?number)?)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[HEX_REDACTED]')
    .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, '[LONG_VALUE_REDACTED]')
    .replace(/\b\d{7,}\b/g, '[NUMBER_REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 220);
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

async function disconnectQuietly(client) {
  if (!client) return;
  let timer;
  try {
    await Promise.race([
      client.disconnect(),
      new Promise(resolve => { timer = setTimeout(resolve, 3000); })
    ]);
  } catch {
    // Teardown should never mask the original connection error.
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class GramJsService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.cancelPromise = null;
    this.attemptId = 0;
    this.promptResolver = null;
    this.promptType = null;
    this.authPromptSeen = false;
    this.diagnosticStage = 'idle';
    this.lastStatusMessage = '';
    this.lastQrLink = '';
    this.me = null;
    this.entities = new Map();
    this.onPrompt = null;
    this.onStatus = null;
  }

  setCallbacks({ onPrompt, onStatus } = {}) {
    this.onPrompt = onPrompt || null;
    this.onStatus = onStatus || null;
  }

  status(message = '') {
    return {
      connected: this.connected,
      connecting: this.connecting,
      engine: 'GramJS-WSS',
      stage: this.connected ? 'connected' : (this.connecting ? 'authorizing' : 'ready'),
      diagnosticStage: this.diagnosticStage,
      message: message || (this.connected
        ? 'حساب تلگرام متصل است.'
        : (this.connecting
          ? (this.lastStatusMessage || 'در حال اتصال امن WebSocket به تلگرام…')
          : 'برای اتصال، API ID و API Hash را وارد کن.'))
    };
  }

  dataDir() {
    const dir = path.join(app.getPath('userData'), 'telegram-native');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  ensureSafeStorage() {
    if (!safeStorage.isEncryptionAvailable()) {
      const error = new Error('ذخیره‌سازی امن سیستم‌عامل در دسترس نیست؛ برای حفاظت از نشست، اتصال لغو شد.');
      error.code = 'SECURE_STORAGE_UNAVAILABLE';
      throw error;
    }
  }

  readSession() {
    try {
      this.ensureSafeStorage();
      const file = path.join(this.dataDir(), SESSION_FILE);
      if (!fs.existsSync(file)) return '';
      return safeStorage.decryptString(fs.readFileSync(file));
    } catch (error) {
      if (error && error.code === 'SECURE_STORAGE_UNAVAILABLE') throw error;
      return '';
    }
  }

  saveSession(session) {
    const value = String(session || '');
    if (!value) throw new Error('تلگرام نشست معتبری برای ذخیره‌کردن برنگرداند.');
    this.ensureSafeStorage();
    const file = path.join(this.dataDir(), SESSION_FILE);
    fs.writeFileSync(file, safeStorage.encryptString(value), { mode: 0o600 });
  }

  reportStage(stage, message) {
    const safeStage = String(stage || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'unknown';
    const safeMessage = redact(message);
    this.diagnosticStage = safeStage;
    this.lastStatusMessage = String(message || '').slice(0, 220);
    try {
      const line = `${new Date().toISOString()} [${safeStage}] ${safeMessage}\n`;
      fs.appendFileSync(path.join(this.dataDir(), 'connection.log'), line, 'utf8');
    } catch {
      // Diagnostic logging must never block login.
    }
    this.onStatus?.(this.status(this.lastStatusMessage));
  }

  appendSafeDiagnostic(stage, message, attemptId) {
    if (attemptId !== this.attemptId || !this.connecting) return;
    const safeStage = String(stage || 'gramjs-event').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'gramjs-event';
    try {
      const line = `${new Date().toISOString()} [${safeStage}] ${redact(message)}\n`;
      fs.appendFileSync(path.join(this.dataDir(), 'connection.log'), line, 'utf8');
    } catch {
      // Ignore diagnostics write failures.
    }
  }

  getDiagnostics() {
    try {
      const file = path.join(this.dataDir(), 'connection.log');
      if (!fs.existsSync(file)) return 'هنوز گزارشی ثبت نشده است.';
      return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-100).join('\n');
    } catch {
      return 'خواندن گزارش تشخیصی ناموفق بود.';
    }
  }

  createClient(apiId, apiHash, sessionString) {
    const { TelegramClient } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const { PromisedWebSockets } = require('telegram/extensions');
    const { ConnectionTCPObfuscated } = require('telegram/network/connection');
    const { Logger, LogLevel } = require('telegram/extensions/Logger');

    // In Node, GramJS normally chooses a raw Telegram IP because its default
    // socket is TCP. A WSS connection must preserve a TLS-verifiable hostname.
    // Seed fresh sessions with Telegram Web's browser-facing WSS hostname so
    // the initial connection uses wss://vesta.web.telegram.org:443/apiws.
    const session = new StringSession(sessionString || '');
    if (!sessionString) {
      session.setDC(2, 'vesta.web.telegram.org', 443);
    }

    // Force the same WebSocket transport used by Telegram Web even though this
    // runs in Electron's Node main process (whose default transport is raw TCP).
    return new TelegramClient(
      session,
      Number(apiId),
      String(apiHash),
      {
        connection: ConnectionTCPObfuscated,
        networkSocket: PromisedWebSockets,
        useWSS: true,
        useIPV6: false,
        connectionRetries: 3,
        requestRetries: 3,
        retryDelay: 1200,
        autoReconnect: true,
        deviceModel: 'TwinPanel',
        systemVersion: `Windows ${os.release()} ${process.arch}`,
        appVersion: app.getVersion(),
        langCode: 'en',
        systemLangCode: 'en',
        baseLogger: new Logger(LogLevel.ERROR)
      }
    );
  }

  async requestAuthInput(type, attemptId = this.attemptId, detail = '') {
    if (!this.onPrompt) throw new Error('پنجرهٔ ورود تلگرام در دسترس نیست.');
    return new Promise((resolve, reject) => {
      if (attemptId !== this.attemptId) {
        reject(new Error('فرایند ورود لغو شده است؛ دوباره تلاش کن.'));
        return;
      }
      if (this.promptResolver) {
        reject(new Error('درخواست ورود قبلی هنوز پاسخ داده نشده است.'));
        return;
      }
      this.promptResolver = resolve;
      this.promptType = type;
      this.authPromptSeen = true;
      const labels = {
        phone: 'شماره تلفن با کد کشور',
        code: 'کد ورود تلگرام',
        password: 'رمز تأیید دومرحله‌ای',
        email: 'ایمیل حساب تلگرام',
        'email-code': 'کد تأیید ایمیل',
        name: 'نام'
      };
      const descriptions = {
        phone: 'شماره را همراه کد کشور وارد کن.',
        code: 'کد ورود ارسال‌شده توسط تلگرام را وارد کن.',
        password: detail ? `رمز دومرحله‌ای را وارد کن. ${String(detail).slice(0, 100)}` : 'رمز تأیید دومرحله‌ای را وارد کن.',
        email: 'ایمیل حساب را وارد کن.',
        'email-code': 'کد تأیید ایمیل را وارد کن.',
        name: 'نام را وارد کن.'
      };
      this.reportStage('awaiting-' + type, descriptions[type] || 'منتظر اطلاعات ورود هستم…');
      this.onPrompt({ type, label: labels[type] || 'اطلاعات ورود' });
    });
  }

  submitAuthInput(type, value) {
    if (!this.promptResolver || type !== this.promptType) {
      return { ok: false, error: 'درخواست ورود فعالی وجود ندارد.' };
    }
    const resolve = this.promptResolver;
    this.promptResolver = null;
    this.promptType = null;
    resolve(String(value || '').trim());
    return { ok: true };
  }

  async loginWithQr(client, apiId, apiHash, attemptId) {
    this.lastQrLink = '';
    this.authPromptSeen = false;
    this.reportStage('request-qr-wss', 'درخواست QR از مسیر WebSocket امن ارسال شد…');
    await client.signInUserWithQrCode(
      { apiId: Number(apiId), apiHash: String(apiHash) },
      {
        qrCode: async ({ token, expires }) => {
          if (attemptId !== this.attemptId) throw new Error('ورود لغو شد.');
          const tokenText = Buffer.from(token).toString('base64url');
          const link = 'tg://login?token=' + tokenText;
          if (link !== this.lastQrLink) {
            this.lastQrLink = link;
            this.authPromptSeen = true;
            this.reportStage('qr-link-received', 'لینک QR از تلگرام دریافت شد؛ در حال ساخت تصویر…');
            this.onPrompt?.({
              type: 'qr',
              label: 'با تلگرام روی گوشی، QR را اسکن کن',
              link
            });
          }
          // Web K refreshes its login token periodically. Return from this
          // callback on a short interval so GramJS requests and emits fresh QR
          // tokens while the authorization update listener waits for the scan.
          const remaining = Math.max(750, Math.min(QR_REFRESH_MS, (Number(expires) - Date.now() / 1000) * 1000 - 800));
          await new Promise(resolve => setTimeout(resolve, remaining));
        },
        password: async hint => this.requestAuthInput('password', attemptId, hint),
        onError: async error => {
          this.appendSafeDiagnostic('gramjs-qr-auth-error', error && error.message || error, attemptId);
          return false;
        }
      }
    );
  }

  async loginWithPhone(client, apiId, apiHash, attemptId) {
    this.reportStage('request-phone-wss', 'ورود با شماره روی مسیر WebSocket امن آغاز شد…');
    await client.start({
      phoneNumber: async () => this.requestAuthInput('phone', attemptId),
      phoneCode: async () => this.requestAuthInput('code', attemptId),
      password: async hint => this.requestAuthInput('password', attemptId, hint),
      onError: async error => {
        this.appendSafeDiagnostic('gramjs-phone-auth-error', error && error.message || error, attemptId);
        return false;
      }
    });
  }

  async connect({ apiId, apiHash, loginMethod = 'qr', proxy = null } = {}) {
    if (this.cancelPromise) await this.cancelPromise;
    if (this.connected) return this.status();
    if (this.connecting) throw new Error('تلاش اتصال قبلی هنوز فعال است؛ آن را لغو کن و دوباره تلاش کن.');

    const parsedId = Number(apiId);
    const hash = String(apiHash || '').trim();
    if (!Number.isInteger(parsedId) || parsedId <= 0 || !/^[a-f0-9]{32}$/i.test(hash)) {
      throw new Error('API ID باید عدد معتبر و API Hash باید ۳۲ نویسهٔ هگزادسیمال باشد.');
    }
    if (proxy && proxy.type) {
      throw new Error('موتور آزمایشی از WebSocket امن (WSS) استفاده می‌کند؛ پروکسی دستی در این مسیر فعلاً فعال نیست. گزینهٔ اتصال WSS را انتخاب کن.');
    }
    this.ensureSafeStorage();
    this.connecting = true;
    this.authPromptSeen = false;
    const attemptId = ++this.attemptId;
    let client = null;

    try {
      this.reportStage('load-gramjs-wss', 'در حال بارگذاری موتور WebSocket تلگرام…');
      const savedSession = this.readSession();
      client = this.createClient(parsedId, hash, savedSession);
      this.client = client;

      this.reportStage('connect-wss', 'در حال اتصال WSS به سرور تلگرام روی پورت ۴۴۳…');
      await withTimeout(
        client.connect(),
        CONNECT_TIMEOUT_MS,
        'اتصال WebSocket امن طی ۲۵ ثانیه پاسخ نداد. گزارش اتصال را بررسی کن.'
      );
      if (attemptId !== this.attemptId) throw new Error('اتصال لغو شد.');

      let authorized = false;
      if (savedSession) {
        this.reportStage('check-saved-session', 'در حال بررسی نشست تلگرام ذخیره‌شده…');
        try {
          authorized = await withTimeout(client.checkAuthorization(), 12000, 'بررسی نشست تلگرام زمان‌بر شد.');
        } catch (error) {
          this.appendSafeDiagnostic('saved-session-check-failed', error && error.message || error, attemptId);
        }
      }

      if (!authorized) {
        if (savedSession) {
          this.reportStage('saved-session-not-authorized', 'نشست قبلی مجاز نیست؛ در حال آماده‌سازی ورود تازه…');
          await disconnectQuietly(client)
          client = this.createClient(parsedId, hash, '');
          this.client = client;
          await withTimeout(
            client.connect(),
            CONNECT_TIMEOUT_MS,
            'اتصال WebSocket برای ورود تازه طی ۲۵ ثانیه پاسخ نداد.'
          );
        }

        if (loginMethod === 'qr') {
          await this.loginWithQr(client, parsedId, hash, attemptId);
        } else {
          await this.loginWithPhone(client, parsedId, hash, attemptId);
        }
      }

      if (attemptId !== this.attemptId) throw new Error('ورود لغو شد؛ دوباره تلاش کن.');
      this.me = await withTimeout(client.getMe(), 15000, 'تلگرام به درخواست دریافت حساب پاسخ نداد.');
      if (!this.me) throw new Error('تلگرام حساب واردشده را برنگرداند.');

      const sessionString = client.session.save();
      if (sessionString) this.saveSession(sessionString);
      this.connected = true;
      this.connecting = false;
      this.reportStage('authorized-wss', 'ورود موفق بود؛ نشست به‌صورت رمزگذاری‌شده ذخیره شد.');
      this.onPrompt?.({ type: 'cancelled' });
      return this.status('حساب تلگرام متصل است.');
    } catch (error) {
      const cancelled = attemptId !== this.attemptId;
      const message = String(error && error.message || 'خطای نامشخص').slice(0, 220);
      if (!cancelled) {
        this.connected = false;
        this.reportStage('connect-error', `خطای موتور WebSocket: ${message}`);
        this.onPrompt?.({ type: 'cancelled' });
        if (client) {
          await disconnectQuietly(client)
        }
        if (this.client === client) this.client = null;
        throw new Error(`اتصال تلگرام برقرار نشد: ${redact(message)}`);
      }
      throw new Error('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.');
    } finally {
      if (attemptId === this.attemptId) {
        this.connecting = false;
        if (!this.connected) {
          this.onStatus?.(this.status(this.lastStatusMessage || 'اتصال برقرار نشد.'));
        }
      }
    }
  }

  requireClient() {
    if (!this.connected || !this.client) {
      const error = new Error('ابتدا حساب تلگرام را متصل کن.');
      error.code = 'TELEGRAM_NOT_CONNECTED';
      throw error;
    }
    return this.client;
  }

  async resolveEntity(chatId) {
    const key = String(chatId);
    const cached = this.entities.get(key);
    if (cached) return cached;
    if (this.me && key === String(this.me.id)) return this.me;
    throw new Error('گفتگو در فهرست فعلی پیدا نشد؛ فهرست گفتگوها را دوباره بارگذاری کن.');
  }

  messageSummary(message) {
    if (!message) return '';
    if (message.message) return String(message.message).slice(0, 240);
    if (message.media) return 'پیام رسانه‌ای';
    return 'پیام';
  }

  async listChats(limit = 60) {
    const client = this.requireClient();
    const dialogs = await client.getDialogs({ limit: Math.max(1, Math.min(Number(limit) || 60, 100)) });
    const rows = [];
    if (this.me) this.entities.set(String(this.me.id), this.me);
    for (const dialog of dialogs || []) {
      if (!dialog || !dialog.entity || dialog.id == null) continue;
      const id = String(dialog.id);
      this.entities.set(id, dialog.entity);
      const isSaved = this.me && id === String(this.me.id);
      rows.push({
        id,
        title: isSaved ? 'Saved Messages' : (dialog.title || dialog.name || 'گفتگو'),
        unreadCount: Number(dialog.unreadCount || 0),
        lastMessage: this.messageSummary(dialog.message),
        isSavedMessages: !!isSaved,
        type: dialog.isChannel ? 'channel' : (dialog.isGroup ? 'group' : 'user')
      });
    }
    // Ensure Saved Messages is accessible even if GramJS did not include self in
    // the most recent dialogs response.
    if (this.me && !rows.some(row => row.isSavedMessages)) {
      rows.unshift({
        id: String(this.me.id),
        title: 'Saved Messages',
        unreadCount: 0,
        lastMessage: '',
        isSavedMessages: true,
        type: 'user'
      });
      this.entities.set(String(this.me.id), this.me);
    }
    return rows;
  }

  async searchChats(query, limit = 30) {
    const client = this.requireClient();
    const dialogs = await client.getDialogs({ limit: 100 });
    const q = String(query || '').trim().toLocaleLowerCase();
    const rows = [];
    if (this.me) this.entities.set(String(this.me.id), this.me);
    for (const dialog of dialogs || []) {
      if (!dialog || !dialog.entity || dialog.id == null) continue;
      const id = String(dialog.id);
      const title = (this.me && id === String(this.me.id))
        ? 'Saved Messages'
        : (dialog.title || dialog.name || 'گفتگو');
      const lastMessage = this.messageSummary(dialog.message);
      if (q && !(title + ' ' + lastMessage).toLocaleLowerCase().includes(q)) continue;
      this.entities.set(id, dialog.entity);
      rows.push({
        id,
        title,
        unreadCount: Number(dialog.unreadCount || 0),
        lastMessage,
        isSavedMessages: !!(this.me && id === String(this.me.id)),
        type: dialog.isChannel ? 'channel' : (dialog.isGroup ? 'group' : 'user')
      });
      if (rows.length >= Math.max(1, Math.min(Number(limit) || 30, 100))) break;
    }
    return rows;
  }

  async getChatHistory(chatId, limit = 40) {
    const client = this.requireClient();
    const entity = await this.resolveEntity(chatId);
    const messages = await client.getMessages(entity, { limit: Math.max(1, Math.min(Number(limit) || 40, 100)) });
    return (messages || []).map(message => ({
      id: String(message.id),
      chatId: String(chatId),
      date: Number(message.date || 0),
      outgoing: !!message.out,
      text: this.messageSummary(message),
      contentType: message.media ? 'media' : 'text'
    }));
  }

  async getUnreadPreview(chatId, limit = 20) {
    // getMessages does not call readHistory/markAsRead; this remains a preview.
    return this.getChatHistory(chatId, limit);
  }

  async sendTextMessage(chatId, text) {
    const client = this.requireClient();
    const entity = await this.resolveEntity(chatId);
    const body = String(text || '').trim();
    if (!body || body.length > 4096) throw new Error('متن پیام خالی است یا بیش از حد طولانی است.');
    const message = await client.sendMessage(entity, { message: body });
    return { id: String(message.id), text: body };
  }

  async sendMedia(chatId, filePath, caption = '') {
    const client = this.requireClient();
    const entity = await this.resolveEntity(chatId);
    const file = path.resolve(String(filePath || ''));
    const userData = path.resolve(app.getPath('userData')) + path.sep;
    const downloads = path.resolve(app.getPath('downloads')) + path.sep;
    if (!file.startsWith(userData) && !file.startsWith(downloads)) {
      throw new Error('برای امنیت، فقط فایل‌های داخل پوشهٔ دادهٔ برنامه یا Downloads مجازند.');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('فایل انتخاب‌شده پیدا نشد.');
    const result = await client.sendFile(entity, {
      file,
      caption: String(caption || '').slice(0, 1024)
    });
    return { id: String(result && result.id || '') };
  }

  async setChatMuted(chatId, muted) {
    const client = this.requireClient();
    const entity = await this.resolveEntity(chatId);
    const { Api } = require('telegram');
    const inputPeer = await client.getInputEntity(entity);
    return client.invoke(new Api.account.UpdateNotifySettings({
      peer: new Api.InputNotifyPeer({ peer: inputPeer }),
      settings: new Api.InputPeerNotifySettings({
        muteUntil: muted ? Math.floor(Date.now() / 1000) + 31536000 : 0,
        silent: false,
        showPreviews: true
      })
    }));
  }

  async cancelConnect() {
    if (!this.connecting && !this.client) return this.status();
    if (this.cancelPromise) return this.cancelPromise;
    this.attemptId += 1;
    this.connecting = false;
    this.connected = false;
    this.entities.clear();
    const resolvePrompt = this.promptResolver;
    this.promptResolver = null;
    this.promptType = null;
    if (resolvePrompt) resolvePrompt('');
    const client = this.client;
    this.client = null;
    const cleanup = (async () => {
      await disconnectQuietly(client)
      this.onPrompt?.({ type: 'cancelled' });
      this.onStatus?.(this.status('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.'));
    })();
    this.cancelPromise = cleanup;
    try { await cleanup; } finally { if (this.cancelPromise === cleanup) this.cancelPromise = null; }
    return this.status('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.');
  }

  async close() {
    this.attemptId += 1;
    if (this.promptResolver) {
      const resolve = this.promptResolver;
      this.promptResolver = null;
      this.promptType = null;
      resolve('');
    }
    const client = this.client;
    this.client = null;
    await disconnectQuietly(client)
    this.connected = false;
    this.connecting = false;
  }
}

module.exports = { GramJsService };
