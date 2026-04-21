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
.${BADGE_CLASS}-disabled {
  background: #c7c7c7;
  color: #555;
  cursor: default;
}
.${BADGE_CLASS}-in-field {
  position: static;
  margin: 0 0 0 6px;
  vertical-align: baseline;
}
.${BADGE_CLASS}-floating {
  position: absolute;
  top: 2px;
  right: 2px;
  margin: 0;
  z-index: 30;
}
.${BADGE_CLASS}-hidden {
  display: none !important;
}
`;
    document.head.appendChild(style);
  }

  function createBadge(fieldCode, options) {
    const canCopy = options?.canCopy !== false;
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.textContent = fieldCode;
    badge.dataset.fieldCode = fieldCode;
    badge.title = canCopy ? 'クリックでコピー' : 'この画面ではコピーできません';
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    badge.setAttribute('draggable', 'false');
    badge.addEventListener('pointerdown', swallow);
    badge.addEventListener('mousedown', swallow);
    badge.addEventListener('dragstart', swallow);
    if (!canCopy) {
      badge.classList.add(`${BADGE_CLASS}-disabled`);
      return badge;
    }
    badge.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
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
        /* グループはレコードにキーが無いが、レイアウト上はフィールドコードを持つ */
        if (row.code) codes.push(row.code);
        codes.push(...collectFieldCodesFromLayout(row.layout));
      } else if (row.type === 'SUBTABLE' && row.fields) {
        if (row.code) codes.push(row.code);
        for (const f of row.fields) {
          if (f.code) codes.push(f.code);
        }
      }
    }
    return codes;
  }

  /** グループ内などネストしたレコードからフィールドコードを列挙（setFieldStyle フォールバック用） */
  function flattenRecordFieldCodes(record) {
    const codes = [];
    if (!record || typeof record !== 'object') return codes;
    for (const key of Object.keys(record)) {
      if (['__REVISION__', '$id', '$revision'].includes(key)) continue;
      const fi = record[key];
      if (!fi || typeof fi !== 'object') continue;
      const t = fi.type;
      if (t === 'GROUP') {
        codes.push(key);
        if (fi.value && typeof fi.value === 'object') {
          codes.push(...flattenRecordFieldCodes(fi.value));
        }
      } else if (t === 'SUBTABLE') {
        codes.push(key);
        const rows = fi.value || [];
        const first = rows[0];
        if (first?.value && typeof first.value === 'object') {
          codes.push(...Object.keys(first.value));
        }
      } else {
        codes.push(key);
      }
    }
    return codes;
  }

  function layoutDefinesSubtableCode(layoutArr, tableCode) {
    return getSubtableFieldCodesFromLayout(layoutArr || [], tableCode).length > 0;
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
        /* 管理画面のフォーム設定など getPageType が無くても k.api で利用可能 */
        if (k && (k.getPageType || (k.api && k.api.url))) {
          resolve();
          return;
        }
        /**
         * アプリ設定のフォーム設計ではページ末尾で `delete kintone` され、
         * kintone JS API が存在しない。代わりに cybozu.data.page に FORM_DATA が載る。
         */
        if (
          isAppFieldSettingsPage() &&
          typeof cybozu !== 'undefined' &&
          cybozu.data &&
          cybozu.data.page &&
          (cybozu.data.page.FORM_DATA || cybozu.data.page.CANVAS_DATA)
        ) {
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

  /** 管理画面で kintone が削除されていてもアプリ ID を取得 */
  function getAppIdFromCybozuPage() {
    try {
      const p = typeof cybozu !== 'undefined' && cybozu.data && cybozu.data.page;
      if (!p) return null;
      const id = p.APP_ID != null ? String(p.APP_ID) : p['APP_ID'] != null ? String(p['APP_ID']) : null;
      return id || null;
    } catch (e) {
      return null;
    }
  }

  function getRequestToken() {
    try {
      if (typeof cybozu !== 'undefined' && cybozu.data && cybozu.data.REQUEST_TOKEN) {
        return String(cybozu.data.REQUEST_TOKEN);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /** 同一オリジンで k/v1 GET（セッション Cookie）。CSRF はヘッダで付与 */
  function fetchKintoneV1Json(path, query) {
    const base = '/k/v1/';
    const qs = new URLSearchParams(query || {});
    const url = `${base}${path.replace(/^\//, '')}?${qs.toString()}`;
    const headers = {
      'X-Requested-With': 'XMLHttpRequest'
    };
    const token = getRequestToken();
    if (token) headers['X-Cybozu-CSRF-TOKEN'] = token;
    return fetch(url, { credentials: 'include', headers })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
  }

  /**
   * cybozu.data.page.FORM_DATA.schema.table.fieldList から REST の properties 相当を生成
   * キーはフィールドコード（var）
   */
  function buildPropertiesFromCybozuFieldList() {
    try {
      const fd =
        typeof cybozu !== 'undefined' &&
        cybozu.data &&
        cybozu.data.page &&
        cybozu.data.page.FORM_DATA;
      const fl = fd && fd.schema && fd.schema.table && fd.schema.table.fieldList;
      if (!fl || typeof fl !== 'object') return null;
      const properties = {};
      for (const id of Object.keys(fl)) {
        const entry = fl[id];
        if (!entry || typeof entry !== 'object') continue;
        const code = entry.var;
        if (!code || /^__/.test(code)) continue;
        properties[code] = {
          code,
          type: entry.type,
          label: entry.label,
          ...entry
        };
      }
      return Object.keys(properties).length ? { properties } : null;
    } catch (e) {
      return null;
    }
  }

  /** ローカル ID（数値文字列）→ フィールドコード */
  function buildLocalIdToFieldCodeMap() {
    const map = Object.create(null);
    try {
      const fd =
        typeof cybozu !== 'undefined' &&
        cybozu.data &&
        cybozu.data.page &&
        cybozu.data.page.FORM_DATA;
      const fl = fd && fd.schema && fd.schema.table && fd.schema.table.fieldList;
      if (!fl || typeof fl !== 'object') return map;
      for (const id of Object.keys(fl)) {
        const entry = fl[id];
        const code = entry && entry.var;
        if (code && !/^__/.test(code)) map[String(id)] = code;
      }
    } catch (e) { /* ignore */ }
    return map;
  }

  function parseFormDesignerLayoutJson(raw) {
    if (raw == null) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : p ? [p] : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  /** フォーム設計のキャンバス形式（controlList / canvasData）からフィールドコードを列挙 */
  function collectFieldCodesFromFormDesignerCanvas(layout) {
    const codes = [];
    const seen = Object.create(null);
    function add(code) {
      if (!code || /^__/.test(code) || seen[code]) return;
      seen[code] = true;
      codes.push(code);
    }
    function walkControlList(controlList) {
      if (!controlList || !Array.isArray(controlList)) return;
      for (const c of controlList) {
        if (!c || typeof c !== 'object') continue;
        if (c.type === 'GROUP' && c.canvasData) {
          walkRows(c.canvasData);
          if (c.var) add(c.var);
          continue;
        }
        if (c.type === 'SUBTABLE' && c.fields) {
          if (c.var) add(c.var);
          for (const f of c.fields) {
            if (f && f.code) add(f.code);
          }
          continue;
        }
        if (c.var && c.type && c.type !== 'LABEL' && c.type !== 'HR' && c.type !== 'SPACER') {
          add(c.var);
        }
      }
    }
    function walkRows(rows) {
      if (!rows || !Array.isArray(rows)) return;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (row.controlList) walkControlList(row.controlList);
        if (row.canvasData) walkRows(row.canvasData);
      }
    }
    walkRows(Array.isArray(layout) ? layout : layout ? [layout] : []);
    return codes;
  }

  function layoutLooksLikeFormDesignerCanvas(layoutArr) {
    if (!layoutArr || !layoutArr[0]) return false;
    const r = layoutArr[0];
    return !!(r.controlList || r.canvasData);
  }

  function collectFieldCodesFromAnyLayout(layoutArr) {
    if (!layoutArr || layoutArr.length === 0) return [];
    if (layoutLooksLikeFormDesignerCanvas(layoutArr)) {
      return collectFieldCodesFromFormDesignerCanvas(layoutArr);
    }
    return collectFieldCodesFromLayout(layoutArr);
  }

  function getLayoutFromCybozuPage() {
    try {
      const p = typeof cybozu !== 'undefined' && cybozu.data && cybozu.data.page;
      if (!p) return [];
      const raw = p.FORM_DATA && p.FORM_DATA.layout != null ? p.FORM_DATA.layout : p.CANVAS_DATA && p.CANVAS_DATA.layout;
      return parseFormDesignerLayoutJson(raw);
    } catch (e) {
      return [];
    }
  }

  /**
   * キャンバス形式レイアウトから「このフィールドコードはどのグループ（フィールドコード）の内側か」を求める。
   * フォーム設計 DOM はグループ外の先勝ちマップに誤マッチしやすいため、子フィールドは親サブツリー内で解決する。
   */
  function buildFieldCodeParentGroupMapFromCanvas(layoutArr) {
    const map = Object.create(null);
    function walkControlList(controlList, parentGroupVar) {
      if (!controlList || !Array.isArray(controlList)) return;
      for (let i = 0; i < controlList.length; i++) {
        const c = controlList[i];
        if (!c || typeof c !== 'object') continue;
        if (c.type === 'GROUP' && c.canvasData) {
          walkRows(c.canvasData, c.var || parentGroupVar);
          continue;
        }
        if (c.type === 'SUBTABLE' && c.fields) {
          if (c.var && parentGroupVar) map[c.var] = parentGroupVar;
          for (let j = 0; j < c.fields.length; j++) {
            const f = c.fields[j];
            if (f && f.code && parentGroupVar) map[f.code] = parentGroupVar;
          }
          continue;
        }
        if (c.var && c.type && c.type !== 'LABEL' && c.type !== 'HR' && c.type !== 'SPACER' && parentGroupVar) {
          map[c.var] = parentGroupVar;
        }
      }
    }
    function walkRows(rows, parentGroupVar) {
      if (!rows || !Array.isArray(rows)) return;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row || typeof row !== 'object') continue;
        if (row.controlList) walkControlList(row.controlList, parentGroupVar);
        if (row.canvasData) walkRows(row.canvasData, parentGroupVar);
      }
    }
    walkRows(Array.isArray(layoutArr) ? layoutArr : [], null);
    return map;
  }

  /** REST の form layout（ROW / GROUP）から親グループコードを求める */
  function buildFieldCodeParentGroupMapFromRestLayout(layoutArr) {
    const map = Object.create(null);
    function walk(layout, parentGroupCode) {
      if (!layout || !Array.isArray(layout)) return;
      for (let i = 0; i < layout.length; i++) {
        const row = layout[i];
        if (!row || typeof row !== 'object') continue;
        if (row.type === 'ROW' && row.fields) {
          for (let j = 0; j < row.fields.length; j++) {
            const f = row.fields[j];
            if (f && f.code && parentGroupCode) map[f.code] = parentGroupCode;
          }
        } else if (row.type === 'GROUP' && row.layout) {
          walk(row.layout, row.code || parentGroupCode);
        } else if (row.type === 'SUBTABLE' && row.fields) {
          if (row.code && parentGroupCode) map[row.code] = parentGroupCode;
          for (let j = 0; j < row.fields.length; j++) {
            const f = row.fields[j];
            if (f && f.code && parentGroupCode) map[f.code] = parentGroupCode;
          }
        }
      }
    }
    walk(layoutArr, null);
    return map;
  }

  function buildFieldCodeParentGroupMap(layoutArr) {
    if (!layoutArr || layoutArr.length === 0) return Object.create(null);
    if (layoutLooksLikeFormDesignerCanvas(layoutArr)) {
      return buildFieldCodeParentGroupMapFromCanvas(layoutArr);
    }
    return buildFieldCodeParentGroupMapFromRestLayout(layoutArr);
  }

  function collectGroupFieldOrderFromCanvas(layoutArr) {
    const out = Object.create(null);
    function push(groupCode, code) {
      if (!groupCode || !code || /^__/.test(code)) return;
      if (!out[groupCode]) out[groupCode] = [];
      out[groupCode].push(code);
    }
    function walkRows(rows, currentGroup) {
      if (!rows || !Array.isArray(rows)) return;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (row.controlList) walkControlList(row.controlList, currentGroup);
        if (row.canvasData) walkRows(row.canvasData, currentGroup);
      }
    }
    function walkControlList(controlList, currentGroup) {
      if (!controlList || !Array.isArray(controlList)) return;
      for (const c of controlList) {
        if (!c || typeof c !== 'object') continue;
        if (c.type === 'GROUP' && c.canvasData) {
          walkRows(c.canvasData, c.var || currentGroup);
          continue;
        }
        if (c.type === 'SUBTABLE' && c.fields) {
          if (c.var) push(currentGroup, c.var);
          for (const f of c.fields || []) if (f?.code) push(currentGroup, f.code);
          continue;
        }
        if (c.var && c.type && c.type !== 'LABEL' && c.type !== 'HR' && c.type !== 'SPACER') {
          push(currentGroup, c.var);
        }
      }
    }
    walkRows(Array.isArray(layoutArr) ? layoutArr : [], null);
    return out;
  }

  function collectGroupFieldOrderFromRestLayout(layoutArr) {
    const out = Object.create(null);
    function push(groupCode, code) {
      if (!groupCode || !code || /^__/.test(code)) return;
      if (!out[groupCode]) out[groupCode] = [];
      out[groupCode].push(code);
    }
    function walk(layout, currentGroup) {
      if (!layout || !Array.isArray(layout)) return;
      for (const row of layout) {
        if (!row || typeof row !== 'object') continue;
        if (row.type === 'ROW' && row.fields) {
          for (const f of row.fields) if (f?.code) push(currentGroup, f.code);
        } else if (row.type === 'GROUP' && row.layout) {
          walk(row.layout, row.code || currentGroup);
        } else if (row.type === 'SUBTABLE' && row.fields) {
          if (row.code) push(currentGroup, row.code);
          for (const f of row.fields) if (f?.code) push(currentGroup, f.code);
        }
      }
    }
    walk(layoutArr, null);
    return out;
  }

  function collectGroupFieldOrderByLayout(layoutArr) {
    if (!layoutArr || layoutArr.length === 0) return Object.create(null);
    if (layoutLooksLikeFormDesignerCanvas(layoutArr)) return collectGroupFieldOrderFromCanvas(layoutArr);
    return collectGroupFieldOrderFromRestLayout(layoutArr);
  }

  function isAppRecordPage() {
    const path = window.location.pathname || '';
    return /\/k\/\d+(\/|$)/.test(path) && !/\/admin\//.test(path);
  }

  /**
   * アプリ設定のフォーム（フィールド設定）画面
   * - /k/admin/app/form?app=
   * - /k/admin/app/flow?app=#section=form（アプリ設定トップの「フォーム」タブ）
   * - /k/{アプリID}/settings（新UI）
   */
  function isAppFieldSettingsPage() {
    const path = window.location.pathname || '';
    const hash = (window.location.hash || '').toLowerCase();
    if (/\/admin\/app\/form/.test(path)) return true;
    /* flow は一覧・グラフ等のタブがあるため、フォーム表示時のみ対象（#section=form 等） */
    if (/\/admin\/app\/flow/.test(path)) {
      return hash.includes('form');
    }
    if (/\/k\/\d+\/settings(\/|$)/.test(path)) return true;
    if (/\/k\/\d+\//.test(path)) {
      const h = (window.location.hash || '').toLowerCase();
      if (h && h.includes('settings') && (h.includes('form') || h.includes('field'))) return true;
    }
    return false;
  }

  function getAppIdFromUrl() {
    const path = window.location.pathname || '';
    const m = path.match(/\/k\/(\d+)(?:\/|$)/);
    if (m) return m[1];
    try {
      const params = new URLSearchParams(window.location.search || '');
      const app = params.get('app');
      if (app) return app;
    } catch (e) {
      /* ignore */
    }
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

    const onFieldSettings = isAppFieldSettingsPage();
    if (!isAppRecordPage() && !onFieldSettings) return;

    waitForKintone().then(() => {
      const k = getKintone();
      /* フォーム設計では kintone が削除されるが、パネルとバッジ処理は続行 */
      if (onFieldSettings) {
        setTimeout(showFieldCodesPanel, 300);
        setTimeout(() => showFieldSettingsPageFieldCodes(0), 200);
        return;
      }

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
    const appId =
      getAppIdFromUrl() ||
      getAppIdFromCybozuPage() ||
      (k && k.app?.getId?.() ? String(k.app.getId()) : null);
    if (!appId) {
      if (retryCount < 5) setTimeout(() => showFieldCodesPanel(retryCount + 1), 500);
      return;
    }

    const embeddedProps = buildPropertiesFromCybozuFieldList();
    const embeddedLayout = getLayoutFromCybozuPage();

    const fetchLayoutJs = () => {
      const getFormLayout = k && k.app?.getFormLayout?.bind(k.app);
      if (getFormLayout) return getFormLayout().catch(() => null);
      return Promise.resolve(null);
    };
    const fetchViaKintoneApi = () => {
      if (!k || !k.api?.url) return Promise.reject(new Error('No API'));
      return k.api(k.api.url('/k/v1/app/form/layout.json', true), 'GET', { app: appId }).catch(() =>
        k.api(k.api.url('/k/v1/app/form/fields.json', true), 'GET', { app: appId })
      );
    };
    const fetchViaNative = () =>
      fetchKintoneV1Json('app/form/layout.json', { app: appId }).catch(() =>
        fetchKintoneV1Json('app/form/fields.json', { app: appId })
      );

    fetchLayoutJs()
      .then((r) => {
        if (r && (r.properties || r.layout)) return r;
        return fetchViaKintoneApi().catch(() => fetchViaNative());
      })
      .then((resp) => {
        if (resp && (resp.properties || resp.layout)) return resp;
        if (embeddedProps) return embeddedProps;
        if (embeddedLayout.length) return { layout: embeddedLayout };
        throw new Error('empty');
      })
      .then((resp) => {
        let fieldCodes = [];
        if (resp?.properties) {
          fieldCodes = Object.keys(resp.properties).filter((c) => !/^__/.test(c));
        } else if (resp) {
          const layout = resp?.layout ?? resp;
          const arr = Array.isArray(layout) ? layout : (layout ? [layout] : []);
          fieldCodes = collectFieldCodesFromAnyLayout(arr);
        }
        if (fieldCodes.length > 0) showFieldCodesPanelUI(fieldCodes);
      })
      .catch(() => {
        if (retryCount < 3) setTimeout(() => showFieldCodesPanel(retryCount + 1), 1000);
      });
  }

  const PANEL_ID = 'kintone-fieldcode-fallback-panel';
  const PANEL_TOGGLE_ID = 'kintone-fieldcode-panel-toggle';

  function copyAllPanelFieldCodesToClipboard() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return '';
    const list = panel.querySelector('.kintone-fieldcode-list');
    if (!list) return '';
    const codes = Array.from(list.querySelectorAll(`.${BADGE_CLASS}`))
      .map((b) => (b.dataset.fieldCode || b.textContent || '').trim())
      .filter(Boolean);
    return codes.join('\n');
  }

  function showFieldCodesPanelUI(fieldCodes) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.style.cssText = 'position:fixed;top:60px;right:16px;max-width:280px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:12px;z-index:2147483647;font-size:12px;';
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;flex:1;min-width:0;';
      title.textContent = 'フィールドコード一覧';
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0;';
      const copyAllBtn = document.createElement('button');
      copyAllBtn.type = 'button';
      copyAllBtn.textContent = '一括コピー';
      copyAllBtn.title = '一覧のフィールドコードをすべてコピー（改行区切り）';
      copyAllBtn.style.cssText = 'font-size:11px;padding:4px 8px;cursor:pointer;background:#f5f5f5;border:1px solid #ccc;border-radius:4px;color:#333;';
      copyAllBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = copyAllPanelFieldCodesToClipboard();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          const prev = copyAllBtn.textContent;
          copyAllBtn.textContent = 'コピーしました';
          setTimeout(() => { copyAllBtn.textContent = prev; }, 1500);
        } catch (err) {
          const prev = copyAllBtn.textContent;
          copyAllBtn.textContent = '失敗';
          setTimeout(() => { copyAllBtn.textContent = prev; }, 1500);
        }
      });
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '×';
      closeBtn.title = 'パネルを閉じる';
      closeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;line-height:1;padding:0 4px;color:#666;';
      closeBtn.addEventListener('click', () => toggleFieldCodePanel(false));
      actions.appendChild(copyAllBtn);
      actions.appendChild(closeBtn);
      header.appendChild(title);
      header.appendChild(actions);
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

  function fieldElementHasBadgeForCode(fieldEl, fieldCode) {
    const badges = fieldEl.querySelectorAll(`.${BADGE_CLASS}`);
    for (const b of badges) {
      if (b.dataset.fieldCode === fieldCode) return true;
    }
    return false;
  }

  function insertBadgeIntoField(fieldEl, fieldCode) {
    if (!fieldEl || fieldElementHasBadgeForCode(fieldEl, fieldCode)) return false;
    const badge = createBadge(fieldCode, { canCopy: !isAppFieldSettingsPage() });
    const labelEl = fieldEl.querySelector?.('.label-text-cybozu, .label-gaia, [class*="label-text"], [class*="field-label"]');
    if (labelEl) {
      badge.classList.add(`${BADGE_CLASS}-in-field`);
      labelEl.insertAdjacentElement('afterend', badge);
      return true;
    }
    badge.classList.add(`${BADGE_CLASS}-floating`);
    fieldEl.style.position = fieldEl.style.position || 'relative';
    fieldEl.insertBefore(badge, fieldEl.firstChild);
    return true;
  }

  /** 管理画面のフォーム設計では record.getFieldElement が未提供・常に null になることがある */
  function cssEscapeAttr(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * open な Shadow Root 内も含めて全要素を走査（フォーム設計キャンバスが Shadow DOM 配下のため必須）
   */
  function forEachElementDeep(root, fn) {
    if (!root) return;
    const visit = (node) => {
      if (!node) return;
      if (node.nodeType === 1) {
        fn(node);
        const sr = node.shadowRoot;
        if (sr) {
          for (let c = sr.firstChild; c; c = c.nextSibling) visit(c);
        }
      }
      if (node.nodeType === 1 || node.nodeType === 11) {
        for (let c = node.firstChild; c; c = c.nextSibling) visit(c);
      }
    };
    visit(root);
  }

  function mapAttributeValueToElement(map, el, value) {
    if (!value || value.length === 0 || value.length >= 256) return;
    if (map[value] == null) map[value] = el;
  }

  function buildFormDesignerFieldCodeElementMap() {
    const map = Object.create(null);
    const root = document.body || document.documentElement;
    if (!root) return map;
    const nameHint = /field|code|fid|component|element|control|property|var|gaia|canvas|design/i;
    try {
      forEachElementDeep(root, (el) => {
        if (!el.attributes) return;
        for (let j = 0; j < el.attributes.length; j++) {
          const a = el.attributes[j];
          const name = a.name;
          const v = a.value;
          if (
            name === 'data-field-code' ||
            name === 'data-fieldcode' ||
            name === 'data-code' ||
            name === 'data-cybozu-field-code' ||
            name === 'data-gaia-field-code' ||
            name === 'data-fid' ||
            name === 'data-field-id' ||
            name === 'data-component-id' ||
            name === 'data-element-id'
          ) {
            mapAttributeValueToElement(map, el, v);
            continue;
          }
          if (nameHint.test(name) && v) mapAttributeValueToElement(map, el, v);
        }
      });
    } catch (e) { /* ignore */ }
    return map;
  }

  /** fieldList のローカル ID が DOM 属性値として出る場合、コード名のキーでも解決できるようにする */
  function augmentFormDesignerMapWithLocalIds(map) {
    const idToCode = buildLocalIdToFieldCodeMap();
    const ids = Object.keys(idToCode);
    if (ids.length === 0) return;
    const idSet = Object.create(null);
    for (let i = 0; i < ids.length; i++) idSet[ids[i]] = true;

    function resolveIdFromValue(v) {
      if (!v) return null;
      const s = String(v);
      if (idSet[s]) return s;
      const m = s.match(/\b(\d{4,14})\b/g);
      if (!m) return null;
      for (let k = 0; k < m.length; k++) {
        if (idSet[m[k]]) return m[k];
      }
      return null;
    }

    const root = document.body || document.documentElement;
    if (!root) return;
    try {
      forEachElementDeep(root, (el) => {
        if (!el.attributes) return;
        for (let j = 0; j < el.attributes.length; j++) {
          const v = el.attributes[j].value;
          const id = resolveIdFromValue(v);
          if (!id) continue;
          const code = idToCode[id];
          if (map[code] == null) map[code] = el;
          if (map[id] == null) map[id] = el;
        }
      });
    } catch (e) { /* ignore */ }
  }

  /** アプリ内でラベルが一意のフィールドだけ code → label を返す（DOM が属性を出さない場合のフォールバック） */
  function buildUniqueLabelByCode(properties) {
    const labelCount = Object.create(null);
    const props = Object.values(properties || {});
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const lb = prop?.label != null ? String(prop.label).trim() : '';
      if (!lb) continue;
      labelCount[lb] = (labelCount[lb] || 0) + 1;
    }
    const out = Object.create(null);
    for (let i = 0; i < props.length; i++) {
      const prop = props[i];
      const code = prop?.code;
      const lb = prop?.label != null ? String(prop.label).trim() : '';
      if (!code || !lb) continue;
      if (labelCount[lb] === 1) out[code] = lb;
    }
    return out;
  }

  /**
   * 同一グループ内でラベルが一意のフィールド向け（アプリ全体では重複していてもグループ内なら解決できる）
   */
  function buildUniqueLabelByCodeWithinParentGroup(properties, parentGroupMap) {
    const byGroup = Object.create(null);
    const props = Object.values(properties || {});
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const c = p?.code;
      const g = parentGroupMap[c];
      if (!c || !g) continue;
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(p);
    }
    const out = Object.create(null);
    for (const g of Object.keys(byGroup)) {
      const list = byGroup[g];
      const labelCount = Object.create(null);
      for (let i = 0; i < list.length; i++) {
        const lb = list[i]?.label != null ? String(list[i].label).trim() : '';
        if (!lb) continue;
        labelCount[lb] = (labelCount[lb] || 0) + 1;
      }
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const c = p?.code;
        const lb = p?.label != null ? String(p.label).trim() : '';
        if (!c || !lb) continue;
        if (labelCount[lb] === 1) out[c] = lb;
      }
    }
    return out;
  }

  /**
   * 同一グループ内で同一ラベルが複数ある場合のために、(group,label) -> [code...] を作る
   */
  function buildGroupedLabelCodeBuckets(properties, parentGroupMap, layoutArr) {
    const buckets = Object.create(null);
    const orderedByGroup = collectGroupFieldOrderByLayout(layoutArr);
    const pushed = Object.create(null);
    for (const g of Object.keys(orderedByGroup)) {
      const codes = orderedByGroup[g] || [];
      for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        const p = properties?.[c];
        const lb = p?.label != null ? String(p.label).trim() : '';
        if (!lb) continue;
        const key = `${g}::${lb}`;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(c);
        pushed[c] = true;
      }
    }
    const props = Object.values(properties || {});
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      const c = p?.code;
      if (!c || pushed[c]) continue;
      const g = parentGroupMap[c];
      const lb = p?.label != null ? String(p.label).trim() : '';
      if (!g || !lb) continue;
      const key = `${g}::${lb}`;
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(c);
    }
    return buckets;
  }

  function normalizeFormDesignerText(t) {
    return String(t || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * @param {string} label
   * @param {Element|null|undefined} searchRoot 省略時は document。グループ内のみ探すときに渡す。
   * @returns {Element|null} ラベルに対応するコントロール要素（wrap 前）
   */
  function findFormDesignerByUniqueLabelControlEl(label, searchRoot) {
    const norm = normalizeFormDesignerText(label);
    if (!norm) return null;
    let found = null;
    const root = searchRoot || document.body || document.documentElement;
    if (!root) return null;
    const rootBoundary = root.nodeType === 1 ? root : null;
    const labelClassHints = [
      'label-text-cybozu',
      'label-gaia',
      'field-label-cybozu',
      'label-control-cybozu'
    ];
    const hasLabelHintClass = (cn) => {
      if (!cn) return false;
      const s = String(cn);
      return labelClassHints.some((k) => s.includes(k));
    };
    const pickWrap = (el) => {
      if (!el) return null;
      if (rootBoundary) {
        const within = wrapFormDesignerNodeWithin(el, rootBoundary);
        if (within) return within;
      }
      return wrapFormDesignerNode(el);
    };

    forEachElementDeep(root, (el) => {
      if (found) return;
      const cn = el.className && String(el.className);
      if (!hasLabelHintClass(cn)) return;
      const t = normalizeFormDesignerText(el.textContent);
      if (t === norm) {
        const wrap = pickWrap(el);
        if (wrap) found = wrap;
      }
    });

    if (!found) {
      forEachElementDeep(root, (el) => {
        if (found) return;
        if (!el.className || typeof el.className !== 'string') return;
        if (!/\blabel|Label|title/i.test(el.className)) return;
        if (!/gaia|field|design|control/i.test(el.className)) return;
        const t = normalizeFormDesignerText(el.textContent);
        if (t === norm) {
          const wrap = pickWrap(el) || el.parentElement;
          if (wrap) found = wrap;
        }
      });
    }

    if (!found) {
      forEachElementDeep(root, (el) => {
        if (found) return;
        if (!el.classList) return;
        if (!el.classList.contains('control-gaia') && !String(el.className).includes('control-gaia')) return;
        const labelEl = el.querySelector('[class*="label"], [class*="Label"]');
        const t = normalizeFormDesignerText(labelEl ? labelEl.textContent : el.textContent);
        if (t === norm || t.startsWith(norm + ' ') || t.startsWith(norm + '\u3000')) {
          found = el;
        }
      });
    }

    return found;
  }

  function findFormDesignerByUniqueLabel(label) {
    const found = findFormDesignerByUniqueLabelControlEl(label);
    return found ? wrapFormDesignerNode(found) : null;
  }

  function findFormDesignerControlsByLabel(label, searchRoot) {
    const norm = normalizeFormDesignerText(label);
    if (!norm) return [];
    const root = searchRoot || document.body || document.documentElement;
    if (!root) return [];
    const out = [];
    const seen = new Set();
    forEachElementDeep(root, (el) => {
      if (!el || !el.className) return;
      const cn = String(el.className);
      if (!cn.includes('label-text-cybozu') && !cn.includes('label-gaia')) return;
      const t = normalizeFormDesignerText(el.textContent);
      if (t !== norm) return;
      const wrap = searchRoot
        ? wrapFormDesignerNodeWithin(el, searchRoot)
        : wrapFormDesignerNode(el);
      if (!wrap || seen.has(wrap)) return;
      seen.add(wrap);
      out.push(wrap);
    });
    return out;
  }

  function getSubtableFieldCodesFromFormDesignerCanvas(layout, tableCode) {
    function walk(rows) {
      if (!rows || !Array.isArray(rows)) return [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        if (row.controlList) {
          for (const c of row.controlList) {
            if (!c || typeof c !== 'object') continue;
            if (c.type === 'SUBTABLE' && c.var === tableCode && c.fields) {
              return c.fields.filter((f) => f && f.code).map((f) => f.code);
            }
            if (c.type === 'GROUP' && c.canvasData) {
              const found = walk(c.canvasData);
              if (found.length) return found;
            }
          }
        }
        if (row.canvasData) {
          const found = walk(row.canvasData);
          if (found.length) return found;
        }
      }
      return [];
    }
    return walk(Array.isArray(layout) ? layout : layout ? [layout] : []);
  }

  function wrapFormDesignerNode(node) {
    if (!node) return null;
    const byModernControl = node.closest(
      '[class*="fm-control-"], [class*="gaia-argoui-app-form"], [class*="form-control"], [class*="control-cybozu"]'
    );
    return node.closest('.control-gaia')
      || node.closest('.field-gaia')
      || byModernControl
      || node.closest('[class*="FormField"]')
      || node.closest('[class*="form-field"]')
      || node.closest('[class*="field-designer"]')
      || node.closest('[class*="FieldDesigner"]')
      || node.closest('[class*="designer-field"]')
      || node.closest('td')
      || node.parentElement
      || node;
  }

  /** グループ境界より外の control-gaia（親グループ）に吸われないよう、境界内で最も近いコントロールを選ぶ */
  function wrapFormDesignerNodeWithin(node, boundaryEl) {
    if (!node || !boundaryEl) return wrapFormDesignerNode(node);
    const isControlLike = (el) => {
      if (!el || el.nodeType !== 1) return false;
      const cn = el.className && String(el.className);
      if (!cn) return false;
      return cn.includes('control-gaia')
        || cn.includes('field-gaia')
        || cn.includes('fm-control-')
        || cn.includes('gaia-argoui-app-form')
        || cn.includes('form-control')
        || cn.includes('control-cybozu');
    };
    let cur = node;
    while (cur && boundaryEl.contains(cur)) {
      if (isControlLike(cur)) return cur;
      cur = cur.parentElement;
    }
    const w = wrapFormDesignerNode(node);
    if (w && boundaryEl.contains(w)) return w;
    return boundaryEl.contains(node) ? node : null;
  }

  function findFieldNodeByCodeAttributeDeepUnder(root, fieldCode) {
    if (!root || !fieldCode) return null;
    const attrs = [
      'data-field-code',
      'data-fieldcode',
      'data-code',
      'data-cybozu-field-code',
      'data-gaia-field-code'
    ];
    let found = null;
    forEachElementDeep(root, (el) => {
      if (found) return;
      for (let i = 0; i < attrs.length; i++) {
        if (el.getAttribute(attrs[i]) === fieldCode) {
          found = el;
          return;
        }
      }
    });
    return found;
  }

  function findLocalIdNodeForFieldCodeInSubtree(subtreeRoot, fieldCode, idToCode) {
    if (!subtreeRoot || !fieldCode || !idToCode) return null;
    let localId = null;
    for (const id of Object.keys(idToCode)) {
      if (idToCode[id] === fieldCode) {
        localId = id;
        break;
      }
    }
    if (!localId) return null;
    let found = null;
    forEachElementDeep(subtreeRoot, (el) => {
      if (found) return;
      if (!el.attributes) return;
      for (let j = 0; j < el.attributes.length; j++) {
        if (el.attributes[j].value === localId) {
          found = el;
          return;
        }
      }
    });
    if (found) return found;
    forEachElementDeep(subtreeRoot, (el) => {
      if (found) return;
      if (!el.attributes) return;
      for (let j = 0; j < el.attributes.length; j++) {
        const v = el.attributes[j].value;
        if (v && v.indexOf(localId) >= 0) {
          found = el;
          return;
        }
      }
    });
    return found;
  }

  function findFieldNodeByCodeAttributeDeep(fieldCode) {
    const root = document.body || document.documentElement;
    return root ? findFieldNodeByCodeAttributeDeepUnder(root, fieldCode) : null;
  }

  function findFormDesignerFieldContainer(fieldCode, attrMap, uniqueLabel) {
    if (!fieldCode) return null;
    if (attrMap && attrMap[fieldCode]) {
      return wrapFormDesignerNode(attrMap[fieldCode]);
    }
    const esc = cssEscapeAttr(fieldCode);
    const selectors = [
      `[data-field-code="${esc}"]`,
      `[data-fieldcode="${esc}"]`,
      `[data-code="${esc}"]`,
      `[data-cybozu-field-code="${esc}"]`,
      `[data-gaia-field-code="${esc}"]`,
    ];
    for (let i = 0; i < selectors.length; i++) {
      try {
        const node = document.querySelector(selectors[i]);
        if (node) return wrapFormDesignerNode(node);
      } catch (e) { /* ignore */ }
    }
    const byAttrDeep = findFieldNodeByCodeAttributeDeep(fieldCode);
    if (byAttrDeep) return wrapFormDesignerNode(byAttrDeep);
    if (uniqueLabel) {
      const byLabel = findFormDesignerByUniqueLabel(uniqueLabel);
      if (byLabel) return byLabel;
    }
    return null;
  }

  function resolveFieldContainerForAdmin(fieldCode, getFieldElement, attrMap, uniqueLabel) {
    if (getFieldElement) {
      try {
        const el = getFieldElement(fieldCode);
        if (el) return el;
      } catch (e) { /* getFieldElement 非対応フィールド */ }
    }
    return findFormDesignerFieldContainer(fieldCode, attrMap, uniqueLabel);
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
      insertBadgeIntoField(cell, innerFieldCodes[i]);
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
      if (getFormLayout) {
        getFormLayout()
          .then((layout) => {
            const layoutData = layout?.layout ?? layout;
            showRecordPageFieldCodesCore(record, getFieldElement, layoutData);
          })
          .catch(() => {
            fetchEditPageLayoutArr().then((arr) => {
              showRecordPageFieldCodesCore(record, getFieldElement, arr);
            });
          });
      } else {
        fetchEditPageLayoutArr().then((arr) => {
          showRecordPageFieldCodesCore(record, getFieldElement, arr);
        });
      }
    } catch (e) {
      console.warn('[kintone-fieldcode] レコード画面の処理に失敗:', e);
    }
  }

  function showRecordPageFieldCodesCore(record, getFieldElement, layoutData) {
    const layout = Array.isArray(layoutData) ? layoutData : (layoutData ? [layoutData] : []);

    function tryPlaceBadge(fieldCode) {
      const fieldEl = getFieldElement(fieldCode);
      insertBadgeIntoField(fieldEl, fieldCode);
    }

    for (const fieldCode of Object.keys(record)) {
      if (['__REVISION__', '$id', '$revision'].includes(fieldCode)) continue;
      const fieldInfo = record[fieldCode];
      if (!fieldInfo || typeof fieldInfo !== 'object') continue;

      if (fieldInfo.type === 'SUBTABLE') {
        const tableEl = getFieldElement(fieldCode);
        if (!tableEl) continue;

        const rows = fieldInfo.value || [];
        const firstRowData = rows[0];
        const fromLayout = getSubtableFieldCodesFromLayout(layout, fieldCode);
        const innerFieldCodes = fromLayout.length > 0
          ? fromLayout
          : (firstRowData?.value ? Object.keys(firstRowData.value) : []);
        if (innerFieldCodes.length > 0) {
          waitForSubtableAndApply(tableEl, innerFieldCodes);
        }
        /* サブテーブル本体のフィールドコード（列バッジとは別） */
        tryPlaceBadge(fieldCode);
        continue;
      }

      tryPlaceBadge(fieldCode);
    }

    /* グループなどレコードのキーに無いフィールドコード（レイアウトから補完） */
    const fromLayout = collectFieldCodesFromLayout(layout);
    function applyLayoutBadges() {
      for (const fieldCode of fromLayout) {
        tryPlaceBadge(fieldCode);
      }
    }
    applyLayoutBadges();
    [600, 1800, 3200].forEach((ms) => {
      setTimeout(applyLayoutBadges, ms);
    });
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

  function fetchEditPageLayoutArr() {
    const k = getKintone();
    const getFormLayout = k?.app?.getFormLayout?.bind(k.app);
    const tryApi = () => {
      const appId = getAppIdFromUrl() || (k?.app?.getId?.() ? String(k.app.getId()) : null);
      if (!appId || !k?.api?.url) return Promise.resolve(null);
      return k.api(k.api.url('/k/v1/app/form/layout.json', true), 'GET', { app: appId })
        .then((resp) => {
          const layoutData = resp?.layout ?? resp;
          if (!layoutData) return null;
          return Array.isArray(layoutData) ? layoutData : [layoutData];
        })
        .catch(() => null);
    };
    if (getFormLayout) {
      return getFormLayout()
        .then((layout) => {
          const layoutData = layout?.layout ?? layout;
          if (layoutData) {
            const arr = Array.isArray(layoutData) ? layoutData : [layoutData];
            if (arr.length > 0) return arr;
          }
          return tryApi();
        })
        .catch(() => tryApi());
    }
    return tryApi();
  }

  function showEditPageFieldCodesByLayout() {
    const getFieldElement = kintone.app.record.getFieldElement?.bind(kintone.app.record) ||
      kintone.mobile?.app?.record?.getFieldElement?.bind(kintone.mobile.app.record);
    if (!getFieldElement) return Promise.resolve(0);

    const runLayoutPasses = (layoutArr, recordSafe) => {
      const layoutCodes = collectFieldCodesFromLayout(layoutArr);
      if (layoutCodes.length === 0) return 0;

      const layoutTree = layoutArr;

      function tryPlaceBadge(fieldCode) {
        const fieldEl = getFieldElement(fieldCode);
        insertBadgeIntoField(fieldEl, fieldCode);
      }

      function onePass() {
        for (const fieldCode of layoutCodes) {
          const fieldInfo = recordSafe[fieldCode];
          const isSubtable = (fieldInfo && fieldInfo.type === 'SUBTABLE') ||
            (!fieldInfo && layoutDefinesSubtableCode(layoutTree, fieldCode));
          if (isSubtable) {
            const tableEl = getFieldElement(fieldCode);
            if (tableEl) {
              const rows = fieldInfo?.value || [];
              const firstRowData = rows[0];
              const fromLayout = getSubtableFieldCodesFromLayout(layoutTree, fieldCode);
              const innerFieldCodes = fromLayout.length > 0
                ? fromLayout
                : (firstRowData?.value ? Object.keys(firstRowData.value) : []);
              if (innerFieldCodes.length > 0) {
                waitForSubtableAndApply(tableEl, innerFieldCodes);
              }
            }
            tryPlaceBadge(fieldCode);
            continue;
          }
          tryPlaceBadge(fieldCode);
        }
      }

      onePass();
      return layoutCodes.filter((c) => {
        const el = getFieldElement(c);
        return el && fieldElementHasBadgeForCode(el, c);
      }).length;
    };

    return fetchEditPageLayoutArr().then((layoutArr) => {
      if (!layoutArr || layoutArr.length === 0) return 0;

      const recordData = kintone.app.record.get?.();
      const recordSafe = recordData?.record && typeof recordData.record === 'object'
        ? recordData.record
        : {};

      runLayoutPasses(layoutArr, recordSafe);
      [450, 1200, 2600].forEach((ms) => {
        setTimeout(() => runLayoutPasses(layoutArr, recordSafe), ms);
      });

      return collectFieldCodesFromLayout(layoutArr).length;
    }).catch((e) => {
      console.warn('[kintone-fieldcode] フォームレイアウトの取得に失敗:', e);
      return 0;
    });
  }

  /** レイアウト反映待ちでバッジが付くまで待ち、付かなければ setFieldStyle へ進める */
  function waitForEditBadgesThenResolve(maxWaitMs) {
    maxWaitMs = maxWaitMs || 4000;
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (document.querySelectorAll(`.${BADGE_CLASS}`).length > 0) {
          resolve(true);
          return;
        }
        if (Date.now() - start >= maxWaitMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, 180);
      };
      tick();
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
      const fieldCodes = [...new Set(flattenRecordFieldCodes(record))].filter(
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
            if (insertBadgeIntoField(container, fieldCode)) addedCount++;
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
        .then((layoutFieldCount) => {
          if (layoutFieldCount === 0) return showEditPageFieldCodesBySetStyle();
          return waitForEditBadgesThenResolve(4000).then((hasBadges) => {
            if (hasBadges) return true;
            return showEditPageFieldCodesBySetStyle();
          });
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

  function showFieldSettingsPageFieldCodes(retryCount) {
    retryCount = retryCount || 0;
    const k = getKintone();
    const getFieldElement = k && k.app?.record?.getFieldElement?.bind(k.app.record);

    const appId =
      getAppIdFromUrl() ||
      getAppIdFromCybozuPage() ||
      (k && k.app?.getId?.() ? String(k.app.getId()) : null);
    if (!appId) {
      if (retryCount < 10) setTimeout(() => showFieldSettingsPageFieldCodes(retryCount + 1), 400);
      return;
    }

    const fetchFields = () => {
      if (k && k.api?.url) {
        return k.api(k.api.url('/k/v1/app/form/fields.json', true), 'GET', { app: appId });
      }
      return fetchKintoneV1Json('app/form/fields.json', { app: appId });
    };
    const fetchLayout = () => {
      if (k && k.api?.url) {
        return k.api(k.api.url('/k/v1/app/form/layout.json', true), 'GET', { app: appId });
      }
      return fetchKintoneV1Json('app/form/layout.json', { app: appId });
    };

    Promise.all([fetchFields().catch(() => null), fetchLayout().catch(() => null)])
      .then(([fieldsResp, layoutResp]) => {
        let properties = fieldsResp?.properties;
        let layoutRaw = layoutResp?.layout ?? layoutResp;

        if (!properties || Object.keys(properties).length === 0) {
          const emb = buildPropertiesFromCybozuFieldList();
          if (emb && emb.properties) properties = emb.properties;
        }

        let layoutArr = Array.isArray(layoutRaw) ? layoutRaw : (layoutRaw ? [layoutRaw] : []);
        if (layoutArr.length === 0) {
          layoutArr = getLayoutFromCybozuPage();
        }

        if (!properties || Object.keys(properties).length === 0) {
          if (retryCount < 6) setTimeout(() => showFieldSettingsPageFieldCodes(retryCount + 1), 600);
          return;
        }

        addStyles();

        function subtableInnerCodes(tableCode) {
          if (layoutLooksLikeFormDesignerCanvas(layoutArr)) {
            return getSubtableFieldCodesFromFormDesignerCanvas(layoutArr, tableCode);
          }
          return getSubtableFieldCodesFromLayout(layoutArr, tableCode);
        }

        function runPlacementPass() {
          const map = buildFormDesignerFieldCodeElementMap();
          augmentFormDesignerMapWithLocalIds(map);
          const uniqueLabelByCode = buildUniqueLabelByCode(properties);
          const parentGroupMap = buildFieldCodeParentGroupMap(layoutArr);
          const uniqueLabelInGroupByCode = buildUniqueLabelByCodeWithinParentGroup(
            properties,
            parentGroupMap
          );
          const groupedLabelBuckets = buildGroupedLabelCodeBuckets(
            properties,
            parentGroupMap,
            layoutArr
          );
          const idToCode = buildLocalIdToFieldCodeMap();
          const groupContainerByCode = Object.create(null);

          function resolveGlobal(code) {
            return resolveFieldContainerForAdmin(code, getFieldElement, map, uniqueLabelByCode[code]);
          }

          for (const prop of Object.values(properties)) {
            if (prop?.type === 'GROUP' && prop.code) {
              const gel = resolveGlobal(prop.code);
              if (gel) groupContainerByCode[prop.code] = gel;
            }
          }

          function resolveEl(code) {
            const pg = parentGroupMap[code];
            if (pg && groupContainerByCode[pg]) {
              const gEl = groupContainerByCode[pg];
              let hit = findFieldNodeByCodeAttributeDeepUnder(gEl, code);
              if (!hit) hit = findLocalIdNodeForFieldCodeInSubtree(gEl, code, idToCode);
              if (!hit && map[code] && gEl.contains(map[code])) hit = map[code];
              if (!hit) {
                const lb =
                  uniqueLabelInGroupByCode[code] || uniqueLabelByCode[code];
                if (lb) hit = findFormDesignerByUniqueLabelControlEl(lb, gEl);
              }
              if (!hit) {
                const prop = properties[code];
                const lb = prop?.label != null ? String(prop.label).trim() : '';
                if (lb) {
                  const key = `${pg}::${lb}`;
                  const codes = groupedLabelBuckets[key] || [];
                  if (codes.length > 1) {
                    const idx = codes.indexOf(code);
                    if (idx >= 0) {
                      const matched = findFormDesignerControlsByLabel(lb, gEl);
                      if (matched[idx]) hit = matched[idx];
                    }
                  }
                }
              }
              if (hit) {
                const wrapped = wrapFormDesignerNodeWithin(hit, gEl);
                if (wrapped) return wrapped;
              }
            }
            return resolveGlobal(code);
          }

          function placeOn(el, code) {
            insertBadgeIntoField(el, code);
          }

          for (const prop of Object.values(properties)) {
            const code = prop?.code;
            const type = prop?.type;
            if (!code || /^__/.test(code)) continue;

            if (type === 'SUBTABLE') {
              const tableEl = resolveEl(code);
              const innerCodes = subtableInnerCodes(code);
              if (tableEl && innerCodes.length > 0) {
                waitForSubtableAndApply(tableEl, innerCodes);
              }
              placeOn(resolveEl(code), code);
              continue;
            }

            if (type === 'REFERENCE_TABLE' && prop.referenceTable?.displayFields?.length) {
              placeOn(resolveEl(code), code);
              for (const subCode of prop.referenceTable.displayFields) {
                placeOn(resolveEl(subCode), subCode);
              }
              continue;
            }

            placeOn(resolveEl(code), code);
          }

          const layoutCodes = collectFieldCodesFromAnyLayout(layoutArr);
          for (let i = 0; i < layoutCodes.length; i++) {
            placeOn(resolveEl(layoutCodes[i]), layoutCodes[i]);
          }
        }

        runPlacementPass();

        const delays = [500, 1500, 3500, 6000];
        delays.forEach((ms) => setTimeout(runPlacementPass, ms));

        let moTimer;
        const mo = new MutationObserver(() => {
          clearTimeout(moTimer);
          moTimer = setTimeout(runPlacementPass, 120);
        });
        if (document.body) {
          mo.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => {
            try { mo.disconnect(); } catch (e) { /* ignore */ }
          }, 15000);
        }

        const badgeCount = () => document.querySelectorAll(`.${BADGE_CLASS}`).length;
        if (badgeCount() === 0 && retryCount < 6) {
          setTimeout(() => showFieldSettingsPageFieldCodes(retryCount + 1), 800 * (retryCount + 1));
        }
      })
      .catch(() => {
        if (retryCount < 6) setTimeout(() => showFieldSettingsPageFieldCodes(retryCount + 1), 600);
      });
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
          insertBadgeIntoField(el, code);
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

  window.addEventListener('hashchange', () => {
    if (window.__kintoneFieldCodeVisible) onPageChange();
  });

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
