const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

class TelethonService {
  constructor() {
    this.child = null; this.buffer = ''; this.pending = new Map(); this.nextId = 0;
    this.connected = false; this.connecting = false; this.onPrompt = null; this.onStatus = null;
    this.diagnosticStage = 'ready'; this.lastMessage = 'برای اتصال، API ID و API Hash را وارد کن.';
  }
  setCallbacks({ onPrompt, onStatus } = {}) { this.onPrompt = onPrompt; this.onStatus = onStatus; }
  status(message = '') {
    return { connected: this.connected, connecting: this.connecting, engine: 'Telethon',
      stage: this.connected ? 'connected' : (this.connecting ? 'authorizing' : 'ready'),
      diagnosticStage: this.diagnosticStage, message: message || this.lastMessage };
  }
  reportStage(stage, message) {
    this.diagnosticStage = String(stage || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'unknown';
    this.lastMessage = String(message || '').slice(0, 240);
    try {
      const dir = path.join(app.getPath('userData'), 'telegram-native');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'connection.log'), new Date().toISOString() + ' [' + this.diagnosticStage + '] ' + this.lastMessage.replace(/[\r\n]+/g, ' ') + '\n', 'utf8');
    } catch {}
    this.onStatus?.(this.status(this.lastMessage));
  }
  runtime() {
    const packagedExe = path.join(process.resourcesPath || '', 'app.asar.unpacked', 'telegram-native', 'runtime', 'twinpanel-telethon.exe');
    if (app.isPackaged && fs.existsSync(packagedExe)) return { command: packagedExe, args: [] };
    const script = path.join(__dirname, 'telegram-native', 'telethon_bridge.py');
    if (process.env.TWINPANEL_PYTHON) return { command: process.env.TWINPANEL_PYTHON, args: ['-u', script] };
    return { command: 'python', args: ['-u', script] };
  }
  ensureProcess() {
    if (this.child && !this.child.killed && this.child.exitCode === null) return;
    const runtime = this.runtime();
    const env = { ...process.env, PYTHONUNBUFFERED: '1', TWINPANEL_DATA_DIR: path.join(app.getPath('userData'), 'telegram-native') };
    this.buffer = '';
    this.child = spawn(runtime.command, runtime.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.consume(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      const safe = String(chunk || '').trim().slice(-800);
      if (safe) this.reportStage('telethon-runtime', safe);
    });
    this.child.on('error', error => this.failAll(new Error('اجرای موتور Telethon ناموفق بود: ' + error.message)));
    this.child.on('exit', code => {
      this.connected = false; this.connecting = false;
      if (code !== 0) this.reportStage('runtime-exit', 'موتور Telethon متوقف شد (کد ' + code + ').');
      this.failAll(new Error('موتور اتصال تلگرام متوقف شد؛ دوباره تلاش کن.'));
    });
  }
  consume(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim(); this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let packet; try { packet = JSON.parse(line); } catch { continue; }
      if (packet.event === 'prompt') { this.onPrompt?.(packet.data || {}); continue; }
      if (packet.event === 'status') {
        const value = packet.data || {};
        this.connected = !!value.connected; this.connecting = !!value.connecting;
        this.diagnosticStage = value.diagnosticStage || this.diagnosticStage; this.lastMessage = value.message || this.lastMessage;
        this.onStatus?.(value); continue;
      }
      const pending = this.pending.get(packet.id); if (!pending) continue; this.pending.delete(packet.id);
      if (packet.ok) {
        const result = packet.result;
        if (result && typeof result === 'object' && 'connected' in result) {
          this.connected = !!result.connected; this.connecting = !!result.connecting;
          this.diagnosticStage = result.diagnosticStage || this.diagnosticStage; this.lastMessage = result.message || this.lastMessage;
        }
        pending.resolve(result);
      } else pending.reject(new Error(packet.error || 'عملیات تلگرام ناموفق بود.'));
    }
  }
  failAll(error) { for (const item of this.pending.values()) item.reject(error); this.pending.clear(); }
  request(method, args = {}) {
    this.ensureProcess(); const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.child.stdin.write(JSON.stringify({ id, method, args }) + '\n'); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  async connect({ apiId, apiHash, loginMethod = 'phone', proxy = null } = {}) {
    if (this.connected) return this.status();
    if (this.connecting) throw new Error('تلاش اتصال قبلی هنوز فعال است. اتصال قبلی را لغو کن و دوباره تلاش کن.');
    if (!/^\d+$/.test(String(apiId || '')) || !/^[a-f0-9]{32}$/i.test(String(apiHash || ''))) throw new Error('API ID یا API Hash معتبر نیست.');
    this.connecting = true; this.reportStage('starting', 'در حال راه‌اندازی موتور اتصال Telethon…');
    try {
      const result = await this.request('connect', { apiId: String(apiId), apiHash: String(apiHash), loginMethod, proxy });
      this.connected = !!(result && result.connected); this.connecting = false;
      this.reportStage('connected', 'حساب تلگرام با موفقیت متصل شد.');
      return result || this.status();
    } catch (error) {
      this.connecting = false; this.connected = false; this.reportStage('connection-failed', error.message); throw error;
    }
  }
  async cancelConnect() {
    const child = this.child; this.child = null; this.connected = false; this.connecting = false;
    this.onPrompt?.({ type: 'cancelled' }); this.failAll(new Error('فرایند اتصال لغو شد.'));
    if (child && !child.killed) { try { child.kill(); } catch {} }
    this.reportStage('cancelled', 'فرایند اتصال لغو شد؛ می‌توانی دوباره تلاش کنی.');
    return this.status();
  }
  getDiagnostics() { return { stage: this.diagnosticStage, message: this.lastMessage, engine: 'Telethon', connected: this.connected }; }
  submitAuthInput(type, value) { return this.request('auth-input', { type, value: String(value || '') }); }
  listChats(limit = 60) { return this.request('list-chats', { limit }); }
  searchChats(query, limit = 30) { return this.request('search-chats', { query: String(query || ''), limit }); }
  getChatHistory(chatId, limit = 40) { return this.request('history', { chatId: String(chatId), limit }); }
  getUnreadPreview(chatId, limit = 20) { return this.request('preview', { chatId: String(chatId), limit }); }
  sendTextMessage(chatId, text) { return this.request('send-text', { chatId: String(chatId), text: String(text || '') }); }
  sendMedia(chatId, filePath, caption = '') { return this.request('send-media', { chatId: String(chatId), filePath: String(filePath || ''), caption: String(caption || '') }); }
  setChatMuted(chatId, muted) { return this.request('mute-chat', { chatId: String(chatId), muted: !!muted }); }
  async close() {
    const child = this.child; this.child = null; this.connected = false; this.connecting = false;
    this.failAll(new Error('TwinPanel بسته شد.'));
    if (child && !child.killed) { try { child.kill(); } catch {} }
  }
}
module.exports = { TelethonService };
