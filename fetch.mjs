// Radar výsledkov – stiahne verejné dáta (Yahoo Finance + Nasdaq) a uloží ich pre webstránku.
// Spustenie: node fetch.mjs        (Node.js 18+; žiadne ďalšie balíčky nie sú potrebné)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
const OUT_DIR = path.join(ROOT, 'site');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (v) => (v && typeof v === 'object' ? (typeof v.raw === 'number' ? v.raw : null) : (typeof v === 'number' && isFinite(v) ? v : null));
const parseMoney = (s) => { if (s == null) return null; const n = parseFloat(String(s).replace(/[$,\s]/g, '')); return isFinite(n) ? n : null; };
const nyDate = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const epochToNY = (sec) => nyDate(new Date(sec * 1000));
const TODAY = nyDate(new Date());

// ---------- HTTP ----------
async function get(url, extra = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { ...HEADERS, ...extra }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return { status: r.status, text: await r.text() };
    } catch (e) {
      if (i === tries - 1) return { status: 0, text: '', error: e.message };
      await sleep(1000 * (i + 1));
    }
  }
  return { status: 0, text: '' };
}
const tryJSON = (t) => { try { return JSON.parse(t); } catch { return null; } };

// ---------- Yahoo Finance ----------
const yahoo = { cookie: '', crumb: '' };
async function yahooAuth() {
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://fc.yahoo.com', { headers: HEADERS, redirect: 'manual' }).catch(() => null);
    yahoo.cookie = r ? r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') : '';
    const c = await get('https://query2.finance.yahoo.com/v1/test/getcrumb', { Cookie: yahoo.cookie });
    if (c.status === 200 && c.text && !c.text.includes('{')) { yahoo.crumb = c.text.trim(); return; }
    await sleep(1500);
  }
  throw new Error('Nepodarilo sa prihlásiť k Yahoo Finance (crumb).');
}
async function yjson(url) {
  for (let i = 0; i < 3; i++) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await get(`${url}${sep}crumb=${encodeURIComponent(yahoo.crumb)}`, { Cookie: yahoo.cookie });
    if (r.status === 401 || r.status === 403) { await yahooAuth(); continue; }
    return tryJSON(r.text);
  }
  return null;
}
const ySym = (s) => s.replace(/\./g, '-');

// ---------- Nasdaq ----------
async function njson(url) {
  const r = await get(url, { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
  return tryJSON(r.text);
}
function usDateToISO(s) { // 8/26/2026 -> 2026-08-26
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}
const TIME_MAP = { 'time-pre-market': 'BMO', 'time-after-hours': 'AMC' };

async function loadCalendar(days) {
  const map = new Map();
  const start = new Date(TODAY + 'T12:00:00Z');
  for (let i = 0; i <= days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    const j = await njson(`https://api.nasdaq.com/api/calendar/earnings?date=${iso}`);
    const rows = j?.data?.rows || [];
    for (const r of rows) {
      if (!r.symbol || map.has(r.symbol)) continue;
      map.set(r.symbol, {
        date: iso,
        time: TIME_MAP[r.time] || null,
        name: r.name,
        marketCap: parseMoney(r.marketCap),
        epsForecast: parseMoney(r.epsForecast),
        noOfEsts: parseInt(r.noOfEsts) || null,
        lastYearEPS: parseMoney(r.lastYearEPS),
        fiscalQuarter: r.fiscalQuarterEnding || null,
      });
    }
    process.stdout.write(`  kalendár ${iso}: ${rows.length} firiem\n`);
    await sleep(300);
  }
  return map;
}

// ---------- Výpočty ----------
function pctChange(a, b) { return a != null && b != null && b !== 0 ? (a - b) / Math.abs(b) : null; }

function priceSeries(chart) {
  const res = chart?.chart?.result?.[0];
  if (!res?.timestamp) return null;
  const off = res.meta?.gmtoffset ?? -18000;
  const closes = res.indicators?.adjclose?.[0]?.adjclose || res.indicators?.quote?.[0]?.close || [];
  const out = [];
  res.timestamp.forEach((t, i) => {
    if (closes[i] != null) out.push({ d: new Date((t + off) * 1000).toISOString().slice(0, 10), c: closes[i] });
  });
  return out;
}
function reactionAround(series, isoDate) {
  // zatváracia cena pred dňom zverejnenia -> zatváracia cena deň po ňom (pokryje vyhlásenie pred otvorením aj po zatvorení)
  if (!series || !isoDate) return null;
  let prev = null, next = null;
  for (let i = 0; i < series.length; i++) {
    if (series[i].d < isoDate) prev = series[i];
    else if (series[i].d > isoDate) { next = series[i]; break; }
  }
  return prev && next ? next.c / prev.c - 1 : null;
}
function momentum(series, n) {
  if (!series || series.length <= n) return null;
  return series[series.length - 1].c / series[series.length - 1 - n].c - 1;
}

async function impliedMove(sym, earningsDate, price) {
  if (!earningsDate || !price) return null;
  const daysAway = (new Date(earningsDate) - new Date(TODAY)) / 86400000;
  if (daysAway < 0 || daysAway > 45) return null;
  const base = await yjson(`https://query2.finance.yahoo.com/v7/finance/options/${ySym(sym)}`);
  const exps = base?.optionChain?.result?.[0]?.expirationDates || [];
  const exp = exps.find((e) => epochToNY(e + 43200) > earningsDate); // prvá expirácia PO dni výsledkov
  if (!exp) return null;
  const j = await yjson(`https://query2.finance.yahoo.com/v7/finance/options/${ySym(sym)}?date=${exp}`);
  const ch = j?.optionChain?.result?.[0];
  const o = ch?.options?.[0];
  if (!o) return null;
  const px = ch.quote?.regularMarketPrice || price;
  const mid = (c) => (c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.lastPrice);
  const strikes = [...new Set(o.calls.map((c) => c.strike))].filter((k) => o.puts.some((p) => p.strike === k));
  if (!strikes.length) return null;
  const k = strikes.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a));
  const call = o.calls.find((c) => c.strike === k), put = o.puts.find((p) => p.strike === k);
  const straddle = mid(call) + mid(put);
  if (!(straddle > 0)) return null;
  return { pct: straddle / px, expiration: epochToNY(exp + 43200), strike: k };
}

function model(t) {
  const reasons = [];
  // 1) pravdepodobnosť, že firma prekoná odhad EPS
  const hist = t.history.filter((h) => h.surprisePct != null);
  const beats = hist.filter((h) => h.surprisePct > 0).length;
  const BASE = 0.75, PRIOR = 3; // dlhodobo ~75 % firiem z S&P 500 prekoná odhad
  let pBeat = (beats + BASE * PRIOR) / (hist.length + PRIOR);
  if (hist.length) reasons.push(`Prekonala odhad ${beats}× z posledných ${hist.length} štvrťrokov.`);

  const tr = t.epsTrend;
  const r30 = pctChange(tr?.current, tr?.d30), r90 = pctChange(tr?.current, tr?.d90);
  let revAdj = 0;
  if (r30 != null) revAdj += clamp(r30 * 1.5, -0.05, 0.05);
  if (r90 != null) revAdj += clamp(r90 * 0.5, -0.04, 0.04);
  const rv = t.revisions;
  if (rv && (rv.up30 || rv.down30)) {
    const net = (rv.up30 || 0) - (rv.down30 || 0);
    revAdj += clamp(net / Math.max(t.consensus.yahoo?.analysts || 10, 1) * 0.1, -0.03, 0.03);
    reasons.push(`Revízie za 30 dní: ${rv.up30 || 0}× nahor, ${rv.down30 || 0}× nadol.`);
  }
  if (r90 != null && Math.abs(r90) > 0.005) reasons.push(`Konsenzus EPS sa za 90 dní ${r90 > 0 ? 'zvýšil' : 'znížil'} o ${(Math.abs(r90) * 100).toFixed(1).replace(".", ",")} %.`);
  pBeat = clamp(pBeat + revAdj, 0.2, 0.95);

  // 2) sklon reakcie ceny (heuristika, nie istota)
  const comp = {};
  const avgSurp = hist.length ? hist.reduce((s, h) => s + h.surprisePct, 0) / hist.length : null;
  comp.surprise = avgSurp != null ? clamp(avgSurp / 10, -1, 1) : 0;
  comp.revisions = clamp(((r30 || 0) * 20 + (r90 || 0) * 5), -1, 1);
  const reacts = t.history.map((h) => h.reactionPct).filter((x) => x != null);
  const avgReact = reacts.length ? reacts.reduce((a, b) => a + b, 0) / reacts.length : null;
  comp.pastReaction = avgReact != null ? clamp(avgReact / 0.05, -1, 1) : 0;
  if (avgReact != null) reasons.push(`Priemerná reakcia ceny po výsledkoch: ${(avgReact * 100).toFixed(1).replace(".", ",")} % (${reacts.filter((x) => x > 0).length}× rast z ${reacts.length}).`);
  const m1 = t.momentum.m1;
  comp.runUp = m1 != null ? -clamp(m1 / 0.15, -1, 1) : 0;
  if (m1 != null && Math.abs(m1) > 0.08) reasons.push(m1 > 0 ? `Akcia za mesiac vzrástla o ${(m1 * 100).toFixed(0).replace(".", ",")} %, takže očakávania sú vysoko a hrozí „sell the news“.` : `Akcia za mesiac klesla o ${(Math.abs(m1) * 100).toFixed(0).replace(".", ",")} %, takže očakávania sú nižšie.`);
  const rec = t.analysts?.recMean;
  comp.analysts = rec != null ? clamp((3 - rec) / 2, -1, 1) : 0;

  const W = { surprise: 0.25, revisions: 0.3, pastReaction: 0.2, runUp: 0.15, analysts: 0.1 };
  const score = Math.round(Object.keys(W).reduce((s, k) => s + W[k] * comp[k], 0) * 100);
  const signal = score >= 20 ? 'pozitivny' : score <= -20 ? 'negativny' : 'neutralny';

  const absMoves = reacts.map(Math.abs);
  const avgAbsMove = absMoves.length ? absMoves.reduce((a, b) => a + b, 0) / absMoves.length : null;
  if (t.impliedMove && avgAbsMove != null) {
    const ratio = t.impliedMove.pct / avgAbsMove;
    if (ratio > 1.3) reasons.push('Opcie čakajú väčší pohyb, ako býval v minulosti.');
    else if (ratio < 0.75) reasons.push('Opcie čakajú menší pohyb, ako býval v minulosti.');
  }
  const ys = t.consensus.yahoo?.eps, ns = t.consensus.nasdaq?.eps;
  if (ys != null && ns != null && Math.abs(pctChange(ys, ns)) > 0.03) reasons.push(`Zdroje sa líšia: Yahoo ${ys.toFixed(2)} vs Nasdaq ${ns.toFixed(2)} USD/akciu.`);

  return { pBeat, score, signal, avgAbsMove, avgReaction: avgReact, avgSurprise: avgSurp, components: comp, reasons };
}

// ---------- Analýza jednej firmy ----------
async function analyze(sym, cal) {
  const modules = 'price,calendarEvents,earningsHistory,earningsTrend,financialData,recommendationTrend';
  const [qs, chart, surp, fc] = await Promise.all([
    yjson(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ySym(sym)}?modules=${modules}`),
    get(`https://query1.finance.yahoo.com/v8/finance/chart/${ySym(sym)}?range=2y&interval=1d`).then((r) => tryJSON(r.text)),
    njson(`https://api.nasdaq.com/api/company/${sym}/earnings-surprise`),
    njson(`https://api.nasdaq.com/api/analyst/${sym}/earnings-forecast`),
  ]);
  const r = qs?.quoteSummary?.result?.[0];
  if (!r) throw new Error('Yahoo nevrátil dáta');
  const p = r.price || {};
  const series = priceSeries(chart);
  const price = num(p.regularMarketPrice) ?? series?.at(-1)?.c ?? null;

  // najbližšie výsledky
  const ce = r.calendarEvents?.earnings || {};
  const yDate = ce.earningsDate?.[0] ? epochToNY(num(ce.earningsDate[0])) : null;
  const next = {
    date: cal?.date || yDate,
    time: cal?.time || null,
    estimated: cal ? false : !!ce.isEarningsDateEstimate,
    source: cal ? 'Nasdaq' : yDate ? 'Yahoo' : null,
    fiscalQuarter: cal?.fiscalQuarter || null,
  };

  // konsenzus z oboch zdrojov
  const q0 = (r.earningsTrend?.trend || []).find((x) => x.period === '0q') || {};
  const ee = q0.earningsEstimate || {}, re = q0.revenueEstimate || {};
  const nRow = fc?.data?.quarterlyForecast?.rows?.[0];
  const consensus = {
    yahoo: {
      eps: num(ee.avg) ?? num(ce.earningsAverage), epsLow: num(ee.low), epsHigh: num(ee.high), analysts: num(ee.numberOfAnalysts),
      yearAgoEps: num(ee.yearAgoEps), growth: num(ee.growth),
      revenue: num(re.avg) ?? num(ce.revenueAverage), revenueLow: num(re.low), revenueHigh: num(re.high),
      revenueAnalysts: num(re.numberOfAnalysts), yearAgoRevenue: num(re.yearAgoRevenue), revenueGrowth: num(re.growth),
      quarterEnd: q0.endDate || null,
    },
    nasdaq: nRow ? {
      eps: num(nRow.consensusEPSForecast) ?? parseMoney(nRow.consensusEPSForecast), epsLow: parseMoney(nRow.lowEPSForecast),
      epsHigh: parseMoney(nRow.highEPSForecast), analysts: parseInt(nRow.noOfEstimates) || null,
      up4w: parseInt(nRow.up) || 0, down4w: parseInt(nRow.down) || 0, quarter: nRow.fiscalEnd,
    } : (cal?.epsForecast != null ? { eps: cal.epsForecast, analysts: cal.noOfEsts } : null),
  };
  const et = q0.epsTrend || {}, er = q0.epsRevisions || {};
  const epsTrend = { current: num(et.current), d7: num(et['7daysAgo']), d30: num(et['30daysAgo']), d60: num(et['60daysAgo']), d90: num(et['90daysAgo']) };
  const revisions = { up7: num(er.upLast7days), up30: num(er.upLast30days), down7: num(er.downLast7Days), down30: num(er.downLast30days) };

  // história: Nasdaq (dátum zverejnenia) + Yahoo (kontrola prekvapenia)
  const yHist = (r.earningsHistory?.history || []).map((h) => ({
    q: h.quarter?.fmt ? new Date(h.quarter.fmt + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : null,
    est: num(h.epsEstimate), act: num(h.epsActual), surp: num(h.surprisePercent),
  }));
  const nRows = surp?.data?.earningsSurpriseTable?.rows || [];
  let history = nRows.map((row) => {
    const date = usDateToISO(row.dateReported);
    const y = yHist.find((h) => h.q === row.fiscalQtrEnd);
    const est = parseMoney(row.consensusForecast), act = parseMoney(row.eps);
    return {
      quarter: row.fiscalQtrEnd, date, epsEstimate: est, epsActual: act,
      surprisePct: parseMoney(row.percentageSurprise),
      yahooEstimate: y?.est ?? null, yahooSurprisePct: y?.surp != null ? y.surp * 100 : null,
      reactionPct: reactionAround(series, date),
    };
  });
  if (!history.length) history = yHist.map((y) => ({ quarter: y.q, date: null, epsEstimate: y.est, epsActual: y.act, surprisePct: y.surp != null ? y.surp * 100 : null, reactionPct: null }));

  const fd = r.financialData || {};
  const rt = (r.recommendationTrend?.trend || []).find((x) => x.period === '0m') || null;
  const analysts = {
    recMean: num(fd.recommendationMean), recKey: fd.recommendationKey || null, opinions: num(fd.numberOfAnalystOpinions),
    targetMean: num(fd.targetMeanPrice), targetHigh: num(fd.targetHighPrice), targetLow: num(fd.targetLowPrice),
    dist: rt ? { strongBuy: rt.strongBuy, buy: rt.buy, hold: rt.hold, sell: rt.sell, strongSell: rt.strongSell } : null,
  };

  // Yahoo niekedy vracia dátum už zverejnených výsledkov -> ďalší termín zatiaľ nie je ohlásený, odhadneme ho
  if (next.date && next.date < TODAY) {
    next.lastReported = next.date;
    const est = new Date(new Date(next.date + 'T12:00:00Z').getTime() + 91 * 86400000);
    next.date = est.toISOString().slice(0, 10);
    next.estimated = true;
    next.source = 'odhad (posledné výsledky + 91 dní)';
  }

  const t = {
    symbol: sym,
    name: p.longName || p.shortName || cal?.name || sym,
    exchange: p.exchange || null,
    price, currency: p.currency || 'USD',
    changePct: num(p.regularMarketChangePercent),
    marketCap: num(p.marketCap) ?? cal?.marketCap ?? null,
    next, consensus, epsTrend, revisions, history, analysts,
    momentum: { m1: momentum(series, 21), m3: momentum(series, 63) },
    spark: series ? series.slice(-63).map((x) => +x.c.toFixed(2)) : [],
    impliedMove: null,
  };
  try { t.impliedMove = await impliedMove(sym, next.date, price); } catch { /* opcie nie sú povinné */ }
  t.model = model(t);
  return t;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ---------- Hlavný beh ----------
console.log(`Radar výsledkov – ${TODAY}`);
console.log('1/3 Načítavam kalendár výsledkov (Nasdaq)…');
const cal = await loadCalendar(cfg.upcoming?.days ?? 14);

const watch = (cfg.watchlist || []).map((s) => s.toUpperCase().trim()).filter(Boolean);
const auto = [...cal.entries()]
  .filter(([, v]) => (v.marketCap || 0) >= (cfg.upcoming?.minMarketCapUSD ?? 0))
  .sort((a, b) => (b[1].marketCap || 0) - (a[1].marketCap || 0))
  .slice(0, cfg.upcoming?.maxCompanies ?? 40)
  .map(([s]) => s);
const symbols = [...new Set([...watch, ...auto])];

console.log(`2/3 Analyzujem ${symbols.length} firiem (${watch.length} z watchlistu, ${auto.length} veľkých firiem s blížiacimi sa výsledkami)…`);
await yahooAuth();
const errors = [];
const results = await pool(symbols, cfg.concurrency || 4, async (sym, idx) => {
  try {
    const t = await analyze(sym, cal.get(sym));
    t.inWatchlist = watch.includes(sym);
    console.log(`  [${idx + 1}/${symbols.length}] ${sym.padEnd(6)} ok  ${t.next.date || '—'}`);
    return t;
  } catch (e) {
    errors.push({ symbol: sym, error: e.message });
    console.log(`  [${idx + 1}/${symbols.length}] ${sym.padEnd(6)} CHYBA: ${e.message}`);
    return null;
  }
});

const calendar = [...cal.entries()].map(([symbol, v]) => ({ symbol, ...v })).sort((a, b) => a.date.localeCompare(b.date) || (b.marketCap || 0) - (a.marketCap || 0));
const data = {
  generatedAt: new Date().toISOString(),
  today: TODAY,
  sources: ['Yahoo Finance', 'Nasdaq.com'],
  companies: results.filter(Boolean),
  calendar,
  errors,
};
if (!data.companies.length) {
  console.error('Nepodarilo sa načítať žiadnu firmu – staré dáta ponechávam bez zmeny.');
  process.exit(1);
}
console.log('3/3 Ukladám…');
await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, 'data.json'), JSON.stringify(data));
await fs.writeFile(path.join(OUT_DIR, 'data.js'), 'window.EARNINGS_DATA = ' + JSON.stringify(data) + ';\n');
console.log(`Hotovo: ${data.companies.length} firiem, ${calendar.length} v kalendári, ${errors.length} chýb -> site/index.html`);
