'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');

const KEY_FILE = 'telegram-native-key.bin';

function redactTdlibLog(message) {
  return String(message || '')
    .replace(/\b(?:tg|https?):\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(api[_ -]?hash|auth[_ -]?key|(?:qr|auth|login)?[_ -]?token|password|phone(?:[_ -]?number)?)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[HEX_REDACTED]')
    .replace(/\b[A-Za-z0-9+/_=-]{40,}\b/g, '[LONG_VALUE_REDACTED]')
    .replace(/\b\d{7,}\b/g, '[NUMBER_REDACTED]')
    .replace(/\+?\d[\d ().-]{7,}\d/g, '[PHONE_REDACTED]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
}

let tdlibConfigured = false;

class TdlibService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connecting = false;
    this.promptResolver = null;
    this.promptType = null;
    this.promptTarget = null;
    this.attemptId = 0;
    this.cancelQrLogin = null;
    this.cancelPromise = null;
    this.authPromptSeen = false;
    this.diagnosticStage = 'idle';
    this.lastStatusMessage = '';
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
      engine: 'TDLib',
      stage: this.connected ? 'connected' : (this.connecting ? 'authorizing' : 'ready'),
      diagnosticStage: this.diagnosticStage,
      message: message || (this.connected
        ? 'حساب تلگرام متصل است.'
        : (this.connecting
          ? (this.lastStatusMessage || 'در حال راه‌اندازی اتصال تلگرام…')
          : 'برای اتصال، API ID و API Hash حساب توسعه‌دهنده را وارد کن.'))
    };
  }

  reportStage(stage, message) {
    const safeStage = String(stage || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'unknown';
    const safeMessage = String(message || '').slice(0, 240);
    this.diagnosticStage = safeStage;
    this.lastStatusMessage = safeMessage;
    try {
      const line = `${new Date().toISOString()} [${safeStage}] ${safeMessage.replace(/[\r\n]+/g, ' ')}\n`;
      fs.appendFileSync(path.join(this.dataDir(), 'connection.log'), line, 'utf8');
    } catch {
      // Diagnostic logging must never block Telegram authentication.
    }
    this.onStatus?.(this.status(safeMessage));
  }

  appendSafeDiagnostic(stage, message, attemptId) {
    if (attemptId !== this.attemptId || !this.connecting) return;
    const safeStage = String(stage || 'tdlib-event').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'tdlib-event';
    const safeMessage = redactTdlibLog(message);
    if (!safeMessage) return;
    try {
      const line = `${new Date().toISOString()} [${safeStage}] ${safeMessage}\n`;
      fs.appendFileSync(path.join(this.dataDir(), 'connection.log'), line, 'utf8');
    } catch {
      // Diagnostic logging must never block Telegram authentication.
    }
  }

  recordNativeTdlibLog(level, message, attemptId) {
    this.appendSafeDiagnostic('tdlib-log-' + (Number(level) || 0), message, attemptId);
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

  dataDir() {
    const dir = path.join(app.getPath('userData'), 'telegram-native');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  ensureSafeStorage() {
    if (!safeStorage.isEncryptionAvailable()) {
      const error = new Error('حافظهٔ امن سیستم‌عامل در دسترس نیست؛ برای حفاظت از نشست، اتصال لغو شد.');
      error.code = 'SECURE_STORAGE_UNAVAILABLE';
      throw error;
    }
  }

  readEncryptedJson(filename) {
    const file = path.join(this.dataDir(), filename);
    if (!fs.existsSync(file)) return null;
    this.ensureSafeStorage();
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  }

  writeEncrypted(filename, value) {
    this.ensureSafeStorage();
    fs.writeFileSync(path.join(this.dataDir(), filename), safeStorage.encryptString(value), { mode: 0o600 });
  }

  getDatabaseKey() {
    const file = path.join(this.dataDir(), KEY_FILE);
    if (fs.existsSync(file)) {
      this.ensureSafeStorage();
      return safeStorage.decryptString(fs.readFileSync(file));
    }
    const key = crypto.randomBytes(32).toString('base64');
    this.writeEncrypted(KEY_FILE, key);
    return key;
  }

  async requestAuthInput(type, attemptId = this.attemptId) {
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
      const label = ({
        phone: 'شماره تلفن با کد کشور',
        code: 'کد ورود تلگرام',
        password: 'رمز تأیید دومرحله‌ای',
        email: 'ایمیل حساب تلگرام',
        'email-code': 'کد تأیید ایمیل',
        name: 'نام'
      })[type] || 'اطلاعات ورود';
      this.reportStage('awaiting-' + type, ({
        phone: 'منتظر شماره تلفن هستم…',
        code: 'منتظر کد ورود تلگرام هستم…',
        password: 'منتظر رمز تأیید دومرحله‌ای هستم…',
        email: 'منتظر ایمیل حساب هستم…',
        'email-code': 'منتظر کد تأیید ایمیل هستم…',
        name: 'منتظر نام حساب هستم…'
      })[type] || 'منتظر اطلاعات ورود هستم…');
      this.onPrompt({ type, label });
    });
  }

  submitAuthInput(type, value) {
    if (!this.promptResolver || type !== this.promptType) return { ok: false, error: 'درخواست ورود فعالی وجود ندارد.' };
    const resolve = this.promptResolver;
    this.promptResolver = null;
    this.promptType = null;
    resolve(String(value || '').trim());
    return { ok: true };
  }

  async loginWithQr(client, attemptId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let qrRequested = false;
      let qrPromptShown = false;
      let queue = Promise.resolve();
      let statePollTimer = null;
      let statePollInFlight = false;
      let statePollAttempts = 0;
      let lastPolledState = '';

      const stopStatePolling = () => {
        if (statePollTimer) clearTimeout(statePollTimer);
        statePollTimer = null;
      };

      const scheduleAuthorizationStatePoll = () => {
        if (settled || !qrRequested || qrPromptShown || statePollTimer) return;
        statePollTimer = setTimeout(async () => {
          statePollTimer = null;
          if (settled || qrPromptShown || statePollInFlight) return;
          statePollInFlight = true;
          try {
            // Recover if TDLib changed authorization state but the update event was missed.
            // Never log the QR link or token.
            const state = await client.invoke({ _: 'getAuthorizationState' });
            if (settled || !state) return;
            if (state._ !== 'authorizationStateWaitPhoneNumber') {
              const signature = state._ === 'authorizationStateWaitOtherDeviceConfirmation'
                ? state._ + ':' + String(state.link || '')
                : state._;
              if (signature !== lastPolledState) {
                lastPolledState = signature;
                this.reportStage('qr-state-recovered', 'وضعیت احراز هویت از پرس‌وجوی مستقیم TDLib بازیابی شد.');
                onUpdate({ _: 'updateAuthorizationState', authorization_state: state });
              }
            } else {
              statePollAttempts += 1;
              if (statePollAttempts === 3) {
                this.reportStage('qr-server-no-response', 'بعد از درخواست QR، TDLib هنوز در وضعیت انتظار شماره است؛ لینک QR دریافت نشده است.');
              }
            }
          } catch {
            statePollAttempts += 1;
            if (statePollAttempts === 3) {
              this.reportStage('qr-state-poll-failed', 'بررسی مستقیم وضعیت ورود TDLib هم پاسخ نداد؛ احتمال مشکل ارتباط با سرویس تلگرام وجود دارد.');
            }
          } finally {
            statePollInFlight = false;
            if (!settled && !qrPromptShown) scheduleAuthorizationStatePoll();
          }
        }, 1500);
      };

      const finish = error => {
        if (settled) return;
        settled = true;
        stopStatePolling();
        client.off('update', onUpdate);
        if (this.cancelQrLogin === cancelQr) this.cancelQrLogin = null;
        if (error) reject(error);
        else resolve();
      };
      const cancelQr = () => finish(new Error('ورود با QR لغو شد.'));
      this.cancelQrLogin = cancelQr;

      const processState = async state => {
        if (settled) return;
        if (attemptId !== this.attemptId) throw new Error('ورود لغو شد.');
        switch (state && state._) {
          case 'authorizationStateReady':
            finish();
            return;
          case 'authorizationStateClosed':
            throw new Error('ارتباط با تلگرام بسته شد.');
          case 'authorizationStateWaitPhoneNumber':
            if (!qrRequested) {
              qrRequested = true;
              this.reportStage('request-qr', 'در حال درخواست QR ورود از تلگرام…');
              // Do not await inside the serialized auth-update queue. TDLib may emit
              // authorizationStateWaitOtherDeviceConfirmation before this request promise
              // resolves; returning lets the next update be processed immediately.
              const qrRequest = client.invoke({ _: 'requestQrCodeAuthentication', other_user_ids: [] });
              qrRequest.then(() => {
                this.reportStage('qr-request-accepted', 'درخواست QR توسط TDLib پذیرفته شد؛ منتظر وضعیت QR هستم…');
              }).catch(error => finish(error));
              scheduleAuthorizationStatePoll();
              return;
            }
            return;
          case 'authorizationStateWaitOtherDeviceConfirmation':
            if (!state.link) throw new Error('تلگرام وضعیت QR را برگرداند اما لینک QR خالی بود.');
            if (qrPromptShown) return;
            qrPromptShown = true;
            this.authPromptSeen = true;
            // Record that TDLib supplied a QR link without ever logging the link/token itself.
            this.reportStage('qr-link-received', 'لینک ورود QR از تلگرام دریافت شد؛ در حال نمایش تصویر…');
            this.onPrompt?.({
              type: 'qr',
              label: 'با تلگرام روی گوشی، QR را اسکن کن',
              link: state.link
            });
            this.reportStage('awaiting-qr-confirmation', 'QR آماده است؛ منتظر تأیید ورود از گوشی هستم…');
            return;
          case 'authorizationStateWaitCode': {
            // A previously interrupted authorization can resume in this state.
            // Prefer QR once; after QR has started, accept the code if TDLib requests it.
            if (!qrRequested) {
              qrRequested = true;
              await client.invoke({ _: 'requestQrCodeAuthentication', other_user_ids: [] });
              return;
            }
            while (true) {
              const code = await this.requestAuthInput('code', attemptId);
              try {
                await client.invoke({ _: 'checkAuthenticationCode', code });
                return;
              } catch (error) {
                if (error?.message === 'PHONE_CODE_EMPTY' || error?.message === 'PHONE_CODE_INVALID') continue;
                throw error;
              }
            }
          }
          case 'authorizationStateWaitPassword':
            while (true) {
              const password = await this.requestAuthInput('password', attemptId);
              try {
                await client.invoke({ _: 'checkAuthenticationPassword', password });
                return;
              } catch (error) {
                if (error?.message === 'PASSWORD_HASH_INVALID') continue;
                throw error;
              }
            }
          case 'authorizationStateWaitEmailAddress': {
            const email = await this.requestAuthInput('email', attemptId);
            await client.invoke({ _: 'setAuthenticationEmailAddress', email_address: email });
            return;
          }
          case 'authorizationStateWaitEmailCode':
            while (true) {
              const code = await this.requestAuthInput('email-code', attemptId);
              try {
                await client.invoke({
                  _: 'checkAuthenticationEmailCode',
                  code: { _: 'emailAddressAuthenticationCode', code }
                });
                return;
              } catch (error) {
                if (error?.message === 'EMAIL_CODE_EMPTY' || error?.message === 'EMAIL_CODE_INVALID') continue;
                throw error;
              }
            }
          case 'authorizationStateWaitRegistration': {
            const firstName = await this.requestAuthInput('name', attemptId);
            await client.invoke({ _: 'registerUser', first_name: firstName, last_name: '' });
            return;
          }
          default:
            return;
        }
      };

      const onUpdate = update => {
        if (!update || update._ !== 'updateAuthorizationState') return;
        const nextState = update.authorization_state;
        queue = queue.then(() => processState(nextState)).catch(error => finish(error));
      };
      client.on('update', onUpdate);
      // TDLib can emit an auth update before this listener is attached. Query its public
      // getAuthorizationState method to recover the current state without relying on internals.
      void client.invoke({ _: 'getAuthorizationState' }).then(state => {
        if (!settled && state && attemptId === this.attemptId) {
          onUpdate({ _: 'updateAuthorizationState', authorization_state: state });
        }
      }).catch(error => finish(error));
    });
  }

  async connect({ apiId, apiHash, loginMethod = 'phone', proxy = null }, targetWebContents) {
    if (this.cancelPromise) await this.cancelPromise;
    if (this.connected) return this.status();
    if (this.connecting) throw new Error('تلاش اتصال قبلی هنوز فعال است. پنجرهٔ ورود قبلی را ببند یا اتصال را لغو کن؛ نیازی به انتظار نیم‌ساعته نیست.');

    const parsedId = Number(apiId);
    const hash = String(apiHash || '').trim();
    if (!Number.isInteger(parsedId) || parsedId <= 0 || !/^[a-f0-9]{32}$/i.test(hash)) {
      throw new Error('API ID باید عدد معتبر و API Hash باید ۳۲ نویسهٔ هگزادسیمال باشد.');
    }
    const proxyType = String(proxy?.type || '').trim().toLowerCase();
    let proxyRequest = null;
    if (proxyType) {
      const server = String(proxy?.server || '').trim();
      const port = Number(proxy?.port);
      if (!server || server.length > 253 || /[\s/]/.test(server) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('میزبان و درگاه پروکسی معتبر نیست؛ آدرس را بدون http:// یا socks5:// و درگاه را بین ۱ تا ۶۵۵۳۵ وارد کن.');
      }
      const username = String(proxy?.username || '');
      const password = String(proxy?.password || '');
      let type;
      if (proxyType === 'socks5') {
        type = { _: 'proxyTypeSocks5', username, password };
      } else if (proxyType === 'http') {
        type = { _: 'proxyTypeHttp', username, password, http_only: false };
      } else if (proxyType === 'mtproto') {
        const secret = String(proxy?.secret || '').trim();
        if (!/^[a-f0-9]{32,64}$/i.test(secret) || secret.length % 2 !== 0) {
          throw new Error('Secret پروکسی MTProto باید یک مقدار هگزادسیمال معتبر با طول زوج باشد.');
        }
        type = { _: 'proxyTypeMtproto', secret };
      } else {
        throw new Error('نوع پروکسی پشتیبانی نمی‌شود؛ SOCKS5، HTTP یا MTProto را انتخاب کن.');
      }
      // Proxy credentials stay in memory and are never written into diagnostics or user data.
      proxyRequest = { _: 'addProxy', proxy: { _: 'proxy', server, port, type }, enable: true };
    }
    this.ensureSafeStorage();
    this.connecting = true;
    this.authPromptSeen = false;
    const attemptId = ++this.attemptId;
    this.promptTarget = targetWebContents;
    this.reportStage(loginMethod === 'qr' ? 'start-qr' : 'start-phone', loginMethod === 'qr'
      ? 'در حال آماده‌سازی ورود با QR…'
      : 'در حال آماده‌سازی موتور تلگرام برای ورود با شماره…');

    let client = null;
    let tdl = null;
    let restoreTdlibVerbosity = false;
    let firstAuthPromptTimer = null;
    try {
      this.reportStage('load-libraries', 'در حال بارگذاری کتابخانه‌های تلگرام…');
      tdl = require('tdl');
      const { getTdjson, getTdlibInfo } = require('prebuilt-tdlib');
      let tdlibInfo = getTdlibInfo();
      this.reportStage('find-tdjson', 'در حال پیدا کردن موتور تلگرام…');
      const localOfficialTdjson = path.join(__dirname, 'native', 'tdjson.dll');
      const packagedOfficialTdjson = path.join(process.resourcesPath, 'telegram-native', 'tdjson.dll');
      let tdjsonPath;
      let buildInfoPath = null;

      if (process.platform === 'win32' && app.isPackaged) {
        // Prefer an official TDLib resource when present. The current CI release
        // workflow does not build that DLL yet, so use the pinned prebuilt package
        // as a safe fallback rather than aborting before QR authentication starts.
        if (fs.existsSync(packagedOfficialTdjson)) {
          tdjsonPath = packagedOfficialTdjson;
          buildInfoPath = path.join(process.resourcesPath, 'telegram-native', 'tdlib-build-info.json');
        } else {
          tdjsonPath = getTdjson();
          if (tdjsonPath.includes('app.asar')) tdjsonPath = tdjsonPath.replace('app.asar', 'app.asar.unpacked');
          if (!fs.existsSync(tdjsonPath)) {
            throw new Error('موتور TDLib در نصاب پیدا نشد؛ لطفاً نسخهٔ کامل TwinPanel را نصب کن.');
          }
        }
      } else if (process.platform === 'win32' && fs.existsSync(localOfficialTdjson)) {
        tdjsonPath = localOfficialTdjson;
        buildInfoPath = path.join(__dirname, 'native', 'tdlib-build-info.json');
      } else {
        // Development/non-Windows fallback: use the pinned prebuilt-tdlib package.
        tdjsonPath = getTdjson();
        if (app.isPackaged && tdjsonPath.includes('app.asar')) {
          tdjsonPath = tdjsonPath.replace('app.asar', 'app.asar.unpacked');
        }
      }

      if (buildInfoPath && fs.existsSync(buildInfoPath)) {
        const builtInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
        if (builtInfo && builtInfo.version && builtInfo.commit) tdlibInfo = builtInfo;
      }
      this.reportStage('tdlib-build-info', `نسخهٔ موتور TDLib: ${tdlibInfo.version || 'نامشخص'}؛ commit: ${tdlibInfo.commit || 'نامشخص'}`);

      if (!fs.existsSync(tdjsonPath)) {
        throw new Error('فایل موتور TDLib در نصب برنامه پیدا نشد؛ نصب مجدد نسخهٔ فعلی لازم است.');
      }
      if (!tdlibConfigured) {
        this.reportStage('configure-tdlib', 'در حال پیکربندی موتور TDLib…');
        tdl.configure({ tdjson: tdjsonPath, verbosityLevel: 0 });
        tdlibConfigured = true;
      }
      if (loginMethod === 'qr') {
        if (typeof tdl.setLogMessageCallback === 'function') {
          // The app's normal global verbosity is zero. Install a redacting callback,
          // then temporarily raise TDLib verbosity so the callback actually receives
          // warnings/errors during this QR attempt.
          tdl.setLogMessageCallback(2, (verbosityLevel, message) => {
            this.recordNativeTdlibLog(verbosityLevel, message, attemptId);
          });
          restoreTdlibVerbosity = true;
          const verbosityResult = tdl.execute({ _: 'setLogVerbosityLevel', new_verbosity_level: 2 });
          if (verbosityResult && verbosityResult._ === 'error') {
            throw new Error('TDLib نتوانست گزارش خطاهای داخلی را فعال کند.');
          }
          this.reportStage('qr-native-diagnostics-enabled', 'گزارش خطاهای داخلی TDLib برای این تلاش فعال شد؛ اطلاعات حساس پیش از ذخیره حذف می‌شوند.');
        } else {
          this.reportStage('qr-native-diagnostics-unavailable', 'این نسخه از رابط TDLib گزارش خطاهای داخلی را پشتیبانی نمی‌کند.');
        }
      }
      this.reportStage('prepare-local-database', 'در حال آماده‌سازی پایگاه دادهٔ محلی رمزگذاری‌شده…');
      const dir = this.dataDir();
      fs.mkdirSync(path.join(dir, 'database'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
      this.reportStage('create-client', 'در حال ساخت کلاینت و بازکردن موتور تلگرام…');
      client = this.client = tdl.createClient({
        apiId: parsedId,
        apiHash: hash,
        databaseDirectory: path.join(dir, 'database'),
        filesDirectory: path.join(dir, 'files'),
        databaseEncryptionKey: this.getDatabaseKey()
      });
      this.reportStage('client-created', 'موتور ساخته شد؛ در حال دریافت وضعیت احراز هویت…');

      client.on('update', update => {
        if (attemptId !== this.attemptId) return;
        if (loginMethod === 'qr' && update && update._ === 'updateConnectionState') {
          const connectionState = update.state && update.state._ || 'unknown';
          this.appendSafeDiagnostic('tdlib-connection-state', connectionState, attemptId);
        }
        if (update && update._ === 'updateAuthorizationState') {
          const state = update.authorization_state && update.authorization_state._;
          const labels = {
            authorizationStateWaitTdlibParameters: 'در حال آماده‌سازی موتور تلگرام…',
            authorizationStateWaitEncryptionKey: 'در حال بازکردن پایگاه دادهٔ محلی تلگرام…',
            authorizationStateWaitPhoneNumber: loginMethod === 'qr' ? 'در حال درخواست QR ورود از تلگرام…' : 'در حال آماده‌سازی فرم ورود…',
            authorizationStateWaitOtherDeviceConfirmation: 'منتظر اسکن QR از گوشی هستم…',
            authorizationStateWaitCode: 'در حال انتظار برای کد ورود…',
            authorizationStateWaitPassword: 'در حال انتظار برای رمز دومرحله‌ای…',
            authorizationStateReady: 'ورود انجام شد؛ در حال بارگذاری حساب…'
          };
          const message = labels[state] || ('وضعیت ورود تلگرام: ' + String(state || 'نامشخص'));
          this.reportStage('auth-' + String(state || 'unknown').replace(/^authorizationState/, '').replace(/[^a-zA-Z0-9_-]/g, ''), message);
        }
      });
      client.on('error', () => {
        // Native error payloads are deliberately not recorded because they may contain sensitive details.
        this.reportStage('tdlib-runtime-error', 'موتور تلگرام خطای داخلی گزارش کرد؛ برای جزئیات بیشتر گزارش را بررسی کن.');
      });

      if (proxyRequest) {
        const proxyLabels = { socks5: 'SOCKS5', http: 'HTTP', mtproto: 'MTProto' };
        const proxyObject = proxyRequest.proxy;
        this.reportStage('test-proxy', 'در حال آزمایش دسترسی پروکسی به سرور تلگرام…');
        try {
          // TDLib documents testProxy as callable before authorization. This verifies
          // network reachability before we begin QR auth and wait for state updates.
          await client.invoke({ _: 'testProxy', proxy: proxyObject, dc_id: 2, timeout: 10 });
          this.reportStage('proxy-test-success', 'آزمایش پروکسی موفق بود؛ در حال فعال‌کردن اتصال تلگرام…');
        } catch (error) {
          const message = String(error?.message || error || '').toLowerCase();
          const reason = /timeout|timed out|timedout/.test(message)
            ? 'timeout'
            : /auth|username|password|407/.test(message)
              ? 'authentication'
              : /resolve|dns|host not found|name.*resolution/.test(message)
                ? 'dns'
                : /refused|reset|unreachable|connect|socket|network|handshake/.test(message)
                  ? 'network'
                  : 'unknown';
          const code = Number(error?.code);
          this.appendSafeDiagnostic('proxy-test-failed', 'reason=' + reason + ' code=' + (Number.isFinite(code) ? code : 'unknown'), attemptId);
          throw new Error('آزمایش پروکسی برای اتصال به تلگرام ناموفق شد (' + reason + '). میزبان، درگاه، نوع پروکسی، دسترسی شبکه و در صورت نیاز نام کاربری/رمز را بررسی کن.');
        }
        this.reportStage('configure-proxy', 'در حال فعال‌کردن پروکسی ' + proxyLabels[proxyType] + ' برای اتصال تلگرام…');
        try {
          const added = await client.invoke(proxyRequest);
          if (!added || added._ === 'error') throw new Error('Proxy rejected');
          this.reportStage('proxy-enabled', 'پروکسی ثبت شد؛ در حال برقراری اتصال…');
        } catch {
          throw new Error('فعال‌سازی پروکسی ناموفق بود؛ نوع پروکسی، میزبان، درگاه و مشخصات آن را بررسی کن.');
        }
      }

      const loginTask = loginMethod === 'qr'
        ? this.loginWithQr(client, attemptId)
        : client.login({
            getPhoneNumber: () => this.requestAuthInput('phone', attemptId),
            getAuthCode: () => this.requestAuthInput('code', attemptId),
            getPassword: () => this.requestAuthInput('password', attemptId),
            getEmailAddress: () => this.requestAuthInput('email', attemptId),
            getEmailCode: () => this.requestAuthInput('email-code', attemptId),
            getName: async () => ({ firstName: await this.requestAuthInput('name', attemptId) }),
            confirmOnAnotherDevice: link => {
              this.authPromptSeen = true;
              this.reportStage('awaiting-qr-confirmation', 'این تلاش ورود نیاز به تأیید QR روی دستگاه دیگر دارد…');
              this.onPrompt?.({
                type: 'qr',
                label: 'برای ادامه، QR ورود را با تلگرام گوشی اسکن کن',
                link
              });
            }
          });
      const firstPromptTimeout = new Promise((_, reject) => {
        firstAuthPromptTimer = setTimeout(() => {
          if (attemptId === this.attemptId && !this.authPromptSeen) {
            reject(new Error(loginMethod === 'qr'
              ? (proxyRequest
                ? 'TDLib طی ۲۵ ثانیه پس از درخواست QR هیچ وضعیت جدیدی برنگرداند؛ اتصال از طریق پروکسی برقرار نشد. میزبان، درگاه، نوع پروکسی و دسترسی شبکه را بررسی کن.'
                : 'TDLib طی ۲۵ ثانیه پس از درخواست QR هیچ وضعیت جدیدی برنگرداند؛ اتصال مستقیم به سرورهای تلگرام برقرار نشد. شبکه را بررسی کن یا پروکسی معتبری تنظیم کن.')
              : 'TDLib طی ۲۵ ثانیه هیچ پنجرهٔ ورود نساخت. اتصال را لغو کن و دوباره امتحان کن.'));
          }
        }, 25000);
      });
      await Promise.race([loginTask, firstPromptTimeout]);

      if (attemptId !== this.attemptId) throw new Error('ورود لغو شد؛ دوباره تلاش کن.');
      this.me = await client.invoke({ _: 'getMe' });
      if (attemptId !== this.attemptId) throw new Error('ورود لغو شد؛ دوباره تلاش کن.');
      this.connected = true;
      this.reportStage('authorized', 'اتصال به تلگرام برقرار شد.');
      return this.status();
    } catch (error) {
      const wasCancelled = attemptId !== this.attemptId;
      const failedStage = this.diagnosticStage || 'unknown';
      const reason = String(error && error.message || '').trim().slice(0, 240);
      if (!wasCancelled) {
        this.connected = false;
        // Record the original failure before closing TDLib, because closing emits
        // authorizationStateClosing/Closed and must not hide the real failing stage.
        if (error && error.code !== 'SECURE_STORAGE_UNAVAILABLE') {
          this.reportStage('connect-error', `خطا در مرحلهٔ ${failedStage}: ${reason || 'خطای نامشخص'}`);
        }
        if (this.client === client) {
          try { if (client) await client.close(); } catch {}
          this.client = null;
        }
      }
      if (wasCancelled) throw new Error('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.');
      if (error && error.code === 'SECURE_STORAGE_UNAVAILABLE') throw new Error(error.message);
      throw new Error(reason ? `اتصال تلگرام ناموفق بود: ${reason}` : 'اتصال تلگرام برقرار نشد. گزارش تشخیصی را بررسی کن.');
    } finally {
      if (firstAuthPromptTimer) clearTimeout(firstAuthPromptTimer);
      if (restoreTdlibVerbosity && tdl) {
        try {
          tdl.execute({ _: 'setLogVerbosityLevel', new_verbosity_level: 0 });
        } catch {
          // Restoring quiet logging must not mask the authentication result.
        }
      }
      if (attemptId === this.attemptId) {
        this.connecting = false;
        this.promptTarget = null;
        this.cancelQrLogin = null;
      }
    }
  }

  async cancelConnect() {
    if (this.connected || !this.connecting) return this.status();
    if (this.cancelPromise) return this.cancelPromise;

    this.attemptId += 1;
    this.connecting = false;
    this.promptTarget = null;
    this.connected = false;

    const resolvePrompt = this.promptResolver;
    this.promptResolver = null;
    this.promptType = null;
    if (resolvePrompt) resolvePrompt('');

    const cancelQr = this.cancelQrLogin;
    this.cancelQrLogin = null;
    if (cancelQr) cancelQr();

    const client = this.client;
    this.client = null;
    const cleanup = (async () => {
      try { if (client) await client.close(); } catch {}
      this.onPrompt?.({ type: 'cancelled' });
      this.onStatus?.(this.status('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.'));
    })();
    this.cancelPromise = cleanup;
    try {
      await cleanup;
    } finally {
      if (this.cancelPromise === cleanup) this.cancelPromise = null;
    }
    return this.status('اتصال لغو شد؛ حالا می‌توانی دوباره تلاش کنی.');
  }

  requireClient() {
    if (!this.connected || !this.client) {
      const error = new Error('ابتدا حساب تلگرام را متصل کن.');
      error.code = 'TELEGRAM_NOT_CONNECTED';
      throw error;
    }
    return this.client;
  }

  async listChats(limit = 60) {
    const client = this.requireClient();
    const result = await client.invoke({ _: 'getChats', chat_list: { _: 'chatListMain' }, limit: Math.max(1, Math.min(Number(limit) || 60, 100)) });
    const chats = await Promise.all((result.chat_ids || []).map(async chatId => {
      try {
        const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
        return {
          id: String(chat.id),
          title: chat.title || 'گفتگو',
          unreadCount: chat.unread_count || 0,
          lastMessage: chat.last_message ? this.summarizeMessage(chat.last_message) : '',
          isSavedMessages: !!(this.me && Number(chat.id) === Number(this.me.id)),
          type: chat.type && chat.type._ || 'unknown'
        };
      } catch { return null; }
    }));
    return chats.filter(Boolean);
  }

  async searchChats(query, limit = 30) {
    const client = this.requireClient();
    const result = await client.invoke({ _: 'searchChats', query: String(query || '').slice(0, 128), limit: Math.max(1, Math.min(Number(limit) || 30, 100)) });
    return Promise.all((result.chat_ids || []).map(async chatId => {
      try {
        const chat = await client.invoke({ _: 'getChat', chat_id: chatId });
        return { id: String(chat.id), title: chat.title || 'گفتگو', unreadCount: chat.unread_count || 0, lastMessage: chat.last_message ? this.summarizeMessage(chat.last_message) : '', type: chat.type && chat.type._ || 'unknown', isSavedMessages: !!(this.me && Number(chat.id) === Number(this.me.id)) };
      } catch { return null; }
    })).then(rows => rows.filter(Boolean));
  }

  summarizeMessage(message) {
    const content = message && message.content || {};
    const text = content.text && content.text.text;
    if (text) return String(text).slice(0, 240);
    const type = content._ || '';
    return type.replace(/^messageContent/, 'پیام ') || 'پیام';
  }

  async getChatHistory(chatId, limit = 40) {
    const client = this.requireClient();
    const result = await client.invoke({
      _: 'getChatHistory',
      chat_id: String(chatId),
      from_message_id: '0',
      offset: 0,
      limit: Math.max(1, Math.min(Number(limit) || 40, 100)),
      only_local: false
    });
    return (result.messages || []).map(message => ({
      id: String(message.id),
      chatId: String(message.chat_id),
      date: message.date,
      outgoing: !!message.is_outgoing,
      text: this.summarizeMessage(message),
      contentType: message.content && message.content._ || 'unknown'
    }));
  }

  async getUnreadPreview(chatId, limit = 20) {
    // Deliberately does not call openChat, viewMessages, readChatList, or any read-marking method.
    return this.getChatHistory(chatId, limit);
  }

  async sendTextMessage(chatId, text) {
    const client = this.requireClient();
    const body = String(text || '').trim();
    if (!body || body.length > 4096) throw new Error('متن پیام خالی است یا بیش از حد طولانی است.');
    const result = await client.invoke({
      _: 'sendMessage',
      chat_id: String(chatId),
      input_message_content: {
        _: 'inputMessageText',
        text: { _: 'formattedText', text: body, entities: [] },
        link_preview_options: { _: 'linkPreviewOptions', is_disabled: false }
      }
    });
    return { id: String(result.id), text: body };
  }

  async sendMedia(chatId, filePath, caption = '') {
    const client = this.requireClient();
    const file = path.resolve(String(filePath || ''));
    if (!file.startsWith(path.resolve(app.getPath('userData')) + path.sep) && !file.startsWith(path.resolve(app.getPath('downloads')) + path.sep)) {
      throw new Error('برای امنیت، فقط فایل‌های داخل پوشهٔ دادهٔ برنامه یا Downloads مجازند.');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('فایل انتخاب‌شده پیدا نشد.');
    const result = await client.invoke({
      _: 'sendMessage',
      chat_id: String(chatId),
      input_message_content: {
        _: 'inputMessageDocument',
        document: { _: 'inputFileLocal', path: file },
        caption: { _: 'formattedText', text: String(caption).slice(0, 1024), entities: [] }
      }
    });
    return { id: String(result.id) };
  }

  async downloadFile(fileId) {
    const client = this.requireClient();
    return client.invoke({ _: 'downloadFile', file_id: Number(fileId), priority: 16, offset: 0, limit: 0, synchronous: false });
  }

  async setChatMuted(chatId, muted) {
    const client = this.requireClient();
    return client.invoke({
      _: 'setChatNotificationSettings',
      chat_id: String(chatId),
      notification_settings: {
        _: 'chatNotificationSettings',
        use_default_mute_for: false,
        mute_for: muted ? 315360000 : 0,
        use_default_sound: true,
        use_default_show_preview: true,
        use_default_disable_pinned_message_notifications: true,
        use_default_disable_mention_notifications: true
      }
    });
  }

  async close() {
    if (this.connecting && !this.connected) {
      await this.cancelConnect();
      return;
    }
    this.attemptId += 1;
    if (this.promptResolver) {
      const resolve = this.promptResolver;
      this.promptResolver = null;
      this.promptType = null;
      resolve('');
    }
    const cancelQr = this.cancelQrLogin;
    this.cancelQrLogin = null;
    if (cancelQr) cancelQr();
    const client = this.client;
    this.client = null;
    try { if (client) await client.close(); } catch {}
    this.connected = false;
    this.connecting = false;
  }
}

module.exports = { TdlibService };
