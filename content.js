/**
 * kintone フィールドコード表示 - コンテンツスクリプト
 * ポップアップからのメッセージを受信し、ページにインジェクトしたスクリプトに転送
 */
(function () {
  'use strict';

  const SCRIPT_ID = 'kintone-fieldcode-inject';

  function injectScript() {
    if (document.getElementById(SCRIPT_ID)) return true;
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = chrome.runtime.getURL('inject.js');
    (document.head || document.documentElement).appendChild(script);
    return false;
  }

  function dispatchToggle(show) {
    window.postMessage({ type: 'KINTONE_FIELDCODE_TOGGLE', show }, '*');
  }

  function scheduleToggle(show) {
    const alreadyInjected = injectScript();
    const doDispatch = () => dispatchToggle(show);
    if (alreadyInjected) {
      setTimeout(doDispatch, 150);
      return;
    }
    const onReady = () => {
      document.removeEventListener('kintone-fieldcode-ready', onReady);
      clearTimeout(timeoutId);
      doDispatch();
    };
    document.addEventListener('kintone-fieldcode-ready', onReady, { once: true });
    const timeoutId = setTimeout(() => {
      document.removeEventListener('kintone-fieldcode-ready', onReady);
      doDispatch();
    }, 800);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TOGGLE_FIELDCODES') {
      scheduleToggle(message.show);
      sendResponse({ ok: true });
    } else if (message.type === 'GET_STATE') {
      chrome.storage.local.get(['fieldCodesVisible'], (result) => {
        sendResponse({ visible: !!result.fieldCodesVisible });
      });
    }
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.fieldCodesVisible) {
      scheduleToggle(changes.fieldCodesVisible.newValue);
    }
  });

  chrome.storage.local.get(['fieldCodesVisible'], (result) => {
    if (result.fieldCodesVisible) {
      scheduleToggle(true);
    }
  });
})();
