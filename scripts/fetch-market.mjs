// Günlük piyasa verisini çekip data/market.json'a yazar.
// GitHub Actions her gün çalıştırır — bilgisayar/sunucu gerekmez.
// Kaynaklar: Yahoo Finance (kur, altın, BIST, BTC) + TCMB (politika faizi). Hepsi anahtarsız.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'market.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (BalPorButce)' };
const GRAM_PER_OZ = 31.1034768;

async function yahoo(symbol, range = '10y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${symbol}: HTTP ${res.status}`);
  const j = await res.json();
  const r = j.chart.result[0];
  const close = r.indicators.quote[0].close;
  const map = new Map();
  r.timestamp.forEach((t, i) => {
    if (close[i] == null) return;
    const d = new Date((t + (r.meta.gmtoffset || 0)) * 1000).toISOString().slice(0, 10);
    map.set(d, close[i]);
  });
  return map;
}

async function tcmbPolicy() {
  const url = 'https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo';
  const html = await (await fetch(url, { headers: UA })).text();
  const cells = [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  const out = [];
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) continue;
    // Tarihten sonraki ilk sayısal hücre (borç verme oranı)
    for (let k = i + 1; k < i + 4 && k < cells.length; k++) {
      const v = parseFloat(cells[k].replace(',', '.'));
      if (!isNaN(v)) { out.push([`${m[3]}-${m[2]}-${m[1]}`, v]); break; }
    }
  }
  if (out.length < 10) throw new Error('TCMB tablosu okunamadı');
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}

// Tarih ekseni boyunca ileri doldurarak iki seriyi çarpar (ör. BTC-USD × USDTRY)
function combine(a, b, fn) {
  const dates = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out = new Map();
  let la, lb;
  for (const d of dates) {
    if (a.has(d)) la = a.get(d);
    if (b.has(d)) lb = b.get(d);
    if (la != null && lb != null && a.has(d)) out.set(d, fn(la, lb));
  }
  return out;
}

const round = (m, dp) => [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([d, v]) => [d, +v.toFixed(dp)]);

async function main() {
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { series: {} };
  const series = { ...prev.series };
  const errors = [];

  const tryGet = async (name, fn) => {
    try { series[name] = await fn(); }
    catch (e) { errors.push(`${name}: ${e.message}`); }
  };

  let usd;
  try { usd = await yahoo('TRY=X'); } catch (e) { errors.push(`usd: ${e.message}`); }
  if (usd) {
    series.usd = round(usd, 4);
    await tryGet('eur', async () => round(await yahoo('EURTRY=X'), 4));
    await tryGet('gold', async () => round(combine(await yahoo('GC=F'), usd, (oz, fx) => oz * fx / GRAM_PER_OZ), 2));
    await tryGet('btc', async () => round(combine(await yahoo('BTC-USD'), usd, (b, fx) => b * fx), 0));
  }
  await tryGet('bist', async () => round(await yahoo('XU100.IS'), 2));
  await tryGet('policy', tcmbPolicy);

  const data = { updated: new Date().toISOString(), errors, series };
  writeFileSync(OUT, JSON.stringify(data));
  console.log('Güncellendi:', Object.entries(series).map(([k, v]) => `${k}=${v.length} (son ${v.at(-1)?.join(' ')})`).join(' | '));
  if (errors.length) console.warn('Hatalar:', errors);
  if (!series.usd) process.exit(1);
}

main();
