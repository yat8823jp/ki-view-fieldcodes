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

  function getKintone() {
    const w = typeof window !== 'undefined' ? window : null;
    if (!w) return null;
    if (typeof w.kintone !== 'undefined' && w.kintone) return w.kintone;
    const top = w.top;
    if (top && top !== w && typeof top.kintone !== 'undefined') return top.kintone;
    return null;
  }

  function waitForKintone(maxWaitMs) {
    maxWaitMs = maxWaitMs || 10000;
    const interval = 200;
    return new Promise((resolve) => {
      const check = () => {
        const k = getKintone();
        if (k && k.getPageType) {
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

  function getAppIdFromUrl() {
    const path = window.location.pathname || '';
    const m = path.match(/\/k\/(\d+)(?:\/|$)/);
    if (m) return m[1];
    const hash = window.location.hash || '';
    const m2 = hash.match(/[/#](\d+)(?:\/|$)/);
    if (m2) return m2[1];
    return null;
  }

  function showFieldCodes() {
    addStyles();
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.classList.remove(`${BADGE_CLASS}-hidden`));
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = '';
    if (badges.length > 0) return;

    if (!isAppRecordPage()) return;

    waitForKintone().then(() => {
      const k = getKintone();
      if (!k) return;

      setTimeout(showFieldCodesPanel, 300);

      if (!k.getPageType) return;
      k.getPageType().then((result) => {
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

  function showFieldCodesPanel(retryCount) {
    retryCount = retryCount || 0;
    const k = getKintone();
    if (!k) return;
    const appId = getAppIdFromUrl() || (k.app?.getId?.() ? String(k.app.getId()) : null);
    if (!appId) {
      if (retryCount < 5) setTimeout(() => showFieldCodesPanel(retryCount + 1), 500);
      return;
    }

    const fetchLayout = () => {
      const getFormLayout = k.app?.getFormLayout?.bind(k.app);
      if (getFormLayout) return getFormLayout().catch(() => null);
      return Promise.resolve(null);
    };
    const fetchApi = () => {
      if (!k.api?.url) return Promise.reject(new Error('No API'));
      return k.api(k.api.url('/k/v1/app/form/layout.json', true), 'GET', { app: appId })
        .catch(() => k.api(k.api.url('/k/v1/app/form/fields.json', true), 'GET', { app: appId }));
    };

    fetchLayout()
      .then((r) => (r ? r : fetchApi()))
      .then((resp) => {
        let fieldCodes = [];
        if (resp?.properties) {
          fieldCodes = Object.keys(resp.properties).filter((c) => !/^__/.test(c));
        } else if (resp) {
          const layout = resp?.layout ?? resp;
          const arr = Array.isArray(layout) ? layout : (layout ? [layout] : []);
          fieldCodes = collectFieldCodesFromLayout(arr);
        }
        if (fieldCodes.length > 0) showFieldCodesPanelUI(fieldCodes);
      })
      .catch(() => {
        if (retryCount < 3) setTimeout(() => showFieldCodesPanel(retryCount + 1), 1000);
      });
  }

  const PANEL_ID = 'kintone-fieldcode-fallback-panel';
  const PANEL_TOGGLE_ID = 'kintone-fieldcode-panel-toggle';

  function showFieldCodesPanelUI(fieldCodes) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.style.cssText = 'position:fixed;top:60px;right:16px;max-width:280px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:12px;z-index:2147483647;font-size:12px;';
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
      const title = document.createElement('div');
      title.style.fontWeight = '600';
      title.textContent = 'フィールドコード一覧';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.title = 'パネルを閉じる';
      closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;color:#666;';
      closeBtn.addEventListener('click', () => toggleFieldCodePanel(false));
      header.appendChild(title);
      header.appendChild(closeBtn);
      panel.appendChild(header);
      document.body.appendChild(panel);
    }
    const old = panel.querySelector('.kintone-fieldcode-list');
    if (old) old.remove();
    const list = document.createElement('div');
    list.className = 'kintone-fieldcode-list';
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    fieldCodes.forEach((code) => {
      const badge = createBadge(code);
      badge.style.margin = '0';
      list.appendChild(badge);
    });
    panel.appendChild(list);
    toggleFieldCodePanel(true);
  }

  function toggleFieldCodePanel(show) {
    const panel = document.getElementById(PANEL_ID);
    let toggleBtn = document.getElementById(PANEL_TOGGLE_ID);
    if (show) {
      if (panel) panel.style.display = '';
      if (toggleBtn) toggleBtn.style.display = 'none';
    } else {
      if (panel) panel.style.display = 'none';
      if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.id = PANEL_TOGGLE_ID;
        toggleBtn.textContent = 'フィールドコード';
        toggleBtn.title = 'フィールドコード一覧を表示';
        toggleBtn.style.cssText = 'position:fixed;top:60px;right:16px;padding:6px 12px;font-size:12px;background:#fca000;color:#000;border:none;border-radius:6px;cursor:pointer;z-index:2147483647;box-shadow:0 2px 6px rgba(0,0,0,0.2);';
        toggleBtn.addEventListener('click', () => toggleFieldCodePanel(true));
        document.body.appendChild(toggleBtn);
      }
      toggleBtn.style.display = '';
    }
  }

  function getSubtableFieldCodesFromLayout(layout, tableCode) {
    if (!layout || !Array.isArray(layout)) return [];
    for (const row of layout) {
      if (row.type === 'SUBTABLE' && row.code === tableCode && row.fields) {
        return row.fields.filter((f) => f.code).map((f) => f.code);
      }
      if (row.type === 'GROUP' && row.layout) {
        const found = getSubtableFieldCodesFromLayout(row.layout, tableCode);
        if (found.length) return found;
      }
    }
    return [];
  }

  function resolveTableElement(fieldEl) {
    if (!fieldEl) return null;
    return fieldEl.tagName === 'TABLE' ? fieldEl : fieldEl.querySelector?.('table') || null;
  }

  function applySubtableBadges(tableEl, innerFieldCodes) {
    const table = resolveTableElement(tableEl);
    if (!table) return false;
    const headerRow = table.tHead?.rows?.[0];
    const tbody = table.tBodies?.[0];
    const firstRow = headerRow || tbody?.rows?.[0];
    if (!firstRow || !firstRow.cells || firstRow.cells.length === 0) return false;
    const cellCount = Math.min(firstRow.cells.length, innerFieldCodes.length);
    for (let i = 0; i < cellCount; i++) {
      const cell = firstRow.cells[i];
      if (cell.querySelector(`.${BADGE_CLASS}`)) continue;
      const badge = createBadge(innerFieldCodes[i]);
      cell.style.position = cell.style.position || 'relative';
      cell.insertBefore(badge, cell.firstChild);
    }
    return cellCount > 0;
  }

  function waitForSubtableAndApply(tableEl, innerFieldCodes) {
    const tryApply = () => applySubtableBadges(tableEl, innerFieldCodes);
    if (tryApply()) return;

    const observer = new MutationObserver(() => {
      if (tryApply()) observer.disconnect();
    });

    const table = resolveTableElement(tableEl);
    const target = table?.tBodies?.[0] || tableEl;
    observer.observe(target, { childList: true, subtree: true });

    const poll = setInterval(() => {
      if (tryApply()) {
        clearInterval(poll);
        observer.disconnect();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(poll);
      observer.disconnect();
    }, 8000);
  }

  function showRecordPageFieldCodes() {
    try {
      const recordData = kintone.app.record.get();
      if (!recordData || !recordData.record) return;

      const record = recordData.record;
      const getFieldElement = kintone.app.record.getFieldElement?.bind(kintone.app.record) ||
        kintone.mobile?.app?.record?.getFieldElement?.bind(kintone.mobile.app.record);

      if (!getFieldElement) return;

      const getFormLayout = kintone.app.getFormLayout?.bind(kintone.app);
      let layoutData = null;
      if (getFormLayout) {
        getFormLayout().then((layout) => {
          layoutData = layout?.layout ?? layout;
          showRecordPageFieldCodesCore(record, getFieldElement, layoutData);
        }).catch(() => {
          showRecordPageFieldCodesCore(record, getFieldElement, null);
        });
      } else {
        showRecordPageFieldCodesCore(record, getFieldElement, null);
      }
    } catch (e) {
      console.warn('[kintone-fieldcode] レコード画面の処理に失敗:', e);
    }
  }

  function showRecordPageFieldCodesCore(record, getFieldElement, layoutData) {
    const layout = Array.isArray(layoutData) ? layoutData : (layoutData ? [layoutData] : []);

    for (const fieldCode of Object.keys(record)) {
      if (['__REVISION__', '$id', '$revision'].includes(fieldCode)) continue;
      const fieldInfo = record[fieldCode];
      if (!fieldInfo || typeof fieldInfo !== 'object') continue;

      if (fieldInfo.type === 'SUBTABLE') {
        const tableEl = getFieldElement(fieldCode);
        if (!tableEl || tableEl.querySelector(`.${BADGE_CLASS}`)) continue;

        const rows = fieldInfo.value || [];
        const firstRowData = rows[0];
        const fromLayout = getSubtableFieldCodesFromLayout(layout, fieldCode);
        const innerFieldCodes = fromLayout.length > 0
          ? fromLayout
          : (firstRowData?.value ? Object.keys(firstRowData.value) : []);
        if (innerFieldCodes.length === 0) continue;

        waitForSubtableAndApply(tableEl, innerFieldCodes);
        continue;
      }

      const fieldEl = getFieldElement(fieldCode);
      if (!fieldEl || fieldEl.querySelector(`.${BADGE_CLASS}`)) continue;

      const badge = createBadge(fieldCode);
      fieldEl.style.position = fieldEl.style.position || 'relative';
      fieldEl.insertBefore(badge, fieldEl.firstChild);
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
      const layoutArr = Array.isArray(layoutData) ? layoutData : [layoutData];
      const fieldCodes = collectFieldCodesFromLayout(layoutArr);
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
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = 'none';
    const toggleBtn = document.getElementById(PANEL_TOGGLE_ID);
    if (toggleBtn) toggleBtn.style.display = 'none';
  }

  function removeFieldCodes() {
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.remove());
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    const toggleBtn = document.getElementById(PANEL_TOGGLE_ID);
    if (toggleBtn) toggleBtn.remove();
  }

  function toggle(show) {
    window.__kintoneFieldCodeVisible = show;
    if (show) {
      removeFieldCodes();
      showFieldCodes();
    } else {
      hideFieldCodes();
    }
  }

  function onPageChange() {
    if (window.__kintoneFieldCodeVisible) {
      removeFieldCodes();
      setTimeout(showFieldCodes, 150);
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

  waitForKintone().then(() => {
    const k = getKintone();
    if (!k || !k.events || !k.events.on) return;
    const navEvents = [
      'app.record.detail.show',
      'app.record.edit.show',
      'app.record.create.show',
      'app.record.index.show',
      'app.record.print.show'
    ];
    navEvents.forEach((ev) => {
      k.events.on(ev, (e) => {
        onPageChange();
        return e;
      });
    });
  });
})();
