(function () {
  'use strict';

  const switchEl = document.getElementById('switch');

  /** manifest の host_permissions と整合（このページではコンテンツスクリプトが載らない） */
  function tabMayHaveFieldcodeContentScript(url) {
    if (!url || !/^https:/i.test(url)) return false;
    try {
      const { hostname } = new URL(url);
      return (
        hostname.endsWith('.cybozu.com') ||
        hostname.endsWith('.cybozu.biz') ||
        hostname.endsWith('.kintone.com') ||
        hostname.endsWith('.s.cybozu.com')
      );
    } catch {
      return false;
    }
  }

  function updateUI(visible) {
    switchEl.classList.toggle('on', visible);
    switchEl.setAttribute('aria-checked', String(visible));
  }

  chrome.storage.local.get(['fieldCodesVisible'], (result) => {
    const visible = !!result.fieldCodesVisible;
    updateUI(visible);
  });

  switchEl.addEventListener('click', () => {
    const isOn = switchEl.classList.contains('on');
    const newState = !isOn;
    updateUI(newState);
    chrome.storage.local.set({ fieldCodesVisible: newState });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = tab?.url || tab?.pendingUrl || '';
      if (!tab?.id || !tabMayHaveFieldcodeContentScript(url)) return;
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FIELDCODES', show: newState }).catch(() => {
        /* 受信側なし（拡張更新直後の未再読み込みタブなど）は想定内。console しない（Chrome が拡張エラー扱いするため） */
      });
    });
  });

  switchEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      switchEl.click();
    }
  });
})();
