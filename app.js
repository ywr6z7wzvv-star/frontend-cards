"use strict";

/* ---------- Data (loaded in boot) ---------- */
let DATA = { cats: [], qs: [] };
let QS = [];
let BY_ID = {};
let CAT_NAME = {};
let CAT_COUNT = {};
let EXP = {};            // question id -> markdown story from data/experience.md

/* ---------- Constants ---------- */
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Leitner boxes: 0 = new/forgotten, 1..5 = increasing intervals
const INTERVALS = [MIN, 15 * MIN, DAY, 3 * DAY, 7 * DAY, 16 * DAY];
const LEARNED_BOX = 3;
const LEGACY_LS_KEY = 'fe-cards.v1';   // progress format of the original single-file version

function defaults() {
  return {
    cards: {},
    fav: {},
    days: {},
    settings: { theme: 'auto', details: false, exp: true, onlyExp: false, goal: 20, mode: 'smart', cats: null },
  };
}
let S = defaults();
let reviewsCount = 0;

/* ---------- Storage: IndexedDB ----------
   Database "fe-cards":
     cards   – key: question id, value: { box, due, seen, ok, fail, last }
     kv      – keys: 'fav', 'days', 'settings'
     reviews – auto-increment log of every answer: { id, grade, box, ts }
   If IndexedDB is unavailable, everything falls back to one localStorage key. */
const DB_NAME = 'fe-cards', DB_VERSION = 1;
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

const idb = {
  db: null,
  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB is not supported'));
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { autoIncrement: true });
      };
      r.onsuccess = () => { this.db = r.result; resolve(); };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
  },
  async load() {
    const tx = this.db.transaction(['cards', 'kv', 'reviews'], 'readonly');
    const cs = tx.objectStore('cards'), kv = tx.objectStore('kv');
    const [keys, vals, fav, days, settings, count] = await Promise.all([
      reqP(cs.getAllKeys()), reqP(cs.getAll()),
      reqP(kv.get('fav')), reqP(kv.get('days')), reqP(kv.get('settings')),
      reqP(tx.objectStore('reviews').count()),
    ]);
    const cards = {};
    keys.forEach((k, i) => { cards[k] = vals[i]; });
    return { cards, fav, days, settings, reviewsCount: count, empty: !settings && !keys.length };
  },
  write(stores, fn) {
    const tx = this.db.transaction(stores, 'readwrite');
    fn(tx);
    return txDone(tx);
  },
  answer(id, card, days, review) {
    return this.write(['cards', 'kv', 'reviews'], tx => {
      tx.objectStore('cards').put(card, id);
      tx.objectStore('kv').put(days, 'days');
      tx.objectStore('reviews').add(review);
    });
  },
  putKV(key, value) { return this.write(['kv'], tx => tx.objectStore('kv').put(value, key)); },
  reviews() { return reqP(this.db.transaction('reviews').objectStore('reviews').getAll()); },
  replace(state, reviews) {
    return this.write(['cards', 'kv', 'reviews'], tx => {
      const cs = tx.objectStore('cards'), kv = tx.objectStore('kv'), rs = tx.objectStore('reviews');
      cs.clear(); rs.clear();
      Object.entries(state.cards).forEach(([id, c]) => cs.put(c, id));
      kv.put(state.fav, 'fav'); kv.put(state.days, 'days'); kv.put(state.settings, 'settings');
      (reviews || []).forEach(r => rs.add(r));
    });
  },
};

// Fallback: whole state as JSON in localStorage (no review log).
const ls = {
  load() {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return { cards: s.cards || {}, fav: s.fav, days: s.days, settings: s.settings, reviewsCount: 0, empty: !raw };
  },
  dump() { localStorage.setItem(LEGACY_LS_KEY, JSON.stringify(S)); return Promise.resolve(); },
  answer() { return this.dump(); },
  putKV() { return this.dump(); },
  reviews() { return Promise.resolve([]); },
  replace() { return this.dump(); },
};

let backend = idb;
let persisted = false;
let warnedSave = false;
function persist(p) {
  return Promise.resolve(p).catch(err => {
    console.error('Save failed', err);
    if (!warnedSave) { warnedSave = true; toast('Не удалось сохранить прогресс'); }
  });
}

async function initStorage() {
  try {
    await idb.open();
  } catch (err) {
    console.warn('IndexedDB unavailable, using localStorage', err);
    backend = ls;
  }
  let loaded;
  try { loaded = await backend.load(); } catch (err) { console.error(err); loaded = { cards: {}, empty: true, reviewsCount: 0 }; }

  // One-time migration from the original single-file version (localStorage).
  if (backend === idb && loaded.empty) {
    try {
      const raw = localStorage.getItem(LEGACY_LS_KEY);
      if (raw) {
        const old = JSON.parse(raw);
        loaded = { cards: old.cards || {}, fav: old.fav, days: old.days, settings: old.settings, reviewsCount: 0 };
        S = mergeState(loaded);
        await idb.replace(S, []);
        localStorage.removeItem(LEGACY_LS_KEY);
      }
    } catch (err) { console.warn('Legacy migration skipped', err); }
  }
  S = mergeState(loaded);
  reviewsCount = loaded.reviewsCount || 0;

  // Ask the browser not to evict our data under storage pressure.
  try {
    if (navigator.storage && navigator.storage.persist) {
      persisted = await navigator.storage.persisted();
      if (!persisted) persisted = await navigator.storage.persist();
    }
  } catch (err) { /* not supported */ }
}

function mergeState(s) {
  const d = defaults();
  const settings = { ...d.settings, ...(s.settings || {}) };
  const allCats = DATA.cats.map(c => c.id);
  settings.cats = Array.isArray(settings.cats) ? settings.cats.filter(c => allCats.includes(c)) : allCats;
  return { cards: s.cards || {}, fav: s.fav || {}, days: s.days || {}, settings };
}
const saveSettings = () => persist(backend.putKV('settings', S.settings));
const saveFav = () => persist(backend.putKV('fav', S.fav));

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dayKey(t = Date.now()) {
  const d = new Date(t);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function card(id) { return S.cards[id] || null; }
function status(id) {
  const c = card(id);
  if (!c) return 'new';
  if (c.box >= LEARNED_BOX) return 'learned';
  if (c.box === 0) return 'weak';
  return 'learning';
}
const STATUS_LABEL = { new: 'Новая', weak: 'Не знаю', learning: 'Учу', learned: 'Выучено' };
function fmtInterval(ms) {
  if (ms < HOUR) return Math.round(ms / MIN) + ' мин';
  if (ms < DAY) return Math.round(ms / HOUR) + ' ч';
  return Math.round(ms / DAY) + ' дн';
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast fade-in'; el.setAttribute('role', 'status'); el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
function streak() {
  let n = 0, t = Date.now();
  if (!S.days[dayKey(t)]) t -= DAY;          // today not started yet: count from yesterday
  while (S.days[dayKey(t)]) { n++; t -= DAY; }
  return n;
}
function updatePill() {
  const n = streak(), today = S.days[dayKey()] || 0;
  $('#streakPill').innerHTML = '🔥 ' + n + ' ' + plural(n, 'день', 'дня', 'дней') + ' · ' + today + ' сегодня';
}
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

/* ---------- Spaced repetition ---------- */
function nextState(id, grade) {
  const now = Date.now();
  const c = { box: 0, due: now, seen: 0, ok: 0, fail: 0, ...(card(id) || {}) };
  if (grade === 0) { c.box = 0; c.fail++; }
  else if (grade === 1) c.box = c.box > 2 ? c.box - 1 : Math.max(1, c.box);
  else { c.box = Math.min(5, c.box + 1); c.ok++; }
  const iv = grade === 1 ? Math.max(5 * MIN, Math.min(INTERVALS[c.box] / 2, DAY)) : INTERVALS[c.box];
  c.due = now + iv; c.seen++; c.last = now;
  return { c, iv };
}
function previewInterval(id, grade) { return nextState(id, grade).iv; }
function grade(id, g) {
  const c = nextState(id, g).c;
  S.cards[id] = c;
  const k = dayKey(); S.days[k] = (S.days[k] || 0) + 1;
  reviewsCount++;
  persist(backend.answer(id, c, S.days, { id, grade: g, box: c.box, ts: c.last }));
  updatePill();
}

function pool() {
  const cats = new Set(S.settings.cats);
  let list = QS.filter(q => cats.has(q.cat));
  if (S.settings.onlyExp) list = list.filter(q => EXP[q.id]);
  const mode = S.settings.mode;
  if (mode === 'weak') list = list.filter(q => { const c = card(q.id); return c && (c.box <= 1 || c.fail > c.ok); });
  if (mode === 'fav') list = list.filter(q => S.fav[q.id]);
  return list;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
let lastShown = [];
function pickNext() {
  const list = pool();
  if (!list.length) return null;
  const recent = new Set(lastShown);
  const fresh = list.length > lastShown.length + 1 ? list.filter(q => !recent.has(q.id)) : list.filter(q => q.id !== lastShown[lastShown.length - 1]);
  const cand = fresh.length ? fresh : list;
  if (S.settings.mode !== 'smart') return shuffle(cand.slice())[0];
  const now = Date.now();
  const due = cand.filter(q => { const c = card(q.id); return c && c.due <= now; });
  if (due.length) {
    // weakest boxes first, a little randomness inside a box
    due.sort((a, b) => card(a.id).box - card(b.id).box || Math.random() - .5);
    return due[0];
  }
  const unseen = cand.filter(q => !card(q.id));
  if (unseen.length) return shuffle(unseen)[0];
  return cand.slice().sort((a, b) => card(a.id).due - card(b.id).due)[0];
}

/* ---------- Markdown ---------- */
const KW = new Set(('const let var function return if else for while do switch case default break continue new class extends super this ' +
  'import export from as async await try catch finally throw typeof instanceof in of void delete yield static get set null undefined true false ' +
  'type interface enum implements private public protected readonly keyof infer satisfies declare module namespace abstract never unknown any').split(' '));
function highlight(code, lang) {
  const out = [];
  const re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->|#[^\n]*(?=\n|$))|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d_.]*[a-z%]*\b)|(<\/?[A-Za-z][\w.-]*)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$-]*)/g;
  const hashComments = lang === 'bash' || lang === 'yaml';
  let last = 0, m;
  while ((m = re.exec(code))) {
    out.push(esc(code.slice(last, m.index)));
    const [t] = m;
    if (m[1]) {
      if (t[0] === '#' && !hashComments) { out.push(esc(t[0])); re.lastIndex = m.index + 1; last = re.lastIndex; continue; }
      out.push('<span class="tk-c">' + esc(t) + '</span>');
    }
    else if (m[2]) out.push('<span class="tk-s">' + esc(t) + '</span>');
    else if (m[3]) out.push('<span class="tk-n">' + esc(t) + '</span>');
    else if (m[4]) out.push('&lt;' + (t[1] === '/' ? '/' : '') + '<span class="tk-t">' + esc(t.replace(/^<\/?/, '')) + '</span>');
    else if (m[5]) out.push(KW.has(t) ? '<span class="tk-k">' + t + '</span>' : '<span class="tk-f">' + esc(t) + '</span>');
    else out.push(KW.has(t) ? '<span class="tk-k">' + t + '</span>' : esc(t));
    last = re.lastIndex;
  }
  out.push(esc(code.slice(last)));
  return out.join('');
}
function inline(text) {
  // code spans become placeholders so bold/italic can wrap them
  const codes = [];
  const withSlots = text.replace(/`([^`]+)`/g, (_, c) => '\u0000' + (codes.push('<code>' + esc(c) + '</code>') - 1) + '\u0000');
  return esc(withSlots)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => codes[i]);
}
function md(src) {
  const lines = src.split('\n');
  const html = [];
  let i = 0;
  const isList = l => /^\s*(?:[-*]|\d+\.)\s+/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      html.push('<pre><code>' + highlight(buf.join('\n'), fence[1]) + '</code></pre>');
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const row = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(line); i += 2;
      const body = [];
      while (i < lines.length && lines[i].startsWith('|')) body.push(row(lines[i++]));
      html.push('<div class="table-wrap"><table><thead><tr>' + head.map(h => '<th>' + inline(h) + '</th>').join('') +
        '</tr></thead><tbody>' + body.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      html.push('<blockquote>' + buf.filter(Boolean).map(b => '<p>' + inline(b) + '</p>').join('') + '</blockquote>');
      continue;
    }
    if (isList(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && (isList(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i];
        const indent = l.match(/^\s*/)[0].length;
        const text = l.replace(/^\s*(?:[-*]|\d+\.)\s+/, '');
        if (indent >= 2 && items.length && isList(l)) items[items.length - 1].sub.push(text);
        else if (indent >= 2 && items.length) items[items.length - 1].text += ' ' + l.trim();
        else items.push({ text, sub: [] });
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push('<' + tag + '>' + items.map(it => '<li>' + inline(it.text) +
        (it.sub.length ? '<ul>' + it.sub.map(s => '<li>' + inline(s) + '</li>').join('') + '</ul>' : '') + '</li>').join('') + '</' + tag + '>');
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !isList(lines[i]) && !lines[i].startsWith('|') && !lines[i].startsWith('>')) buf.push(lines[i++]);
    html.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return html.join('');
}

/* ---------- Experience stories ----------
   data/experience.md format:
     ## <question-id>
     story in markdown…
   HTML comments <!-- … --> are notes for editing and are not shown. */
function parseExperience(text) {
  const out = {};
  const parts = text.replace(/<!--[\s\S]*?-->/g, '').split(/^##[ \t]+([\w-]+)[ \t]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const body = (parts[i + 1] || '').trim();
    if (body) out[parts[i]] = body;
  }
  return out;
}
function expBlock(id) {
  if (!EXP[id] || !S.settings.exp) return '';
  return '<div class="exp md"><div class="label">From my experience</div>' + md(EXP[id]) + '</div>';
}

/* ---------- Icons ---------- */
const ICON_STAR = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 2.9 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const ICON_STAR_O = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.3l-5.6 2.9 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
function starBtn(id) {
  const on = !!S.fav[id];
  return '<button class="star" data-fav="' + id + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Убрать из избранного' : 'В избранное') + '">' + (on ? ICON_STAR : ICON_STAR_O) + '</button>';
}
function boxDots(id) {
  const c = card(id), box = c ? c.box : 0;
  let h = '<span class="boxdots" title="Уровень ' + box + ' из 5" aria-label="Уровень ' + box + ' из 5">';
  for (let k = 1; k <= 5; k++) h += '<i class="' + (k <= box ? 'on' : '') + '"></i>';
  return h + '</span>';
}
function metaRow(q) {
  return '<div class="card-meta"><span class="tag">' + esc(CAT_NAME[q.cat]) + '</span>' +
    (q.x ? '<span class="tag senior">Senior+</span>' : '') +
    (EXP[q.id] ? '<span class="tag has-exp" title="Есть история из опыта" aria-label="Есть история из опыта">💼</span>' : '') +
    boxDots(q.id) + starBtn(q.id) + '</div>';
}

/* ---------- Views ---------- */
const view = $('#view');
let current = null;       // current study card id
let revealed = false;
let forcedNext = null;
let detailsOpen = false;
let animateNext = true;

function renderStudy() {
  if (!current || !BY_ID[current] || !pool().some(q => q.id === current) && !forcedNext) {
    current = forcedNext || (pickNext() || {}).id || null;
    forcedNext = null; revealed = false; detailsOpen = S.settings.details;
  }
  const today = S.days[dayKey()] || 0, goal = S.settings.goal;
  const modes = [['smart', 'Умный'], ['random', 'Случайно'], ['weak', 'Слабые'], ['fav', 'Избранное']];
  const selCats = S.settings.cats.length;
  let h = '<div class="toolbar"><div class="seg full" role="group" aria-label="Режим">' +
    modes.map(([m, l]) => '<button data-mode="' + m + '" aria-pressed="' + (S.settings.mode === m) + '">' + l + '</button>').join('') + '</div></div>';
  h += '<div class="session"><button class="chip" data-open="cats">Темы: ' + (selCats === DATA.cats.length ? 'все' : selCats + ' из ' + DATA.cats.length) + (S.settings.onlyExp ? ' · 💼' : '') + ' ▾</button>' +
    '<span>' + today + ' / ' + goal + '</span><div class="goalbar" title="Цель на день"><div style="width:' + Math.min(100, today / goal * 100) + '%"></div></div><span>' + pool().length + ' в колоде</span></div>';
  if (!current) {
    const msg = S.settings.mode === 'fav' ? ['Избранное пусто', 'Отмечай сложные вопросы звёздочкой, чтобы гонять их отдельно.']
      : S.settings.mode === 'weak' ? ['Слабых карточек нет', 'Сюда попадают вопросы, на которые ты ответил «Не знал». Отличная работа!']
      : ['Колода пуста', 'Выбери хотя бы одну тему.'];
    view.innerHTML = h + '<div class="card empty"><h2>' + msg[0] + '</h2><p>' + msg[1] + '</p></div>';
    return;
  }
  const q = BY_ID[current];
  h += '<article class="card' + (animateNext ? ' fade-in' : '') + '">' + metaRow(q) + '<h2 class="question">' + inline(q.q) + '</h2>';
  if (!revealed) {
    h += '<p class="hint">Ответь вслух, как на собеседовании, а потом открой ответ и честно оцени себя.' +
      (EXP[q.id] && S.settings.exp ? ' <strong>💼 Тут есть история из опыта</strong> — попробуй вспомнить свой пример.' : '') + '</p>' +
      '<div class="reveal-row"><button class="btn primary" data-act="reveal">Показать ответ</button><button class="btn" data-act="skip" aria-label="Пропустить">Пропустить</button></div>';
  } else {
    h += '<div class="short md"><div class="label">Short answer</div>' + md(q.s) + '</div>';
    h += expBlock(q.id);
    h += '<button class="details-toggle" data-act="details" aria-expanded="' + detailsOpen + '">' + (detailsOpen ? 'Скрыть подробности ▴' : 'Подробный ответ ▾') + '</button>';
    if (detailsOpen) h += '<div class="details md">' + md(q.d) + '</div>';
  }
  h += '</article>';
  if (revealed) {
    h += '<div class="grades" role="group" aria-label="Оценка">' +
      '<button class="grade bad" data-grade="0">Не знал<small>' + fmtInterval(previewInterval(current, 0)) + '</small></button>' +
      '<button class="grade warn" data-grade="1">Сомневался<small>' + fmtInterval(previewInterval(current, 1)) + '</small></button>' +
      '<button class="grade good" data-grade="2">Знал<small>' + fmtInterval(previewInterval(current, 2)) + '</small></button></div>';
  }
  view.innerHTML = h;
  animateNext = false;
}

function nextCard() {
  if (current) { lastShown.push(current); if (lastShown.length > 8) lastShown.shift(); }
  current = (pickNext() || {}).id || null;
  revealed = false; detailsOpen = S.settings.details; animateNext = true;
  renderStudy();
  window.scrollTo(0, 0);
}

let catFilter = 'all', statusFilter = 'all', query = '';
function matches(q, words) {
  if (!words.length) return true;
  const hay = (q.q + ' ' + q.s + ' ' + q.d + ' ' + (EXP[q.id] || '')).toLowerCase();
  return words.every(w => hay.includes(w));
}
function renderCatalog() {
  const chips = [['all', 'Все', QS.length]].concat(DATA.cats.map(c => [c.id, c.name, CAT_COUNT[c.id]]));
  const statuses = [['all', 'Все'], ['new', 'Новые'], ['weak', 'Не знаю'], ['learning', 'Учу'], ['learned', 'Выучено'], ['fav', '★ Избранное'], ['exp', '💼 С опытом']];
  view.innerHTML =
    '<label class="visually-hidden" for="search">Поиск</label>' +
    '<input id="search" class="search" type="search" placeholder="Поиск по вопросам и ответам…" autocomplete="off" value="' + esc(query) + '">' +
    '<div class="chips" role="group" aria-label="Темы">' + chips.map(([id, n, k]) => '<button class="chip" data-cat="' + id + '" aria-pressed="' + (catFilter === id) + '">' + esc(n) + '<span class="n">' + k + '</span></button>').join('') + '</div>' +
    '<div class="chips" role="group" aria-label="Статус">' + statuses.map(([id, n]) => '<button class="chip" data-status="' + id + '" aria-pressed="' + (statusFilter === id) + '">' + n + '</button>').join('') + '</div>' +
    '<div id="results"></div>';
  renderResults();
}
function statusMatches(q) {
  if (statusFilter === 'all') return true;
  if (statusFilter === 'fav') return !!S.fav[q.id];
  if (statusFilter === 'exp') return !!EXP[q.id];
  return status(q.id) === statusFilter;
}
function renderResults() {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = QS.filter(q => (catFilter === 'all' || q.cat === catFilter) && statusMatches(q) && matches(q, words));
  let h = '<div class="count-line">' + list.length + ' ' + plural(list.length, 'вопрос', 'вопроса', 'вопросов') + '</div>';
  let lastCat = null;
  h += '<div class="list">';
  for (const q of list) {
    if (catFilter === 'all' && q.cat !== lastCat) { h += '<div class="group-title">' + esc(CAT_NAME[q.cat]) + '</div>'; lastCat = q.cat; }
    const st = status(q.id);
    h += '<a class="item" href="#/q/' + q.id + '"><span class="dot ' + st + '" aria-hidden="true"></span><span class="t">' + inline(q.q) +
      '<span class="c"><span>' + STATUS_LABEL[st] + '</span>' + (q.x ? '<span>Senior+</span>' : '') + (EXP[q.id] ? '<span>💼 опыт</span>' : '') + (S.fav[q.id] ? '<span>★</span>' : '') + '</span></span></a>';
  }
  h += '</div>';
  if (!list.length) h += '<div class="empty"><p>Ничего не найдено.</p></div>';
  $('#results').innerHTML = h;
}

function renderDetail(id) {
  const q = BY_ID[id];
  if (!q) { location.replace('#/catalog'); return; }
  const c = card(id), st = status(id);
  let info = STATUS_LABEL[st];
  if (c) info += ' · повторений: ' + c.seen + ' · следующее: ' + (c.due <= Date.now() ? 'сейчас' : 'через ' + fmtInterval(c.due - Date.now()));
  view.innerHTML = '<button class="back" data-act="back">‹ Назад</button>' +
    '<article class="card">' + metaRow(q) + '<h2 class="question">' + inline(q.q) + '</h2>' +
    '<div class="short md"><div class="label">Short answer</div>' + md(q.s) + '</div>' +
    expBlock(q.id) +
    '<div class="details md">' + md(q.d) + '</div>' +
    '<p class="count-line">' + esc(info) + '</p>' +
    '<div class="detail-actions"><button class="btn primary" data-study="' + id + '">Учить эту карточку</button></div></article>';
}

function renderProgress() {
  const counts = { new: 0, weak: 0, learning: 0, learned: 0 };
  QS.forEach(q => counts[status(q.id)]++);
  let reviews = 0, ok = 0, fail = 0;
  Object.values(S.cards).forEach(c => { reviews += c.seen; ok += c.ok; fail += c.fail; });
  const acc = ok + fail ? Math.round(ok / (ok + fail) * 100) + '%' : '—';
  const pct = n => (n / QS.length * 100) + '%';
  let h = '<div class="stats">' +
    '<div class="stat"><b>' + counts.learned + '</b><span>выучено из ' + QS.length + '</span></div>' +
    '<div class="stat"><b>' + streak() + '</b><span>' + plural(streak(), 'день', 'дня', 'дней') + ' подряд</span></div>' +
    '<div class="stat"><b>' + reviews + '</b><span>всего повторений</span></div>' +
    '<div class="stat"><b>' + acc + '</b><span>ответов «Знал»</span></div></div>';
  h += '<div class="card"><div class="stack" aria-hidden="true"><div class="s-learned" style="width:' + pct(counts.learned) + '"></div><div class="s-learning" style="width:' + pct(counts.learning) + '"></div><div class="s-weak" style="width:' + pct(counts.weak) + '"></div></div>' +
    '<div class="legend"><span><i class="s-learned"></i>Выучено ' + counts.learned + '</span><span><i class="s-learning"></i>Учу ' + counts.learning + '</span><span><i class="s-weak"></i>Не знаю ' + counts.weak + '</span><span><i style="background:var(--surface-2)"></i>Новые ' + counts.new + '</span></div></div>';
  h += '<div class="section-title">Последние 14 дней</div><div class="card"><div class="days" aria-label="Активность по дням">';
  const vals = [];
  for (let k = 13; k >= 0; k--) vals.push(S.days[dayKey(Date.now() - k * DAY)] || 0);
  const max = Math.max(1, ...vals);
  vals.forEach(v => { h += '<div class="' + (v ? '' : 'zero') + '" style="height:' + Math.max(4, v / max * 100) + '%" title="' + v + '"></div>'; });
  h += '</div></div><div class="section-title">По темам</div><div class="card">';
  DATA.cats.forEach(cat => {
    const qs = QS.filter(q => q.cat === cat.id), n = qs.length;
    const c = { weak: 0, learning: 0, learned: 0 };
    qs.forEach(q => { const s = status(q.id); if (s in c) c[s]++; });
    const w = k => (c[k] / n * 100) + '%';
    h += '<div class="catrow"><div class="top">' + esc(cat.name) + '<span>' + c.learned + ' / ' + n + '</span></div><div class="stack"><div class="s-learned" style="width:' + w('learned') + '"></div><div class="s-learning" style="width:' + w('learning') + '"></div><div class="s-weak" style="width:' + w('weak') + '"></div></div></div>';
  });
  h += '</div>';
  view.innerHTML = h;
}

function renderSettings() {
  const themes = [['auto', 'Авто'], ['dark', 'Тёмная'], ['light', 'Светлая']];
  const goals = [10, 20, 30, 50];
  const expCount = Object.keys(EXP).filter(id => BY_ID[id]).length;
  const install = isStandalone() ? '' :
    '<div class="card install"><b>Установи как приложение</b><p>В Safari нажми <strong>Поделиться</strong> → <strong>На экран «Домой»</strong>. Приложение откроется без панели браузера и будет работать офлайн.</p></div>';
  view.innerHTML = install + '<div class="card">' +
    '<div class="setting"><div class="l">Тема</div><div class="seg" role="group" aria-label="Тема">' + themes.map(([t, l]) => '<button data-theme-set="' + t + '" aria-pressed="' + (S.settings.theme === t) + '">' + l + '</button>').join('') + '</div></div>' +
    '<div class="setting"><div class="l">Цель на день<small>Карточек в день</small></div><div class="seg" role="group" aria-label="Цель">' + goals.map(g => '<button data-goal="' + g + '" aria-pressed="' + (S.settings.goal === g) + '">' + g + '</button>').join('') + '</div></div>' +
    '<div class="setting"><div class="l">Сразу показывать подробный ответ<small>Иначе сначала только short answer</small></div><button class="switch" role="switch" data-toggle="details" aria-checked="' + S.settings.details + '" aria-label="Подробный ответ"></button></div>' +
    '<div class="setting"><div class="l">Показывать истории из опыта<small>Блок «From my experience» под ответом</small></div><button class="switch" role="switch" data-toggle="exp" aria-checked="' + S.settings.exp + '" aria-label="Истории из опыта"></button></div>' +
    '</div>' +
    '<div class="section-title">Как это работает</div><div class="card md"><p>Каждая карточка живёт в одной из 5 «коробок». <strong>Знал</strong> переносит её выше, и она возвращается всё реже: через 15 минут, день, 3, 7 и 16 дней. <strong>Сомневался</strong> откладывает ненадолго. <strong>Не знал</strong> отправляет в начало, и карточка вернётся через минуту.</p><p>Режим <strong>Умный</strong> сначала даёт карточки, которые пора повторить, потом новые. <strong>Слабые</strong> гоняет только то, что ты не знал. Карточка считается выученной с 3-й коробки.</p></div>' +
    '<div class="section-title">Хранилище</div><div class="card"><p class="count-line">' +
    (backend === idb ? 'IndexedDB' : 'localStorage (IndexedDB недоступна)') + ' · ' +
    Object.keys(S.cards).length + ' ' + plural(Object.keys(S.cards).length, 'карточка', 'карточки', 'карточек') + ' с прогрессом · ' +
    reviewsCount + ' ' + plural(reviewsCount, 'ответ', 'ответа', 'ответов') + ' в журнале · ' +
    (persisted ? 'постоянное хранилище ✓' : 'браузер может очистить данные') + '</p></div>' +
    '<div class="section-title">Перенос прогресса</div><div class="card">' +
    '<p class="count-line">Бэкап на случай смены телефона. Код или файл можно загрузить на другом устройстве.</p>' +
    '<div class="detail-actions"><button class="btn" data-act="export">Показать код</button><button class="btn" data-act="file">Сохранить файлом</button><button class="btn" data-act="import">Вставить код</button></div><div id="io"></div></div>' +
    '<div class="section-title">Сброс</div><div class="card"><div class="detail-actions"><button class="btn danger" data-act="reset">Сбросить весь прогресс</button></div></div>' +
    '<p class="count-line" style="text-align:center;margin-top:18px">' + QS.length + ' вопросов · ' + DATA.cats.length + ' тем · ' + expCount + ' ' + plural(expCount, 'история', 'истории', 'историй') + ' из опыта</p>';
}

/* ---------- Backup ---------- */
async function backupJson() {
  const reviews = await backend.reviews().catch(() => []);
  return JSON.stringify({ v: 2, exported: new Date().toISOString(), cards: S.cards, fav: S.fav, days: S.days, reviews });
}
const toB64 = s => btoa(unescape(encodeURIComponent(s)));
const fromB64 = s => decodeURIComponent(escape(atob(s)));
async function applyBackup(text) {
  text = text.trim();
  const obj = JSON.parse(text.startsWith('{') ? text : fromB64(text));
  if (!obj || typeof obj !== 'object' || !obj.cards) throw new Error('bad backup');
  S.cards = obj.cards || {}; S.fav = obj.fav || {}; S.days = obj.days || {};
  const reviews = Array.isArray(obj.reviews) ? obj.reviews : [];
  await backend.replace(S, reviews);
  reviewsCount = reviews.length;
}

/* ---------- Sheets ---------- */
function openSheet(html, onClick) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = '<div class="sheet fade-in" role="dialog" aria-modal="true">' + html + '</div>';
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  ov.addEventListener('click', e => { if (e.target === ov) close(); else onClick(e, close); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
  const f = ov.querySelector('button'); if (f) f.focus();
  return ov;
}
function catSheetHtml() {
  const sel = new Set(S.settings.cats);
  const expCount = QS.filter(q => EXP[q.id]).length;
  return '<h3>Темы для тренировки</h3><div class="sub">Выбранные темы попадают в колоду.</div>' +
    '<div class="sheet-actions"><button class="btn" data-preset="all">Все</button><button class="btn" data-preset="base">Базовые</button><button class="btn" data-preset="senior">Senior-темы</button><button class="btn" data-preset="none">Снять все</button></div>' +
    '<button class="check" role="checkbox" data-only-exp aria-checked="' + S.settings.onlyExp + '"><span class="box">' + ICON_CHECK + '</span><span class="name">💼 Только вопросы с историей из опыта</span><span class="num">' + expCount + '</span></button>' +
    DATA.cats.map(c => '<button class="check" role="checkbox" data-cat-toggle="' + c.id + '" aria-checked="' + sel.has(c.id) + '"><span class="box">' + ICON_CHECK + '</span><span class="name">' + esc(c.name) + '</span><span class="num">' + CAT_COUNT[c.id] + '</span></button>').join('') +
    '<div style="margin-top:14px"><button class="btn primary block" data-done>Готово</button></div>';
}
function openCats() {
  const ov = openSheet(catSheetHtml(), (e, close) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.done !== undefined) { close(); current = null; renderStudy(); return; }
    const base = ['js', 'css', 'react', 'vue', 'general'];
    if (t.dataset.preset) {
      const p = t.dataset.preset, all = DATA.cats.map(c => c.id);
      S.settings.cats = p === 'all' ? all : p === 'base' ? base : p === 'senior' ? all.filter(c => !base.includes(c)) : [];
    }
    if (t.dataset.onlyExp !== undefined) S.settings.onlyExp = !S.settings.onlyExp;
    if (t.dataset.catToggle) {
      const id = t.dataset.catToggle, set = new Set(S.settings.cats);
      set.has(id) ? set.delete(id) : set.add(id);
      S.settings.cats = DATA.cats.map(c => c.id).filter(c => set.has(c));
    }
    saveSettings();
    ov.querySelector('.sheet').innerHTML = catSheetHtml();
  });
}
function confirmSheet(title, text, okLabel, onOk) {
  openSheet('<h3>' + title + '</h3><div class="sub">' + text + '</div><div class="sheet-actions"><button class="btn" data-no>Отмена</button><button class="btn danger" data-yes>' + okLabel + '</button></div>', (e, close) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.yes !== undefined) onOk();
    close();
  });
}

/* ---------- Theme ---------- */
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
function applyTheme() {
  const t = S.settings.theme === 'auto' ? (mq && mq.matches ? 'light' : 'dark') : S.settings.theme;
  document.documentElement.dataset.theme = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'light' ? '#f5f6f8' : '#0f1115';
}
if (mq && mq.addEventListener) mq.addEventListener('change', applyTheme);

/* ---------- Router ---------- */
function route() {
  const hash = location.hash || '#/study';
  const [, name, arg] = hash.split('/');
  const tab = name === 'q' ? 'catalog' : (name || 'study');
  document.querySelectorAll('nav.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (name === 'catalog') renderCatalog();
  else if (name === 'q') renderDetail(arg);
  else if (name === 'progress') renderProgress();
  else if (name === 'settings') renderSettings();
  else renderStudy();
  if (name !== 'study' && name) window.scrollTo(0, 0);
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('button');
  if (!t || !QS.length) return;
  const d = t.dataset;
  if (d.fav) {
    S.fav[d.fav] ? delete S.fav[d.fav] : (S.fav[d.fav] = 1);
    saveFav();
    t.setAttribute('aria-pressed', !!S.fav[d.fav]);
    t.innerHTML = S.fav[d.fav] ? ICON_STAR : ICON_STAR_O;
    toast(S.fav[d.fav] ? 'Добавлено в избранное' : 'Убрано из избранного');
    return;
  }
  if (d.act === 'reveal') { revealed = true; renderStudy(); return; }
  if (d.act === 'skip') { nextCard(); return; }
  if (d.act === 'details') { detailsOpen = !detailsOpen; renderStudy(); return; }
  if (d.grade) { grade(current, +d.grade); nextCard(); return; }
  if (d.mode) { S.settings.mode = d.mode; saveSettings(); current = null; lastShown = []; renderStudy(); return; }
  if (d.open === 'cats') { openCats(); return; }
  if (d.cat) { catFilter = d.cat; renderCatalog(); return; }
  if (d.status) { statusFilter = d.status; renderCatalog(); return; }
  if (d.study) { forcedNext = d.study; current = null; location.hash = '#/study'; return; }
  if (d.act === 'back') { if (history.length > 1) history.back(); else location.hash = '#/catalog'; return; }
  if (d.themeSet) { S.settings.theme = d.themeSet; saveSettings(); applyTheme(); renderSettings(); return; }
  if (d.goal) { S.settings.goal = +d.goal; saveSettings(); renderSettings(); return; }
  if (d.toggle === 'details' || d.toggle === 'exp') { S.settings[d.toggle] = !S.settings[d.toggle]; saveSettings(); renderSettings(); return; }
  if (d.act === 'export') {
    let code = '';
    try { code = toB64(await backupJson()); } catch (err) { code = ''; }
    $('#io').innerHTML = '<textarea class="io" readonly aria-label="Код прогресса">' + code + '</textarea><div class="detail-actions"><button class="btn" data-act="copy">Скопировать</button></div>';
    return;
  }
  if (d.act === 'copy') {
    const ta = $('#io textarea'); ta.select();
    const done = () => toast('Скопировано');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand('copy'); done(); });
    else { document.execCommand('copy'); done(); }
    return;
  }
  if (d.act === 'file') {
    const json = await backupJson();
    const name = 'fe-cards-backup-' + dayKey() + '.json';
    const file = new File([json], name, { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  if (d.act === 'import') {
    $('#io').innerHTML = '<textarea class="io" aria-label="Вставь код прогресса" placeholder="Вставь код или содержимое файла бэкапа"></textarea>' +
      '<div class="detail-actions"><button class="btn primary" data-act="apply">Загрузить</button><label class="btn">Выбрать файл<input type="file" accept="application/json,.json" id="importFile" hidden></label></div>';
    $('#io textarea').focus();
    return;
  }
  if (d.act === 'apply') {
    try {
      await applyBackup($('#io textarea').value);
      updatePill(); toast('Прогресс загружен'); renderSettings();
    } catch (err) { toast('Код не подошёл'); }
    return;
  }
  if (d.act === 'reset') {
    confirmSheet('Сбросить прогресс?', 'Все уровни карточек, избранное, журнал ответов и статистика удалятся. Это нельзя отменить.', 'Сбросить', async () => {
      S = { ...defaults(), settings: S.settings };
      await persist(backend.replace(S, []));
      reviewsCount = 0;
      updatePill(); current = null; toast('Прогресс сброшен'); renderSettings();
    });
  }
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'importFile' || !e.target.files[0]) return;
  try {
    await applyBackup(await e.target.files[0].text());
    updatePill(); toast('Прогресс загружен'); renderSettings();
  } catch (err) { toast('Файл не подошёл'); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'search') { query = e.target.value; renderResults(); }
});
document.addEventListener('keydown', e => {
  if (!current || (location.hash || '#/study') !== '#/study' || e.target.closest('input, textarea') || document.querySelector('.overlay')) return;
  if (!revealed && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('button')) { e.preventDefault(); revealed = true; renderStudy(); }
  else if (revealed && ['1', '2', '3'].includes(e.key)) { grade(current, +e.key - 1); nextCard(); }
  else if (revealed && e.key.toLowerCase() === 'd') { detailsOpen = !detailsOpen; renderStudy(); }
});

/* ---------- Boot ---------- */
async function loadData() {
  const [qRes, eRes] = await Promise.all([fetch('data/questions.json'), fetch('data/experience.md').catch(() => null)]);
  if (!qRes.ok) throw new Error('questions.json: HTTP ' + qRes.status);
  DATA = await qRes.json();
  QS = DATA.qs;
  BY_ID = Object.fromEntries(QS.map(q => [q.id, q]));
  CAT_NAME = Object.fromEntries(DATA.cats.map(c => [c.id, c.name]));
  CAT_COUNT = {};
  QS.forEach(q => { CAT_COUNT[q.cat] = (CAT_COUNT[q.cat] || 0) + 1; });
  EXP = eRes && eRes.ok ? parseExperience(await eRes.text()) : {};
  const unknown = Object.keys(EXP).filter(id => !BY_ID[id]);
  if (unknown.length) console.warn('experience.md: unknown question ids', unknown);
}

async function boot() {
  applyTheme();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    view.innerHTML = '<div class="card empty"><h2>Не удалось загрузить вопросы</h2><p>Проверь интернет и перезапусти приложение.</p></div>';
    return;
  }
  await initStorage();
  applyTheme();
  updatePill();
  window.addEventListener('hashchange', route);
  route();
}
boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err)));
}
