/* core.js — 面板数据模型（纯函数，无 DOM 依赖；浏览器与 Node 测试共用）
 *
 * 数据模型 v3（多角色增量式）：
 *   book = {
 *     id, title, steps, format: 3,
 *     characters: [ { id, name, startNo, base: sections[] } ],
 *        // startNo = 角色入场章号：面板从该章开始存在，之前章节为 null
 *     chapters: [ { id, no, title, content, deltasByChar: { [charId]: [op...] } } ]
 *   }
 *   每个角色的每章面板 = 该角色 base（startNo 章）依次应用此后章节的 deltas。
 *   delta 操作（与 v2 相同）：
 *     value.add {fid,d} / field.set {fid,patch} / field.add / field.del /
 *     section.add / section.rename / section.del / order
 * 修改任何一章某角色的面板后重放 deltas，该角色后面章节自动重算。
 */
'use strict';

const PANEL_FORMAT = 3;
const DEFAULT_STEPS = [1, 5, 10, 100, 1000];

function deep(x) {
  return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x));
}

function uid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

function num(v) {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

function parseSteps(s) {
  return [...new Set(
    String(s).split(/[,，;；\s]+/)
      .map(x => parseFloat(x))
      .filter(n => isFinite(n) && n > 0)
  )].sort((a, b) => a - b).slice(0, 6);
}

function makeField(name, type, value) {
  return { id: uid(), name: name || '', type: type === 'number' ? 'number' : 'text', value };
}

function defaultSections() {
  return [{
    id: uid(), name: '基础',
    fields: [
      makeField('宿主', 'text', ''),
      makeField('等级', 'number', 1),
      makeField('积分', 'number', 0),
    ],
  }];
}

function makeCharacter(name, startNo, base) {
  return {
    id: uid(),
    name: name || '角色',
    startNo: Number.isFinite(startNo) && startNo >= 1 ? Math.round(startNo) : 1,
    base: base || defaultSections(),
  };
}

// ------------------------------------------------ 解析（重放 deltas）

function findFieldIn(sections, fid) {
  for (const s of sections) {
    const f = s.fields.find(x => x.id === fid);
    if (f) return { sec: s, field: f };
  }
  return null;
}

function applyDeltas(state, deltas) {
  if (!Array.isArray(deltas)) return state;
  for (const op of deltas) {
    switch (op && op.op) {
      case 'field.del': {
        for (const s of state) {
          const i = s.fields.findIndex(f => f.id === op.fid);
          if (i >= 0) s.fields.splice(i, 1);
        }
        break;
      }
      case 'field.set': {
        const hit = findFieldIn(state, op.fid);
        if (hit) Object.assign(hit.field, op.patch);
        break;
      }
      case 'value.add': {
        const hit = findFieldIn(state, op.fid);
        if (hit && hit.field.type === 'number') hit.field.value = round6(num(hit.field.value) + op.d);
        break;
      }
      case 'field.add': {
        let sec = state.find(s => s.id === op.sid);
        if (!sec) {
          sec = { id: op.sid, name: op.secName || '', fields: [] };
          state.push(sec);
        }
        const idx = op.after ? sec.fields.findIndex(f => f.id === op.after) : -1;
        sec.fields.splice(idx >= 0 ? idx + 1 : sec.fields.length, 0, deep(op.field));
        break;
      }
      case 'section.rename': {
        const s = state.find(x => x.id === op.sid);
        if (s) s.name = op.name;
        break;
      }
      case 'section.add': {
        const idx = op.after ? state.findIndex(s => s.id === op.after) : -1;
        state.splice(idx >= 0 ? idx + 1 : state.length, 0, { id: op.sid, name: op.name || '', fields: [] });
        break;
      }
      case 'section.del': {
        const i = state.findIndex(s => s.id === op.sid);
        if (i >= 0) state.splice(i, 1);
        break;
      }
      case 'order': {
        // 兼容保留：仅迁移期间使用；新数据一律用 move/secmove
        const pool = new Map();
        state.forEach(s => s.fields.forEach(f => pool.set(f.id, f)));
        const secMap = new Map(state.map(s => [s.id, s]));
        const ordered = [];
        for (const sid of op.sections || []) {
          const s = secMap.get(sid);
          if (s) ordered.push(s);
        }
        for (const s of state) if (!ordered.includes(s)) ordered.push(s);
        for (const s of ordered) {
          const list = (op.fieldsBySection || {})[s.id];
          const nf = [];
          if (Array.isArray(list)) {
            for (const fid of list) {
              const f = pool.get(fid);
              if (f) nf.push(f);
            }
          }
          s.fields = nf;
        }
        const placed = new Set();
        ordered.forEach(s => s.fields.forEach(f => placed.add(f.id)));
        const leftovers = [...pool.values()].filter(f => !placed.has(f.id));
        if (leftovers.length && ordered.length) ordered[ordered.length - 1].fields.push(...leftovers);
        state.length = 0;
        state.push(...ordered);
        break;
      }
      case 'move': {
        // 相对移动指令：把字段移到某分组的某位置（前面章节顺序变化时依然成立）
        let moved = null;
        for (const s of state) {
          const i = s.fields.findIndex(f => f.id === op.fid);
          if (i >= 0) { moved = s.fields.splice(i, 1)[0]; break; }
        }
        if (!moved) break;
        let sec = state.find(s => s.id === op.sid);
        if (!sec) { sec = { id: op.sid, name: op.secName || '', fields: [] }; state.push(sec); }
        const idx = op.after ? sec.fields.findIndex(f => f.id === op.after) : -1;
        sec.fields.splice(idx >= 0 ? idx + 1 : 0, 0, moved);
        break;
      }
      case 'secmove': {
        // 相对移动指令：把分组移到某分组之后（after=null 则移到最前）
        const i = state.findIndex(s => s.id === op.sid);
        if (i < 0) break;
        const sec = state.splice(i, 1)[0];
        const j = op.after ? state.findIndex(s => s.id === op.after) : -1;
        state.splice(j >= 0 ? j + 1 : 0, 0, sec);
        break;
      }
    }
  }
  return state;
}

// 解析整本书：返回 { [charId]: [sections|null, ...] }（与 chapters 对齐）。
// 角色入场章（no === startNo）的槽位是 char.base 本体（别名，供基准编辑直写）。
function resolveBook(book) {
  const out = {};
  for (const ch of book.characters) {
    const arr = [];
    let st = null;
    for (let i = 0; i < book.chapters.length; i++) {
      const no = book.chapters[i].no;
      if (no < ch.startNo) { arr.push(null); continue; }
      if (st === null) {
        st = deep(ch.base);
        arr.push(ch.base);  // 别名：入场章直接编辑基准
      } else {
        applyDeltas(st, (book.chapters[i].deltasByChar || {})[ch.id] || []);
        arr.push(deep(st));
      }
    }
    out[ch.id] = arr;
  }
  return out;
}

// ------------------------------------------------ diff / order

function orderOpFrom(sections) {
  const fieldsBySection = {};
  sections.forEach(s => { fieldsBySection[s.id] = s.fields.map(f => f.id); });
  return { op: 'order', sections: sections.map(s => s.id), fieldsBySection };
}

// 两个已解析面板之间的变化 → delta 操作列表（数值差异记为相对变化）
function diffSections(prevSecs, nextSecs) {
  const ops = [];
  const prevF = new Map();
  prevSecs.forEach(s => s.fields.forEach(f => prevF.set(f.id, { f, sid: s.id })));
  const nextF = new Map();
  nextSecs.forEach(s => s.fields.forEach(f => nextF.set(f.id, { f, sid: s.id })));

  for (const fid of prevF.keys()) if (!nextF.has(fid)) ops.push({ op: 'field.del', fid });

  for (const [fid, nx] of nextF) {
    const pv = prevF.get(fid);
    if (!pv) continue;
    if (pv.f.type !== nx.f.type) {
      ops.push({ op: 'field.set', fid, patch: { type: nx.f.type, value: nx.f.value } });
      continue;
    }
    if (nx.f.type === 'number') {
      const d = round6(num(nx.f.value) - num(pv.f.value));
      if (d !== 0) ops.push({ op: 'value.add', fid, d });
    } else if (String(pv.f.value) !== String(nx.f.value)) {
      ops.push({ op: 'field.set', fid, patch: { value: nx.f.value } });
    }
    if (pv.f.name !== nx.f.name) ops.push({ op: 'field.set', fid, patch: { name: nx.f.name } });
  }

  const prevS = new Set(prevSecs.map(s => s.id));
  const nextS = new Set(nextSecs.map(s => s.id));
  for (const sid of prevS) if (!nextS.has(sid)) ops.push({ op: 'section.del', sid });
  for (let i = 0; i < nextSecs.length; i++) {
    const s = nextSecs[i];
    if (!prevS.has(s.id)) ops.push({ op: 'section.add', sid: s.id, name: s.name, after: i > 0 ? nextSecs[i - 1].id : null });
  }
  for (const s of nextSecs) {
    const p = prevSecs.find(x => x.id === s.id);
    if (p && p.name !== s.name) ops.push({ op: 'section.rename', sid: s.id, name: s.name });
  }
  for (const [fid, nx] of nextF) {
    if (prevF.has(fid)) continue;
    const sec = nextSecs.find(s => s.fields.some(f => f.id === fid));
    if (!sec) continue;
    const idx = sec.fields.findIndex(f => f.id === fid);
    let after = null;
    for (let j = idx - 1; j >= 0; j--) {
      if (prevF.has(sec.fields[j].id)) { after = sec.fields[j].id; break; }
    }
    ops.push({ op: 'field.add', sid: sec.id, after, field: deep(nx.f), secName: sec.name });
  }

  ops.push(orderOpFrom(nextSecs));
  return ops;
}

// ------------------------------------------------ 迁移

// v1（每章完整快照）→ v2 形状（base + chapters[].deltas），数值差异转相对变化
function migrateV1toV2(book) {
  const chs = Array.isArray(book.chapters) ? book.chapters : [];
  const base = chs.length && Array.isArray(chs[0].sections) ? deep(chs[0].sections) : defaultSections();
  const chapters = chs.map((c, i) => ({
    id: c.id || uid(),
    no: c.no != null ? c.no : i + 1,
    title: c.title || '',
    content: typeof c.content === 'string' ? c.content : '',
    deltas: i === 0 ? [] : diffSections(chs[i - 1].sections || [], c.sections || []),
  }));
  if (!chapters.length) chapters.push({ id: uid(), no: 1, title: '', content: '', deltas: [] });
  return Object.assign({}, book, { format: 2, base, chapters });
}

// v2 → v3：主角面板整体包装为第一个角色
function migrateV2toV3(book) {
  const mainId = uid();
  const characters = [{
    id: mainId,
    name: '主角',
    startNo: 1,
    base: Array.isArray(book.base) ? book.base : defaultSections(),
  }];
  const chapters = (book.chapters || []).map(c => ({
    id: c.id || uid(),
    no: c.no != null ? c.no : 1,
    title: c.title || '',
    content: typeof c.content === 'string' ? c.content : '',
    deltasByChar: { [mainId]: Array.isArray(c.deltas) ? c.deltas : [] },
  }));
  if (!chapters.length) {
    chapters.push({ id: uid(), no: 1, title: '', content: '', deltasByChar: {} });
  }
  return Object.assign({}, book, { format: PANEL_FORMAT, characters, chapters });
}

function migrateBook(book) {
  book = Object.assign({}, book);
  if (book.format === PANEL_FORMAT && Array.isArray(book.characters)) return book;
  const first = book.chapters && book.chapters[0];
  if (!Array.isArray(book.characters)) {
    if (Array.isArray(book.base)) {
      book = migrateV2toV3(book);           // v2
    } else if (first && Array.isArray(first.sections)) {
      book = migrateV2toV3(migrateV1toV2(book));  // v1
    } else {
      book.base = defaultSections();
      book.chapters = Array.isArray(book.chapters) ? book.chapters : [];
      book = migrateV2toV3(book);           // 空书
    }
  }
  return book;
}

function repairSections(sections) {
  if (!Array.isArray(sections)) return;
  sections.forEach(sec => {
    if (sec.id == null) sec.id = uid();
    if (sec.name == null) sec.name = '';
    if (!Array.isArray(sec.fields)) sec.fields = [];
    sec.fields.forEach(f => {
      if (f.id == null) f.id = uid();
      if (f.name == null) f.name = '';
      if (f.type !== 'text' && f.type !== 'number') f.type = 'text';
      if (f.type === 'number') f.value = num(f.value);
      else f.value = String(f.value == null ? '' : f.value);
    });
  });
}

// 把历史遗留的绝对 order 操作迁移为相对 move/secmove 指令序列：
// 逐字段"就位"生成指令，应用后与原 order 的目标状态完全一致，
// 但语义变为相对移动——前面章节顺序变化时依然成立。
function migrateOrderOps(book) {
  for (const ch of book.characters) {
    let st = null;
    for (let i = 0; i < book.chapters.length; i++) {
      const no = book.chapters[i].no;
      if (no < ch.startNo) continue;
      const dbc = book.chapters[i].deltasByChar;
      const deltas = dbc && Array.isArray(dbc[ch.id]) ? dbc[ch.id] : null;
      const orderOps = deltas ? deltas.filter(o => o && o.op === 'order') : [];
      if (!orderOps.length) {
        if (st === null) st = deep(ch.base);
        else if (deltas && deltas.length) applyDeltas(st, deltas);
        continue;
      }
      if (st === null) st = deep(ch.base);
      // st 推进到 order 之前的状态
      if (deltas && deltas.length) applyDeltas(st, deltas.filter(o => !(o && o.op === 'order')));
      const moves = [];
      for (const op of orderOps) {
        // 分组就位
        const targetSids = op.sections || [];
        targetSids.forEach((sid, k) => {
          const curIdx = st.findIndex(s => s.id === sid);
          if (curIdx !== k) {
            moves.push({ op: 'secmove', sid, after: k > 0 ? targetSids[k - 1] : null });
            const s = st.find(x => x.id === sid);
            st.splice(st.indexOf(s), 1);
            st.splice(k, 0, s);
          }
        });
        // 字段就位
        for (const sid of targetSids) {
          const list = (op.fieldsBySection || {})[sid] || [];
          const sec = st.find(x => x.id === sid);
          if (!sec) continue;
          list.forEach((fid, k) => {
            const cur = sec.fields[k];
            if (cur && cur.id === fid) return;  // 已就位
            const f = [...st.flatMap(s2 => s2.fields)].find(x => x.id === fid);
            if (!f) return;  // 字段不在本章状态中，move 指令重放时会容错跳过
            moves.push({ op: 'move', fid, sid, after: k > 0 ? list[k - 1] : null });
            for (const s2 of st) {
              const kk = s2.fields.findIndex(x => x.id === fid);
              if (kk >= 0) { s2.fields.splice(kk, 1); break; }
            }
            sec.fields.splice(k, 0, f);
          });
        }
      }
      // 替换 order ops → move/secmove 序列；st 推进到该章最终状态
      if (deltas) {
        const kept = deltas.filter(o => !(o && o.op === 'order'));
        dbc[ch.id] = [...kept, ...moves];
        applyDeltas(st, orderOps);
      }
    }
  }
}

function normalizeBook(book) {
  book = migrateBook(book || {});
  if (book.title == null) book.title = '未命名作品';
  if (!Array.isArray(book.steps)) book.steps = [...DEFAULT_STEPS];
  book.steps = parseSteps(book.steps.join(', ')) || [...DEFAULT_STEPS];

  if (!Array.isArray(book.characters) || !book.characters.length) {
    book.characters = [makeCharacter('主角', 1)];
  }
  const seen = new Set();
  book.characters.forEach(ch => {
    if (ch.id == null || seen.has(ch.id)) ch.id = uid();
    seen.add(ch.id);
    ch.name = ch.name || '角色';
    if (!Number.isFinite(ch.startNo) || ch.startNo < 1) ch.startNo = 1;
    if (!Array.isArray(ch.base)) ch.base = defaultSections();
    repairSections(ch.base);
  });

  if (!Array.isArray(book.chapters) || !book.chapters.length) {
    book.chapters = [{ id: uid(), no: 1, title: '', content: '', deltasByChar: {} }];
  }
  book.chapters.forEach((c, i) => {
    if (c.id == null) c.id = uid();
    if (c.no == null) c.no = i + 1;
    c.title = c.title || '';
    if (typeof c.content !== 'string') c.content = '';   // 正文
    if (!c.deltasByChar || typeof c.deltasByChar !== 'object') c.deltasByChar = {};
    // 清理指向不存在角色的键
    for (const k of Object.keys(c.deltasByChar)) {
      if (!seen.has(k)) delete c.deltasByChar[k];
      else if (!Array.isArray(c.deltasByChar[k])) c.deltasByChar[k] = [];
    }
  });
  migrateOrderOps(book);
  return book;
}

// ------------------------------------------------ 章节变化查询

// 某章某角色"动了"哪些条目（用于差异圆点；不含 order）
function chapterChangedFids(deltas) {
  const set = new Set();
  (deltas || []).forEach(o => {
    if (!o) return;
    if (o.op === 'field.add' && o.field) set.add(o.field.id);
    else if (o.fid) set.add(o.fid);
  });
  return set;
}

// 本章某条目的净变化徽标：'+5' / '=65' / '新增'；无变化返回 null
function chapterChangeBadge(deltas, fid) {
  let addD = 0, hasAdd = false, setV, hasSet = false, added = false;
  (deltas || []).forEach(o => {
    if (!o) return;
    if (o.op === 'value.add' && o.fid === fid) { hasAdd = true; addD = round6(addD + o.d); }
    if (o.op === 'field.set' && o.fid === fid && o.patch && 'value' in o.patch) { setV = o.patch.value; hasSet = true; }
    if (o.op === 'field.add' && o.field && o.field.id === fid) added = true;
  });
  if (added) return '新增';
  if (hasSet) return '=' + setV;
  if (hasAdd) return (addD > 0 ? '+' : '') + addD;
  return null;
}

// Node 测试用导出（浏览器里直接用全局函数）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PANEL_FORMAT, DEFAULT_STEPS, deep, uid, round6, num, parseSteps, makeField, makeCharacter,
    defaultSections, applyDeltas, resolveBook, diffSections, orderOpFrom,
    migrateV1toV2, migrateV2toV3, migrateBook, normalizeBook, repairSections,
    chapterChangedFids, chapterChangeBadge, findFieldIn,
  };
}
