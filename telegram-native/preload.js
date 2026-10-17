'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function isNativeTelegramDocument() {
  try {
    const url = new URL(location.href);
    return url.protocol === 'file:' &&
      /\\/telegram-native\\/index\\.html$/i.test(decodeURIComponent(url.pathname).replace(/\\\\/g, '/'));
  } catch {
    return false;
  }
}

// This preload is attached to the Telegram webview for its lifetime. Do not expose
// privileged APIs while the webview is displaying the remote Telegram Web origin.
if (isNativeTelegramDocument()) {
  contextBridge.exposeInMainWorld('twinPanel', {
    telegramNative: {
      status: () => ipcRenderer.invoke('telegram-native:status'),
      connect: () => ipcRenderer.invoke('telegram-native:connect'),
      cancelConnect: () => ipcRenderer.invoke('telegram-native:cancel-connect'),
      diagnostics: () => ipcRenderer.invoke('telegram-native:diagnostics'),
      qrDataUrl: link => ipcRenderer.invoke('telegram-native:qr-data-url', link),
      qrImageStatus: state => ipcRenderer.invoke('telegram-native:qr-image-status', state),
      submitAuthInput: (type, value) => ipcRenderer.invoke('telegram-native:auth-input', { type, value }),
      listChats: limit => ipcRenderer.invoke('telegram-native:list-chats', limit),
      searchChats: query => ipcRenderer.invoke('telegram-native:search-chats', query),
      history: (chatId, limit) => ipcRenderer.invoke('telegram-native:history', chatId, limit),
      preview: (chatId, limit) => ipcRenderer.invoke('telegram-native:preview', chatId, limit),
      sendText: (chatId, body) => ipcRenderer.invoke('telegram-native:send-text', chatId, body),
      selectMedia: () => ipcRenderer.invoke('telegram-native:select-media'),
      sendMedia: (chatId, filePath, caption) => ipcRenderer.invoke('telegram-native:send-media', chatId, filePath, caption),
      muteChat: (chatId, muted) => ipcRenderer.invoke('telegram-native:mute-chat', chatId, muted),
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
      onStatus: callback => ipcRenderer.on('telegram-native:status-update', (_event, value) => callback(value))
    }
  });
}
