/**
 * kintone フィールドコード表示 - ページコンテキストで実行されるスクリプト
 * kintone JavaScript API にアクセスするため、ページにインジェクトして実行
 */
(function () {
  'use strict';

  const BADGE_CLASS = 'kintone-fieldcode-badge';
  const BADGE_STYLE_ID = 'kintone-fieldcode-badge-style';

  function addStyles() {
    if (document.getElementById(BADGE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = BADGE_STYLE_ID;
    style.textContent = `
      .${BADGE_CLASS} {
        display: inline-block;
        padding: 2px 6px;
        margin-right: 8px;
        margin-bottom: 4px;
        font-size: 11px;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        background: #FF6B35;
        color: white;
        border-radius: 4px;
        font-weight: 500;
        vertical-align: middle;
        cursor: pointer;
      }
      .${BADGE_CLASS}-hidden {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function createBadge(fieldCode) {
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.textContent = fieldCode;
    badge.dataset.fieldCode = fieldCode;
    badge.title = 'クリックでコピー';
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(fieldCode);
        badge.textContent = 'クリップボードにコピーしました';
        setTimeout(() => { badge.textContent = fieldCode; }, 1500);
      } catch (err) {
        badge.textContent = 'コピーに失敗しました';
        setTimeout(() => { badge.textContent = fieldCode; }, 1500);
      }
    });
    return badge;
  }

  const RECORD_PAGES = ['APP_DETAIL', 'APP_EDIT', 'APP_CREATE', 'APP_PRINT', 'APP_DETAIL_MOBILE', 'APP_EDIT_MOBILE', 'APP_CREATE_MOBILE'];
  const LIST_PAGES = ['APP_INDEX', 'APP_INDEX_MOBILE'];

  function showFieldCodes() {
    addStyles();
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.classList.remove(`${BADGE_CLASS}-hidden`));
    if (badges.length > 0) return;

    if (typeof kintone === 'undefined' || !kintone.getPageType) {
      console.warn('[kintone-fieldcode] kintone API が利用できません');
      return;
    }

    kintone.getPageType().then((result) => {
      const page = result?.page || '';
      try {
        if (RECORD_PAGES.includes(page)) {
          showRecordPageFieldCodes();
        } else if (LIST_PAGES.includes(page)) {
          showListPageFieldCodes();
        }
      } catch (e) {
        console.warn('[kintone-fieldcode] フィールドコードの取得に失敗しました:', e);
      }
    }).catch((e) => {
      console.warn('[kintone-fieldcode] ページタイプの取得に失敗:', e);
    });
  }

  function showRecordPageFieldCodes() {
    try {
      const recordData = kintone.app.record.get();
      if (!recordData || !recordData.record) return;

      const record = recordData.record;
      const getFieldElement = kintone.app.record.getFieldElement?.bind(kintone.app.record) ||
        kintone.mobile?.app?.record?.getFieldElement?.bind(kintone.mobile.app.record);

      if (!getFieldElement) return;

      for (const fieldCode of Object.keys(record)) {
        if (['__REVISION__', '$id', '$revision'].includes(fieldCode)) continue;
        const fieldInfo = record[fieldCode];
        if (!fieldInfo || typeof fieldInfo !== 'object') continue;

        const fieldEl = getFieldElement(fieldCode);
        if (!fieldEl || fieldEl.querySelector(`.${BADGE_CLASS}`)) continue;

        const badge = createBadge(fieldCode);
        fieldEl.style.position = fieldEl.style.position || 'relative';
        fieldEl.insertBefore(badge, fieldEl.firstChild);
      }
    } catch (e) {
      console.warn('[kintone-fieldcode] レコード画面の処理に失敗:', e);
    }
  }

  function showListPageFieldCodes() {
    const getFieldElements = kintone.app.getFieldElements?.bind(kintone.app);
    if (!getFieldElements) return;

    const getView = kintone.app.getView?.bind(kintone.app);
    if (!getView) return;

    getView().then((view) => {
      if (!view || view.type !== 'LIST' || !view.fields || !Array.isArray(view.fields)) return;
      addStyles();

      for (const fieldCode of view.fields) {
        const code = typeof fieldCode === 'string' ? fieldCode : fieldCode?.code;
        if (!code) continue;

        const elements = getFieldElements(code);
        if (!elements || !Array.isArray(elements)) continue;

        elements.forEach((el) => {
          if (el.querySelector(`.${BADGE_CLASS}`)) return;
          const badge = createBadge(code);
          el.style.position = el.style.position || 'relative';
          el.insertBefore(badge, el.firstChild);
        });
      }
    }).catch((e) => {
      console.warn('[kintone-fieldcode] 一覧画面の処理に失敗:', e);
    });
  }

  function hideFieldCodes() {
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.classList.add(`${BADGE_CLASS}-hidden`));
  }

  function removeFieldCodes() {
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.remove());
  }

  function toggle(show) {
    if (show) {
      removeFieldCodes();
      showFieldCodes();
    } else {
      hideFieldCodes();
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'KINTONE_FIELDCODE_TOGGLE') {
      toggle(event.data.show);
    }
  });

  window.__kintoneFieldCodeToggle = toggle;
  document.dispatchEvent(new CustomEvent('kintone-fieldcode-ready'));
})();
