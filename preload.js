const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('twinPanel', {
  openNativeTelegram: () => ipcRenderer.invoke('twinpanel:open-native-telegram'),
  getNativeTelegramViewConfig: () => ipcRenderer.invoke('twinpanel:open-native-telegram'),
  telegramNative: {
    status: () => ipcRenderer.invoke('telegram-native:status'),
    credentialsStatus: () => ipcRenderer.invoke('telegram-native:credentials-status'),
    connect: credentials => ipcRenderer.invoke('telegram-native:connect', credentials),
    cancelConnect: () => ipcRenderer.invoke('telegram-native:cancel-connect'),
    diagnostics: () => ipcRenderer.invoke('telegram-native:diagnostics'),
    qrDataUrl: link => ipcRenderer.invoke('telegram-native:qr-data-url', link),
    qrImageStatus: state => ipcRenderer.invoke('telegram-native:qr-image-status', state),
    submitAuthInput: (type, value) => ipcRenderer.invoke('telegram-native:auth-input', { type, value }),
    listChats: limit => ipcRenderer.invoke('telegram-native:list-chats', limit),
    listContacts: () => ipcRenderer.invoke('telegram-native:list-contacts'),
    addContact: (phone, firstName, lastName) => ipcRenderer.invoke('telegram-native:add-contact', phone, firstName, lastName),
    deleteContact: chatId => ipcRenderer.invoke('telegram-native:delete-contact', chatId),
    listDialogFolders: () => ipcRenderer.invoke('telegram-native:list-dialog-folders'),
    getProfile: () => ipcRenderer.invoke('telegram-native:profile'),
    getAuthorizations: () => ipcRenderer.invoke('telegram-native:list-authorizations'),
    resetAuthorization: hash => ipcRenderer.invoke('telegram-native:reset-authorization', hash),
    getPrivacySettings: () => ipcRenderer.invoke('telegram-native:get-privacy-settings'),
    setPrivacySetting: (name, choice) => ipcRenderer.invoke('telegram-native:set-privacy-setting', name, choice),
    getChatInfo: chatId => ipcRenderer.invoke('telegram-native:get-chat-info', chatId),
    getChatMembers: chatId => ipcRenderer.invoke('telegram-native:get-chat-members', chatId),
    exportChatInviteLink: chatId => ipcRenderer.invoke('telegram-native:export-chat-invite-link', chatId),
    exportChatInviteLink: (chatId, expireSeconds, usageLimit) => ipcRenderer.invoke('telegram-native:export-chat-invite-link', chatId, expireSeconds, usageLimit),
    searchChats: query => ipcRenderer.invoke('telegram-native:search-chats', query),
    searchGlobalMessages: (query, limit) => ipcRenderer.invoke('telegram-native:search-global-messages', query, limit),
    history: (chatId, limit) => ipcRenderer.invoke('telegram-native:history', chatId, limit),
    sendTypingAction: chatId => ipcRenderer.invoke('telegram-native:typing-action', chatId),
    exportChatHistory: (chatId, title) => ipcRenderer.invoke('telegram-native:export-chat-history', chatId, title),
    searchChatMessages: (chatId, query, limit) => ipcRenderer.invoke('telegram-native:search-chat-messages', chatId, query, limit),
    listPinnedMessages: chatId => ipcRenderer.invoke('telegram-native:list-pinned-messages', chatId),
    historyBefore: (chatId, offsetId, limit) => ipcRenderer.invoke('telegram-native:history-before', chatId, offsetId, limit),
    historyAround: (chatId, messageId) => ipcRenderer.invoke('telegram-native:history-around', chatId, messageId),
    messagesOnDate: (chatId, startTimestamp, endTimestamp, limit) => ipcRenderer.invoke('telegram-native:messages-on-date', chatId, startTimestamp, endTimestamp, limit),
    preview: (chatId, limit) => ipcRenderer.invoke('telegram-native:preview', chatId, limit),
    sendText: (chatId, body) => ipcRenderer.invoke('telegram-native:send-text', chatId, body),
    sendPoll: (chatId, question, options, anonymous, multipleChoice) => ipcRenderer.invoke('telegram-native:send-poll', chatId, question, options, anonymous, multipleChoice),
    searchGifs: query => ipcRenderer.invoke('telegram-native:search-gifs', query),
    sendGif: (chatId, token) => ipcRenderer.invoke('telegram-native:send-gif', chatId, token),
    scheduleMessage: (chatId, body, scheduleAt) => ipcRenderer.invoke('telegram-native:schedule-message', chatId, body, scheduleAt),
    listScheduledMessages: chatId => ipcRenderer.invoke('telegram-native:list-scheduled-messages', chatId),
    cancelScheduledMessage: (chatId, messageId) => ipcRenderer.invoke('telegram-native:cancel-scheduled-message', chatId, messageId),
    editScheduledMessage: (chatId, messageId, text) => ipcRenderer.invoke('telegram-native:edit-scheduled-message', chatId, messageId, text),
    replyText: (chatId, messageId, body) => ipcRenderer.invoke('telegram-native:reply-text', chatId, messageId, body),
    editMessage: (chatId, messageId, body) => ipcRenderer.invoke('telegram-native:edit-message', chatId, messageId, body),
    deleteMessage: (chatId, messageId) => ipcRenderer.invoke('telegram-native:delete-message', chatId, messageId),
    forwardMessage: (chatId, messageId, targetChatId) => ipcRenderer.invoke('telegram-native:forward-message', chatId, messageId, targetChatId),
    saveMessage: (chatId, messageId) => ipcRenderer.invoke('telegram-native:save-message', chatId, messageId),
    pinMessage: (chatId, messageId, pinned) => ipcRenderer.invoke('telegram-native:pin-message', chatId, messageId, pinned),
    reactMessage: (chatId, messageId, emoji) => ipcRenderer.invoke('telegram-native:react-message', chatId, messageId, emoji),
    getMessageLink: (chatId, messageId) => ipcRenderer.invoke('telegram-native:message-link', chatId, messageId),
    downloadMessageMedia: (chatId, messageId) => ipcRenderer.invoke('telegram-native:download-message-media', chatId, messageId),
    selectMedia: () => ipcRenderer.invoke('telegram-native:select-media'),
    sendMedia: (chatId, filePath, caption) => ipcRenderer.invoke('telegram-native:send-media', chatId, filePath, caption),
    sendMediaBatch: (chatId, filePaths, caption) => ipcRenderer.invoke('telegram-native:send-media-batch', chatId, filePaths, caption),
    muteChat: (chatId, muted) => ipcRenderer.invoke('telegram-native:mute-chat', chatId, muted),
    muteChatUntil: (chatId, seconds) => ipcRenderer.invoke('telegram-native:mute-chat-until', chatId, seconds),
    setChatUnread: (chatId, unread) => ipcRenderer.invoke('telegram-native:set-chat-unread', chatId, unread),
    setChatArchived: (chatId, archived) => ipcRenderer.invoke('telegram-native:set-chat-archived', chatId, archived),
    setChatPinned: (chatId, pinned) => ipcRenderer.invoke('telegram-native:set-chat-pinned', chatId, pinned),
    onAuthPrompt: callback => {
      let lastId = 0;
      const forward = packet => {
        if (!packet) return;
        const id = Number(packet.id) || 0;
        if (id && id <= lastId) {
          void ipcRenderer.invoke('telegram-native:ack-auth-prompt', id).catch(() => {});
          return;
        }
        if (id) lastId = id;
        callback(packet.prompt || packet);
        if (id) void ipcRenderer.invoke('telegram-native:ack-auth-prompt', id).catch(() => {});
      };
      ipcRenderer.on('telegram-native:auth-prompt', (_event, packet) => forward(packet));
      void ipcRenderer.invoke('telegram-native:take-auth-prompt').then(forward).catch(() => {});
    },
    onStatus: callback => ipcRenderer.on('telegram-native:status-update', (_event, value) => callback(value)),
    onUpdate: callback => ipcRenderer.on('telegram-native:live-update', (_event, value) => callback(value)),
    onUploadProgress: callback => ipcRenderer.on('telegram-native:upload-progress', (_event, value) => callback(value)),
  },
  toggleFullscreen: () => ipcRenderer.invoke('twinpanel:toggle-fullscreen'),
  getVersion: () => ipcRenderer.invoke('twinpanel:app-version'),
  checkForUpdates: () => ipcRenderer.invoke('twinpanel:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('twinpanel:download-update'),
  installUpdate: () => ipcRenderer.invoke('twinpanel:install-update'),
  onFullscreenChanged: (callback) => ipcRenderer.on('twinpanel:fullscreen-changed', (_event, value) => callback(value)),
  onCommand: (callback) => ipcRenderer.on('twinpanel:command', (_event, command) => callback(command)),
  onUpdateStatus: (callback) => ipcRenderer.on('twinpanel:update-status', (_event, status) => callback(status)),
  onMediaState: (callback) => ipcRenderer.on('twinpanel:media-state', (_event, state) => callback(state)),
  onGptAudioState: (callback) => ipcRenderer.on('twinpanel:gpt-audio-state', (_event, audible) => callback(audible))
});
