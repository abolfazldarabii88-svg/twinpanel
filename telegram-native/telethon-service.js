const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

class TelethonService {
  constructor() {
    this.child = null; this.buffer = ''; this.pending = new Map(); this.nextId = 0;
    this.connected = false; this.connecting = false; this.onPrompt = null; this.onStatus = null; this.onUpdate = null;
    this.diagnosticStage = 'ready'; this.lastMessage = 'برای اتصال، API ID و API Hash را وارد کن.';
  }
  setCallbacks({ onPrompt, onStatus, onUpdate } = {}) { this.onPrompt = onPrompt; this.onStatus = onStatus; this.onUpdate = onUpdate; }
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
      if (packet.event === 'update') { this.onUpdate?.(packet.data || {}); continue; }
      if (packet.event === 'upload-progress') { this.onProgress?.(packet.data || {}); continue; }
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
  // Polling and profile helpers are exposed by the native service.
  listChats(limit = 60) { return this.request('list-chats', { limit }); }
  searchPublicPeers(query) { return this.request('search-public-peers', { query: String(query || '') }); }
  reportMessage(chatId, messageId, reason, details = '') { return this.request('report-message', { chatId: String(chatId), messageId: String(messageId), reason: String(reason), details: String(details || '') }); }
  reportChat(chatId, reason, details = '') { return this.request('report-chat', { chatId: String(chatId), reason: String(reason), details: String(details || '') }); }
  getAdminLog(chatId) { return this.request('get-admin-log', { chatId: String(chatId) }); }
  listForumTopics(chatId) { return this.request('list-forum-topics', { chatId: String(chatId) }); }
  createForumTopic(chatId, title) { return this.request('create-forum-topic', { chatId: String(chatId), title: String(title || '') }); }
  editForumTopic(chatId, topicId, changes = {}) { return this.request('edit-forum-topic', { chatId: String(chatId), topicId: String(topicId), title: changes.title == null ? null : String(changes.title), closed: changes.closed == null ? null : !!changes.closed }); }
  topicHistory(chatId, topicId, limit = 50) { return this.request('topic-history', { chatId: String(chatId), topicId: String(topicId), limit: Number(limit) }); }
  listContacts() { return this.request('list-contacts'); }
  addContact(phone, firstName, lastName = '') { return this.request('add-contact', { phone: String(phone || ''), firstName: String(firstName || ''), lastName: String(lastName || '') }); }
  deleteContact(chatId) { return this.request('delete-contact', { chatId: String(chatId) }); }
  deleteChat(chatId) { return this.request('delete-chat', { chatId: String(chatId) }); }
  clearChatHistory(chatId) { return this.request('clear-chat-history', { chatId: String(chatId) }); }
  leaveChat(chatId) { return this.request('leave-chat', { chatId: String(chatId) }); }
  listDialogFolders() { return this.request('list-dialog-folders'); }
  saveDialogFolder(folder) { return this.request('save-dialog-folder', folder || {}); }
  deleteDialogFolder(id) { return this.request('delete-dialog-folder', { id: Number(id) }); }
  getProfile() { return this.request('profile'); }
  listStickers() { return this.request('list-stickers'); }
  sendSticker(chatId, token) { return this.request('send-sticker', { chatId: String(chatId), token: String(token || '') }); }
  getBotCommands(chatId) { return this.request('get-bot-commands', { chatId: String(chatId) }); }
  listStories() { return this.request('list-stories'); }
  openStory(token) { return this.request('open-story', { token: String(token || '') }); }
  getAuthorizations() { return this.request('list-authorizations'); }
  resetAuthorization(hash) { return this.request('reset-authorization', { hash: String(hash || '') }); }
  getPrivacySettings() { return this.request('get-privacy-settings'); }
  setPrivacySetting(name, choice) { return this.request('set-privacy-setting', { name: String(name), choice: String(choice) }); }
  getChatInfo(chatId) { return this.request('get-chat-info', { chatId: String(chatId) }); }
  getChatMembers(chatId) { return this.request('get-chat-members', { chatId: String(chatId) }); }
  exportChatInviteLink(chatId) { return this.request('export-chat-invite-link', { chatId: String(chatId) }); }
  exportChatInviteLink(chatId, expireSeconds = 0, usageLimit = 0) { return this.request('export-chat-invite-link', { chatId: String(chatId), expireSeconds: Number(expireSeconds) || 0, usageLimit: Number(usageLimit) || 0 }); }
  searchChats(query, limit = 30) { return this.request('search-chats', { query: String(query || ''), limit }); }
  searchGlobalMessages(query, limit = 30) { return this.request('search-global-messages', { query: String(query || ''), limit }); }
  getChatHistory(chatId, limit = 40) { return this.request('history', { chatId: String(chatId), limit }); }
  sendTypingAction(chatId) { return this.request('send-typing-action', { chatId: String(chatId) }); }
  exportChatHistory(chatId, limit = 2000) { return this.request('export-chat-history', { chatId: String(chatId), limit }); }
  searchChatMessages(chatId, query, limit = 50) { return this.request('search-chat-messages', { chatId: String(chatId), query: String(query || ''), limit }); }
  listPinnedMessages(chatId) { return this.request('list-pinned-messages', { chatId: String(chatId) }); }
  getChatHistoryBefore(chatId, offsetId, limit = 50) { return this.request('history-before', { chatId: String(chatId), offsetId: Number(offsetId), limit }); }
  getChatHistoryAround(chatId, messageId) { return this.request('history-around', { chatId: String(chatId), messageId: Number(messageId) }); }
  getChatMessagesOnDate(chatId, startTimestamp, endTimestamp, limit = 100) { return this.request('messages-on-date', { chatId: String(chatId), startTimestamp: Number(startTimestamp), endTimestamp: Number(endTimestamp), limit: Number(limit) }); }
  getUnreadPreview(chatId, limit = 20) { return this.request('preview', { chatId: String(chatId), limit }); }
  sendTextMessage(chatId, text, topicId = null) { return this.request('send-text', { chatId: String(chatId), text: String(text || ''), topicId: topicId == null ? null : String(topicId) }); }
  sendPoll(chatId, question, options, anonymous = true, multipleChoice = false) { return this.request('send-poll', { chatId: String(chatId), question: String(question || ''), options: Array.isArray(options) ? options.map(String) : [], anonymous: !!anonymous, multipleChoice: !!multipleChoice }); }
  votePoll(chatId, messageId, options) { return this.request('vote-poll', { chatId: String(chatId), messageId: String(messageId), options: Array.isArray(options) ? options.map(String) : [] }); }
  searchGifs(query) { return this.request('search-gifs', { query: String(query || '') }); }
  sendGif(chatId, token) { return this.request('send-gif', { chatId: String(chatId), token: String(token || '') }); }
  scheduleMessage(chatId, text, scheduleAt) { return this.request('schedule-message', { chatId: String(chatId), text: String(text || ''), scheduleAt: Number(scheduleAt) }); }
  listScheduledMessages(chatId) { return this.request('list-scheduled-messages', { chatId: String(chatId) }); }
  sendScheduledMessageNow(chatId, messageId) { return this.request('send-scheduled-message-now', { chatId: String(chatId), messageId: String(messageId) }); }
  cancelScheduledMessage(chatId, messageId) { return this.request('cancel-scheduled-message', { chatId: String(chatId), messageId: String(messageId) }); }
  editScheduledMessage(chatId, messageId, text) { return this.request('edit-scheduled-message', { chatId: String(chatId), messageId: String(messageId), text: String(text || '') }); }
  sendVoice(chatId, filePath, caption = '') { return this.request('send-voice', { chatId: String(chatId), filePath: String(filePath || ''), caption: String(caption || '') }); }
  sendMedia(chatId, filePath, caption = '') { return this.request('send-media', { chatId: String(chatId), filePath: String(filePath || ''), caption: String(caption || '') }); }
  sendMediaBatch(chatId, filePaths, caption = '') { return this.request('send-media-batch', { chatId: String(chatId), filePaths: Array.isArray(filePaths) ? filePaths.map(String) : [], caption: String(caption || '') }); }
  replyTextMessage(chatId, messageId, text) { return this.request('reply-text', { chatId: String(chatId), messageId: String(messageId), text: String(text || '') }); }
  editMessage(chatId, messageId, text) { return this.request('edit-message', { chatId: String(chatId), messageId: String(messageId), text: String(text || '') }); }
  deleteMessage(chatId, messageId) { return this.request('delete-message', { chatId: String(chatId), messageId: String(messageId) }); }
  forwardMessage(chatId, messageId, targetChatId, options = {}) { return this.request('forward-message', { chatId: String(chatId), messageId: String(messageId), targetChatId: String(targetChatId), dropAuthor: !!options.dropAuthor, dropMediaCaptions: !!options.dropMediaCaptions }); }
  saveMessage(chatId, messageId) { return this.request('save-message', { chatId: String(chatId), messageId: String(messageId) }); }
  pinMessage(chatId, messageId, pinned = true) { return this.request('pin-message', { chatId: String(chatId), messageId: String(messageId), pinned: !!pinned }); }
  reactMessage(chatId, messageId, emoji) { return this.request('react-message', { chatId: String(chatId), messageId: String(messageId), emoji: String(emoji || '') }); }
  getMessageLink(chatId, messageId) { return this.request('message-link', { chatId: String(chatId), messageId: String(messageId) }); }
  downloadMessageMedia(chatId, messageId) { return this.request('download-message-media', { chatId: String(chatId), messageId: String(messageId) }); }
  setChatMuted(chatId, muted) { return this.request('mute-chat', { chatId: String(chatId), muted: !!muted }); }
  setChatMutedUntil(chatId, seconds) { return this.request('mute-chat-until', { chatId: String(chatId), seconds: Number(seconds) || 0 }); }
  setChatUnread(chatId, unread) { return this.request('set-chat-unread', { chatId: String(chatId), unread: !!unread }); }
  setChatArchived(chatId, archived) { return this.request('set-chat-archived', { chatId: String(chatId), archived: !!archived }); }
  setChatPinned(chatId, pinned) { return this.request('set-chat-pinned', { chatId: String(chatId), pinned: !!pinned }); }
  async close() {
    const child = this.child; this.child = null; this.connected = false; this.connecting = false;
    this.failAll(new Error('TwinPanel بسته شد.'));
    if (child && !child.killed) { try { child.kill(); } catch {} }
  }
}
module.exports = { TelethonService };
