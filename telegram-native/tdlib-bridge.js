'use strict';

/**
 * Contract for the future main-process TDLib bridge.
 *
 * Intentionally does not fake Telegram data or load arbitrary native libraries.
 * A real implementation must be backed by a pinned, verified TDLib JSON/native
 * interface build and tests before this module is replaced with a working client.
 */
const REQUIRED_METHODS = Object.freeze([
  'getAuthorizationState',
  'startPhoneAuthorization',
  'submitLoginCode',
  'submitPassword',
  'listChats',
  'searchChats',
  'getChatHistory',
  'sendTextMessage',
  'sendMedia',
  'downloadFile',
  'setChatMuted',
  'setStudyCategory',
  'getUnreadPreview'
]);

function createUnavailableTdlibBridge() {
  const unavailable = method => async () => {
    const error = new Error(
      'TDLib is not installed or connected. The native Telegram screen is a UI prototype; Telegram Web remains available.'
    );
    error.code = 'TDLIB_NOT_CONFIGURED';
    error.method = method;
    throw error;
  };

  const bridge = {};
  for (const method of REQUIRED_METHODS) bridge[method] = unavailable(method);
  bridge.getStatus = async () => ({
    connected: false,
    engine: 'TDLib',
    stage: 'prototype',
    message: 'موتور اصلی تلگرام هنوز نصب و متصل نشده است.'
  });
  return Object.freeze(bridge);
}

module.exports = { REQUIRED_METHODS, createUnavailableTdlibBridge };
