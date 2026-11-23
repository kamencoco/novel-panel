/* 面板志 — 前端逻辑（v2 增量模型）
 * 第 1 章 = 基准面板；之后每章记录本章变化（deltas）。
 * 修改任何一章后重放 deltas，后面章节自动按各自变化重新计算。
 * UI 始终展示"解析后的完整面板"；数值输入 = 本章确定值（锚定），
 * +N 按钮 = 本章相对变化（会向后面章节加减传播）。
 * 纯数据函数在 core.js。
 */

'use strict';

// ---------------------------------------------------------------- RPC

let _rpcId = 0;
const _pending = new Map();

function settle(id, resp) {
  const p = _pending.get(id);
  if (!p) return;
  _pending.delete(id);
  resp.ok ? p.resolve(resp.result) : p.reject(new Error(resp.error || 'unknown error'));
}

const inApp = !!(window.chrome && window.chrome.webview);

function rpc(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++_rpcId;
    _pending.set(id, { resolve, reject });
    if (inApp) {
      window.chrome.webview.postMessage({ id, method, params });
    } else {
      mock.call(method, params)
        .then(v => settle(id, { id, ok: true, result: v }))
        .catch(e => settle(id, { id, ok: false, error: String(e && e.message || e) }));
    }
  });
}

if (inApp) {
  window.chrome.webview.addEventListener('message', e => {
    const d = e.data;
    if (d && typeof d === 'object' && 'id' in d) settle(d.id, d);
  });
}

// 浏览器预览用的 mock 后端（localStorage 持久化）
const mock = {
  _key: 'novelpanel.mock.v1',
  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(this._key));
      if (d && d.books) return d;
    } catch (e) { /* 忽略 */ }
    return { books: {}, settings: { theme: 'xianxia', lastBookId: null } };
  },
  _save(db) { localStorage.setItem(this._key, JSON.stringify(db)); },
  async call(method, p) {
    const db = this._load();
    switch (method) {
      case 'appInfo':
        return { version: '1.1.0-mock', dataDir: '（浏览器预览模式，数据存于 localStorage）' };
      case 'listBooks':
        return Object.values(db.books).map(b => ({
          id: b.id, title: b.title, updatedAt: b.updatedAt,
          chapters: Array.isArray(b.chapters) ? b.chapters.length : 0,
          chars: Array.isArray(b.characters) ? b.characters.length : 0,
        }));
      case 'loadBook': {
        const b = db.books[p.id];
        if (!b) throw new Error('book not found');
        return b;
      }
      case 'saveBook': {
        p.data.id = p.id;
        p.data.updatedAt = new Date().toISOString();
        db.books[p.id] = p.data;
        this._save(db);
        return { updatedAt: p.data.updatedAt };
      }
      case 'deleteBook':
        delete db.books[p.id];
        this._save(db);
        return {};
      case 'getSettings':
        return db.settings;
      case 'saveSettings':
        db.settings = p.data;
        this._save(db);
        return {};
      case 'exportAll': {
        const blob = new Blob([p.data], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = p.filename + '.txt';
        a.click();
        return { path: p.filename + '.txt（浏览器下载）' };
      }
      case 'openPath':
        return {};
      default:
        throw new Error('unknown method: ' + method);
    }
  },
};

// ---------------------------------------------------------------- 工具

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICONS = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9.5" cy="8" r="2.1"/><circle cx="14.5" cy="16" r="2.1"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20.6 13.4A8.4 8.4 0 1 1 10.6 3.4a6.6 6.6 0 0 0 10 10z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12M10 11v5.5M14 11v5.5"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M9.5 6l6 6-6 6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M14.5 6l-6 6 6 6"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="5.5" r="1.7"/><circle cx="15" cy="5.5" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18.5" r="1.7"/><circle cx="15" cy="18.5" r="1.7"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.2a2.4 2.4 0 1 1 3.4 2.2c-.6.25-1 .7-1 1.4v.5"/><line x1="12" y1="16.3" x2="12" y2="16.4"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 20l1-4.5L16.5 4a1.9 1.9 0 0 1 2.7 0l.8.8a1.9 1.9 0 0 1 0 2.7L7.5 19 4 20z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
  export: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
};

function icon(name) {
  const s = h('span');
  s.style.display = 'inline-flex';
  s.innerHTML = ICONS[name] || '';
  return s;
}

// ---------------------------------------------------------------- 面板模板

const PANEL_TEMPLATES = [
  { id: 'default', name: '简约面板', desc: '宿主 / 等级 / 积分' },
  { id: 'xianxia', name: '修仙面板', desc: '境界 / 灵力 / 寿元 / 灵石 ＋ 功法分组' },
  { id: 'game', name: '游戏系统', desc: '等级 / 生命 / 魔法 / 经验 / 金币' },
  { id: 'urban', name: '都市异能', desc: '宿主 / 异能等级 / 能力点 / 声望' },
  { id: 'blank', name: '空白面板', desc: '只有一个"基础"分组，自己添加' },
];

function templateSections(id) {
  const f = (name, type, value) => ({ id: uid(), name, type, value: type === 'number' ? (value || 0) : (value || '') });
  switch (id) {
    case 'xianxia': return [
      { id: uid(), name: '基础', fields: [f('宿主', 'text'), f('境界', 'text', '练气一层'), f('灵力', 'number'), f('寿元', 'number', 16), f('灵石', 'number')] },
      { id: uid(), name: '功法', fields: [f('功法名', 'text'), f('层数', 'number', 1)] },
    ];
    case 'game': return [
      { id: uid(), name: '基础', fields: [f('宿主', 'text'), f('等级', 'number', 1), f('生命', 'number', 100), f('魔法', 'number', 50), f('经验', 'number'), f('金币', 'number')] },
    ];
    case 'urban': return [
      { id: uid(), name: '基础', fields: [f('宿主', 'text'), f('异能等级', 'number', 1), f('能力点', 'number'), f('声望', 'number')] },
    ];
    case 'blank': return [
      { id: uid(), name: '基础', fields: [] },
    ];
    case 'default':
    default: return defaultSections();
  }
}

// 带"参考当前面板"选项的模板选择弹窗（新角色用）
const CHAR_TEMPLATES = [
  { id: '__cur', name: '参考当前面板', desc: '条目与当前角色一致，数值全 0' },
  ...PANEL_TEMPLATES,
];

function templateModal({ title, namePlaceholder, templates, defaultId, okLabel, initialName }, onOk) {
  let sel = defaultId;
  const nameIn = h('input', { class: 'set-in', placeholder: namePlaceholder, spellcheck: 'false' });
  if (initialName) nameIn.value = initialName;
  const list = h('div', { class: 'tpl-list' });
  templates.forEach(t => {
    const row = h('div', { class: 'tpl-row' + (t.id === sel ? ' on' : ''), tabindex: '0', role: 'button' },
      h('span', { class: 'tpl-radio' }),
      h('div', { class: 'tpl-info' },
        h('div', { class: 'tpl-name', text: t.name }),
        h('div', { class: 'tpl-desc', text: t.desc })));
    const pick = () => {
      sel = t.id;
      list.querySelectorAll('.tpl-row').forEach(r => r.classList.remove('on'));
      row.classList.add('on');
    };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    list.append(row);
  });
  const ok = h('button', { class: 'btn-primary', text: okLabel || '创建' });
  const commit = () => {
    const v = nameIn.value.trim();
    if (!v) { nameIn.focus(); return; }
    closeModal();
    onOk(v, sel);
  };
  ok.addEventListener('click', commit);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
  openModal(h('div', { class: 'modal small' },
    h('div', { class: 'm-title', text: title }),
    nameIn,
    h('div', { class: 'm-label', text: '选择面板模板' }),
    list,
    h('div', { class: 'm-row' },
      h('button', { class: 'ghost', text: '取消', onclick: closeModal }),
      ok),
  ));
  setTimeout(() => { nameIn.focus(); }, 50);
}

// ---------------------------------------------------------------- 状态

const THEMES = [
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' },
  { id: 'xianxia', name: '仙侠' },
  { id: 'tech', name: '科技' },
  { id: 'glass', name: '液态玻璃' },
];

const state = {
  books: [],        // [{id,title,updatedAt}]
  book: null,       // 当前作品（v3 格式：characters[] + chapters[].deltasByChar）
  resolvedByChar: {},  // { [charId]: [sections|null, ...] } 与 chapters 对齐
  curChar: null,    // 当前编辑的角色 id
  chIdx: 0,
  theme: 'light',
};
let g_dataDir = '';

const els = {};
['shelf', 'shelfHero', 'shelfGrid', 'btnHelp', 'shelfTheme', 'heroTitle', 'heroCreate',
 'btnBackShelf', 'bsTitle', 'btnHelp2', 'btnTheme', 'btnSettings', 'chapterTree', 'btnAddChapter',
 'app', 'chNo', 'chTitle', 'saveState', 'btnCopy', 'wordCount', 'btnPreviewToggle',
 'charTabs', 'editor', 'editorScroll', 'fieldsScroll', 'fieldsWrap',
 'preview', 'pvChar', 'pvCh', 'btnPvClose',
 'modalRoot', 'toast',
].forEach(id => els[id] = document.getElementById(id));

// ---- 当前上下文 ----
function curChapter() { return state.book.chapters[state.chIdx]; }
function curCharObj() {
  return state.book.characters.find(c => c.id === state.curChar) || state.book.characters[0];
}
// 当前章当前角色的解析面板（基准章是 char.base 别名，可直接改）
function curPanel() {
  return state.resolvedByChar[state.curChar][state.chIdx];
}
function prevPanel() {
  const arr = state.resolvedByChar[state.curChar];
  return state.chIdx > 0 ? arr[state.chIdx - 1] : null;
}
// 是否处于该角色的入场章（基准章）：直接改 base，不记录 delta
function isBase() {
  const c = curCharObj();
  return curChapter().no === c.startNo;
}
// 本章该角色的 deltas（可写，确保存在）
function curDeltas() {
  const ch = curChapter();
  if (!ch.deltasByChar) ch.deltasByChar = {};
  if (!ch.deltasByChar[state.curChar]) ch.deltasByChar[state.curChar] = [];
  return ch.deltasByChar[state.curChar];
}
// 只读版本（不创建）
function peekDeltas() {
  const dbc = curChapter().deltasByChar;
  return (dbc && dbc[state.curChar]) || [];
}

function resolveAll() {
  state.resolvedByChar = resolveBook(state.book);
  // 当前角色在本章不存在时，回落到第一个角色
  const arr = state.resolvedByChar[state.curChar];
  if (!arr || !arr[state.chIdx]) state.curChar = state.book.characters[0].id;
}

// ---------------------------------------------------------------- 本章变化记录（deltas）

// 直接输入的值/名称/类型：锚定到本章（与上一章相同则不记录）
function recSet(fid, patch) {
  if (isBase()) return; // 入场章直接改基准
  const hit = findFieldIn(prevPanel(), fid);
  const p = {};
  if ('name' in patch && (!hit || hit.field.name !== patch.name)) p.name = patch.name;
  if ('value' in patch && !('type' in patch)) {
    const same = hit ? (hit.field.type === 'number'
      ? num(hit.field.value) === num(patch.value)
      : String(hit.field.value) === String(patch.value)) : false;
    if (!same) p.value = patch.value;
  }
  if ('type' in patch) {
    if (!hit || hit.field.type !== patch.type) { p.type = patch.type; p.value = patch.value; }
  }
  const deltas = curDeltas();
  const ex = deltas.find(o => o.op === 'field.set' && o.fid === fid);
  if (Object.keys(p).length) {
    if (ex) Object.assign(ex.patch, p);
    else deltas.push({ op: 'field.set', fid, patch: p });
  } else if (ex) {
    // 改回了继承值：撤掉本章的锚定
    for (const k of Object.keys(patch)) delete ex.patch[k];
    if (!Object.keys(ex.patch).length) {
      const idx = deltas.indexOf(ex);
      deltas.splice(idx, 1);
    }
  }
}

// +N 按钮：本章相对变化（合并本章对该字段已有的 value.add）
function recValueAdd(fid, n) {
  if (isBase() || !n) return;
  const deltas = curDeltas();
  let lastIdx = -1;
  for (let i = 0; i < deltas.length; i++) {
    const o = deltas[i];
    if (o.fid === fid || (o.op === 'field.add' && o.field && o.field.id === fid)) lastIdx = i;
  }
  const last = lastIdx >= 0 ? deltas[lastIdx] : null;
  if (last && last.op === 'value.add') last.d = round6(last.d + n);
  else deltas.push({ op: 'value.add', fid, d: n });
}

function recFieldAdd(field, sid, after, secName) {
  if (isBase()) return;
  curDeltas().push({ op: 'field.add', sid, after, field, secName });
}

function recFieldDel(fid) {
  if (isBase()) return;
  const deltas = curDeltas();
  const hadAdd = deltas.some(o => o.op === 'field.add' && o.field && o.field.id === fid);
  if (hadAdd) {
    // 本章新增又删除 = 没变
    for (let i = deltas.length - 1; i >= 0; i--) {
      const o = deltas[i];
      if ((o.op === 'field.add' && o.field && o.field.id === fid) || o.fid === fid) deltas.splice(i, 1);
    }
  } else {
    deltas.push({ op: 'field.del', fid });
  }
}

function recSectionAdd(sid, name, after) {
  if (isBase()) return;
  curDeltas().push({ op: 'section.add', sid, name, after });
}

function recSectionRename(sid, name) {
  if (isBase()) return;
  const prev = prevPanel().find(s => s.id === sid);
  const deltas = curDeltas();
  const ex = deltas.find(o => o.op === 'section.rename' && o.sid === sid);
  if (!prev || prev.name !== name) {
    if (ex) ex.name = name;
    else deltas.push({ op: 'section.rename', sid, name });
  } else if (ex) {
    deltas.splice(deltas.indexOf(ex), 1);
  }
}

function recSectionDel(sid) {
  if (isBase()) return;
  const deltas = curDeltas();
  const hadAdd = deltas.some(o => o.op === 'section.add' && o.sid === sid);
  if (hadAdd) {
    for (let i = deltas.length - 1; i >= 0; i--) {
      const o = deltas[i];
      if ((o.op === 'section.add' && o.sid === sid) ||
          (o.op === 'field.add' && o.sid === sid) ||
          (o.op === 'section.rename' && o.sid === sid)) deltas.splice(i, 1);
    }
  } else {
    deltas.push({ op: 'section.del', sid });
  }
}

// 移动通过 recMove/recSecMove 记录为相对指令（前面章节顺序变化时依然成立）。


// ---------------------------------------------------------------- 自动保存

let dirty = false;
let saveTimer = null;

let saveFadeTimer = null;
function setSaveState(s) {
  clearTimeout(saveFadeTimer);
  els.saveState.classList.remove('faded');
  els.saveState.textContent = {
    idle: '',
    pending: '未保存',
    saving: '保存中…',
    saved: '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    error: '保存失败',
  }[s] || '';
  // 保存成功后 3.5 秒淡出为小圆点，不常驻占用视觉空间；其它状态保持醒目
  if (s === 'saved') {
    saveFadeTimer = setTimeout(() => {
      els.saveState.textContent = '●';
      els.saveState.classList.add('faded');
      els.saveState.title = '已保存';
    }, 3500);
  } else {
    els.saveState.removeAttribute('title');
  }
}

function markDirty() {
  dirty = true;
  setSaveState('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}

async function flush() {
  clearTimeout(saveTimer);
  if (!state.book || !dirty) return;
  dirty = false;
  setSaveState('saving');
  try {
    await rpc('saveBook', { id: state.book.id, data: state.book });
    setSaveState('saved');
  } catch (e) {
    dirty = true;
    setSaveState('error');
    toast('保存失败：' + e.message);
  }
}

// ---------------------------------------------------------------- 渲染

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  const icon = state.theme === 'dark' || state.theme === 'tech' ? ICONS.sun : ICONS.moon;
  const t = THEMES.find(x => x.id === state.theme);
  const title = t ? '当前主题：' + t.name + '，点击切换' : '切换主题';
  for (const b of [els.btnTheme, els.shelfTheme]) {
    if (b) { b.innerHTML = icon; b.title = title; }
  }
}

function setTheme(t) {
  state.theme = t;
  applyTheme();
  saveSettingsSoon();
}

let settingsTimer = null;
function saveSettingsSoon() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const cur = await rpc('getSettings').catch(() => ({}));
    // 注意展开顺序：旧配置在前，本次的 theme / lastBookId 覆盖旧值
    await rpc('saveSettings', {
      data: {
        ...(cur && typeof cur === 'object' ? cur : {}),
        theme: state.theme,
        lastBookId: state.book ? state.book.id : null,
      },
    }).catch(() => {});
  }, 300);
}

function renderBackBtn() {
  els.bsTitle.textContent = state.book ? (state.book.title || '未命名作品') : '书架';
}

// ---------------------------------------------------------------- 书架

function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return '今天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

async function showShelf() {
  await flush();
  await refreshBooks();
  state.screen = 'shelf';
  els.app.hidden = true;
  els.shelf.hidden = false;
  playViewIn(els.shelf, true);  // 整页切换只淡入，避免整屏位移的"弹一下"感
  await renderShelf();
}

function renderShelf() {
  const sorted = [...state.books].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const has = sorted.length > 0;
  els.shelfHero.hidden = has;
  els.shelfGrid.hidden = !has;
  if (!has) return;
  els.shelfGrid.textContent = '';
  for (const b of sorted) {
    const card = h('div', { class: 'shelf-card', tabindex: '0', role: 'button' },
      h('div', { class: 'sc-title', text: b.title || '未命名作品' }),
      h('div', { class: 'sc-meta', text: (b.chapters || 0) + ' 章 · ' + (b.chars || 0) + ' 个角色' }),
      h('div', { class: 'sc-time', text: fmtTime(b.updatedAt) }));
    const actions = h('div', { class: 'sc-actions' });
    const ren = h('button', { class: 'toolbtn', title: '重命名' });
    ren.innerHTML = ICONS.pencil;
    ren.addEventListener('click', e => {
      e.stopPropagation();
      promptModal('重命名作品', '作品名称', b.title || '', async t => {
        await renameBook(b.id, t);
        await renderShelf();
      });
    });
    const del = h('button', { class: 'toolbtn warn', title: '删除' });
    del.innerHTML = ICONS.trash;
    del.addEventListener('click', e => { e.stopPropagation(); delBook(b.id, renderShelf); });
    actions.append(ren, del);
    card.append(actions);
    card.addEventListener('click', () => openBook(b.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBook(b.id); }
    });
    els.shelfGrid.append(card);
  }
  const add = h('button', { class: 'shelf-card add' }, icon('plus'), h('span', { text: '新建作品' }));
  add.addEventListener('click', () => templateModal({
    title: '新建作品',
    namePlaceholder: '作品名称，如：凡人修仙录',
    templates: PANEL_TEMPLATES,
    defaultId: 'default',
    okLabel: '开始创作',
  }, (name, tpl) => createBook(name, tpl)));
  els.shelfGrid.append(add);
}

function renderTree() {
  els.chapterTree.textContent = '';
  state.book.chapters.forEach((c, i) => {
    const li = h('li', { class: 'tree-item' });
    const row = h('div', { class: 'tree-ch' + (i === state.chIdx ? ' active' : ''), tabindex: '0', role: 'button' },
      h('span', { class: 'tree-no', text: String(c.no) }),
      h('span', { class: 'tree-title', text: c.title || '未命名' }));
    const del = h('button', { class: 'tree-del', title: '删除本章' }, icon('close'));
    del.addEventListener('click', e => {
      e.stopPropagation();
      confirmModal('删除第 ' + c.no + ' 章', '「' + (c.title || '未命名') + '」记录的变化将一并删除。', () => delChapter(i));
    });
    row.append(del);
    const activate = () => { if (state.chIdx !== i) switchChapter(i); };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
    li.append(row);
    els.chapterTree.append(li);
  });
  const act = els.chapterTree.querySelector('.tree-ch.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

function renderHeader() {
  const ch = curChapter();
  els.chNo.textContent = String(ch.no);
  if (document.activeElement !== els.chTitle) els.chTitle.value = ch.title;
}

// 本章（当前角色）是否动了该条目（差异圆点）
function fieldChanged(f) {
  if (isBase()) return false;
  return chapterChangedFids(peekDeltas()).has(f.id);
}

function toolBtn(iconName, title, cls, fn) {
  const b = h('button', { class: 'toolbtn' + (cls ? ' ' + cls : ''), title });
  b.innerHTML = ICONS[iconName] || '';
  b.addEventListener('click', fn);
  return b;
}

function fieldRow(f, fi, si) {
  const row = h('div', { class: 'field' + (fieldChanged(f) ? ' changed' : ''), 'data-fid': f.id });

  const name = h('input', { value: f.name, placeholder: '名称', spellcheck: 'false' });
  name.addEventListener('input', () => {
    f.name = name.value;
    recSet(f.id, { name: f.name });
    markDirty(); renderPreview(); refreshDot(row, f);
  });

  const valWrap = h('div', { class: 'f-value' });
  const badge = h('span', { class: 'chg' });
  const refreshBadge = () => {
    const t = isBase() ? null : chapterChangeBadge(peekDeltas(), f.id);
    const next = (f.type === 'number' || t === '新增') ? (t || '') : '';
    const changed = next && next !== badge.textContent;
    badge.textContent = next;
    badge.title = !t ? '' :
      t === '新增' ? '本章新增的条目，后面章节会继承' :
      t.startsWith('+') || t.startsWith('-') ? '本章相对上一章的变化；后面章节会随之加减' :
      '本章确定的值（锚定，不随前面章节变动）';
    // 科技主题：数值变化瞬间闪一次品红光。用 Web Animations API，每次调用新建实例，
    // 无需 class 切换或强制回流；徽章节点是复用的，故只能在文本变化时主动播放。
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (changed && !reduceMotion && document.documentElement.dataset.theme === 'tech' && badge.animate) {
      badge.animate([
        { textShadow: '0 0 0 rgba(240, 114, 214, 0)', filter: 'brightness(1)' },
        { textShadow: '0 0 14px rgba(240, 114, 214, .95), 0 0 28px rgba(240, 114, 214, .65)', filter: 'brightness(2)', offset: .3 },
        { textShadow: '0 0 0 rgba(240, 114, 214, 0)', filter: 'brightness(1)' },
      ], { duration: 760, easing: 'ease-out' });
    }
  };

  if (f.type === 'number') {
    const val = h('input', { class: 'numIn', value: String(f.value), inputmode: 'decimal', spellcheck: 'false', title: '↑↓ 增减（Shift ×10）；输入 +3 / -2 表示本章相对变化' });
    const parse = () => {
      const n = parseFloat(String(val.value).replace('，', '.').trim());
      return isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
    };
    // 是否为相对输入（+3 / -2）：这类输入在 input 阶段不锚定，留给 change 处理
    const isRelative = () => /^[+-]\s*\d/.test(String(val.value).trim());
    // 输入时实时更新状态（锚定语义），非法输入或相对输入暂不改动
    val.addEventListener('input', () => {
      if (isRelative()) return;  // +3/-2 等失焦时再按相对变化处理
      const n = parse();
      if (n !== null) f.value = n;
      recSet(f.id, { value: f.value });
      markDirty(); renderPreview(); refreshDot(row, f); refreshBadge();
    });
    // 失焦/回车时规范化显示；相对输入转为本章 delta
    val.addEventListener('change', () => {
      if (isRelative()) {
        const d = parse();
        if (d !== null && d !== 0) { stepField(f, d, val, row, refreshBadge); return; }
      }
      const shown = parse();
      if (shown === null) val.value = String(f.value);
      else { f.value = shown; val.value = String(shown); }
    });
    val.addEventListener('keydown', e => {
      if (e.key === 'Enter') { val.blur(); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();  // 阻止光标移动与输入焦点行为
        const unit = e.shiftKey ? 10 : 1;
        stepField(f, e.key === 'ArrowUp' ? unit : -unit, val, row, refreshBadge);
      }
    });
    const steps = h('div', { class: 'steps' });
    state.book.steps.forEach(n => {
      const b = h('button', { class: 'step', title: '本章发生 ' + (n > 0 ? '+' : '') + n + '（Shift=减去；后面章节会随之加减）', text: '+' + trimNum(n) });
      b.addEventListener('click', e => stepField(f, e.shiftKey ? -n : n, val, row, refreshBadge));
      steps.append(b);
    });
    valWrap.append(val, badge, steps);
  } else {
    const val = h('input', { class: 'txtIn', value: String(f.value), spellcheck: 'false', placeholder: '内容' });
    val.addEventListener('input', () => {
      f.value = val.value;
      recSet(f.id, { value: f.value });
      markDirty(); renderPreview(); refreshDot(row, f); refreshBadge();
    });
    val.addEventListener('keydown', e => { if (e.key === 'Enter') val.blur(); });
    valWrap.append(val, badge);
  }
  refreshBadge();

  const tools = h('div', { class: 'f-tools' });
  const typeBtn = h('button', { class: 'toolbtn', title: f.type === 'number' ? '切换为文本' : '切换为数值', text: f.type === 'number' ? '数' : '文' });
  typeBtn.addEventListener('click', () => {
    if (f.type === 'number') { f.type = 'text'; f.value = String(f.value); }
    else { f.type = 'number'; f.value = num(f.value); }
    recSet(f.id, { type: f.type, value: f.value });
    markDirty(); renderFields(); renderPreview();
  });
  tools.append(
    typeBtn,
    toolBtn('trash', '删除', 'warn', () => {
      curPanel()[si].fields.splice(fi, 1);
      recFieldDel(f.id);
      markDirty(); renderFields(); renderPreview();
    }),
  );

  row.append(h('div', { class: 'f-name' }, name), valWrap, tools);

  // 拖拽排序：抓手按住后整行可拖（支持跨分组）
  const grip = h('div', { class: 'f-grip', title: '拖拽排序（可跨分组）' });
  grip.innerHTML = ICONS.grip;
  grip.addEventListener('mousedown', () => { row.draggable = true; });
  grip.addEventListener('mouseup', () => { row.draggable = false; });
  row.append(grip);
  row.addEventListener('dragstart', e => {
    if (!row.draggable) { e.preventDefault(); return; }
    dragFid = f.id;
    row.classList.add('dragging');
    try { e.dataTransfer.setData('text/plain', f.id); } catch (err) { /* 忽略 */ }
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    row.draggable = false;
    clearDropMarks();
    dragFid = null;
  });

  return row;
}

let dragFid = null;
let dragSid = null;
function clearDropMarks() {
  document.querySelectorAll('.field.drop-above, .field.drop-below, .section.drop-into, .section.drop-above, .section.drop-below')
    .forEach(el => el.classList.remove('drop-above', 'drop-below', 'drop-into'));
}

// 记录相对移动指令：字段移动到某分组某位置（after 字段之后；null=组首）。
// 顺序是全书属性：拖拽发生在任意章，指令会同步写入该字段所在的每一章，
// 因此前面/后面章节全部同步。
function moveFieldDragIn(secs, fid, sid, after) {
  let moved = null;
  for (const s of secs) {
    const i = s.fields.findIndex(x => x.id === fid);
    if (i >= 0) { moved = s.fields.splice(i, 1)[0]; break; }
  }
  if (!moved) return;
  let sec = secs.find(s => s.id === sid);
  if (!sec) { sec = { id: sid, name: '', fields: [] }; secs.push(sec); }
  const idx = after ? sec.fields.findIndex(f => f.id === after) : -1;
  sec.fields.splice(idx >= 0 ? idx + 1 : 0, 0, moved);
}

function recMoveAll(fid, sid, after) {
  if (isBase()) return;  // 基准章直接改基准
  const charId = state.curChar;
  const char = state.book.characters.find(c => c.id === charId);
  state.book.chapters.forEach((chap, i) => {
    if (chap.no < char.startNo) return;
    const arr = state.resolvedByChar[charId] && state.resolvedByChar[charId][i];
    if (!arr || !arr.some(s => s.fields.some(f => f.id === fid))) return;  // 本章无此字段
    moveFieldDragIn(arr, fid, sid, after);
    if (chap.no !== char.startNo) {
      if (!chap.deltasByChar) chap.deltasByChar = {};
      if (!chap.deltasByChar[charId]) chap.deltasByChar[charId] = [];
      chap.deltasByChar[charId].push({ op: 'move', fid, sid, after: after || null });
    }
  });
  renderFields(); renderPreview(); markDirty();
}

function recSecMoveAll(sid, after) {
  if (isBase()) return;
  const charId = state.curChar;
  const char = state.book.characters.find(c => c.id === charId);
  state.book.chapters.forEach((chap, i) => {
    if (chap.no < char.startNo) return;
    const arr = state.resolvedByChar[charId] && state.resolvedByChar[charId][i];
    if (!arr || !arr.some(s => s.id === sid)) return;
    const idx = arr.findIndex(s => s.id === sid);
    const sec = arr.splice(idx, 1)[0];
    const j = after ? arr.findIndex(s => s.id === after) : -1;
    arr.splice(j >= 0 ? j + 1 : 0, 0, sec);
    if (chap.no !== char.startNo) {
      if (!chap.deltasByChar) chap.deltasByChar = {};
      if (!chap.deltasByChar[charId]) chap.deltasByChar[charId] = [];
      chap.deltasByChar[charId].push({ op: 'secmove', sid, after: after || null });
    }
  });
  renderFields(); renderPreview(); markDirty();
}

function refreshDot(row, f) {
  row.classList.toggle('changed', fieldChanged(f));
}

function trimNum(n) {
  return String(n);
}

function stepField(f, delta, val, row, refreshBadge) {
  f.value = round6(num(f.value) + delta);
  val.value = String(f.value);
  recValueAdd(f.id, delta);
  markDirty(); renderPreview(); refreshDot(row, f);
  if (refreshBadge) refreshBadge();
}

// ---------------------------------------------------------------- 角色切换

function renderCharTabs() {
  els.charTabs.textContent = '';
  const no = curChapter().no;
  const all = state.book.characters;
  for (const c of all) {
    const off = no < c.startNo;  // 本章尚未登场
    const b = h('button', {
      class: 'char-chip' + (c.id === state.curChar && !off ? ' active' : '') + (off ? ' off' : ''),
      title: off ? (c.name || '角色') + ' 第 ' + c.startNo + ' 章才登场，本章还没有 TA 的面板' : '',
    });
    b.append(h('span', { class: 'chip-name', text: c.name || '角色' }));
    if (c.startNo > 1) b.append(h('span', { class: 'chip-since', text: '第' + c.startNo + '章登场' }));
    b.addEventListener('click', () => {
      if (off) { toast('「' + (c.name || '角色') + '」第 ' + c.startNo + ' 章才登场，本章还没有 TA 的面板'); return; }
      if (state.curChar === c.id) return;
      state.curChar = c.id;
      resolveAll();
      renderCharTabs();
      renderFields();
      renderPreview();
    });
    // 右上角小 ×：直接删除该角色（最后一个角色不显示）
    if (all.length > 1) {
      const x = h('span', { class: 'chip-x', title: '删除角色「' + (c.name || '角色') + '」' });
      x.innerHTML = ICONS.close;
      x.addEventListener('click', e => { e.stopPropagation(); delCharacter(c.id); });
      b.append(x);
    }
    els.charTabs.append(b);
  }
  const addBtn = h('button', { class: 'char-chip add', text: '＋ 新角色', title: '新角色从本章登场；可选面板模板' });
  addBtn.addEventListener('click', () => templateModal({
    title: '新角色（从本章登场）',
    namePlaceholder: '角色名，如：林雨',
    templates: CHAR_TEMPLATES,
    defaultId: '__cur',
    okLabel: '创建角色',
  }, (name, tpl) => createCharacter(name, tpl)));
  els.charTabs.append(addBtn);
}

async function createCharacter(name, tplId) {
  await flush();
  // 条目结构：tplId 为 '__cur' 时参考当前面板；否则用模板。数值全部归零，名字字段填角色名
  let template;
  if (tplId === '__cur') {
    template = deep(curPanel());
  } else {
    template = templateSections(tplId);
  }
  template.forEach(s => {
    s.id = uid();
    s.fields.forEach(f => {
      f.id = uid();
      if (f.type === 'number') f.value = 0;
      else f.value = '';
    });
  });
  const nameKeys = ['宿主', '姓名', '名字', '角色名', '名称'];
  let named = false;
  template.forEach(s => s.fields.forEach(f => {
    if (!named && f.type === 'text' && nameKeys.includes(f.name)) { f.value = name; named = true; }
  }));
  const ch = makeCharacter(name, curChapter().no, template);
  state.book.characters.push(ch);
  state.curChar = ch.id;
  resolveAll();
  markDirty(); renderAll(); flush();
  toast('「' + name + '」从第 ' + ch.startNo + ' 章登场，面板数值全 0，宿主已填为角色名');
}

async function delCharacter(id) {
  const c = state.book.characters.find(x => x.id === id);
  if (!c) return;
  confirmModal('删除角色「' + c.name + '」', '其在所有章节的面板数据将一并删除。', async () => {
    await flush();
    state.book.characters = state.book.characters.filter(x => x.id !== id);
    state.book.chapters.forEach(ch => { if (ch.deltasByChar) delete ch.deltasByChar[id]; });
    if (state.curChar === id) state.curChar = state.book.characters[0].id;
    resolveAll();
    markDirty(); renderAll(); flush();
    toast('已删除角色');
  }, '删除');
}

function renderFields() {
  els.fieldsWrap.textContent = '';
  const secs = curPanel();

  if (!secs.length) {
    els.fieldsWrap.append(h('div', { class: 'empty', text: isBase() ? '基准面板还没有数据，从下面添加。' : '这一章还没有数据。在下方添加一个分组或直接添加条目。' }));
  }

  secs.forEach((sec, si) => {
    const s = h('div', { class: 'section', 'data-sid': sec.id });

    const name = h('input', { class: 'sec-name', value: sec.name, placeholder: '分组名', spellcheck: 'false' });
    name.addEventListener('input', () => {
      sec.name = name.value;
      recSectionRename(sec.id, sec.name);
      markDirty(); renderPreview();
    });
    const title = h('div', { class: 'sec-title' },
      h('span', { class: 'sec-dash', text: '——' }),
      name,
      h('span', { class: 'sec-dash', text: '——' }));
    const tools = h('div', { class: 'sec-tools' },
      toolBtn('trash', '删除分组', 'warn', () => delSection(si)),
    );
    const head = h('div', { class: 'sec-head' }, title, tools);
    s.append(head);

    // 分组拖拽排序：抓手按住后整组可拖（与条目拖拽同一套 drop 逻辑）
    const grip = h('div', { class: 's-grip', title: '拖拽排序分组' });
    grip.innerHTML = ICONS.grip;
    grip.addEventListener('mousedown', () => { head.draggable = true; });
    grip.addEventListener('mouseup', () => { head.draggable = false; });
    head.append(grip);
    head.addEventListener('dragstart', e => {
      if (!head.draggable) { e.preventDefault(); return; }
      dragSid = sec.id;
      s.classList.add('dragging');
      try { e.dataTransfer.setData('text/plain', sec.id); } catch (err) { /* 忽略 */ }
      e.dataTransfer.effectAllowed = 'move';
    });
    head.addEventListener('dragend', () => {
      s.classList.remove('dragging');
      head.draggable = false;
      clearDropMarks();
      dragSid = null;
    });

    sec.fields.forEach((f, fi) => s.append(fieldRow(f, fi, si)));

    const addBtn = h('button', { class: 'sec-add' }, icon('plus'), '添加条目');
    addBtn.addEventListener('click', () => {
      const nf = makeField('', 'number', 0);
      const after = sec.fields.length ? sec.fields[sec.fields.length - 1].id : null;
      sec.fields.push(nf);
      recFieldAdd(nf, sec.id, after, sec.name);
      markDirty(); renderFields(); renderPreview();
      const target = els.fieldsWrap.querySelector('.field[data-fid="' + nf.id + '"] .f-name input');
      if (target) target.focus();
    });
    s.append(addBtn);

    els.fieldsWrap.append(s);
  });

  const addSec = h('button', { class: 'add-section' }, icon('plus'), '添加分组');
  addSec.addEventListener('click', () => {
    const sec = { id: uid(), name: '新分组', fields: [] };
    const after = secs.length ? secs[secs.length - 1].id : null;
    secs.push(sec);
    recSectionAdd(sec.id, sec.name, after);
    markDirty(); renderFields(); renderPreview();
    const inputs = els.fieldsWrap.querySelectorAll('.sec-head input');
    const last = inputs[inputs.length - 1];
    if (last) { last.focus(); last.select(); }
  });
  els.fieldsWrap.append(addSec);
}

function panelText(sections) {
  const lines = ['【系统面板】'];
  const hasData = sections.some(s => s.fields.length);
  if (!sections.length || !hasData) return lines.join('\n') + '\n（暂无数据）';
  sections.forEach(sec => {
    lines.push('—— ' + (sec.name || '未分组') + ' ——');
    sec.fields.forEach(f => {
      lines.push((f.name || '未命名') + '：' + String(f.value == null ? '' : f.value));
    });
  });
  return lines.join('\n');
}

// 右侧面板头部（角色切换片与字段编辑由 renderCharTabs / renderFields 负责）
function renderPreview() {
  const ch = curChapter();
  const c = curCharObj();
  els.pvChar.textContent = '· ' + (c.name || '角色');
  els.pvCh.textContent = '第 ' + ch.no + ' 章' + (ch.title ? ' · ' + ch.title : '');
}

// 中间正文编辑区
function renderEditor() {
  els.editor.value = curChapter().content || '';
  autogrow();
  updateWordCount();
}

function renderAll() {
  renderBackBtn();
  renderTree();
  renderHeader();
  renderEditor();
  renderCharTabs();
  renderFields();
  renderPreview();
}

function switchChapter(i) {
  flush();
  state.chIdx = i;
  resolveAll();  // 校验当前角色在本章是否存在，不存在则回落
  renderTree();
  renderHeader();
  renderEditor();
  renderCharTabs();
  renderFields();
  renderPreview();
  // 内容轻淡入：作用在非滚动容器（#fieldsWrap / #editor）上，
  // 避免 transform 动画作用到 overflow:auto 容器导致滚动条抖动、内容视觉下移
  playViewIn(els.fieldsWrap);
  playViewIn(els.editor, true);  // textarea 只淡入、不位移
}

function updateWordCount() {
  const n = (els.editor.value.replace(/\s/g, '')).length;
  els.wordCount.textContent = n.toLocaleString('zh-CN') + ' 字';
}

function autogrow() {
  els.editor.style.height = 'auto';
  els.editor.style.height = els.editor.scrollHeight + 'px';
}

// ---------------------------------------------------------------- 操作

function delChapter(i) {
  flush();
  state.book.chapters.splice(i, 1);
  if (state.chIdx >= state.book.chapters.length) state.chIdx = state.book.chapters.length - 1;
  if (state.chIdx < 0) state.chIdx = 0;
  resolveAll();
  markDirty(); renderAll(); flush();
}

function delSection(si) {
  const sec = curPanel()[si];
  const doIt = () => {
    curPanel().splice(si, 1);
    recSectionDel(sec.id);
    markDirty(); renderFields(); renderPreview(); flush();
  };
  if (sec.fields.length) {
    confirmModal('删除分组「' + (sec.name || '未命名') + '」', '分组内 ' + sec.fields.length + ' 条数据在本章及后面章节将一并删除。', doIt);
  } else {
    doIt();
  }
}

async function addChapter() {
  await flush();
  const chs = state.book.chapters;
  const prev = chs[chs.length - 1];
  const no = prev ? prev.no + 1 : 1;
  const ch = { id: uid(), no, title: '', deltas: [], content: '' };
  chs.push(ch);
  state.chIdx = chs.length - 1;
  resolveAll();
  renderAll();
  markDirty(); flush();
  toast('第 ' + no + ' 章已创建，自动继承前面的面板');
}

async function copyPanel() {
  const text = panelText(curPanel());
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制本章面板');
  } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制本章面板');
  }
}

async function createBook(title, tplId) {
  const book = {
    id: uid(),
    title: title || '未命名作品',
    steps: [...DEFAULT_STEPS],
    format: PANEL_FORMAT,
    characters: [makeCharacter('主角', 1, templateSections(tplId || 'default'))],
    chapters: [{ id: uid(), no: 1, title: '', content: '', deltasByChar: {} }],
  };
  await rpc('saveBook', { id: book.id, data: book });
  await refreshBooks();
  await openBook(book.id);
}

async function refreshBooks() {
  state.books = await rpc('listBooks');
}

async function openBook(id) {
  await flush();
  const raw = await rpc('loadBook', { id });
  const wasOld = raw && raw.format !== PANEL_FORMAT;
  state.book = normalizeBook(raw);
  state.curChar = state.book.characters[0].id;
  resolveAll();
  state.chIdx = state.book.chapters.length - 1;   // 续写：停在最后一章
  if (state.chIdx < 0) state.chIdx = 0;
  if (wasOld) { markDirty(); flush(); toast('已升级：修改任何一章，后面章节会自动按各自变化重算'); }
  saveSettingsSoon();
  state.screen = 'workbench';
  els.shelf.hidden = true;
  els.app.hidden = false;
  playViewIn(els.app, true);  // 同上：整页淡入
  renderAll();
}

async function delBook(id, after) {
  const b = state.books.find(x => x.id === id);
  confirmModal('删除作品', '《' + (b ? b.title : '') + '》的全部章节面板与正文将一并删除。', async () => {
    await flush();
    await rpc('deleteBook', { id });
    await refreshBooks();
    if (state.book && state.book.id === id) {
      state.book = null;
      await showShelf();
    }
    if (after) await after();
    toast('已删除');
  });
}

async function renameBook(id, title) {
  if (state.book && state.book.id === id) {
    state.book.title = title;
    markDirty();
    await flush();
  } else {
    const data = await rpc('loadBook', { id });
    data.title = title;
    await rpc('saveBook', { id, data });
  }
  await refreshBooks();
  renderBackBtn();
}

const EXPORT_MODES = [
  { id: 'novel', name: '小说正文', desc: '每章标题与正文内容（不含面板）' },
  { id: 'novel_panel', name: '正文＋面板', desc: '每章正文后附本章各角色面板，可直接粘贴进章节' },
  { id: 'panels', name: '仅面板汇总', desc: '每章面板数据汇总（不含正文）' },
];

function chapterPanelBlocks(i) {
  const blocks = [];
  state.book.characters.forEach(ch => {
    const arr = state.resolvedByChar[ch.id];
    const secs = arr && arr[i];
    if (!secs) return;
    blocks.push(panelText(secs).replace('【系统面板】', '【系统面板 · ' + (ch.name || '角色') + '】'));
  });
  return blocks;
}

function buildExportText(mode) {
  resolveAll();
  const parts = ['《' + state.book.title + '》', ''];
  state.book.chapters.forEach((c, i) => {
    parts.push('── 第 ' + c.no + ' 章' + (c.title ? ' · ' + c.title : '') + ' ──');
    if (mode === 'panels') {
      chapterPanelBlocks(i).forEach(b => { parts.push(b); parts.push(''); });
      return;
    }
    const content = (c.content || '').trim();
    parts.push(content || '（本章暂无正文）');
    if (mode === 'novel_panel') {
      parts.push('');
      chapterPanelBlocks(i).forEach(b => { parts.push(b); parts.push(''); });
    }
    parts.push('');
  });
  return parts.join('\n');
}

function openExport() {
  if (!state.book) return;
  let sel = 'novel';
  const list = h('div', { class: 'tpl-list' });
  EXPORT_MODES.forEach(m => {
    const row = h('div', { class: 'tpl-row' + (m.id === sel ? ' on' : ''), tabindex: '0', role: 'button' },
      h('span', { class: 'tpl-radio' }),
      h('div', { class: 'tpl-info' },
        h('div', { class: 'tpl-name', text: m.name }),
        h('div', { class: 'tpl-desc', text: m.desc })));
    const pick = () => {
      sel = m.id;
      list.querySelectorAll('.tpl-row').forEach(r => r.classList.remove('on'));
      row.classList.add('on');
    };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    list.append(row);
  });
  const ok = h('button', { class: 'btn-primary', text: '导出' });
  ok.addEventListener('click', () => { closeModal(); doExport(sel); });
  openModal(h('div', { class: 'modal small' },
    h('div', { class: 'm-title', text: '导出' }),
    h('div', { class: 'm-label', text: '选择导出内容' }),
    list,
    h('div', { class: 'm-row' },
      h('button', { class: 'ghost', text: '取消', onclick: closeModal }),
      ok),
  ));
}

async function doExport(mode) {
  if (!state.book) return;
  await flush();
  const text = buildExportText(mode);
  const d = new Date();
  const ds = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const label = mode === 'novel' ? '小说正文' : mode === 'novel_panel' ? '正文加面板' : '系统面板汇总';
  const r = await rpc('exportAll', { filename: state.book.title + '-' + label + '-' + ds, data: text });
  toast('已导出：' + r.path);
}

// ---------------------------------------------------------------- 弹窗 / Toast

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

let modalCloseTimer = null;
function openModal(node) {
  clearTimeout(modalCloseTimer);
  els.modalRoot.classList.remove('closing');
  els.modalRoot.textContent = '';
  els.modalRoot.append(node);
  els.modalRoot.classList.add('show');
}

// 视图/内容淡入：hidden 切换无法做 CSS 过渡，用一次性动画类代替。
// fadeOnly=true 时只做透明度（用于 textarea 等不适合位移的元素）。
function playViewIn(el, fadeOnly) {
  if (!el) return;
  const cls = fadeOnly ? 'view-fade' : 'view-in';
  el.classList.remove('view-in', 'view-fade');
  void el.offsetWidth;  // 强制重排，让动画可重复触发
  el.classList.add(cls);
}
function closeModal() {
  const root = els.modalRoot;
  if (!root.classList.contains('show') || root.classList.contains('closing')) return;
  root.classList.add('closing');  // 先播 130ms 渐隐动画再真正移除，避免瞬间消失
  clearTimeout(modalCloseTimer);
  modalCloseTimer = setTimeout(() => {
    root.classList.remove('show', 'closing');
    root.textContent = '';
  }, 135);
}

function confirmModal(title, body, onYes, yesLabel = '删除') {
  const yes = h('button', { class: 'btn-danger', text: yesLabel });
  yes.addEventListener('click', () => { closeModal(); onYes(); });
  openModal(h('div', { class: 'modal small' },
    h('div', { class: 'm-title', text: title }),
    h('div', { class: 'm-body', text: body }),
    h('div', { class: 'm-row' },
      h('button', { class: 'ghost', text: '取消', onclick: closeModal }),
      yes),
  ));
}

function promptModal(title, placeholder, initial, onOk) {
  const inp = h('input', { class: 'set-in', placeholder: placeholder || '', value: initial || '', spellcheck: 'false' });
  const ok = h('button', { class: 'btn-primary', text: '确定' });
  const commit = () => {
    const v = inp.value.trim();
    if (!v) { inp.focus(); return; }
    closeModal();
    onOk(v);
  };
  ok.addEventListener('click', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') commit();
  });
  openModal(h('div', { class: 'modal small' },
    h('div', { class: 'm-title', text: title }),
    inp,
    h('div', { class: 'm-row' },
      h('button', { class: 'ghost', text: '取消', onclick: closeModal }),
      ok),
  ));
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

function ghostBtn(label, iconName, fn) {
  const b = h('button', { class: 'ghost' }, icon(iconName), label);
  b.addEventListener('click', fn);
  return b;
}

const HELP_SECTIONS = [
  ['快速上手',
   '书架新建作品进入工作台：第 1 章就是基准面板；点「新建章节」写下一章，自动继承前面的面板。中间写正文，右侧面板直接维护数值，全部自动保存。'],
  ['面板是怎么算的',
   '第 1 章是基准面板。之后每一章只记录本章的变化，面板显示的始终是完整结果。＋N 按钮 = 本章发生了 +N（后面章节会跟着加减）；直接输入数值 = 本章确定为该值（锚定）。因此写到 100 章时回头改第 50 章，后面章节会自动按各自的变化重新计算。'],
  ['多角色面板',
   '右侧面板顶部点 ＋ 新角色：该角色从当前章登场，面板以你正在编辑的面板为模板，可自行删改。每个角色的数据完全隔离，互不影响。点角色片可随时切换编辑谁的面板——正好配合"主角能看见别人面板"的剧情。'],
  ['数值步长与排序',
   '行内步长按钮（默认 +1/+5/+10/+100/+1000）在设置里可自定义，逗号分隔、正数、最多 6 个；Shift＋点击 = 减去。条目与分组都按住左侧的 ⠿ 把手拖拽排序，条目还能跨分组拖动。'],
  ['正文写作',
   '中间就是正文编辑区，右上角实时字数，右侧面板随时对照和修改数值。👁 按钮可以收起/展开面板栏，内容自动保存。'],
  ['数据与备份',
   '所有数据自动保存在 %APPDATA%\\NovelPanel\\（books\\ 下每部作品一个 JSON 文件）。设置里可一键打开数据文件夹、导出全部章节为 TXT。建议偶尔把 books 文件夹复制一份作为备份。'],
];

function openHelp() {
  const box = h('div', { class: 'modal help' },
    h('div', { class: 'm-title', text: '使用说明' }));
  HELP_SECTIONS.forEach(([t, body]) => {
    box.append(h('div', { class: 'm-label', text: t }));
    box.append(h('div', { class: 'm-body', text: body }));
  });
  box.append(h('div', { class: 'm-row' }, h('button', { class: 'ghost', text: '关闭', onclick: closeModal })));
  openModal(box);
}

function openSettings() {
  if (!state.book) return;
  refreshBooks().then(() => {
    const b = state.book;

    // 外观
    const seg = h('div', { class: 'seg' });
    THEMES.forEach(t => {
      seg.append(h('button', {
        class: 'seg-b' + (state.theme === t.id ? ' on' : ''),
        text: t.name,
        onclick: () => { setTheme(t.id); openSettings(); },
      }));
    });

    // 步长（输入即实时生效，失焦时规范化显示）
    const stepsIn = h('input', { class: 'set-in', value: b.steps.join(', '), spellcheck: 'false' });
    stepsIn.addEventListener('input', () => {
      const v = parseSteps(stepsIn.value);
      if (v.length && v.join() !== b.steps.join()) {
        b.steps = v;
        markDirty(); flush(); renderFields();
      }
    });
    stepsIn.addEventListener('change', () => { stepsIn.value = b.steps.join(', '); });

    // 数据
    const dir = h('div', { class: 'm-dir', text: g_dataDir || '（未知）' });

    openModal(h('div', { class: 'modal' },
      h('div', { class: 'm-title', text: '设置' }),
      h('div', { class: 'm-label', text: '外观' }), seg,
      h('div', { class: 'm-label', text: '数值步长按钮' }), stepsIn,
      h('div', { class: 'm-hint', text: '逗号分隔，正数，最多 6 个；行内按钮 Shift+点击 为减去。' }),
      h('div', { class: 'm-label', text: '数据与导出' }), dir,
      h('div', { class: 'm-actions' },
        ghostBtn('打开数据文件夹', 'folder', () => rpc('openPath', { path: g_dataDir })),
        ghostBtn('导出 TXT', 'export', openExport),
        ghostBtn('使用说明', 'help', openHelp),
      ),
      h('div', { class: 'm-row' }, h('button', { class: 'ghost', text: '关闭', onclick: closeModal })),
    ));
  });
}

// ---------------------------------------------------------------- 事件绑定

els.btnAddChapter.addEventListener('click', addChapter);
els.btnCopy.addEventListener('click', copyPanel);
function cycleTheme() {  // 浅色 → 深色 → 仙侠 → 科技 → 液态玻璃 → 浅色
  const i = THEMES.findIndex(t => t.id === state.theme);
  setTheme(THEMES[(i + 1) % THEMES.length].id);
}
els.btnTheme.addEventListener('click', cycleTheme);
els.shelfTheme.addEventListener('click', cycleTheme);
els.btnHelp.addEventListener('click', openHelp);
els.btnHelp2.addEventListener('click', openHelp);
els.btnBackShelf.addEventListener('click', () => showShelf());
function setPreviewDrawer(open) {
  document.body.classList.toggle('preview-open', open);
  syncPreviewIcon();
}
// 面板显隐按钮图标与实际状态保持一致（宽窗=整列，窄窗=抽屉）
function syncPreviewIcon() {
  const narrow = window.matchMedia('(max-width: 1000px)').matches;
  const visible = narrow ? document.body.classList.contains('preview-open')
                         : !document.body.classList.contains('preview-closed');
  els.btnPreviewToggle.innerHTML = visible ? ICONS.close : ICONS.eye;
}
els.btnPreviewToggle.addEventListener('click', () => {
  const narrow = window.matchMedia('(max-width: 1000px)').matches;
  if (narrow) setPreviewDrawer(!document.body.classList.contains('preview-open'));
  else {
    document.body.classList.toggle('preview-closed');
    syncPreviewIcon();
  }
});
els.btnPvClose.addEventListener('click', () => setPreviewDrawer(false));
document.addEventListener('click', e => {  // 抽屉打开时点外部收起
  const narrow = window.matchMedia('(max-width: 1000px)').matches;
  if (!narrow || !document.body.classList.contains('preview-open')) return;
  if (els.preview.contains(e.target) || els.btnPreviewToggle.contains(e.target)) return;
  setPreviewDrawer(false);
});
window.addEventListener('resize', syncPreviewIcon);  // 跨过宽度断点时同步按钮图标
els.btnSettings.addEventListener('click', openSettings);

// 判断 drop 落点：目标在源行上方时判定线偏下（更容易判"插到它上面"），
// 目标在源行下方时判定线偏上——双向拖拽都对齐到鼠标所在的那一侧。
function dropBelow(e, row) {
  const srcRow = document.querySelector('.field[data-fid="' + dragFid + '"]');
  const rect = row.getBoundingClientRect();
  const srcTop = srcRow ? srcRow.getBoundingClientRect().top : rect.top;
  const ratio = rect.top < srcTop ? 0.65 : 0.35;
  return e.clientY > rect.top + rect.height * ratio;
}

// 分组拖放落点：与条目同理
function dropSecBelow(e, secEl) {
  const srcEl = document.querySelector('.section[data-sid="' + dragSid + '"]');
  const rect = secEl.getBoundingClientRect();
  const srcTop = srcEl ? srcEl.getBoundingClientRect().top : rect.top;
  const ratio = rect.top < srcTop ? 0.65 : 0.35;
  return e.clientY > rect.top + rect.height * ratio;
}

// 条目拖拽排序（容器级委托；move/secmove 相对指令持久化，可跨分组、可拖入空分组）。
// 分组自身也能按住 sec-head 左侧抓手拖动排序。
els.fieldsWrap.addEventListener('dragover', e => {
  if (!dragFid && !dragSid) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const row = e.target.closest('.field');
  const secEl = e.target.closest('.section');
  if (dragSid) {  // 拖的是分组：只对分组边界做指示
    if (secEl && secEl.dataset.sid !== dragSid) {
      secEl.classList.add(dropSecBelow(e, secEl) ? 'drop-below' : 'drop-above');
    }
    return;
  }
  if (row && row.dataset.fid !== dragFid) {
    row.classList.add(dropBelow(e, row) ? 'drop-below' : 'drop-above');
  } else if (!row && secEl) {
    secEl.classList.add('drop-into');
  }
});
els.fieldsWrap.addEventListener('drop', e => {
  if (dragSid) {  // 分组拖放：落到目标分组上方/下方
    e.preventDefault();
    clearDropMarks();
    const sid = dragSid;
    dragSid = null;
    const secEl = e.target.closest('.section');
    if (!secEl || secEl.dataset.sid === sid) return;
    const secs = curPanel();
    const tIdx = secs.findIndex(s => s.id === secEl.dataset.sid);
    if (tIdx < 0) return;
    const after = dropSecBelow(e, secEl) ? secs[tIdx].id : (tIdx > 0 ? secs[tIdx - 1].id : null);
    recSecMoveAll(sid, after);
    return;
  }
  if (!dragFid) return;
  e.preventDefault();
  clearDropMarks();
  const fid = dragFid;
  dragFid = null;
  const row = e.target.closest('.field');
  const secEl = e.target.closest('.section');
  let sid = null, after = null;
  if (row) {
    const sec = curPanel().find(s => s.fields.some(f => f.id === row.dataset.fid));
    if (!sec) return;
    sid = sec.id;
    const idx = sec.fields.findIndex(f => f.id === row.dataset.fid);
    const below = dropBelow(e, row);
    after = below ? row.dataset.fid : (idx > 0 ? sec.fields[idx - 1].id : null);
  } else if (secEl) {
    sid = secEl.dataset.sid;
    if (!sid) return;
    const sec = curPanel().find(s => s.id === sid);
    after = sec && sec.fields.length ? sec.fields[sec.fields.length - 1].id : null;
  } else return;
  recMoveAll(fid, sid, after);
});
els.chTitle.addEventListener('input', () => {
  curChapter().title = els.chTitle.value;
  markDirty(); renderPreview();
  const items = els.chapterTree.querySelectorAll('.tree-ch');
  if (items[state.chIdx]) {
    items[state.chIdx].querySelector('.tree-title').textContent = els.chTitle.value || '未命名';
  }
});
els.editor.addEventListener('input', () => {
  curChapter().content = els.editor.value;
  autogrow();
  updateWordCount();
  markDirty();
});
els.editor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {  // 编辑器内 Tab 缩进两个空格，而不是跳出焦点
    e.preventDefault();
    const s = els.editor.selectionStart, epos = els.editor.selectionEnd;
    els.editor.value = els.editor.value.slice(0, s) + '  ' + els.editor.value.slice(epos);
    els.editor.selectionStart = els.editor.selectionEnd = s + 2;
    curChapter().content = els.editor.value;
    autogrow(); updateWordCount(); markDirty();
  }
});
els.heroCreate.addEventListener('click', () => templateModal({
  title: '新建作品',
  namePlaceholder: '作品名称，如：凡人修仙录',
  templates: PANEL_TEMPLATES,
  defaultId: 'default',
  okLabel: '开始创作',
  initialName: els.heroTitle.value.trim(),  // 首屏已输入的名字直接带入，省去重复输入
}, (name, tpl) => createBook(name, tpl)));
els.heroTitle.addEventListener('keydown', e => { if (e.key === 'Enter') els.heroCreate.click(); });
els.modalRoot.addEventListener('click', e => { if (e.target === els.modalRoot) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); if (window.matchMedia('(max-width: 1000px)').matches) setPreviewDrawer(false); }

  // 全局快捷键（仅在工作台内：app 可见、有作品、无弹窗时）
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || !state.book || els.modalRoot.classList.contains('show')) return;
  if (els.app.hidden) return;  // 还在书架/首屏，不响应

  if (e.key.toLowerCase() === 's') {
    e.preventDefault();  // 阻止浏览器"保存网页"对话框
    // 仅刷新顶部保存状态（显示"已保存 时:分:秒"再淡出），不弹 toast 重复提示
    if (dirty) flush(); else setSaveState('saved');  // 无改动时也给一次明确反馈
    return;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (!state.book || state.book.chapters.length < 1) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(state.book.chapters.length - 1, state.chIdx + (e.key === 'ArrowUp' ? -1 : 1)));
    if (next !== state.chIdx) switchChapter(next);
    return;
  }
  // 面板开关用 Alt+B（Ctrl+Tab 会与宿主/浏览器的标签切换冲突，故不用）
  if (e.altKey && !mod && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    if (window.matchMedia('(max-width: 1000px)').matches) {
      setPreviewDrawer(!document.body.classList.contains('preview-open'));
    } else {
      document.body.classList.toggle('preview-closed');
    }
    syncPreviewIcon();
    return;
  }
});
// 拖拽状态兜底：若鼠标在窗口外松开导致 grip 的 mouseup 未触发，
// document 级统一清理残留的 draggable，避免整行被误拖。
function resetDraggables() {
  document.querySelectorAll('.field[draggable="true"], .section > .sec-head[draggable="true"]')
    .forEach(el => el.removeAttribute('draggable'));
}
document.addEventListener('mouseup', resetDraggables);
document.addEventListener('dragend', resetDraggables);
window.addEventListener('beforeunload', () => {
  if (dirty && state.book && inApp) {
    window.chrome.webview.postMessage({ id: ++_rpcId, method: 'saveBook', params: { id: state.book.id, data: state.book } });
  }
});
setInterval(() => { if (dirty) flush(); }, 4000);

// ---------------------------------------------------------------- 启动

(async function boot() {
  els.btnTheme.innerHTML = ICONS.moon;
  els.shelfTheme.innerHTML = ICONS.moon;
  els.btnSettings.innerHTML = ICONS.gear;
  els.btnHelp.innerHTML = ICONS.help;
  els.btnHelp2.innerHTML = ICONS.help;
  els.btnAddChapter.querySelector('.ico').innerHTML = ICONS.plus;
  syncPreviewIcon();
  els.btnPvClose.innerHTML = ICONS.close;
  els.btnCopy.querySelector('.ico').innerHTML = ICONS.copy;
  const bsChev = els.btnBackShelf.querySelector('.bs-chev');
  if (bsChev) bsChev.innerHTML = ICONS.chevL;

  try {
    const info = await rpc('appInfo');
    g_dataDir = (info && info.dataDir) || '';
    const st = await rpc('getSettings');
    // 液态玻璃首次引入：一次性迁移到新默认主题，写入版本号；之后完全尊重用户选择。
    if (!st || st.glassV !== 1) {
      state.theme = 'glass';
      await rpc('saveSettings', {
        data: { ...(st && typeof st === 'object' ? st : {}), glassV: 1, theme: 'glass' },
      }).catch(() => {});
    } else {
      state.theme = st && THEMES.some(t => t.id === st.theme) ? st.theme : 'glass';
    }
    applyTheme();
    await refreshBooks();
    await showShelf();   // 书架 = 初始界面
  } catch (e) {
    toast('启动失败：' + e.message);
    els.shelf.hidden = false;
    playViewIn(els.shelf, true);  // 整页切换只淡入，避免整屏位移的"弹一下"感
    await renderShelf();
  }
})();

// 液态玻璃 · 指针高光跟随（.glassEffect interactive() 的 Web 转译）
// 事件委托 + rAF 节流，仅在 glass 主题且悬停于玻璃卡片时更新光斑坐标。
(function initGlassInteractive() {
  let queued = false;
  let px = 0, py = 0, target = null;
  function paint() {
    queued = false;
    if (target) {
      target.style.setProperty('--mx', px + 'px');
      target.style.setProperty('--my', py + 'px');
    }
  }
  document.addEventListener('pointermove', (e) => {
    if (document.documentElement.dataset.theme !== 'glass') return;
    const t = e.target.closest ? e.target.closest('.shelf-card, .section') : null;
    if (!t) return;
    const r = t.getBoundingClientRect();
    px = e.clientX - r.left;
    py = e.clientY - r.top;
    target = t;
    if (!queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
})();
