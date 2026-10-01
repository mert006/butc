// BalPor Bütçe — harcama, zam, fırsat maliyeti, kimin için.
// Yerel mod: localStorage. Bulut modu (firebase-config.js doluysa): üyelik + Firestore senkron + fiş okuma.
import * as cloud from './cloud.js';

const KEY = 'bb.v1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const DEFAULT_CATS = [
  ['market', '🛒', 'Market'], ['yemek', '🍽️', 'Dışarıda yemek'], ['ulasim', '⛽', 'Ulaşım/Yakıt'],
  ['fatura', '💡', 'Faturalar'], ['kira', '🏠', 'Kira/Aidat'], ['saglik', '💊', 'Sağlık'],
  ['giyim', '👕', 'Giyim'], ['eglence', '🎉', 'Eğlence'], ['abonelik', '📺', 'Abonelik'],
  ['egitim', '📚', 'Eğitim'], ['ev', '🛋️', 'Ev/Eşya'], ['diger', '📦', 'Diğer'],
].map(([id, emoji, name]) => ({ id, emoji, name }));
const DEFAULT_PURPOSES = [
  ['kisisel', '🙋', 'Kişisel', 'kendine'], ['ev', '🏠', 'Ev', 'ev için'], ['is', '💼', 'İş', 'işin için'],
  ['sevgili', '❤️', 'Sevgili', 'sevgiline'], ['aile', '👨‍👩‍👧', 'Aile', 'ailene'], ['arkadas', '🍻', 'Arkadaşlar', 'arkadaşlarına'],
].map(([id, emoji, name, to]) => ({ id, emoji, name, to }));
// Bu kategoriler neredeyse her zaman "Ev" — sormaya gerek yok
const CAT_PURPOSE = { kira: 'ev', fatura: 'ev' };
const PALETTE = ['#c2410c', '#0f766e', '#7c3aed', '#ca8a04', '#be185d', '#2563eb', '#65a30d', '#9333ea', '#0891b2', '#dc2626', '#57534e', '#a16207'];
const UNITS = ['adet', 'kg', 'lt', 'paket', 'ay'];

const ASSETS = [
  { key: 'gold', emoji: '🥇', name: 'Gram altın' },
  { key: 'usd', emoji: '💵', name: 'Dolar' },
  { key: 'eur', emoji: '💶', name: 'Euro' },
  { key: 'bist', emoji: '📈', name: 'BIST 100' },
  { key: 'btc', emoji: '₿', name: 'Bitcoin' },
  { key: 'depo', emoji: '🏦', name: 'Mevduat*' },
];
const PERIODS = [['1 Ay', 1], ['3 Ay', 3], ['6 Ay', 6], ['9 Ay', 9], ['1 Yıl', 12], ['Bu Yıl', 'ytd']];

// ---------- durum ----------
let mode = 'local';          // 'local' | 'cloud'
let user = null;
let db = loadLocal();
let market = null;
let period = 1;
let statPurpose = null;      // Analiz filtresi
let editing = null;          // düzenlenen harcama
let selCat = null, selPur = null, purAuto = false;
let showAll = false;
let rc = null;               // okunan fiş

function blank() { return { expenses: [], categories: DEFAULT_CATS, purposes: DEFAULT_PURPOSES, lastBackup: null, payDay: null, salary: null }; }
function loadLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.expenses)) {
      if (!d.categories?.length) d.categories = DEFAULT_CATS;
      if (!d.purposes?.length) d.purposes = DEFAULT_PURPOSES;
      return d;
    }
  } catch (e) { /* bozuk veri → sıfırdan */ }
  return blank();
}
const saveLocal = () => localStorage.setItem(KEY, JSON.stringify(db));

// ---------- kalıcılık (yerel ya da bulut) ----------
function commit(list, prevDates = {}) {
  for (const e of list) {
    const i = db.expenses.findIndex(x => x.id === e.id);
    if (i >= 0) db.expenses[i] = e; else db.expenses.push(e);
  }
  if (mode === 'cloud') cloud.putExpenses(user.uid, list, prevDates).catch(err => toast('Kaydedilemedi: ' + err.message));
  else saveLocal();
  renderAll();
}
function removeExp(e) {
  db.expenses = db.expenses.filter(x => x.id !== e.id);
  if (mode === 'cloud') cloud.removeExpense(user.uid, e).catch(err => toast('Silinemedi: ' + err.message));
  else saveLocal();
  renderAll();
}
function commitSettings() {
  if (mode === 'cloud') cloud.putSettings(user.uid, { categories: db.categories, purposes: db.purposes, lastBackup: db.lastBackup, payDay: db.payDay ?? null, salary: db.salary ?? null }).catch(() => {});
  else saveLocal();
}

// ---------- yardımcılar ----------
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const norm = s => (s || '').trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const isYmd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseYmd(s));

function money(v, forceDec) {
  const dec = forceDec || Math.abs(v) < 1000 ? 2 : 0;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}
function pct(v, dp = 1) {
  if (!isFinite(v)) return '–';
  const s = Math.abs(v * 100).toLocaleString('tr-TR', { maximumFractionDigits: dp, minimumFractionDigits: dp });
  return (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + s;
}
const cls = v => v > 0.0005 ? 'bad' : v < -0.0005 ? 'good' : '';
function parseAmount(s) {
  if (typeof s === 'number') return s;
  s = String(s ?? '').replace(/\s|₺|tl/gi, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s);
}
const fmtNum = v => v.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
const moneyStr = v => v == null || !isFinite(v) ? '' : v.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
// Tutar yazarken binlik nokta kendiliğinden gelsin: 1200 → 1.200, 1200000 → 1.200.000 (kuruş virgülle)
function groupInput(el, e) {
  let v = el.value, pos = el.selectionStart ?? v.length;
  if (e?.data === '.' && v[pos - 1] === '.') v = v.slice(0, pos - 1) + ',' + v.slice(pos);   // elle yazılan nokta = kuruş virgülü
  const keep = v.slice(0, pos).replace(/[^\d,]/g, '').length;
  let [int, ...dec] = v.replace(/[^\d,]/g, '').split(',');
  int = int.replace(/^0+(?=\d)/, '');
  if (!int && dec.length) int = '0';
  let out = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (dec.length) out += ',' + dec.join('').slice(0, 2);
  if (out === el.value) return;
  el.value = out;
  let n = 0, p = 0;   // imleci aynı rakamın arkasına geri koy
  while (p < out.length && n < keep) { if (/[\d,]/.test(out[p])) n++; p++; }
  if (document.activeElement === el) el.setSelectionRange(p, p);
}
document.addEventListener('input', e => { if (e.target.classList?.contains('money')) groupInput(e.target, e); }, true);
const fmtDate = s => parseYmd(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDay = s => {
  const diff = daysBetween(s, today());
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return parseYmd(s).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
};
const catOf = id => db.categories.find(c => c.id === id) || { id, emoji: '📦', name: 'Diğer' };
const purOf = id => db.purposes.find(p => p.id === id);
const catColor = id => PALETTE[Math.max(0, db.categories.findIndex(c => c.id === id)) % PALETTE.length];
const purColor = id => PALETTE[(Math.max(0, db.purposes.findIndex(p => p.id === id)) + 3) % PALETTE.length];
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------- paneller + Android geri tuşu ----------
// Açık panel varken geçmişte tek bir kayıt tutulur; geri tuşu en üstteki paneli kapatır.
const stack = [];
let hasEntry = false, popSilently = 0;
function openOv(id) {
  $('#' + id).hidden = false;
  if (!stack.includes(id)) stack.push(id);
  if (!hasEntry) { history.pushState({ ov: 1 }, ''); hasEntry = true; }
}
function closeOv(id, fromPop) {
  const el = $('#' + id);
  if (el.hidden) return;
  el.hidden = true;
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
  if (id === 'ask') askDone?.(null);
  if (!fromPop) setTimeout(() => {
    if (!stack.length && hasEntry) { hasEntry = false; popSilently++; history.back(); }
  }, 0);
}
addEventListener('popstate', () => {
  if (popSilently) { popSilently--; return; }
  hasEntry = false;
  const top = stack[stack.length - 1];
  if (top) closeOv(top, true);
  if (stack.length) { history.pushState({ ov: 1 }, ''); hasEntry = true; }
});
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) closeOv(c.closest('.overlay').id);
  else if (e.target.classList.contains('overlay') && !e.target.classList.contains('solid')) closeOv(e.target.id);
});

// ---------- soru sorma ----------
let askDone = null;
function ask({ text, sub = '', options = [], input = null, value = '', skip = 'Atla' }) {
  return new Promise(resolve => {
    askDone = v => { askDone = null; resolve(v); };
    $('#askText').textContent = text;
    $('#askSub').innerHTML = sub;
    $('#askOpts').innerHTML = options.map((o, i) => `<button class="pchip" data-i="${i}">${esc(o.label)}</button>`).join('');
    $('#askOpts').onclick = e => { const b = e.target.closest('.pchip'); if (b) finish(options[+b.dataset.i].value); };
    const inp = $('#askInput');
    $('#askInputRow').hidden = !input;
    if (input) {
      inp.type = input === 'date' ? 'date' : 'text';
      inp.inputMode = input === 'number' || input === 'money' ? 'decimal' : 'text';
      inp.classList.toggle('money', input === 'money');
      inp.value = value;
    }
    const finish = v => { const f = askDone; askDone = null; closeOv('ask'); f?.(v); };
    $('#askOk').onclick = () => { const v = inp.value.trim(); if (v) finish(v); };
    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#askOk').click(); } };
    $('#askSkip').textContent = skip;
    $('#askSkip').onclick = () => finish(null);
    openOv('ask');
    if (input) setTimeout(() => inp.focus(), 60);
  });
}
const purposeOptions = () => db.purposes.map(p => ({ label: `${p.emoji} ${p.name}`, value: p.id }));
const askPurpose = (sub, text = 'Bu harcamayı kimin için yaptın?') => ask({ text, sub, options: purposeOptions(), skip: 'Şimdilik boş bırak' });

// Geçmişe bakarak "kimin için" tahmini. Emin değilse null → kullanıcıya sorulur.
function inferPurpose({ cat, item, store }) {
  const hist = db.expenses.filter(e => e.purpose && e.id !== editing?.id).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  const vote = (arr, minLen, ratio) => {
    if (arr.length < minLen) return null;
    const c = {};
    arr.forEach(e => c[e.purpose] = (c[e.purpose] || 0) + 1);
    const [p, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return n / arr.length >= ratio ? p : null;
  };
  if (item) { const p = vote(hist.filter(e => norm(e.item) === norm(item)).slice(0, 3), 1, 0.66); if (p) return p; }
  if (store) { const p = vote(hist.filter(e => norm(e.store) === norm(store)).slice(0, 3), 2, 0.66); if (p) return p; }
  if (CAT_PURPOSE[cat] && purOf(CAT_PURPOSE[cat])) return CAT_PURPOSE[cat];
  if (cat) return vote(hist.filter(e => e.cat === cat).slice(0, 5), 3, 0.8);
  return null;
}

// ---------- dönem ----------
function periodRange(p) {
  const now = new Date();
  const end = ymd(now);
  let s;
  if (p === 'ytd') s = new Date(now.getFullYear(), 0, 1);
  else { s = new Date(now); s.setMonth(s.getMonth() - p); s.setDate(s.getDate() + 1); }
  const start = ymd(s);
  const len = daysBetween(start, end) + 1;
  const ps = parseYmd(start); ps.setDate(ps.getDate() - len);
  const pe = parseYmd(start); pe.setDate(pe.getDate() - 1);
  return { start, end, prevStart: ymd(ps), prevEnd: ymd(pe), len };
}
const inRange = (e, a, b) => e.date >= a && e.date <= b;
const sum = arr => arr.reduce((t, e) => t + e.amount, 0);

// ---------- piyasa ----------
async function loadMarket() {
  try { market = await (await fetch('data/market.json', { cache: 'no-cache' })).json(); }
  catch (e) { market = null; }
  depositFactor.cache = null;
  renderSettingsInfo();
  if ($('#v-stats').classList.contains('active')) renderStats();
}
function priceAt(series, date) {
  if (!series || !series.length) return null;
  if (date < series[0][0]) return series[0][1];
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid][0] <= date) lo = mid; else hi = mid - 1;
  }
  return series[lo][1];
}
function depositFactor(from) {
  const pol = market?.series?.policy;
  if (!pol) return null;
  const end = today();
  depositFactor.cache ??= new Map();
  if (depositFactor.cache.has(from)) return depositFactor.cache.get(from);
  let f = 1;
  const d = parseYmd(from);
  for (let s = ymd(d); s < end; d.setDate(d.getDate() + 1), s = ymd(d)) f *= 1 + priceAt(pol, s) / 100 / 365;
  depositFactor.cache.set(from, f);
  return f;
}
function growthFactor(key, date) {
  if (key === 'depo') return depositFactor(date);
  const s = market?.series?.[key];
  if (!s) return null;
  const then = priceAt(s, date);
  return then ? s[s.length - 1][1] / then : null;
}

// ---------- ANA ----------
function renderHome() {
  const now = new Date();
  const mStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const t = today();
  const thisMonth = sum(db.expenses.filter(e => inRange(e, mStart, t)));
  const pmStart = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const pmSameDay = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()));
  const prevSoFar = sum(db.expenses.filter(e => inRange(e, pmStart, ymd(pmSameDay))));
  $('#monthTotal').textContent = money(thisMonth);
  $('#monthCompare').innerHTML = prevSoFar > 0
    ? `Geçen ayın aynı dönemine göre <b class="${cls(thisMonth / prevSoFar - 1)}">${pct(thisMonth / prevSoFar - 1)}</b> (${money(prevSoFar)})`
    : now.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

  // Yedek uyarısı sadece yerel modda (bulutta veri zaten hesapta)
  const since = db.lastBackup ? daysBetween(db.lastBackup.slice(0, 10), t) : Infinity;
  const w = $('#backupWarn');
  if (mode === 'local' && db.expenses.length >= 10 && since > 30) {
    w.hidden = false;
    w.innerHTML = `💾 ${db.lastBackup ? since + ' gündür' : 'Hiç'} yedek alınmadı. <button class="link" id="quickBk">Şimdi yedekle</button>`;
    $('#quickBk').onclick = backupShare;
  } else w.hidden = true;

  const sorted = [...db.expenses].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
  const list = showAll ? sorted : sorted.slice(0, 30);
  $('#showAll').hidden = showAll || sorted.length <= 30;
  if (!list.length) {
    $('#recent').innerHTML = `<div class="empty">Henüz harcama yok.<br>Sağ alttaki <b>+</b> ile ilkini ekle.<br>Elle girebilir ya da fişin fotoğrafını atabilirsin.</div>`;
    return;
  }
  const dayTotals = {};
  db.expenses.forEach(e => dayTotals[e.date] = (dayTotals[e.date] || 0) + e.amount);
  let html = '', lastDay = '';
  for (const e of list) {
    if (e.date !== lastDay) { html += `<div class="dayhead">${fmtDay(e.date)} · ${money(dayTotals[e.date])}</div>`; lastDay = e.date; }
    html += itemRow(e);
  }
  $('#recent').innerHTML = html;
}
function itemRow(e) {
  const c = catOf(e.cat), p = purOf(e.purpose);
  const title = esc(e.item || c.name);
  const sub = [p ? `${p.emoji} ${p.name}` : '', e.item ? c.name : '', e.qty && e.qty !== 1 ? `${fmtNum(e.qty)} ${e.unit}` : '', e.store || '', e.note || '']
    .filter(Boolean).map(esc).join(' · ');
  return `<div class="item" data-id="${e.id}">
    <div class="ic" style="background:${catColor(e.cat)}22">${c.emoji}</div>
    <div class="mid"><div>${title}</div>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>
    <div class="amt">${money(e.amount)}</div></div>`;
}

// ---------- ELLE GİRİŞ ----------
function openSheet(id) {
  editing = id ? db.expenses.find(x => x.id === id) : null;
  const e = editing;
  $('#formTitle').textContent = e ? 'Harcamayı düzenle' : 'Harcama ekle';
  $('#fAmount').value = e ? moneyStr(e.amount) : '';
  $('#fItem').value = e?.item || '';
  $('#fQty').value = e?.qty ? String(e.qty).replace('.', ',') : '';
  $('#fUnit').value = e?.unit || 'adet';
  $('#fDate').value = e?.date || today();
  $('#fNote').value = e?.note || e?.store || '';
  $('#fDelete').hidden = !e;
  $('#fItemBox').open = !!e?.item;
  selCat = e?.cat || null;
  selPur = e?.purpose || null;
  purAuto = false;
  renderCatGrid(); renderPurChips(); renderItemList(); updateHint();
  openOv('sheet');
}
function renderCatGrid() {
  $('#fCats').innerHTML = db.categories.map(c =>
    `<button type="button" class="cat${c.id === selCat ? ' sel' : ''}" data-c="${c.id}"><b>${c.emoji}</b>${esc(c.name)}</button>`).join('');
}
function renderPurChips() {
  $('#fPurs').innerHTML = db.purposes.map(p =>
    `<button type="button" class="pchip${p.id === selPur ? ' sel' : ''}" data-p="${p.id}">${p.emoji} ${esc(p.name)}</button>`).join('');
  $('#fPurHint').textContent = purAuto && selPur ? '(geçmişine göre tahmin)' : '';
}
function autoPurpose() {
  if (selPur && !purAuto) return;
  const p = inferPurpose({ cat: selCat, item: $('#fItem').value, store: $('#fNote').value });
  selPur = p; purAuto = !!p;
  renderPurChips();
}
function renderItemList() {
  const names = new Map();
  for (const e of db.expenses) if (e.item) names.set(norm(e.item), e.item);
  $('#itemList').innerHTML = [...names.values()].sort((a, b) => a.localeCompare(b, 'tr')).map(n => `<option value="${esc(n)}">`).join('');
}
function lastPurchase(item, excludeId) {
  const k = norm(item);
  return db.expenses.filter(e => e.item && norm(e.item) === k && e.id !== excludeId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts)[0];
}
function updateHint() {
  const item = $('#fItem').value;
  const h = $('#fHint');
  if (!item.trim()) { h.textContent = ''; return; }
  const last = lastPurchase(item, editing?.id);
  if (!last) { h.textContent = 'Yeni ürün. Bir dahaki alımda zam hesaplanacak.'; return; }
  if (!selCat) { selCat = last.cat; renderCatGrid(); }
  if (!$('#fQty').value && last.unit) $('#fUnit').value = last.unit;
  const lu = last.amount / (last.qty || 1);
  let txt = `Son alım: ${money(lu, true)}/${last.unit || 'adet'} · ${fmtDate(last.date)}`;
  const amt = parseAmount($('#fAmount').value), qty = parseAmount($('#fQty').value) || 1;
  if (amt > 0 && last.unit === $('#fUnit').value) {
    const ch = (amt / qty) / lu - 1;
    txt += ` → <b class="${cls(ch)}">${pct(ch)}</b>`;
  }
  h.innerHTML = txt;
}
async function submitForm(ev) {
  ev.preventDefault();
  const amount = parseAmount($('#fAmount').value);
  if (!selCat) { toast('Önce para nereye gitti onu seç'); return; }
  if (!(amount > 0)) { toast('Ne kadar tuttu, onu yaz'); $('#fAmount').focus(); return; }
  const c = catOf(selCat);
  const item = $('#fItem').value.trim();

  // Normalden çok yüksek tutar → yazım hatası olabilir, sor
  const same = db.expenses.filter(e => e.cat === selCat && e.id !== editing?.id).map(e => e.amount);
  if (same.length >= 5) {
    const med = median(same);
    if (amount > med * 4 && amount - med > 300 && (!editing || editing.amount !== amount)) {
      const a = await ask({
        text: `${money(amount)} ${c.name} için normalinden çok yüksek. Doğru mu?`,
        sub: `Genelde ${money(med)} civarı harcıyorsun.`,
        options: [{ label: '✅ Evet, doğru', value: 'ok' }, { label: '✏️ Düzelteyim', value: 'fix' }], skip: 'Vazgeç',
      });
      if (a !== 'ok') { $('#fAmount').focus(); return; }
    }
  }
  // Kimin için belli değilse sor
  if (!selPur) {
    const p = await askPurpose(`${c.emoji} ${esc(item || c.name)} · ${money(amount)}`);
    if (p) selPur = p;
  }
  const qtyRaw = parseAmount($('#fQty').value);
  const rec = {
    id: editing?.id || uid(),
    date: $('#fDate').value || today(),
    amount: Math.round(amount * 100) / 100,
    cat: selCat,
    purpose: selPur || undefined,
    item: item || undefined,
    qty: item ? (qtyRaw > 0 ? qtyRaw : 1) : undefined,
    unit: item ? $('#fUnit').value : undefined,
    note: $('#fNote').value.trim() || undefined,
    store: editing?.store, receiptId: editing?.receiptId,
    ts: Date.now(),
  };
  if (rec.store && rec.note === rec.store) rec.note = undefined;
  commit([rec], editing ? { [rec.id]: editing.date } : {});
  closeOv('sheet');
  toast(editing ? 'Güncellendi' : `${money(rec.amount)} kaydedildi`);
}
function deleteCurrent() {
  if (!editing || !confirm('Bu harcama silinsin mi?')) return;
  removeExp(editing);
  closeOv('sheet'); toast('Silindi');
}

// ---------- FİŞ OKUMA ----------
async function compress(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL('image/jpeg', 0.85);
  return { url, b64: url.split(',')[1] };
}
function buildPrompt() {
  const items = new Map(), stores = new Map();
  [...db.expenses].sort((a, b) => b.date.localeCompare(a.date)).forEach(e => {
    if (e.item && !items.has(norm(e.item))) items.set(norm(e.item), `${e.item} (${e.unit || 'adet'}${e.purpose ? ', ' + e.purpose : ''})`);
    if (e.store && e.purpose && !stores.has(norm(e.store))) stores.set(norm(e.store), `${e.store} → ${e.purpose}`);
  });
  return `Sen bir fiş/fatura okuma asistanısın. Görseldeki alışveriş fişini, faturayı ya da ödeme ekran görüntüsünü oku ve SADECE şu yapıda JSON döndür:
{"store": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
 "items": [{"name": string, "qty": number, "unit": "adet"|"kg"|"lt"|"paket"|"ay", "amount": number|null, "cat": string, "purpose": string|null, "confidence": "high"|"low"}],
 "questions": [{"item": number|null, "field": "purpose"|"amount"|"name"|"qty"|"date"|"store"|"total"|null, "type": "purpose"|"choice"|"text"|"number"|"date", "text": string, "options": [string]}]}

Kurallar:
- amount: o satırda ödenen TL tutarı (miktar × birim fiyat). İndirimleri ilgili ürünün tutarından düş. Kalemlerin toplamı ödenen toplamla eşleşsin. KDV, ara toplam, para üstü, kart/ödeme satırlarını kalem yapma.
- Sayılar JSON sayısı olsun: "1.234,50" → 1234.5
- name: sade, genel Türkçe ürün adı ("EKM.TAM BUGDAY 350G" → "Tam buğday ekmeği"). Kullanıcının geçmiş ürünlerinden biriyle aynı ürünse AYNEN o adı yaz (zam takibi bu adla yapılıyor).
- Tartılı ürünlerde qty ve unit (kg/lt) fişten al; yoksa qty 1, unit "adet".
- cat: aşağıdaki kategori id'lerinden en uygunu.
- purpose: sadece açıkça belliyse ya da geçmişte aynı ürün/mağaza için belliyse doldur, yoksa null.
- confidence "low": ürün adını ya da tutarı tam okuyamadıysan.
- questions: okuyamadığın ya da emin olmadığın her şey için kısa, samimi Türkçe soru ekle. Örn: "Şu satırı okuyamadım: 'K...R 2 AD'. Ne almıştın?" (field "name", type "text"). Tutarı okunmayan kalem için field "amount", type "number".
- Kimin için olduğu tahmin edilebilir ama belli olmayan ürünlerde (çiçek, hediye, oyuncak, iki kişilik yemek, parfüm, kozmetik, bebek ürünü, ofis malzemesi vb.) type "purpose" soru sor. Örn: "Çiçek almışsın 🌷 Sevgilin için mi?" Tüm fiş tek bir amaca aitse tek soru sor (item: null).
- En fazla 5 soru, gereksiz soru sorma. Tarih okunamazsa soru ekleme, date null bırak.
- item alanı items dizisindeki 0'dan başlayan sıra numarasıdır.
- Görsel bir fiş/fatura değilse items boş olsun ve questions'a durumu açıklayan tek bir "text" sorusu koy.

Kategori id'leri: ${db.categories.map(c => `${c.id}=${c.name}`).join(', ')}
Kimin için id'leri: ${db.purposes.map(p => `${p.id}=${p.name}`).join(', ')}
Bugün: ${today()}
Kullanıcının geçmiş ürünleri: ${[...items.values()].slice(0, 150).join('; ') || 'yok'}
Geçmiş mağaza → kimin için: ${[...stores.values()].slice(0, 40).join('; ') || 'yok'}`;
}
function parseAI(txt) {
  const s = txt.replace(/^```(json)?/m, '').replace(/```\s*$/m, '').trim();
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}
function normalizeReceipt(d, img) {
  const catIds = new Set(db.categories.map(c => c.id)), purIds = new Set(db.purposes.map(p => p.id));
  const items = (Array.isArray(d.items) ? d.items : []).map(x => {
    const amt = parseAmount(x.amount);
    const qty = parseAmount(x.qty);
    return {
      name: String(x.name || '').trim() || 'Okunamayan ürün',
      qty: qty > 0 ? qty : 1,
      unit: UNITS.includes(x.unit) ? x.unit : 'adet',
      amount: amt > 0 ? Math.round(amt * 100) / 100 : null,
      cat: catIds.has(x.cat) ? x.cat : 'diger',
      purpose: purIds.has(x.purpose) ? x.purpose : null,
      low: x.confidence === 'low',
    };
  });
  const date = isYmd(d.date) && d.date <= today() ? d.date : null;
  const total = parseAmount(d.total);
  const questions = (Array.isArray(d.questions) ? d.questions : []).filter(q => q && q.text).slice(0, 6).map(q => ({
    item: Number.isInteger(q.item) && items[q.item] ? q.item : null,
    field: q.field || (q.type === 'purpose' ? 'purpose' : null),
    type: q.type || 'text',
    text: String(q.text),
    options: Array.isArray(q.options) ? q.options.map(String).slice(0, 6) : [],
  }));
  return { img, store: d.store ? String(d.store).trim() : '', date: date || today(), dateKnown: !!date, total: total > 0 ? total : null, items, questions };
}
async function startReceipt(file) {
  closeOv('chooser');
  if (!file) return;
  if (mode !== 'cloud') {
    await ask({ text: 'Fiş okuma için hesabın olması lazım.', sub: 'Firebase kurulumu yapılınca açılacak. Şimdilik elle girebilirsin.', options: [{ label: '👍 Tamam', value: 1 }], skip: 'Kapat' });
    return;
  }
  openOv('receipt');
  $('#rcBody').innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Fişi okuyorum…</p>`;
  let img;
  try {
    img = await compress(file);
    $('#rcBody').insertAdjacentHTML('afterbegin', `<img class="rc-img" src="${img.url}" alt="">`);
    const txt = await cloud.readReceipt(img.b64, buildPrompt());
    rc = normalizeReceipt(parseAI(txt), img.url);
  } catch (e) {
    $('#rcBody').innerHTML = `${img ? `<img class="rc-img" src="${img.url}" alt="">` : ''}
      <p class="bad">Fişi okuyamadım: ${esc(e.message)}</p>
      <button class="btn full" id="rcManual">Elle gireyim</button>`;
    $('#rcManual').onclick = () => { closeOv('receipt'); openSheet(); };
    return;
  }
  renderReceipt();
  await runQuestions();
}
async function runQuestions() {
  const qs = [];
  if (!rc.dateKnown) qs.push({ field: 'date', type: 'date', item: null, text: 'Fişin tarihini okuyamadım. Ne zaman aldın?', options: [] });
  // Geçmişten tahmin edilebilenleri önce doldur, gereksiz soru sorma
  rc.items.forEach(x => { if (!x.purpose) x.purpose = inferPurpose({ cat: x.cat, item: x.name, store: rc.store }); });
  qs.push(...rc.questions.filter(q => !(q.field === 'purpose' && q.item != null && rc.items[q.item].purpose)));
  // Tutarı eksik kalemler en sonda (önce "ne aldın" sonra "kaç TL" doğal sıra)
  rc.items.forEach((x, i) => {
    if (x.amount == null && !rc.questions.some(q => q.item === i && q.field === 'amount'))
      qs.push({ field: 'amount', type: 'number', item: i, text: `Bunun tutarını okuyamadım. Kaç TL'ydi?`, options: [] });
  });

  for (const q of qs) {
    if (q.field === 'purpose' && q.item == null && rc.items.every(x => x.purpose)) continue;
    const target = q.item != null ? rc.items[q.item] : null;
    let a;
    if (q.field === 'purpose' || q.type === 'purpose') {
      a = await askPurpose(target ? `${esc(target.name)} · ${target.amount ? money(target.amount) : '?'}` : esc(rc.store), q.text);
      if (a) { if (target) target.purpose = a; else rc.items.forEach(x => { if (!x.purpose) x.purpose = a; }); }
    } else if (q.type === 'date' || q.field === 'date') {
      a = await ask({ text: q.text, options: [{ label: 'Bugün', value: today() }, { label: 'Dün', value: ymd(new Date(Date.now() - 864e5)) }], input: 'date', value: today() });
      if (isYmd(a)) rc.date = a;
    } else {
      const input = ['amount', 'total'].includes(q.field) ? 'money' : q.type === 'number' || q.field === 'qty' ? 'number' : 'text';
      a = await ask({ text: q.text, sub: target ? `Kalem: ${esc(target.name)}` : '', options: q.options.map(o => ({ label: o, value: o })), input });
      if (a != null) applyAnswer(q, target, a);
    }
    if (!$('#receipt').hidden) renderReceipt(); else return;
  }
  // Hâlâ kimin için belli olmayanlar → tek soruda topla
  const rest = rc.items.filter(x => !x.purpose);
  if (rest.length) {
    const names = rest.slice(0, 4).map(x => x.name).join(', ') + (rest.length > 4 ? ` ve ${rest.length - 4} kalem daha` : '');
    const a = await askPurpose(esc(names), rest.length === rc.items.length ? 'Bu alışverişi kimin için yaptın?' : 'Kalanlar kimin için?');
    if (a) rest.forEach(x => x.purpose = a);
    if (!$('#receipt').hidden) renderReceipt();
  }
}
function applyAnswer(q, target, a) {
  const num = parseAmount(a);
  switch (q.field) {
    case 'amount': if (target && num > 0) { target.amount = num; target.low = false; } break;
    case 'qty': if (target && num > 0) target.qty = num; break;
    case 'name': if (target) { target.name = a; target.low = false; } break;
    case 'store': rc.store = a; break;
    case 'total': if (num > 0) rc.total = num; break;
    default: if (target) target.note = [target.note, a].filter(Boolean).join(' · ');
  }
}
function renderReceipt() {
  const opts = (list, sel, blankLabel) => (blankLabel ? `<option value="">${blankLabel}</option>` : '') +
    list.map(o => `<option value="${o.id}"${o.id === sel ? ' selected' : ''}>${o.emoji} ${esc(o.name)}</option>`).join('');
  const rows = rc.items.map((x, i) => `
    <div class="rc-row${x.low ? ' low' : ''}" data-i="${i}">
      <input class="rc-name" value="${esc(x.name)}" data-f="name">
      <input class="rc-amt money" inputmode="decimal" value="${moneyStr(x.amount)}" placeholder="₺?" data-f="amount">
      <button class="x rc-del" aria-label="Kalemi sil">✕</button>
      <div class="sub">
        <select data-f="cat">${opts(db.categories, x.cat)}</select>
        <select data-f="purpose">${opts(db.purposes, x.purpose, 'Kimin için?')}</select>
        <input data-f="qty" inputmode="decimal" value="${fmtNum(x.qty)}" style="flex:0 0 52px">
        <select data-f="unit" style="flex:0 0 74px">${UNITS.map(u => `<option${u === x.unit ? ' selected' : ''}>${u}</option>`).join('')}</select>
      </div>
    </div>`).join('');
  $('#rcBody').innerHTML = `
    <img class="rc-img" src="${rc.img}" alt="">
    <div class="row"><input id="rcStore" placeholder="Mağaza" value="${esc(rc.store)}"><input id="rcDate" type="date" value="${rc.date}"></div>
    <div id="rcItems">${rows || '<p class="muted">Kalem bulunamadı. Aşağıdan ekleyebilirsin.</p>'}</div>
    <button class="link" id="rcAdd">+ Kalem ekle</button>
    <div id="rcSum" class="small"></div>
    <button class="btn full" id="rcSave" style="margin-top:10px"></button>`;
  renderRcSum();
}
function renderRcSum() {
  const s = rc.items.reduce((t, x) => t + (x.amount || 0), 0);
  let h = `Kalemler toplamı <b>${money(s, true)}</b>`;
  if (rc.total) {
    const diff = Math.round((rc.total - s) * 100) / 100;
    h += ` · Fiş toplamı <b>${money(rc.total, true)}</b>`;
    if (Math.abs(diff) >= 1) h += `<div class="bad">Fark ${money(diff, true)}. ${diff > 0 ? '<button class="link" id="rcDiff">Farkı "Diğer" olarak ekle</button>' : 'Bir kalem fazla okunmuş olabilir.'}</div>`;
  }
  $('#rcSum').innerHTML = h;
  const ok = rc.items.filter(x => x.amount > 0).length;
  $('#rcSave').textContent = `Kaydet (${ok} kalem · ${money(s)})`;
  $('#rcSave').disabled = !ok;
}
async function saveReceipt() {
  const valid = rc.items.filter(x => x.amount > 0);
  if (valid.length < rc.items.length) {
    const a = await ask({ text: `${rc.items.length - valid.length} kalemin tutarı yok. Onları atlayıp kaydedeyim mi?`, options: [{ label: 'Evet, atla', value: 1 }], skip: 'Geri dön' });
    if (!a) return;
  }
  const rest = valid.filter(x => !x.purpose);
  if (rest.length) {
    const a = await askPurpose(esc(rest.map(x => x.name).slice(0, 4).join(', ')), 'Bunlar kimin için?');
    if (a) rest.forEach(x => x.purpose = a);
  }
  const receiptId = uid();
  const ts = Date.now();
  const list = valid.map((x, i) => ({
    id: uid() + i, date: rc.date, amount: Math.round(x.amount * 100) / 100, cat: x.cat,
    purpose: x.purpose || undefined, item: x.name, qty: x.qty, unit: x.unit,
    note: x.note || undefined, store: rc.store || undefined, receiptId, ts: ts + i,
  }));
  commit(list);
  closeOv('receipt');
  toast(`${list.length} kalem kaydedildi · ${money(sum(list))}`);
  rc = null;
}
$('#rcBody').addEventListener('input', e => {
  if (e.target.id === 'rcStore') { rc.store = e.target.value; return; }
  if (e.target.id === 'rcDate') { if (isYmd(e.target.value)) rc.date = e.target.value; return; }
  const row = e.target.closest('.rc-row'), f = e.target.dataset.f;
  if (!row || !f) return;
  const x = rc.items[+row.dataset.i];
  if (f === 'amount') { const v = parseAmount(e.target.value); x.amount = v > 0 ? v : null; renderRcSum(); }
  else if (f === 'qty') { const v = parseAmount(e.target.value); if (v > 0) x.qty = v; }
  else if (f === 'purpose') x.purpose = e.target.value || null;
  else if (f === 'name') { x.name = e.target.value; x.low = false; }
  else x[f] = e.target.value;
});
$('#rcBody').addEventListener('click', e => {
  if (e.target.classList.contains('rc-del')) { rc.items.splice(+e.target.closest('.rc-row').dataset.i, 1); renderReceipt(); }
  else if (e.target.id === 'rcAdd') { rc.items.push({ name: '', qty: 1, unit: 'adet', amount: null, cat: 'diger', purpose: null }); renderReceipt(); $$('.rc-name').at(-1)?.focus(); }
  else if (e.target.id === 'rcDiff') {
    const s = rc.items.reduce((t, x) => t + (x.amount || 0), 0);
    rc.items.push({ name: 'Fişteki diğer kalemler', qty: 1, unit: 'adet', amount: Math.round((rc.total - s) * 100) / 100, cat: 'diger', purpose: rc.items[0]?.purpose || null });
    renderReceipt();
  }
  else if (e.target.id === 'rcSave') saveReceipt();
});

// ---------- ANALİZ ----------
function renderPeriods() {
  $('#periods').innerHTML = PERIODS.map(([l, v]) => `<button data-p="${v}" class="${v === period ? 'sel' : ''}">${l}</button>`).join('');
}
function renderStats() {
  renderPeriods();
  const r = periodRange(period);
  const byPur = e => !statPurpose || (e.purpose || '_') === statPurpose;
  const curAll = db.expenses.filter(e => inRange(e, r.start, r.end));
  const cur = curAll.filter(byPur);
  const prev = db.expenses.filter(e => inRange(e, r.prevStart, r.prevEnd)).filter(byPur);
  const total = sum(cur), ptotal = sum(prev);
  const el = $('#stats');
  const fp = statPurpose && (purOf(statPurpose) || { emoji: '❔', name: 'Belirtilmemiş' });
  const filterChip = fp ? `<button class="filter" id="clearFilter">${fp.emoji} ${esc(fp.name)} ✕</button>` : '';
  if (!cur.length) {
    el.innerHTML = `${filterChip}<div class="empty">${fmtDate(r.start)} – ${fmtDate(r.end)}<br>arasında harcama yok.</div>`;
    return;
  }
  const firstDate = db.expenses.reduce((m, e) => e.date < m ? e.date : m, r.end);
  const activeDays = daysBetween(r.start < firstDate ? firstDate : r.start, r.end) + 1;

  let html = `${filterChip}<p class="muted small">${fmtDate(r.start)} – ${fmtDate(r.end)}</p>
  <div class="kpis">
    <div class="kpi"><div class="muted small">Toplam</div><div class="v">${money(total)}</div>
      ${ptotal > 0 ? `<div class="small ${cls(total / ptotal - 1)}">${pct(total / ptotal - 1)} önceki döneme göre</div>` : '<div class="small muted">önceki dönem verisi yok</div>'}</div>
    <div class="kpi"><div class="muted small">Günlük ortalama</div><div class="v">${money(total / activeDays)}</div>
      <div class="small muted">${cur.length} harcama</div></div>
  </div>`;
  if (!statPurpose) html += `<div class="card"><h3>Kimin için?</h3>${purposeBars(curAll)}</div>`;
  html += `<div class="card"><h3>Zaman içinde</h3>${trendChart(cur, r)}</div>`;
  html += `<div class="card"><h3>Neye ne kadar?</h3>${catBars(cur, prev, total)}</div>`;
  html += `<div class="card"><h3>Zam takibi</h3>${zamTable(r)}</div>`;
  html += `<div class="card"><h3>Fırsat maliyeti</h3>${oppCost(cur, total)}</div>`;
  el.innerHTML = html;
}
function purposeBars(cur) {
  const total = sum(cur);
  const by = new Map();
  for (const e of cur) { const k = e.purpose || '_'; by.set(k, (by.get(k) || 0) + e.amount); }
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const lead = rows.filter(([k]) => k !== '_' && k !== 'kisisel').slice(0, 3)
    .map(([k, v]) => { const p = purOf(k); return p ? `${p.to || p.name.toLocaleLowerCase('tr') + ' için'} <b>${money(v)}</b>` : ''; }).filter(Boolean);
  let h = lead.length ? `<p class="lead">Bu dönemde ${lead.join(', ')} harcadın.</p>` : '';
  h += rows.map(([k, v]) => {
    const p = purOf(k) || { emoji: '❔', name: 'Belirtilmemiş' };
    return `<div class="bar tap" data-pur="${k}"><div>${p.emoji} ${esc(p.name)}</div><div><b>${money(v)}</b> <span class="muted small">%${Math.round(v / total * 100)}</span></div>
      <div class="track"><div class="fill" style="width:${(v / total * 100).toFixed(1)}%;background:${k === '_' ? 'var(--muted)' : purColor(k)}"></div></div></div>`;
  }).join('');
  return h + `<p class="muted small">Birine dokun: tüm analiz sadece onun için gösterilir.</p>`;
}
function trendChart(cur, r) {
  const daily = period === 1;
  const buckets = new Map();
  if (daily) {
    for (let d = parseYmd(r.start); ymd(d) <= r.end; d.setDate(d.getDate() + 1)) buckets.set(ymd(d), 0);
    for (const e of cur) buckets.set(e.date, (buckets.get(e.date) || 0) + e.amount);
  } else {
    for (let d = parseYmd(r.start.slice(0, 8) + '01'); ymd(d) <= r.end; d.setMonth(d.getMonth() + 1)) buckets.set(ymd(d).slice(0, 7), 0);
    for (const e of cur) buckets.set(e.date.slice(0, 7), (buckets.get(e.date.slice(0, 7)) || 0) + e.amount);
  }
  const entries = [...buckets.entries()];
  const max = Math.max(...entries.map(x => x[1]), 1);
  const W = 320, H = 130, pb = 18, gap = daily ? 1 : 6;
  const bw = (W - gap * (entries.length - 1)) / entries.length;
  let bars = '', labels = '';
  entries.forEach(([k, v], i) => {
    const h = (v / max) * (H - pb - 14);
    const x = i * (bw + gap);
    bars += `<rect x="${x.toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, v > 0 ? 1.5 : 0).toFixed(1)}" rx="2" fill="var(--accent)"><title>${k}: ${money(v)}</title></rect>`;
    if (daily ? i % 5 === 0 : true) {
      const lab = daily ? String(+k.slice(8)) : parseYmd(k + '-01').toLocaleDateString('tr-TR', { month: 'short' });
      labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${lab}</text>`;
    }
    if (!daily && v > 0 && entries.length <= 6) labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${(H - pb - h - 4).toFixed(1)}" text-anchor="middle">${compact(v)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Harcama grafiği">${bars}${labels}</svg>`;
}
const compact = v => v >= 1e6 ? (v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'B' : Math.round(v) + '';
function catBars(cur, prev, total) {
  const by = new Map(), pby = new Map();
  for (const e of cur) by.set(e.cat, (by.get(e.cat) || 0) + e.amount);
  for (const e of prev) pby.set(e.cat, (pby.get(e.cat) || 0) + e.amount);
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => {
    const c = catOf(id), p = pby.get(id);
    const ch = p ? `<span class="small ${cls(v / p - 1)}">${pct(v / p - 1, 0)}</span>` : '';
    return `<div class="bar"><div>${c.emoji} ${esc(c.name)} ${ch}</div><div><b>${money(v)}</b> <span class="muted small">%${Math.round(v / total * 100)}</span></div>
      <div class="track"><div class="fill" style="width:${(v / total * 100).toFixed(1)}%;background:${catColor(id)}"></div></div></div>`;
  }).join('');
}
function zamTable(r) {
  const groups = new Map();
  for (const e of db.expenses) {
    if (!e.item || e.date > r.end) continue;
    const k = norm(e.item) + '|' + (e.unit || 'adet');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const rows = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const inWin = list.filter(e => e.date >= r.start);
    if (!inWin.length) continue;
    const before = list.filter(e => e.date < r.start);
    const base = before.length ? before[before.length - 1] : inWin[0];
    const last = inWin[inWin.length - 1];
    if (base === last || base.date === last.date) continue;
    const up0 = base.amount / (base.qty || 1), up1 = last.amount / (last.qty || 1);
    rows.push({ name: last.item, unit: last.unit, up0, up1, ch: up1 / up0 - 1, from: base.date, to: last.date, spend: sum(inWin) });
  }
  if (!rows.length) return `<p class="muted small">Zam hesabı için aynı ürünü en az 2 kez ürün adıyla kaydetmelisin (ör. ekmek, benzin, süt). Fiş fotoğrafıyla girersen bu otomatik olur.</p>`;
  rows.sort((a, b) => b.ch - a.ch);
  const wsum = rows.reduce((t, x) => t + x.spend, 0);
  const personal = rows.reduce((t, x) => t + x.ch * x.spend, 0) / wsum;
  const usdRef = market?.series?.usd ? priceAt(market.series.usd, r.end) / priceAt(market.series.usd, r.start) - 1 : null;
  let html = `<div class="kpis"><div class="kpi"><div class="muted small">Kişisel enflasyonun</div><div class="v ${cls(personal)}">${pct(personal)}</div><div class="small muted">harcama ağırlıklı</div></div>
    ${usdRef != null ? `<div class="kpi"><div class="muted small">Aynı dönemde dolar</div><div class="v">${pct(usdRef)}</div><div class="small muted">kıyas için</div></div>` : ''}</div>`;
  html += `<table class="zam"><tr><th>Ürün</th><th>Önce</th><th>Şimdi</th><th>Değişim</th></tr>` + rows.map(x =>
    `<tr><td>${esc(x.name)}<div class="muted small">${x.unit} · ${daysBetween(x.from, x.to)} gün</div></td><td>${money(x.up0, true)}</td><td>${money(x.up1, true)}</td><td class="${cls(x.ch)}"><b>${pct(x.ch)}</b></td></tr>`).join('') + '</table>';
  return html;
}
function oppCost(cur, total) {
  if (!market) return `<p class="muted small">Piyasa verisi yüklenemedi. İnternete bağlanınca tekrar dene.</p>`;
  const res = ASSETS.map(a => {
    let v = 0;
    for (const e of cur) {
      const f = growthFactor(a.key, e.date);
      if (f == null) return null;
      v += e.amount * f;
    }
    return { ...a, v };
  }).filter(Boolean).sort((a, b) => b.v - a.v);
  let html = `<p class="muted small">Bu dönemde harcadığın <b>${money(total)}</b>, her harcama gününde şuna yatırılsaydı bugün:</p>`;
  html += res.map(x => {
    const g = x.v / total - 1;
    return `<div class="opp"><div class="e">${x.emoji}</div><div>${x.name}<div class="small ${g >= 0 ? 'good' : 'bad'}">${pct(g)} · ${g >= 0 ? '+' : '−'}${money(Math.abs(x.v - total))}</div></div><div><b>${money(x.v)}</b></div></div>`;
  }).join('');
  const best = res[0];
  if (best) {
    const top = cur.map(e => ({ e, gain: e.amount * (growthFactor(best.key, e.date) - 1) })).sort((a, b) => b.gain - a.gain)[0];
    if (top && top.gain > 0) {
      const c = catOf(top.e.cat);
      html += `<div class="card warn" style="margin:12px 0 0"><b>En pahalıya patlayan harcama</b><div class="small">${fmtDate(top.e.date)} · ${c.emoji} ${esc(top.e.item || c.name)} · ${money(top.e.amount)}<br>${best.name.replace('*', '')} alsaydın bugün <b>${money(top.e.amount + top.gain)}</b> olurdu.</div></div>`;
    }
  }
  html += `<p class="muted small">* Mevduat: TCMB politika faiziyle günlük bileşik, brüt (stopaj hariç), yaklaşık. Piyasa verisi: ${market.updated ? new Date(market.updated).toLocaleString('tr-TR') : '?'}</p>`;
  return html;
}

// ---------- AYARLAR ----------
function renderSettings() {
  const acc = $('#accountCard');
  if (mode === 'cloud' && user) {
    acc.innerHTML = `<h3>Hesap</h3><p class="small">${esc(user.email || user.displayName || 'Hesap')}<br><span class="muted">Verilerin hesabına kaydediliyor. Başka telefonda aynı hesapla girince hepsi gelir.</span></p>
      <button class="btn ghost full" id="logout">Çıkış yap</button>`;
    $('#logout').onclick = async () => { if (confirm('Çıkış yapılsın mı? Verilerin hesabında kalır.')) await cloud.logout(); };
  } else {
    acc.innerHTML = `<h3>Hesap</h3><p class="small muted">Yerel mod: veriler sadece bu cihazda. Üyelik, senkron ve fiş okuma Firebase kurulumuyla açılır.</p>`;
  }
  $('#payDay').value = db.payDay || '';
  $('#paySalary').value = db.salary ? moneyStr(db.salary) : '';
  renderPushCard();
  renderEditor('#catEdit', db.categories, id => db.expenses.filter(e => e.cat === id).length);
  renderEditor('#purEdit', db.purposes, id => db.expenses.filter(e => e.purpose === id).length);
  $('#bkText').textContent = mode === 'cloud' ? 'Verilerin hesabında güvende. İstersen ayrıca dosya yedeği alabilirsin.' : 'Veriler sadece bu telefonda. Ayda bir yedeği Drive\'a kaydet.';
  const bk = db.lastBackup ? `Son yedek: ${new Date(db.lastBackup).toLocaleString('tr-TR')}` : 'Henüz dosya yedeği alınmadı.';
  $('#bkInfo').textContent = `${db.expenses.length} kayıt · ${bk}`;
  renderSettingsInfo();
}
function renderEditor(sel, list, count) {
  $(sel).innerHTML = list.map(c => `<div class="row" data-id="${c.id}" style="align-items:center">
      <input class="ed-emoji" value="${esc(c.emoji)}" style="flex:0 0 52px;text-align:center">
      <input class="ed-name" value="${esc(c.name)}">
      <span class="muted small" style="flex:0 0 auto">${count(c.id)}</span>
      <button class="x ed-del" title="Sil" style="flex:0 0 auto">🗑</button></div>`).join('');
}
function editorEvents(sel, key, field) {
  $(sel).addEventListener('change', e => {
    const row = e.target.closest('[data-id]'); if (!row) return;
    const c = db[key].find(x => x.id === row.dataset.id);
    if (e.target.classList.contains('ed-emoji')) c.emoji = e.target.value.trim() || '🏷️';
    if (e.target.classList.contains('ed-name')) { c.name = e.target.value.trim() || 'Adsız'; if (key === 'purposes') delete c.to; }
    commitSettings(); renderHome();
  });
  $(sel).addEventListener('click', e => {
    if (!e.target.classList.contains('ed-del')) return;
    const id = e.target.closest('[data-id]').dataset.id;
    const used = db.expenses.filter(x => x[field] === id);
    if (db[key].length <= 1) return;
    if (key === 'categories' && id === 'diger' && used.length) { toast('"Diğer" dolu, silinemez'); return; }
    const msg = !used.length ? 'Silinsin mi?' : key === 'categories' ? `${used.length} harcama "Diğer"e taşınacak. Silinsin mi?` : `${used.length} harcamada bu seçim boşalacak. Silinsin mi?`;
    if (!confirm(msg)) return;
    if (used.length) {
      if (key === 'categories' && !db.categories.some(c => c.id === 'diger')) db.categories.push({ id: 'diger', emoji: '📦', name: 'Diğer' });
      used.forEach(x => { if (key === 'categories') x.cat = 'diger'; else delete x.purpose; });
    }
    db[key] = db[key].filter(c => c.id !== id);
    commitSettings();
    if (used.length) commit(used, {}); else renderAll();
  });
}
function renderSettingsInfo() {
  if (!market) { $('#mktInfo').textContent = 'Piyasa verisi yok (çevrimdışı olabilirsin).'; return; }
  const s = market.series;
  const last = k => s[k]?.length ? money(s[k][s[k].length - 1][1], true) : '–';
  $('#mktInfo').innerHTML = `Güncelleme: ${new Date(market.updated).toLocaleString('tr-TR')}<br>
    Dolar ${last('usd')} · Euro ${last('eur')} · Gram altın ${last('gold')}<br>
    BIST 100 ${s.bist?.at(-1)?.[1].toLocaleString('tr-TR') ?? '–'} · Politika faizi %${s.policy?.at(-1)?.[1] ?? '–'}
    ${market.errors?.length ? `<br><span class="bad">Uyarı: ${esc(market.errors.join('; '))}</span>` : ''}`;
}
async function backupShare() {
  const name = `balpor-butce-yedek-${today()}.json`;
  const data = { app: 'balpor-butce', v: 2, exportedAt: new Date().toISOString(), expenses: db.expenses, categories: db.categories, purposes: db.purposes };
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'BalPor Bütçe yedeği' });
    else download(file, name);
    db.lastBackup = new Date().toISOString(); commitSettings(); renderAll();
    toast('Yedek hazır');
  } catch (e) { if (e.name !== 'AbortError') toast('Yedek alınamadı: ' + e.message); }
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'balpor-butce' || !Array.isArray(d.expenses)) throw new Error('Bu bir BalPor Bütçe yedeği değil');
    const ids = new Set(db.expenses.map(e => e.id));
    const added = d.expenses.filter(e => !ids.has(e.id));
    for (const c of d.categories || []) if (!db.categories.some(x => x.id === c.id)) db.categories.push(c);
    for (const p of d.purposes || []) if (!db.purposes.some(x => x.id === p.id)) db.purposes.push(p);
    commitSettings();
    commit(added);
    toast(`${added.length} kayıt eklendi`);
  } catch (e) { toast('Yüklenemedi: ' + e.message); }
}
function exportCsv() {
  const n = v => v == null ? '' : String(v).replace('.', ',');
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['Tarih', 'Kategori', 'Kimin için', 'Ürün', 'Miktar', 'Birim', 'Tutar', 'Mağaza', 'Not']];
  for (const e of [...db.expenses].sort((a, b) => a.date.localeCompare(b.date)))
    rows.push([e.date, q(catOf(e.cat).name), q(purOf(e.purpose)?.name), q(e.item), n(e.qty), e.unit || '', n(e.amount), q(e.store), q(e.note)]);
  download(new Blob(['﻿' + rows.map(r => r.join(';')).join('\r\n')], { type: 'text/csv' }), `balpor-butce-${today()}.csv`);
}


// ---------- MAAŞ ----------
function clampDay(y, m, d) { return new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())); }
function payCycle() {
  const d = +db.payDay;
  if (!(d >= 1 && d <= 31)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  let last = clampDay(now.getFullYear(), now.getMonth(), d);
  if (last > now) last = clampDay(now.getFullYear(), now.getMonth() - 1, d);
  const next = clampDay(last.getFullYear(), last.getMonth() + 1, d);
  return { last: ymd(last), next: ymd(next), daysLeft: Math.round((next - now) / 864e5), today: ymd(now) === ymd(last) };
}
function renderPay() {
  const c = payCycle();
  const L = $('#payLeft'), R = $('#payRight');
  if (!c) {
    L.innerHTML = `<small>Maaş gününe kalan</small><b>? gün</b>`;
    R.innerHTML = `<small>Kalan</small><b>?</b>`;
    return;
  }
  L.innerHTML = c.today ? `<small>Maaş günü</small><b>Bugün 🎉</b>` : `<small>Maaş gününe kalan</small><b>${c.daysLeft} gün</b>`;
  if (db.salary > 0) {
    const spent = sum(db.expenses.filter(e => inRange(e, c.last, today())));
    const left = db.salary - spent;
    R.innerHTML = `<small>Kalan</small><b class="${left < 0 ? 'bad' : ''}">${money(left)}</b>`;
  } else R.innerHTML = `<small>Kalan</small><b>?</b>`;
}
async function askPay() {
  const d = await ask({ text: 'Maaş ayın kaçında yatıyo la?', sub: 'Maaş gününe kaç gün kaldığını ona göre sayacam.', input: 'number', value: db.payDay || '', skip: 'Maaşım yok / sonra' });
  const day = parseInt(d, 10);
  if (!(day >= 1 && day <= 31)) return;
  db.payDay = day;
  const s = await ask({ text: 'Ne kadar yatıyo peki?', sub: 'Söylemezsen "Kalan"ı hesaplayamam. Kimseyle paylaşılmaz, merak etme.', input: 'money', value: db.salary ? moneyStr(db.salary) : '', skip: 'Söylemem' });
  const sal = parseAmount(s);
  if (sal > 0) db.salary = Math.round(sal * 100) / 100;
  commitSettings(); renderAll();
}
function payFromSettings() {
  const day = parseInt($('#payDay').value, 10), sal = parseAmount($('#paySalary').value);
  db.payDay = day >= 1 && day <= 31 ? day : null;
  db.salary = sal > 0 ? sal : null;
  commitSettings(); renderPay();
}

// ---------- BİLDİRİM ----------
const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
async function enablePush() {
  if (Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('İzin vermedin, dürtemem artık'); renderSettings(); return false; }
  }
  try {
    await cloud.enablePush(user.uid, await navigator.serviceWorker.ready);
    localStorage.removeItem('bb.pushOff');
    toast('Tamamdır, günde 2 kere dürterim');
    return true;
  } catch (e) { toast('Bildirim açılamadı: ' + e.message); return false; }
  finally { if ($('#v-settings').classList.contains('active')) renderSettings(); }
}
async function disablePush() {
  try { await cloud.disablePush(user.uid); } catch (e) { /* çevrimdışı olabilir */ }
  localStorage.setItem('bb.pushOff', '1');
  toast('Bildirimler kapandı'); renderSettings();
}
function renderPushCard() {
  const info = $('#pushInfo'), btn = $('#pushToggle');
  if (mode !== 'cloud' || !pushSupported()) { info.textContent = 'Bu cihazda bildirim desteklenmiyor (ya da hesap yok).'; btn.hidden = true; return; }
  if (Notification.permission === 'denied') {
    info.textContent = 'Bildirim izni tarayıcıdan engellenmiş. Açmak için: site ayarları › Bildirimler › İzin ver.';
    btn.hidden = true; return;
  }
  btn.hidden = false;
  const on = Notification.permission === 'granted' && !localStorage.getItem('bb.pushOff');
  info.textContent = on ? 'Açık: öğlen 13:00 ve akşam 21:00 civarı dürterim.' : 'Kapalı. Günde 2 kere hatırlatayım mı?';
  btn.textContent = on ? 'Dürtme artık' : 'Dürt la';
  btn.onclick = on ? disablePush : enablePush;
}
// Girişten sonra: maaş sorulmadıysa sor, bildirim sorulmadıysa sor
let afterLoginDone = false;
async function afterLogin() {
  if (afterLoginDone) return; afterLoginDone = true;
  if (!db.payDay && !localStorage.getItem('bb.payAsked')) { localStorage.setItem('bb.payAsked', '1'); await askPay(); }
  if (mode !== 'cloud' || !pushSupported()) return;
  if (Notification.permission === 'granted' && !localStorage.getItem('bb.pushOff')) {
    cloud.enablePush(user.uid, await navigator.serviceWorker.ready).catch(() => {});   // token yenilenmiş olabilir
    return;
  }
  if (Notification.permission === 'default' && !localStorage.getItem('bb.pushAsked')) {
    localStorage.setItem('bb.pushAsked', '1');
    const a = await ask({ text: 'Günde 2 kere dürteyim mi?', sub: 'Öğlen bi, akşam bi. Yoksa harcadıklarını unutursun, ay sonu "para nereye gitti" diye ağlarsın.', options: [{ label: '👉 Dürt la', value: 1 }], skip: 'Dürtme' });
    if (a) enablePush();
  }
}

// ---------- gezinme ----------
function show(v) {
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.v === v));
  $('#fab').hidden = v === 'settings';
  if (v === 'stats') renderStats();
  if (v === 'settings') renderSettings();
  $('#scroller').scrollTo(0, 0);
}
function renderAll() {
  renderPay();
  renderHome();
  if ($('#v-stats').classList.contains('active')) renderStats();
  if ($('#v-settings').classList.contains('active')) renderSettings();
}

// ---------- olaylar ----------
$$('.tabs button').forEach(b => b.onclick = () => show(b.dataset.v));
$('#fab').onclick = () => openOv('chooser');
$('#chManual').onclick = () => { closeOv('chooser'); openSheet(); };
$('#chCamera').onclick = () => $('#camFile').click();
$('#chGallery').onclick = () => $('#galFile').click();
['#camFile', '#galFile'].forEach(s => $(s).onchange = e => { const f = e.target.files[0]; e.target.value = ''; startReceipt(f); });
$('#form').addEventListener('submit', submitForm);
$('#fDelete').onclick = deleteCurrent;
$('#fCats').onclick = e => {
  const b = e.target.closest('.cat'); if (!b) return;
  selCat = b.dataset.c; renderCatGrid(); autoPurpose();
  if (!$('#fAmount').value) $('#fAmount').focus();   // kategoriden sonra tutar
};
$('#fPurs').onclick = e => { const b = e.target.closest('.pchip'); if (b) { selPur = selPur === b.dataset.p ? null : b.dataset.p; purAuto = false; renderPurChips(); } };
['#fItem', '#fQty', '#fAmount', '#fUnit'].forEach(s => $(s).addEventListener('input', updateHint));
$('#fItem').addEventListener('change', autoPurpose);
$('#recent').onclick = e => { const r = e.target.closest('.item'); if (r) openSheet(r.dataset.id); };
$('#showAll').onclick = () => { showAll = true; renderHome(); };
$('#periods').onclick = e => { const b = e.target.closest('button'); if (b) { period = b.dataset.p === 'ytd' ? 'ytd' : +b.dataset.p; renderStats(); } };
$('#stats').onclick = e => {
  const b = e.target.closest('[data-pur]');
  if (b) { statPurpose = b.dataset.pur; renderStats(); $('#scroller').scrollTo(0, 0); }
  if (e.target.closest('#clearFilter')) { statPurpose = null; renderStats(); }
};
$('#payLeft').onclick = askPay;
$('#payRight').onclick = askPay;
$('#payDay').onchange = payFromSettings;
$('#paySalary').onchange = payFromSettings;
$('#bkShare').onclick = backupShare;
$('#bkImport').onclick = () => $('#bkFile').click();
$('#bkFile').onchange = e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
$('#csvExport').onclick = exportCsv;
$('#catAdd').onclick = () => { db.categories.push({ id: uid(), emoji: '🏷️', name: 'Yeni kategori' }); commitSettings(); renderSettings(); };
$('#purAdd').onclick = () => { db.purposes.push({ id: uid(), emoji: '🏷️', name: 'Yeni' }); commitSettings(); renderSettings(); };
editorEvents('#catEdit', 'categories', 'cat');
editorEvents('#purEdit', 'purposes', 'purpose');
$('#wipe').onclick = async () => {
  if (!confirm('TÜM harcamalar silinecek. Emin misin?')) return;
  if (!confirm('Son kez soruyorum: geri alınamaz.')) return;
  if (mode === 'cloud') await cloud.wipe(user.uid, [...new Set(db.expenses.map(e => e.date.slice(0, 7)))]).catch(err => toast(err.message));
  db.expenses = []; if (mode === 'local') saveLocal(); renderAll(); toast('Silindi');
};
const net = () => { $('#netbadge').hidden = navigator.onLine; };
addEventListener('online', () => { net(); loadMarket(); });
addEventListener('offline', net);

// ---------- üyelik ----------
function loginEvents() {
  const err = e => { $('#lgErr').textContent = cloud.authError(e); };
  const creds = () => [$('#lgEmail').value.trim(), $('#lgPass').value];
  $('#lgGoogle').onclick = () => cloud.loginGoogle().catch(err);
  $('#lgIn').onclick = () => cloud.loginEmail(...creds()).catch(err);
  $('#lgUp').onclick = () => cloud.registerEmail(...creds()).catch(err);
  $('#lgReset').onclick = () => {
    const [e] = creds();
    if (!e) { $('#lgErr').textContent = 'Önce e-postanı yaz.'; return; }
    cloud.resetPassword(e).then(() => { $('#lgErr').textContent = 'Şifre sıfırlama bağlantısı gönderildi.'; }).catch(err);
  };
}
let unsub = null;
async function startCloud() {
  try { await cloud.init(); } catch (e) { toast('Bulut başlatılamadı, yerel moddayım'); return; }
  mode = 'cloud';
  loginEvents();
  cloud.onUser(u => {
    unsub?.(); unsub = null;
    user = u;
    if (!u) {
      afterLoginDone = false;
      db = blank(); renderAll();
      $('#login').hidden = false; $('#lgErr').textContent = '';
      return;
    }
    $('#login').hidden = true;
    let settingsSeen = false;
    unsub = cloud.subscribe(u.uid, list => {
      db.expenses = list; renderAll();
    }, s => {
      if (!s) { if (!settingsSeen) cloud.putSettings(u.uid, { categories: DEFAULT_CATS, purposes: DEFAULT_PURPOSES }); }
      else {
        db.categories = s.categories?.length ? s.categories : DEFAULT_CATS;
        db.purposes = s.purposes?.length ? s.purposes : DEFAULT_PURPOSES;
        db.lastBackup = s.lastBackup || null;
        db.payDay = s.payDay ?? null; db.salary = s.salary ?? null;
      }
      const first = !settingsSeen;
      settingsSeen = true; renderAll();
      if (first) afterLogin();
    });
    migrateLocal(u.uid);
  });
}
// Üyelik öncesi bu telefonda girilen kayıtları hesaba bir kez aktar
function migrateLocal(id) {
  const flag = 'bb.migrated.' + id;
  if (localStorage.getItem(flag)) return;
  const local = loadLocal();
  localStorage.setItem(flag, '1');
  if (!local.expenses.length) return;
  cloud.putExpenses(id, local.expenses).then(() => toast(`Bu telefondaki ${local.expenses.length} kayıt hesabına aktarıldı`));
}

// ---------- başlat ----------
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
net();
renderAll();
loadMarket();
if (cloud.enabled) startCloud(); else afterLogin();

// Yerel test kancası: fiş akışını Firebase olmadan örnek veriyle dener (sadece localhost)
if (location.hostname === 'localhost') window.__bbTest = {
  receipt: async (data, img = 'icons/icon-192.png') => { rc = normalizeReceipt(data, img); openOv('receipt'); renderReceipt(); await runQuestions(); },
  prompt: buildPrompt,
};
