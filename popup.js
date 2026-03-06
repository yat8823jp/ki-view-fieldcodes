(function () {
  'use strict';

  const switchEl = document.getElementById('switch');

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
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_FIELDCODES', show: newState }).catch(() => {
          console.warn('kintone ページでないか、ページの再読み込みが必要です');
        });
      }
    });
  });

  switchEl.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      switchEl.click();
    }
  });
})();
