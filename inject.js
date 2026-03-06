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
  background: #fca000;
  color: black;
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

  const RECORD_DETAIL_PAGES = ['APP_DETAIL', 'APP_PRINT', 'APP_DETAIL_MOBILE'];
  const RECORD_EDIT_PAGES = ['APP_EDIT', 'APP_CREATE', 'APP_EDIT_MOBILE', 'APP_CREATE_MOBILE'];
  const LIST_PAGES = ['APP_INDEX', 'APP_INDEX_MOBILE'];

  const EDIT_FIELD_SELECTORS = [
    'input.input-text-cybozu',
    'textarea',
    '.select-cybozu',
    '.gaia-argoui-select',
    '.userselect-cybozu',
    '.control-value-gaia',
    '.gaia-argoui-app-property'
  ].join(',');

  const STYLE_MARKER_BG = 'rgb(255, 241, 194)';
  const STYLE_MARKER_BD = 'rgb(255, 143, 0)';

  function collectFieldCodesFromLayout(layout) {
    const codes = [];
    if (!layout || !Array.isArray(layout)) return codes;
    for (const row of layout) {
      if (row.type === 'ROW' && row.fields) {
        for (const f of row.fields) {
          if (f.code && f.type !== 'SPACER' && f.type !== 'HR' && f.type !== 'LABEL') {
            codes.push(f.code);
          }
        }
      } else if (row.type === 'GROUP' && row.layout) {
        codes.push(...collectFieldCodesFromLayout(row.layout));
      } else if (row.type === 'SUBTABLE' && row.fields) {
        for (const f of row.fields) {
          if (f.code) codes.push(f.code);
        }
      }
    }
    return codes;
  }

  function getEditFormFieldContainers() {
    const form = document.querySelector('.record-edit-gaia, .record-create-gaia, .gaia-argoui-app-property-list, [class*="record-edit"], [class*="record-create"]') ||
      document.querySelector('.gaia-argoui-app') ||
      document.body;
    const containers = [];
    const seen = new Set();
    const walk = (el) => {
      if (!el || seen.has(el)) return;
      if (el.classList?.contains('control-gaia')) {
        const hasInput = el.querySelector('.control-value-gaia, input:not([type="hidden"]), textarea, .select-cybozu, .gaia-argoui-select, .userselect-cybozu, .gaia-argoui-app-property');
        if (hasInput && !el.querySelector(`.${BADGE_CLASS}`)) {
          containers.push(el);
          seen.add(el);
          return;
        }
      }
      for (const child of el.children || []) {
        walk(child);
      }
    };
    walk(form);
    return containers;
  }

  function waitForKintone(maxWaitMs) {
    maxWaitMs = maxWaitMs || 10000;
    const interval = 200;
    return new Promise((resolve) => {
      const check = () => {
        if (typeof kintone !== 'undefined' && kintone.getPageType) {
          resolve();
          return;
        }
        maxWaitMs -= interval;
        if (maxWaitMs <= 0) {
          resolve();
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  function isAppRecordPage() {
    const path = window.location.pathname || '';
    return /\/k\/\d+(\/|$)/.test(path) && !/\/admin\//.test(path);
  }

  function showFieldCodes() {
    addStyles();
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.classList.remove(`${BADGE_CLASS}-hidden`));
    if (badges.length > 0) return;
    if (!isAppRecordPage()) return;

    waitForKintone().then(() => {
      if (typeof kintone === 'undefined' || !kintone.getPageType) {
        return;
      }

      kintone.getPageType().then((result) => {
      const page = result?.page || '';
      try {
        if (RECORD_DETAIL_PAGES.includes(page)) {
          showRecordPageFieldCodes();
        } else if (RECORD_EDIT_PAGES.includes(page)) {
          showEditPageFieldCodes();
        } else if (LIST_PAGES.includes(page)) {
          showListPageFieldCodes();
        }
      } catch (e) {
        console.warn('[kintone-fieldcode] フィールドコードの取得に失敗しました:', e);
      }
    }).catch((e) => {
      console.warn('[kintone-fieldcode] ページタイプの取得に失敗:', e);
    });
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

  function findStyledFieldContainer() {
    const candidates = document.querySelectorAll(EDIT_FIELD_SELECTORS);
    for (const el of candidates) {
      const cs = getComputedStyle(el);
      const bgMatch = cs.backgroundColor === STYLE_MARKER_BG;
      const bdMatch = cs.borderColor === STYLE_MARKER_BD ||
        cs.borderTopColor === STYLE_MARKER_BD ||
        cs.borderRightColor === STYLE_MARKER_BD ||
        cs.borderBottomColor === STYLE_MARKER_BD ||
        cs.borderLeftColor === STYLE_MARKER_BD;
      if (bgMatch && bdMatch) {
        const container = el.closest('.control-gaia');
        if (container && !container.querySelector(`.${BADGE_CLASS}`)) {
          return container;
        }
      }
    }
    return null;
  }

  function showEditPageFieldCodesByLayout() {
    const getFormLayout = kintone.app.getFormLayout?.bind(kintone.app);
    if (!getFormLayout) return Promise.resolve(0);

    return getFormLayout().then((layout) => {
      const layoutData = layout?.layout ?? layout;
      const fieldCodes = collectFieldCodesFromLayout(Array.isArray(layoutData) ? layoutData : [layoutData]);
      const containers = getEditFormFieldContainers();
      const minLen = Math.min(fieldCodes.length, containers.length);
      for (let i = 0; i < minLen; i++) {
        const badge = createBadge(fieldCodes[i]);
        const container = containers[i];
        container.style.position = container.style.position || 'relative';
        container.insertBefore(badge, container.firstChild);
      }
      return minLen;
    }).catch((e) => {
      console.warn('[kintone-fieldcode] getFormLayout の取得に失敗:', e);
      return 0;
    });
  }

  async function showEditPageFieldCodesBySetStyle() {
    const setFieldStyle = kintone.app.record.setFieldStyle?.bind(kintone.app.record) ||
      kintone.mobile?.app?.record?.setFieldStyle?.bind(kintone.mobile.app.record);
    if (!setFieldStyle) return false;

    try {
      const recordData = kintone.app.record.get();
      if (!recordData || !recordData.record) return false;

      const record = recordData.record;
      const fieldCodes = Object.keys(record).filter(
        (code) => !['__REVISION__', '$id', '$revision'].includes(code)
      );

      const styleConfig = {
        content: {
          backgroundColor: '#fff1c2',
          borderColor: '#ff8f00'
        }
      };

      let addedCount = 0;
      for (const fieldCode of fieldCodes) {
        const fieldInfo = record[fieldCode];
        if (!fieldInfo || typeof fieldInfo !== 'object') continue;

        try {
          await setFieldStyle(fieldCode, styleConfig);
          await new Promise((r) => setTimeout(r, 0));
          const container = findStyledFieldContainer();
          if (container) {
            const badge = createBadge(fieldCode);
            container.style.position = container.style.position || 'relative';
            container.insertBefore(badge, container.firstChild);
            addedCount++;
          }
        } catch (err) {
          // ステータス・担当者など setFieldStyle 非対応フィールドはスキップ
        } finally {
          try {
            await setFieldStyle(fieldCode, 'DEFAULT');
          } catch (clearErr) {
            // クリア失敗は無視
          }
        }
      }
      return addedCount > 0;
    } catch (e) {
      return false;
    }
  }

  function showEditPageFieldCodes() {
    const tryShow = (retryCount) => {
      const layoutPromise = showEditPageFieldCodesByLayout();
      (layoutPromise && layoutPromise.then ? layoutPromise : Promise.resolve(0))
        .then((layoutCount) => {
          if (layoutCount > 0) return;
          return showEditPageFieldCodesBySetStyle();
        })
        .then((setStyleSuccess) => {
          if (setStyleSuccess) return;
          const badgeCount = document.querySelectorAll(`.${BADGE_CLASS}`).length;
          if (badgeCount > 0) return;
          if (retryCount < 3) {
            setTimeout(() => tryShow(retryCount + 1), 500 * (retryCount + 1));
          }
        })
        .catch((e) => {
          console.warn('[kintone-fieldcode] 編集画面の処理に失敗:', e);
          if (retryCount < 3) {
            setTimeout(() => tryShow(retryCount + 1), 500 * (retryCount + 1));
          }
        });
    };
    tryShow(0);
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
