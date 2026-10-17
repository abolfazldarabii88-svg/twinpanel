'use strict';

const fs = require('node:fs');
const path = require('node:path');

const apiIdText = String(process.env.TWINPANEL_TELEGRAM_API_ID || '').trim();
const apiHash = String(process.env.TWINPANEL_TELEGRAM_API_HASH || '').trim();

if (!/^\d+$/.test(apiIdText) || !/^[a-f0-9]{32}$/i.test(apiHash)) {
  console.error(
    'TwinPanel Telegram credentials are not configured. Add the repository Actions secrets ' +
    'TWINPANEL_TELEGRAM_API_ID and TWINPANEL_TELEGRAM_API_HASH; their values are never printed.'
  );
  process.exit(1);
}

const credentials = {
  apiId: Number(apiIdText),
  apiHash
};
if (!Number.isSafeInteger(credentials.apiId) || credentials.apiId <= 0) {
  console.error('TWINPANEL_TELEGRAM_API_ID must be a positive integer.');
  process.exit(1);
}

const target = path.join(__dirname, '..', 'telegram-native', 'app-credentials.json');
fs.writeFileSync(target, JSON.stringify(credentials) + '\n', { encoding: 'utf8', mode: 0o600 });
console.log('TwinPanel Telegram app credentials validated and staged for packaging (values redacted).');
