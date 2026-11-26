/* 나스닥 선물 — OKX·바이낸스 나스닥·S&P·반도체 ETF 무기한 선물 분석 앱 (공부용, 자동 주문 없음)
 * 화면: 📊 스캐너 · 📈 차트(매물대) · 🧭 선물 지표 · 🔔 신호 · 🧮 도구
 * 시세: OKX·바이낸스·바이비트 공개 API(키 없음). 디스코드 알림은 '가격 위치' 앱과 같은 구글 Apps Script를 씀.
 * 계산 파일: scan.js(스캐너) · levels.js(매물대·지지/저항) · nq.js(QQQ 규칙 신호)
 */
'use strict';

const APP_VERSION = '1.2.0';

/* ───────── 저장(IndexedDB 키-값) ───────── */
const KV = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('nqfut', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: async (k, def) => { const v = await tx('readonly', (s) => s.get(k)); return v === undefined ? def : v; }, set: (k, v) => tx('readwrite', (s) => s.put(v, k)) };
})();

/* ───────── 도우미 ───────── */
const $ = (s, el = document) => el.querySelector(s);
const view = () => $('#view');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 2) => (x == null || !Number.isFinite(x) ? '-' : `${x > 0 ? '+' : ''}${x.toFixed(d)}%`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); }
function setTitle(t, back) { $('#title').textContent = t; $('#backBtn').hidden = !back; }
const fmt = (p) => (p == null || !Number.isFinite(p) ? '-' : p >= 1000 ? p.toFixed(0) : p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toFixed(4));
const money = (v) => (v >= 1e8 ? (v / 1e8).toFixed(v >= 1e10 ? 0 : 1) + '억 달러' : v >= 1e4 ? Math.round(v / 1e4).toLocaleString('ko-KR') + '만 달러' : Math.round(v || 0) + '달러');
const kTime = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k).catch((e) => ({ error: e.message })); } })); return out; }

/* ───────── 알림 스크립트(가격 위치 앱과 같은 구글 Apps Script) ───────── */
async function relayOn() { const c = await KV.get('relay', {}); return !!(c.url && c.key); }
async function relay(action, extra) {
  const cfg = await KV.get('relay', {});
  if (!cfg.url || !cfg.key) throw new Error('도구 화면에서 알림 스크립트 주소와 앱 키를 먼저 넣어 주세요');
  let r; try { r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, action, ...extra }) }); } catch { throw new Error('인터넷 연결이나 스크립트 주소를 확인하세요'); }
  let d; try { d = JSON.parse(await r.text()); } catch { throw new Error('스크립트 응답을 읽지 못했습니다(주소·배포 확인)'); }
  if (d.ok === false) throw new Error(d.error === 'denied' ? '앱 키가 스크립트의 APP_KEY와 다릅니다' : d.error || '오류');
  return d;
}

/* ───────── 시세 받기(OKX 우선, 없으면 바이낸스) ───────── */
const TF = {
  '15m': { okx: '15m', bn: '15m', by: '15', ms: 15 * 60e3, label: '15분봉', ttl: 2 * 60e3 }, '30m': { okx: '30m', bn: '30m', by: '30', ms: 30 * 60e3, label: '30분봉', ttl: 3 * 60e3 },
  '1H': { okx: '1H', bn: '1h', by: '60', ms: 3600e3, label: '1시간봉', ttl: 5 * 60e3 }, '4H': { okx: '4H', bn: '4h', by: '240', ms: 4 * 3600e3, label: '4시간봉', ttl: 10 * 60e3 }, '1D': { okx: '1Dutc', bn: '1d', by: 'D', ms: 86400e3, label: '일봉', ttl: 30 * 60e3 },
};
const fixTf = (tf) => (TF[tf] ? tf : tf === '5m' ? '30m' : '1H'); // 예전 설정(5분봉) → 30분봉
const EXN = { okx: 'OKX', bn: '바이낸스', by: '바이비트' };
// OKX는 짧은 시간에 요청이 몰리면 막음(429) → 120ms 간격으로 줄 세우고, 막히면 잠깐 쉬었다 다시
let okxLast = 0;
async function okxQ(path) {
  for (let t = 0; t < 3; t++) {
    const wait = Math.max(0, okxLast + 120 - Date.now()); okxLast = Date.now() + wait; if (wait) await sleep(wait);
    try { return await okxGet(path); } catch (e) { if (!/Too Many|429/i.test(e.message) || t === 2) throw e; await sleep(800 * (t + 1)); }
  }
}
const bnGet = async (path) => { let r; try { r = await fetch('https://fapi.binance.com' + path); } catch { throw new Error('바이낸스 시세를 받지 못했습니다'); } const j = await r.json(); if (j && j.code && j.msg) throw new Error('바이낸스: ' + j.msg); return j; };
const byGet = async (path) => { let r; try { r = await fetch('https://api.bybit.com' + path); } catch { throw new Error('바이비트 시세를 받지 못했습니다'); } const j = await r.json(); if (j.retCode !== 0) throw new Error('바이비트: ' + (j.retMsg || j.retCode)); return j.result; };
// 바이비트가 'ETF'로 분류한 무기한 선물 목록(하루 한 번) → 목록에 없는 ETF도 자동으로 스캐너에 들어감
async function bybitEtfs() {
  const hit = await KV.get('byEtf', null);
  if (hit && Date.now() - hit.at < 86400e3) return hit.data;
  const r = await byGet('/v5/market/instruments-info?category=linear&limit=1000');
  const data = r.list.filter((x) => x.symbolType === 'ETF' && x.status === 'Trading' && /USDT$/.test(x.symbol)).map((x) => x.symbol.replace(/USDT$/, ''));
  KV.set('byEtf', { at: Date.now(), data }).catch(() => {});
  return data;
}
async function tickers() {
  const hit = await KV.get('tickers', null);
  if (hit && Date.now() - hit.at < 60e3) { hit.data.extra.forEach((s) => { if (!SCAN.META[s]) SCAN.META[s] = { name: 'ETF(바이비트 분류)', g: 'other', lev: 1, auto: true }; }); return hit.data; }
  const [o, b, y, e] = await Promise.allSettled([okxGet('/market/tickers?instType=SWAP'), bnGet('/fapi/v1/ticker/24hr'), byGet('/v5/market/tickers?category=linear'), bybitEtfs()]);
  const extra = e.status === 'fulfilled' ? e.value.filter((s) => !SCAN.META[s]) : [];
  extra.forEach((s) => { SCAN.META[s] = { name: 'ETF(바이비트 분류)', g: 'other', lev: 1, auto: true }; });
  const out = {};
  for (const s of Object.keys(SCAN.META)) {
    const x = o.status === 'fulfilled' ? o.value.find((t) => t.instId === s + '-USDT-SWAP') : null;
    const z = b.status === 'fulfilled' && Array.isArray(b.value) ? b.value.find((t) => t.symbol === s + 'USDT') : null;
    const w = y.status === 'fulfilled' ? y.value.list.find((t) => t.symbol === s + 'USDT') : null;
    if (!x && !z && !w) continue;
    out[s] = {
      okx: x ? { last: +x.last, chg: ((+x.last / +x.open24h) - 1) * 100, vol: +x.volCcy24h * +x.last } : null,
      bn: z ? { last: +z.lastPrice, chg: +z.priceChangePercent, vol: +z.quoteVolume } : null,
      by: w ? { last: +w.lastPrice, chg: +w.price24hPcnt * 100, vol: +w.turnover24h, oiUsd: +w.openInterestValue, funding: w.fundingRate === '' ? null : +w.fundingRate, mark: +w.markPrice, index: +w.indexPrice, next: +w.nextFundingTime } : null,
    };
    out[s].vol = ['okx', 'bn', 'by'].reduce((a, k) => a + (out[s][k] ? out[s][k].vol : 0), 0);
    out[s].px = out[s].okx || out[s].bn || out[s].by;
  }
  const data = { t: out, extra, okxOk: o.status === 'fulfilled', bnOk: b.status === 'fulfilled' && Array.isArray(b.value), byOk: y.status === 'fulfilled', at: Date.now() };
  KV.set('tickers', { at: Date.now(), data }).catch(() => {});
  return data;
}
// 바이비트 봉: 최신이 앞, [시작, 시가, 고가, 저가, 종가, 거래량, 거래대금], 진행 중인 봉 포함 → 끝난 봉만
const fromBybit = (rows, ms) => (rows || []).filter((k) => +k[0] + ms <= Date.now()).map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).reverse();
async function candlesFrom(sym, src, tf) {
  const key = `c:${src}:${sym}:${tf}`, hit = await KV.get(key, null);
  if (hit && Date.now() - hit.at < TF[tf].ttl) return hit.data;
  const data = src === 'okx' ? SCAN.fromOkx(await okxQ(`/market/candles?instId=${sym}-USDT-SWAP&bar=${TF[tf].okx}&limit=300`))
    : src === 'bn' ? SCAN.fromBinance(await bnGet(`/fapi/v1/klines?symbol=${sym}USDT&interval=${TF[tf].bn}&limit=300`))
    : fromBybit((await byGet(`/v5/market/kline?category=linear&symbol=${sym}USDT&interval=${TF[tf].by}&limit=300`)).list, TF[tf].ms);
  KV.set(key, { at: Date.now(), data }).catch(() => {});
  return data;
}
// OKX(직접 거래하는 곳) → 바이낸스 → 바이비트 순. 봉이 40개 미만이면 다음 거래소
async function candles(sym, tf, T) {
  const t = T.t[sym]; if (!t) throw new Error(sym + ' 시세가 없습니다');
  let best = null;
  for (const src of ['okx', 'bn', 'by']) {
    if (!t[src]) continue;
    try { const cs = await candlesFrom(sym, src, tf); if (!best || cs.length > best.cs.length) best = { src, cs }; if (cs.length >= 40) return { src, cs }; } catch { /* 다음 거래소 */ }
  }
  if (!best) throw new Error(sym + ' 봉 데이터를 받지 못했습니다');
  return best;
}
const dayStartUtc = () => Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());

/* ───────── 미국장 시간(뉴욕 기준) ───────── */
function usSession(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now || new Date()).map((p) => [p.type, p.value]));
  const wd = parts.weekday, m = (+parts.hour % 24) * 60 + +parts.minute;
  const weekend = wd === 'Sat' || wd === 'Sun' || (wd === 'Fri' && m >= 20 * 60);
  let s;
  if (weekend) s = { k: 'closed', t: '주말 휴장', c: 'var(--muted)' };
  else if (m >= 9 * 60 + 30 && m < 16 * 60) s = { k: 'rth', t: '정규장', c: 'var(--green)' };
  else if (m >= 4 * 60 && m < 9 * 60 + 30) s = { k: 'pre', t: '프리마켓', c: '#E8A317' };
  else if (m >= 16 * 60 && m < 20 * 60) s = { k: 'post', t: '애프터마켓', c: '#E8A317' };
  else s = { k: 'night', t: '야간(장 닫힘)', c: 'var(--muted)' };
  s.ny = `${parts.hour}:${parts.minute} (${wd})`;
  return s;
}

/* ───────── 라우터 ───────── */
const routes = [
  [/^#?\/?$/, 'scan', viewScan],
  [/^#\/c\/([A-Z0-9]+)$/, 'chart', (m) => viewChart(m[1])],
  [/^#\/f$/, 'fut', viewFut],
  [/^#\/s$/, 'sig', viewSignals],
  [/^#\/t$/, 'tools', viewTools],
];
async function render() {
  const h = (location.hash || '#/').split('?')[0];
  for (const [re, tab, fn] of routes) {
    const m = h.match(re);
    if (m) { document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab)); try { await fn(m); } catch (e) { console.error(e); view().innerHTML = `<div class="card errbox">오류: ${esc(e.message)}</div>`; } return; }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
$('#backBtn').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/')));
const DISC = '📘 정해진 조건으로 계산한 공부용 정보입니다. 매수·매도 추천이 아니며 <b>자동 주문은 하지 않습니다</b>. 3배 레버리지 상품을 선물로 거래하면 손실이 원금보다 커질 수 있습니다.';
const scChip = (label, s) => `<span class="scchip s${Math.min(s, 4)}">${label} ${s}/5 ${SCAN.strength(s)}</span>`;

/* ═════════ 📊 스캐너 ═════════ */
const SORTS = { up: '🔼 반등 포착', dn: '🔽 하락 전환 포착', strong: '⭐ 강한 신호', spike: '📢 거래량 급증', atr: '🌊 변동성' };
const HIGHER = { '15m': '1H', '30m': '4H', '1H': '4H', '4H': '1D', '1D': null };
const SETS = { top: '자동 상위 20', core: '핵심(나스닥·S&P·반도체)', nasdaq: '나스닥100', sp500: 'S&P500', semi: '반도체', single: '개별주 레버리지', other: '기타 ETF' };
async function viewScan() {
  setTitle('📊 ETF 선물 스캐너');
  const prefs = await KV.get('scanPrefs', { set: 'top', tf: '1H', sort: 'up' }); prefs.tf = fixTf(prefs.tf);
  view().innerHTML = `<div class="card warnlist" style="margin-top:0;font-size:13px">${DISC}</div>
    <div class="chips">${Object.entries(SETS).map(([k, v]) => `<button class="chip${prefs.set === k ? ' on' : ''}" data-set="${k}" type="button">${v}</button>`).join('')}</div>
    <div class="seg" role="radiogroup" aria-label="봉 단위">${Object.entries(TF).map(([k, v]) => `<label><input type="radio" name="tf" value="${k}"${prefs.tf === k ? ' checked' : ''}><span>${v.label.replace('봉', '')}</span></label>`).join('')}</div>
    <div class="chips" style="margin-top:8px">${Object.entries(SORTS).map(([k, v]) => `<button class="chip${prefs.sort === k ? ' on' : ''}" data-sort="${k}" type="button">${v}</button>`).join('')}</div>
    <div id="mkt" class="card"><div class="muted">시장 방향 계산 중…</div></div>
    <div id="list"><div class="card"><div class="muted">OKX·바이낸스 시세를 받는 중… (처음엔 10~20초)</div></div></div>
    <div class="card"><details><summary><b>점수 기준</b></summary><div class="muted" style="font-size:13px;margin-top:6px">
      <b>🔼 반등 포착(0~5)</b>: RSI가 최근 40 이하에서 다시 오름 · MACD 히스토그램 음→양 또는 2봉 연속 개선 · 종가가 EMA5 위 · 거래량 1.3배 이상 양봉 · 직전 저점 지킴.<br>
      <b>🔽 하락 전환 포착(0~5)</b>: RSI가 최근 60 이상에서 다시 내림 · MACD 히스토그램 양→음 또는 2봉 연속 악화 · 종가가 EMA5 아래 · 거래량 1.3배 이상 음봉 · 고점이 낮아짐.<br>
      <b>📢 거래량 급증</b>: 마지막으로 끝난 봉의 거래량 ÷ 그 전 20봉 평균. 2배 이상이면 급증. 양봉·음봉과 함께 봐야 합니다.<br>
      <b>🌊 변동성</b>: 일봉 ATR(14)÷가격. 10%↑ 초고변동, 5~10% 고변동, 2~5% 중간, 2% 미만 낮음.<br>
      <b>⭐ 강한 신호</b>: 기본 점수가 4 이상이고, 아래 5가지 확인 중 3가지 이상이 맞을 때만. 매수: 상위 봉(예: 1시간봉이면 4시간봉)도 반등 점수 3 이상 · 지지 가격 위 1 ATR 안 · VWAP 위 · 최근 3봉에 거래량 1.5배 이상 양봉 · RSI 강세 다이버전스. 매도는 그 반대.<br>
      <b>📍 매수(매도) 검토 가격대</b>: 현재가 아래(위) 1.5 ATR 안의 지지(저항) 주변, 근거 2개 이상 겹친 곳 우선. 무효(손절) 가격 = 가격대 밖 1 ATR, 1차 목표 = 가장 가까운 저항(지지).<br>
      '자동 상위 20'은 OKX·바이낸스·바이비트에서 거래가 가장 많은 ETF 선물 20개를 자동으로 고릅니다(바이비트가 ETF로 분류한 종목은 목록에 없어도 자동 포함). 봉 데이터는 OKX → 바이낸스 → 바이비트 순.</div></details></div>
    <div class="disc">OKX·바이낸스·바이비트 공개 시세 · 자동 주문 없음 · v${APP_VERSION}</div>`;
  view().querySelectorAll('[data-set]').forEach((b) => { b.onclick = async () => { prefs.set = b.dataset.set; await KV.set('scanPrefs', prefs); viewScan(); }; });
  view().querySelectorAll('[name=tf]').forEach((r) => { r.onchange = async () => { prefs.tf = r.value; await KV.set('scanPrefs', prefs); viewScan(); }; });
  view().querySelectorAll('[data-sort]').forEach((b) => { b.onclick = async () => { prefs.sort = b.dataset.sort; await KV.set('scanPrefs', prefs); view().querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b)); drawList(); }; });

  let T; try { T = await tickers(); } catch (e) { $('#list').innerHTML = `<div class="card errbox">${esc(e.message)}</div>`; return; }
  let syms = Object.keys(T.t);
  if (prefs.set === 'top') syms = syms.sort((a, b) => T.t[b].vol - T.t[a].vol).slice(0, 20);
  else if (prefs.set === 'core') syms = SCAN.CORE.filter((s) => T.t[s]);
  else syms = syms.filter((s) => SCAN.META[s].g === prefs.set);
  let done = 0;
  const R = await pool(syms, 4, async (s) => {
    const A = await candles(s, prefs.tf, T), a = SCAN.analyze(A.cs, { dayStart: dayStartUtc(), daily: prefs.tf === '1D' });
    const d = prefs.tf === '1D' ? a : SCAN.analyze((await candles(s, '1D', T)).cs, { daily: true });
    const htf = HIGHER[prefs.tf], hi = !htf ? null : htf === '1D' ? d : SCAN.analyze((await candles(s, htf, T)).cs, { dayStart: dayStartUtc() });
    let lv = null, bz = null, sz = null, st = null;
    if (!a.error) { lv = LV.levels(A.cs, a.atr); bz = LV.buyZone(lv, a); sz = LV.sellZone(lv, a); st = LV.strong(A.cs, a, hi && !hi.error ? hi : null, lv, SCAN.rsiSeries(A.cs.map((k) => k.c))); }
    done++; const el = $('#list .muted'); if (el) el.textContent = `분석 중… ${done}/${syms.length}`;
    return { s, src: A.src, a, d: d && !d.error ? d : null, tk: T.t[s], hiTf: htf, bz, sz, st };
  });
  const rows = R.filter((x) => x && !x.error && x.a && !x.a.error);
  function drawList() {
    const key = { up: (x) => x.a.upScore * 10 + (x.st ? x.st.nb : 0) - x.a.dnScore, dn: (x) => x.a.dnScore * 10 + (x.st ? x.st.ns : 0) - x.a.upScore, strong: (x) => (x.st ? Math.max(x.st.strongBuy ? x.st.nb : 0, x.st.strongSell ? x.st.ns : 0) : 0), spike: (x) => x.a.volRatio || 0, atr: (x) => (x.d && x.d.atrPct) || 0 }[prefs.sort] || ((x) => x.a.upScore);
    let L = rows.slice().sort((p, q) => key(q) - key(p));
    if (prefs.sort === 'strong') L = L.filter((x) => x.st && (x.st.strongBuy || x.st.strongSell));
    let head = '';
    if (prefs.sort === 'atr') {
      const by = (c) => L.filter((x) => x.d && SCAN.volClass(x.d.atrPct) === c).map((x) => x.s).join(', ') || '없음';
      head = `<div class="muted" style="font-size:13px;margin-bottom:8px">초고변동: ${by('초고변동')}<br>고변동: ${by('고변동')}<br>중간: ${by('중간')}<br>낮음(안정적): ${by('낮음')}</div>`;
    }
    if (prefs.sort === 'strong') head = `<div class="muted" style="font-size:13px;margin-bottom:8px">기본 점수 4 이상 + 추가 확인 5가지 중 3가지 이상인 종목만 보여 줍니다.${L.length ? '' : '<br><b>지금은 강한 신호가 없습니다.</b> 확인이 덜 된 신호는 반등·하락 전환 목록에서 보세요.'}</div>`;
    if (prefs.sort === 'spike') head = `<div class="muted" style="font-size:13px;margin-bottom:8px">2배 이상 급증: ${L.filter((x) => x.a.volRatio >= 2).map((x) => `${x.s} ${x.a.volRatio.toFixed(1)}배(${x.a.price >= x.a.open ? '양봉' : '음봉'})`).join(', ') || '없음'}</div>`;
    $('#list').innerHTML = `<div class="card"><h2>${SORTS[prefs.sort] || ''} <span class="muted">(${L.length}종목 · ${TF[prefs.tf].label})</span></h2>${head}${L.map((x, i) => scanRow(x, i, prefs.sort)).join('') || (prefs.sort === 'strong' ? '' : '<div class="muted">종목이 없습니다.</div>')}</div>`;
  }
  drawList();
  const mk = await pool(['QQQ', 'SPY'], 2, async (s) => ({ s, d: SCAN.analyze((await candles(s, '1D', T)).cs, { daily: true }) }));
  const ses = usSession();
  $('#mkt').innerHTML = `<div class="row spread"><h2 style="margin:0">시장 방향 <span class="muted">(일봉)</span></h2><span style="color:${ses.c};font-weight:700;font-size:13px">미국 ${ses.t}</span></div>
    ${mk.map((x) => x.d && !x.d.error ? `<div style="font-size:14px;margin:4px 0"><b>${x.s}</b> ${fmt(x.d.price)} · RSI ${x.d.rsi.toFixed(1)} · <span class="${x.d.trend === 'up' ? 'up' : x.d.trend === 'down' ? 'down' : ''}">${esc(SCAN.dayTrend(x.d))}</span></div>` : '').join('')}
    <div class="muted" style="font-size:12px">${!T.okxOk ? '⚠️ OKX 시세 못 받음 · ' : ''}${!T.bnOk ? '⚠️ 바이낸스 시세 못 받음 · ' : ''}${!T.byOk ? '⚠️ 바이비트 시세 못 받음 · ' : ''}${kTime(Date.now())} · 뉴욕 ${ses.ny}</div>`;
}
function zoneBox(z, kind) {
  if (!z) return '';
  const buy = kind === 'buy';
  return `<div class="zonebox ${buy ? 'zb' : 'zs'}"><b>📍 ${buy ? '매수' : '매도(숏)'} 검토 가격대 ${fmt(z.low)} ~ ${fmt(z.high)}</b> <span class="muted">(${z.inZone ? '지금 가격대 안' : '현재가 대비 ' + pct(z.dist)})</span>${z.star ? ' ★' : ''}<br><span style="font-size:12px">무효(손절) <b>${fmt(z.stop)}</b> · 1차 목표 <b>${fmt(z.target)}</b> · 손익비 1:${z.rr > 0 ? z.rr.toFixed(1) : '-'} · 근거: ${z.basis.map(esc).join('·')}${z.rr < 1 ? '<br><span style="color:#B26B00">⚠️ 손익비 1 미만 — 목표가가 가까워 들어갈 만한 자리가 아닐 수 있음</span>' : ''}</span></div>`;
}
function scanRow(x, i, sort) {
  const m = SCAN.META[x.s], a = x.a, d = x.d, tk = x.tk, px = tk.px, st = x.st;
  const showBuy = a.upScore >= 3 || sort === 'up' || (st && st.strongBuy), showSell = a.dnScore >= 3 || sort === 'dn' || (st && st.strongSell);
  const badge = st && st.strongBuy ? `<span class="scchip sbuy">🟢 강한 매수 신호 · 확인 ${st.nb}/5</span>` : st && st.strongSell ? `<span class="scchip ssell">🔴 강한 매도 신호 · 확인 ${st.ns}/5</span>` : '';
  const warn = [d && d.atrJump >= 1.5 ? `⚠️ 변동성 확대(ATR ${d.atrJump.toFixed(1)}배)` : '', a.volRatio >= 2 ? `📢 거래량 ${a.volRatio.toFixed(1)}배(${a.price >= a.open ? '양봉' : '음봉'})` : ''].filter(Boolean).join(' · ');
  const ck = (L) => `<ul class="checks">${L.map((c) => `<li>${c.ok ? '✅' : '⬜'} ${esc(c.name)}</li>`).join('')}</ul>`;
  return `<details class="scrow"><summary>
      <div class="row spread"><span><b>${i + 1}. ${x.s}</b> <span class="muted" style="font-size:12px">${esc(m.name)}</span>${m.lev < 0 ? ' <span class="levtag inv">인버스</span>' : ''}</span><span class="${px.chg > 0 ? 'up' : px.chg < 0 ? 'down' : ''}" style="font-size:13px">${fmt(px.last)} ${pct(px.chg)}</span></div>
      <div class="row wrap" style="gap:4px;margin-top:4px">${scChip('🔼반등', a.upScore)}${scChip('🔽하락전환', a.dnScore)}<span class="scchip">거래량 ${a.volRatio != null ? a.volRatio.toFixed(1) + '배' : '-'}</span><span class="scchip">${SCAN.volClass(d && d.atrPct)} ${d && d.atrPct ? d.atrPct.toFixed(1) + '%' : ''}</span>${d ? `<span class="scchip ${d.trend === 'up' ? 'tup' : d.trend === 'down' ? 'tdn' : ''}">일봉 ${d.trend === 'up' ? '상승' : d.trend === 'down' ? '하락' : '횡보'}</span>` : ''}</div>
      ${warn ? `<div style="font-size:12px;margin-top:3px;color:#B26B00">${warn}</div>` : ''}
      ${badge ? `<div style="margin-top:4px">${badge}</div>` : ''}
      ${showBuy && x.bz && (sort !== 'dn') ? zoneBox(x.bz, 'buy') : ''}${showSell && x.sz && (sort === 'dn' || (st && st.strongSell)) ? zoneBox(x.sz, 'sell') : ''}</summary>
    <div class="grid2" style="font-size:13px;margin-top:8px">
      <div>RSI(14) <b>${a.rsi != null ? a.rsi.toFixed(1) : '-'}</b></div><div>MACD 히스토그램 <b>${a.hist != null ? a.hist.toFixed(3) : '-'}</b></div>
      <div>ADX <b>${a.adx != null ? a.adx.toFixed(0) : '-'}</b></div><div>VWAP 대비 <b class="${a.vwapGap > 0 ? 'up' : 'down'}">${pct(a.vwapGap)}</b></div></div>
    ${d ? `<div class="muted" style="font-size:12px;margin-top:4px">일봉: ${esc(SCAN.dayTrend(d))} · RSI ${d.rsi.toFixed(1)}</div>` : ''}
    <h4>🔼 반등 조건 ${a.upScore}/5</h4>${ck(a.up)}<h4>🔽 하락 전환 조건 ${a.dnScore}/5</h4>${ck(a.dn)}
    ${st ? `<h4>⭐ 강한 매수 확인 ${st.nb}/5 <span class="muted">(상위 봉 ${x.hiTf ? TF[x.hiTf].label : '없음'})</span></h4>${ck(st.buy)}<h4>⭐ 강한 매도 확인 ${st.ns}/5</h4>${ck(st.sell)}<div class="muted" style="font-size:12px">기본 점수 4 이상 + 확인 3가지 이상이면 '강한 신호'입니다.</div>` : ''}
    ${x.bz && !(showBuy && sort !== 'dn') ? zoneBox(x.bz, 'buy') : ''}${x.sz && !(showSell && (sort === 'dn' || (st && st.strongSell))) ? zoneBox(x.sz, 'sell') : ''}
    ${d && d.trend === 'down' && a.upScore >= 3 ? '<div class="warnlist" style="font-size:12px">일봉은 하락 추세입니다. 지금 반등 점수는 추세를 거스르는 단기 반등이라 실패할 가능성도 큽니다.</div>' : ''}
    ${d && d.trend === 'up' && a.dnScore >= 3 ? '<div class="warnlist" style="font-size:12px">일봉은 상승 추세입니다. 지금 하락 전환 점수는 눌림일 수도 있습니다.</div>' : ''}
    ${m.pair ? `<div class="muted" style="font-size:12px;margin-top:4px">반대 상품: ${m.pair}</div>` : ''}
    <a class="btn small" href="#/c/${x.s}" style="margin-top:8px">📈 차트·매물대 보기</a>
  </details>`;
}

/* ═════════ 📈 차트·매물대 ═════════ */
const CHART_SYMS = ['QQQ', 'TQQQ', 'SQQQ', 'US100', 'SPY', 'SOXL', 'SOXS'];
async function viewChart(sym) {
  setTitle(`📈 ${sym} 차트·매물대`);
  const prefs = await KV.get('chartPrefs', { tf: '1H' }); prefs.tf = fixTf(prefs.tf);
  await KV.set('lastChart', sym);
  const T = await tickers();
  const others = Object.keys(T.t).filter((s) => !CHART_SYMS.includes(s)).sort((a, b) => T.t[b].vol - T.t[a].vol);
  view().innerHTML = `<div class="chips">${CHART_SYMS.filter((s) => T.t[s]).map((s) => `<a class="chip${s === sym ? ' on' : ''}" href="#/c/${s}">${s}</a>`).join('')}
      <select id="other" style="width:auto;min-height:32px;padding:4px 8px;border-radius:999px"><option value="">다른 종목…</option>${others.map((s) => `<option value="${s}"${s === sym ? ' selected' : ''}>${s} · ${esc(SCAN.META[s].name)}</option>`).join('')}</select></div>
    <div class="seg" role="radiogroup" aria-label="봉 단위">${Object.entries(TF).map(([k, v]) => `<label><input type="radio" name="tf" value="${k}"${prefs.tf === k ? ' checked' : ''}><span>${v.label.replace('봉', '')}</span></label>`).join('')}</div>
    <div class="card" style="margin-top:10px;padding:8px"><canvas id="cv" class="chart" style="height:340px" aria-label="캔들 차트와 매물대"></canvas>
      <div class="muted" style="font-size:11px;margin-top:4px">빨강 상승·파랑 하락 봉 · <span style="color:#E8A317">EMA20</span> · <span style="color:#8E5CF0">EMA50</span> · <span style="color:#1F9D63">VWAP(그날)</span> · 오른쪽 막대: 매물대(최근 200봉) · <span style="color:#E8A317">━ POC</span> · ┅ 가치영역(VAH·VAL)</div></div>
    <div id="sum"><div class="card"><div class="muted">계산 중…</div></div></div>`;
  $('#other').onchange = (e) => { if (e.target.value) location.hash = '#/c/' + e.target.value; };
  view().querySelectorAll('[name=tf]').forEach((r) => { r.onchange = async () => { prefs.tf = r.value; await KV.set('chartPrefs', prefs); viewChart(sym); }; });
  let A; try { A = await candles(sym, prefs.tf, T); } catch (e) { $('#sum').innerHTML = `<div class="card errbox">${esc(e.message)}</div>`; return; }
  const cs = A.cs, a = SCAN.analyze(cs, { dayStart: dayStartUtc(), daily: prefs.tf === '1D' });
  if (a.error) { $('#sum').innerHTML = `<div class="card errbox">${esc(a.error)}</div>`; return; }
  const L = LV.levels(cs, a.atr), bz = LV.buyZone(L, a), sz = LV.sellZone(L, a);
  drawChart($('#cv'), cs, L.vp, a);
  const lvRow = (x, kind) => `<li><b class="${kind === 'res' ? 'up' : 'down'}">${fmt(x.p)}</b> <span class="muted">(${pct(x.dist)})</span> ${x.labels.map(esc).join(' · ')}${x.n >= 2 ? ' <b>★</b>' : ''}</li>`;
  const vp = L.vp, d = a, px = T.t[sym].px;
  $('#sum').innerHTML = `<div class="card"><div class="row spread"><b style="font-size:18px">${sym} ${fmt(px.last)}</b><span class="${px.chg > 0 ? 'up' : 'down'}">${pct(px.chg)} (24시간)</span></div>
      <div class="row wrap" style="gap:4px;margin-top:6px">${scChip('🔼반등', a.upScore)}${scChip('🔽하락전환', a.dnScore)}<span class="scchip">RSI ${a.rsi.toFixed(1)}</span><span class="scchip">ATR ${a.atrPct.toFixed(2)}%</span><span class="scchip">거래량 ${a.volRatio ? a.volRatio.toFixed(1) : '-'}배</span></div>
      <div class="muted" style="font-size:12px;margin-top:6px">${esc(SCAN.META[sym].name)} · ${EXN[A.src]} ${TF[prefs.tf].label} ${cs.length}개</div></div>
    <div class="card"><h2>🧱 매물대 <span class="muted">(최근 ${Math.min(200, cs.length)}봉 거래량 분포)</span></h2>
      ${vp ? `<div class="grid2" style="font-size:14px"><div>POC(매물 중심) <b>${fmt(vp.poc)}</b></div><div>가치영역 <b>${fmt(vp.val)}~${fmt(vp.vah)}</b></div></div>
      <div style="font-size:14px;margin-top:6px">현재 위치: <b>${esc(L.where)}</b>${L.inLvn ? ' · <span style="color:#B26B00">매물이 적은 빈 구간(빨리 움직이기 쉬움)</span>' : ''}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">매물이 많이 쌓인 가격(HVN)은 멈추기 쉽고, 빈 구간(LVN)은 빨리 지나가기 쉽습니다. 가치영역 위에서 버티면 강세, 아래로 내려가면 약세로 봅니다.</div>` : '<div class="muted">계산할 봉이 부족합니다.</div>'}</div>
    <div class="card"><h2>지지·저항 <span class="muted">(★ 근거 2개 이상 겹침)</span></h2>
      <h4>⬆️ 위쪽 저항</h4><ul class="lvl">${L.res.map((x) => lvRow(x, 'res')).join('') || '<li class="muted">위쪽에 뚜렷한 저항 없음</li>'}</ul>
      <h4>⬇️ 아래쪽 지지</h4><ul class="lvl">${L.sup.map((x) => lvRow(x, 'sup')).join('') || '<li class="muted">아래쪽에 뚜렷한 지지 없음</li>'}</ul>
      ${zoneBox(bz, 'buy')}${zoneBox(sz, 'sell')}
      <a class="btn small" id="toCalc" href="#/t" style="margin-top:8px">🧮 매수 검토 가격대로 위험 계산</a></div>
    <div class="card"><h2>반등·하락 전환 조건 <span class="muted">(${TF[prefs.tf].label})</span></h2>
      <h4>🔼 반등 ${a.upScore}/5</h4><ul class="checks">${a.up.map((c) => `<li>${c.ok ? '✅' : '⬜'} ${esc(c.name)}</li>`).join('')}</ul>
      <h4>🔽 하락 전환 ${a.dnScore}/5</h4><ul class="checks">${a.dn.map((c) => `<li>${c.ok ? '✅' : '⬜'} ${esc(c.name)}</li>`).join('')}</ul>
      <div class="muted" style="font-size:12px">EMA5 ${fmt(d.ema5)} · EMA20 ${fmt(d.ema20)} · EMA50 ${fmt(d.ema50)}${d.ema200 ? ' · EMA200 ' + fmt(d.ema200) : ''} · VWAP ${fmt(d.vwap)} · ADX ${d.adx ? d.adx.toFixed(0) : '-'}</div></div>
    <div class="disc">${DISC}</div>`;
  $('#toCalc').onclick = async () => { await KV.set('calcPrefill', bz ? { sym, entry: (bz.low + bz.high) / 2, stop: bz.stop, rr: bz.rr > 0 ? +bz.rr.toFixed(1) : 2, atr: a.atr } : { sym, entry: px.last, stop: px.last - 2 * a.atr, atr: a.atr }); };
}
function drawChart(cv, all, vp, a) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement), ink = css.getPropertyValue('--muted') || '#66708A';
  const cs = all.slice(-120), n = cs.length, vpW = Math.round(W * 0.2), plotW = W - vpW - 42, volH = H * 0.16, priceH = H - volH - 14;
  const lo0 = Math.min(...cs.map((k) => k.l)), hi0 = Math.max(...cs.map((k) => k.h));
  const lo = vp ? Math.min(lo0, vp.val) : lo0, hi = vp ? Math.max(hi0, vp.vah) : hi0, pad = (hi - lo) * 0.04;
  const y = (p) => 6 + (1 - (p - (lo - pad)) / (hi - lo + 2 * pad)) * (priceH - 6);
  const bw = plotW / n, x = (i) => i * bw + bw / 2;
  // 지표선(전체 봉으로 계산 후 마지막 n개)
  const c = all.map((k) => k.c), ema = (len) => { const k = 2 / (len + 1); let e = c[0]; return c.map((v, i) => (e = i ? v * k + e * (1 - k) : v)); };
  const e20 = ema(20).slice(-n), e50 = ema(50).slice(-n);
  const ds = dayStartUtc(); let pv = 0, vv = 0; const vw = cs.map((k) => { if (k.t < ds && cs[cs.length - 1].t >= ds) return null; pv += ((k.h + k.l + k.c) / 3) * k.v; vv += k.v; return vv ? pv / vv : null; });
  // 가로 눈금
  g.font = '10px sans-serif'; g.fillStyle = ink; g.strokeStyle = 'rgba(128,128,128,.15)'; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const p = lo + ((hi - lo) * i) / 4, yy = y(p); g.beginPath(); g.moveTo(0, yy); g.lineTo(plotW, yy); g.stroke(); g.fillText(fmt(p), plotW + vpW + 2, yy + 3); }
  // 매물대(오른쪽)
  if (vp) {
    const mx = Math.max(...vp.bins);
    vp.bins.forEach((v, j) => {
      const p0 = vp.lo + vp.step * j, p1 = p0 + vp.step, y0 = y(p1), y1 = y(p0), w = (v / mx) * (vpW - 4);
      const inVA = p0 >= vp.val - 1e-9 && p1 <= vp.vah + 1e-9, isPoc = j === vp.pocIdx;
      g.fillStyle = isPoc ? 'rgba(232,163,23,.85)' : inVA ? 'rgba(91,146,240,.45)' : 'rgba(128,128,128,.28)';
      g.fillRect(plotW + vpW - w, y0 + 0.5, w, Math.max(1, y1 - y0 - 1));
      const upw = (vp.upBins[j] / mx) * (vpW - 4); g.fillStyle = 'rgba(214,69,69,.35)'; g.fillRect(plotW + vpW - w, y0 + 0.5, Math.min(upw, w), Math.max(1, y1 - y0 - 1));
    });
    const hl = (p, color, dash) => { g.strokeStyle = color; g.setLineDash(dash || []); g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, y(p)); g.lineTo(plotW + vpW, y(p)); g.stroke(); g.setLineDash([]); };
    hl(vp.poc, 'rgba(232,163,23,.9)'); hl(vp.vah, 'rgba(91,146,240,.8)', [4, 3]); hl(vp.val, 'rgba(91,146,240,.8)', [4, 3]);
  }
  // 거래량
  const vmax = Math.max(...cs.map((k) => k.v)) || 1;
  cs.forEach((k, i) => { g.fillStyle = k.c >= k.o ? 'rgba(214,69,69,.45)' : 'rgba(28,96,214,.45)'; const h = (k.v / vmax) * volH; g.fillRect(x(i) - bw * 0.35, H - h - 2, bw * 0.7, h); });
  // 캔들
  cs.forEach((k, i) => {
    const col = k.c >= k.o ? '#D64545' : '#2F6FE0'; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x(i), y(k.h)); g.lineTo(x(i), y(k.l)); g.stroke();
    const top = y(Math.max(k.o, k.c)), bot = y(Math.min(k.o, k.c)); g.fillRect(x(i) - bw * 0.35, top, bw * 0.7, Math.max(1, bot - top));
  });
  const line = (arr, color) => { g.strokeStyle = color; g.lineWidth = 1.4; g.beginPath(); let s = false; arr.forEach((v, i) => { if (v == null) { s = false; return; } if (!s) { g.moveTo(x(i), y(v)); s = true; } else g.lineTo(x(i), y(v)); }); g.stroke(); };
  line(e20, '#E8A317'); line(e50, '#8E5CF0'); line(vw, '#1F9D63');
  // 현재가
  const last = cs[n - 1].c; g.fillStyle = last >= cs[n - 1].o ? '#D64545' : '#2F6FE0'; g.fillRect(plotW + vpW, y(last) - 7, 42, 14); g.fillStyle = '#fff'; g.fillText(fmt(last), plotW + vpW + 2, y(last) + 3);
}

/* ═════════ 🧭 선물 지표 ═════════ */
const FUT_SYMS = ['QQQ', 'TQQQ', 'SQQQ', 'US100', 'SPY', 'SOXL', 'SOXS'];
async function futData() {
  const hit = await KV.get('fut', null);
  if (hit && Date.now() - hit.at < 3 * 60e3) return hit.data;
  const T = await tickers(), out = {};
  const [oi, mark, prem] = await Promise.allSettled([okxGet('/public/open-interest?instType=SWAP'), okxGet('/public/mark-price?instType=SWAP'), bnGet('/fapi/v1/premiumIndex')]);
  await pool(FUT_SYMS.filter((s) => T.t[s]), 3, async (s) => {
    const o = { s, px: T.t[s].px, okx: null, bn: null };
    if (T.t[s].okx) {
      const id = s + '-USDT-SWAP', x = { };
      const oiRow = oi.status === 'fulfilled' ? oi.value.find((r) => r.instId === id) : null; if (oiRow) x.oiUsd = +oiRow.oiUsd;
      const mk = mark.status === 'fulfilled' ? mark.value.find((r) => r.instId === id) : null; if (mk) x.mark = +mk.markPx;
      try { const f = (await okxQ(`/public/funding-rate?instId=${id}`))[0]; x.funding = +f.fundingRate; x.next = +f.nextFundingTime; } catch { /* 없음 */ }
      try { const ix = (await okxQ(`/market/index-tickers?instId=${s}-USDT`))[0]; if (ix) x.index = +ix.idxPx; } catch { /* 없음 */ }
      if (x.mark && x.index) x.premium = ((x.mark / x.index) - 1) * 100;
      o.okx = x;
    }
    if (T.t[s].bn) {
      const sym = s + 'USDT', y = {};
      const p = prem.status === 'fulfilled' && Array.isArray(prem.value) ? prem.value.find((r) => r.symbol === sym) : null;
      if (p) { y.mark = +p.markPrice; y.index = +p.indexPrice; y.funding = +p.lastFundingRate; y.next = +p.nextFundingTime; if (y.index) y.premium = ((y.mark / y.index) - 1) * 100; }
      try { const h = await bnGet(`/futures/data/openInterestHist?symbol=${sym}&period=1h&limit=25`); if (h.length) { const a0 = +h[0].sumOpenInterestValue, a1 = +h[h.length - 1].sumOpenInterestValue; y.oiUsd = a1; y.oiChg = a0 ? ((a1 / a0) - 1) * 100 : null; } } catch { /* 없음 */ }
      try { const r = await bnGet(`/futures/data/globalLongShortAccountRatio?symbol=${sym}&period=1h&limit=1`); if (r.length) { y.ls = +r[0].longShortRatio; y.longPct = +r[0].longAccount * 100; } } catch { /* 없음 */ }
      try { const r = await bnGet(`/futures/data/takerlongshortRatio?symbol=${sym}&period=1h&limit=4`); if (r.length) { const b = r.reduce((s2, z) => s2 + +z.buyVol, 0), sl = r.reduce((s2, z) => s2 + +z.sellVol, 0); y.taker = sl ? b / sl : null; } } catch { /* 없음 */ }
      o.bn = y;
    }
    if (T.t[s].by) {
      const sym = s + 'USDT', t = T.t[s].by, z = { oiUsd: t.oiUsd, funding: t.funding, next: t.next, mark: t.mark, index: t.index };
      if (z.mark && z.index) z.premium = ((z.mark / z.index) - 1) * 100;
      try { const h = (await byGet(`/v5/market/open-interest?category=linear&symbol=${sym}&intervalTime=1h&limit=25`)).list; if (h.length > 1) { const a1 = +h[0].openInterest, a0 = +h[h.length - 1].openInterest; z.oiChg = a0 ? ((a1 / a0) - 1) * 100 : null; } } catch { /* 없음 */ }
      try { const r = (await byGet(`/v5/market/account-ratio?category=linear&symbol=${sym}&period=1h&limit=1`)).list; if (r.length) { const bu = +r[0].buyRatio, se = +r[0].sellRatio; z.ls = se ? bu / se : null; z.longPct = bu * 100; } } catch { /* 없음 */ }
      o.by = z;
    }
    out[s] = o;
  });
  const data = { at: Date.now(), rows: out };
  KV.set('fut', { at: Date.now(), data }).catch(() => {});
  return data;
}
function oiRead(priceChg, oiChg) {
  if (priceChg == null || oiChg == null) return { t: '판단 자료 부족', c: 'var(--muted)' };
  if (priceChg > 0.3 && oiChg > 2) return { t: '가격↑ 미결제↑ — 새 매수 유입(상승에 힘이 있음)', c: 'var(--red)' };
  if (priceChg > 0.3 && oiChg < -2) return { t: '가격↑ 미결제↓ — 숏 청산이 끌어올림(오래 못 갈 수 있음)', c: '#B26B00' };
  if (priceChg < -0.3 && oiChg > 2) return { t: '가격↓ 미결제↑ — 새 매도 유입(하락에 힘이 있음)', c: 'var(--blue)' };
  if (priceChg < -0.3 && oiChg < -2) return { t: '가격↓ 미결제↓ — 롱 청산 하락(매도가 지쳐 갈 수 있음)', c: '#B26B00' };
  return { t: '가격·미결제 변화가 작아 뚜렷하지 않음', c: 'var(--muted)' };
}
async function viewFut() {
  setTitle('🧭 선물 지표');
  const ses = usSession();
  view().innerHTML = `<div class="card" style="margin-top:0"><div class="row spread"><b>미국장</b><b style="color:${ses.c}">${ses.t}</b></div>
      <div class="muted" style="font-size:12px;margin-top:4px">뉴욕 ${ses.ny} · 정규장 한국 23:30~06:00(서머타임엔 22:30~05:00) · 무기한 선물은 24시간 거래되어 장이 닫힌 밤·주말엔 실제 ETF와 차이가 날 수 있습니다. 미국 공휴일은 따로 표시하지 않습니다.</div></div>
    <div id="fut"><div class="card"><div class="muted">미결제약정·펀딩비·롱숏 비율을 받는 중…</div></div></div>
    <div class="card"><details><summary><b>지표 읽는 법</b></summary><ul class="steps" style="font-size:13px;margin-top:6px">
      <li><b>미결제약정(OI)</b>: 아직 정리되지 않은 선물 계약의 총액. 가격과 함께 늘면 새 돈이 그 방향으로 들어오는 것, 줄면 기존 포지션이 정리되는 것.</li>
      <li><b>펀딩비</b>: 선물값을 현물(지수)에 붙여 두려고 롱·숏이 서로 주고받는 돈. +면 롱이 숏에게 냄(롱 쏠림), −면 반대. 너무 크면 한쪽 과열.</li>
      <li><b>괴리율(프리미엄)</b>: 선물 표시가격이 기초 지수보다 얼마나 비싼지. +면 선물 참여자가 낙관적, −면 비관적. 미국장이 닫힌 시간엔 더 벌어지기 쉬움.</li>
      <li><b>롱/숏 계좌 비율</b>(바이낸스·바이비트): 롱 계좌 수 ÷ 숏 계좌 수. 한쪽으로 크게 쏠리면 반대로 흔들릴 위험(쏠린 쪽 청산)이 큼.</li>
      <li><b>공격적 매수/매도 비율</b>(바이낸스, 최근 4시간): 시장가로 산 양 ÷ 판 양. 1보다 크면 사는 쪽이 더 급함.</li></ul></details></div>
    <div class="disc">${DISC}</div>`;
  let D; try { D = await futData(); } catch (e) { $('#fut').innerHTML = `<div class="card errbox">${esc(e.message)}</div>`; return; }
  const fr = (x) => (x == null ? '-' : (x * 100).toFixed(4) + '%');
  const rows = FUT_SYMS.map((s) => D.rows[s]).filter(Boolean).map((o) => {
    const b = o.bn || {}, k = o.okx || {}, y = o.by || {}, oiSrc = b.oiChg != null ? ['바이낸스', b.oiChg] : y.oiChg != null ? ['바이비트', y.oiChg] : ['', null];
    const rd = oiRead(o.px.chg, oiSrc[1]), fHot = [k.funding, b.funding, y.funding].some((f) => f != null && Math.abs(f) >= 0.0003);
    const lsMax = [b.ls, y.ls].filter((v) => v != null), lsWarn = lsMax.some((v) => v >= 2.5 || v <= 0.6);
    const lsv = (q) => (q.ls != null ? `${q.ls.toFixed(2)} (롱 ${q.longPct.toFixed(0)}%)` : '-');
    return `<div class="card"><div class="row spread"><b style="font-size:16px">${o.s} <span class="muted" style="font-size:12px">${esc(SCAN.META[o.s].name)}</span></b><span class="${o.px.chg > 0 ? 'up' : 'down'}">${fmt(o.px.last)} ${pct(o.px.chg)}</span></div>
      <div style="font-size:13px;margin-top:6px;color:${rd.c}"><b>${esc(rd.t)}</b> <span class="muted">(${oiSrc[0]} 미결제 24시간 ${pct(oiSrc[1])})</span></div>
      <div class="tblwrap"><table class="md" style="margin-top:6px"><thead><tr><th></th><th>OKX</th><th>바이낸스</th><th>바이비트</th></tr></thead><tbody>
        <tr><td>미결제약정</td><td>${k.oiUsd ? money(k.oiUsd) : '-'}</td><td>${b.oiUsd ? money(b.oiUsd) : '-'}</td><td>${y.oiUsd ? money(y.oiUsd) : '-'}</td></tr>
        <tr><td>펀딩비</td><td>${fr(k.funding)}</td><td>${fr(b.funding)}</td><td>${fr(y.funding)}</td></tr>
        <tr><td>괴리율</td><td>${pct(k.premium, 3)}</td><td>${pct(b.premium, 3)}</td><td>${pct(y.premium, 3)}</td></tr>
        <tr><td>다음 정산</td><td>${k.next ? kTime(k.next) : '-'}</td><td>${b.next ? kTime(b.next) : '-'}</td><td>${y.next ? kTime(y.next) : '-'}</td></tr>
        <tr><td>미결제 24시간</td><td>-</td><td>${pct(b.oiChg)}</td><td>${pct(y.oiChg)}</td></tr>
        <tr><td>롱/숏 계좌</td><td>-</td><td>${lsv(b)}</td><td>${lsv(y)}</td></tr>
        <tr><td>매수/매도(4시간)</td><td>-</td><td>${b.taker != null ? b.taker.toFixed(2) : '-'}</td><td>-</td></tr></tbody></table></div>
      ${fHot || lsWarn ? `<div style="font-size:12px;margin-top:4px;color:#B26B00">${fHot ? '⚠️ 펀딩비가 커서 한쪽이 과열 ' : ''}${lsWarn ? `⚠️ 롱/숏 ${lsMax.map((v) => v.toFixed(2)).join('·')}로 한쪽 쏠림` : ''}</div>` : ''}
      <a class="btn small" href="#/c/${o.s}" style="margin-top:6px">📈 차트</a></div>`;
  }).join('');
  $('#fut').innerHTML = rows + `<div class="muted" style="font-size:12px;text-align:center">${kTime(D.at)} 기준 · 3분마다 새로 받음 · OKX 통계(롱숏 등)는 브라우저에서 막혀 바이낸스·바이비트 것으로 표시</div>`;
}

/* ═════════ 🔔 신호(QQQ 규칙 신호 + 디스코드 알림) ═════════ */
async function viewSignals() {
  await viewNq(); // nqui.js(가격 위치 앱과 같은 화면) — 끝에 디스코드 아침 정리 켜기 카드 추가
  const host = document.createElement('div'); host.id = 'scAlert'; view().appendChild(host);
  const cfg = await KV.get('scAlert', { enabled: false });
  host.innerHTML = `<div class="card"><div class="row spread"><b>📊 디스코드 아침 정리</b><label class="row" style="margin:0;color:var(--ink)"><input type="checkbox" id="scAl" ${cfg.enabled ? 'checked' : ''} style="width:22px;min-height:22px"> 켜기</label></div>
    <div class="muted" style="font-size:13px;margin-top:4px">매일 한국 9시 10분쯤 OKX ETF 선물의 시장 방향·반등/하락 전환 상위·거래대금·변동성을 디스코드로 받습니다(가격 위치 앱과 같은 스크립트, 같은 설정).</div></div>`;
  $('#scAl').onchange = async (e) => {
    if (e.target.checked && !(await relayOn())) { e.target.checked = false; alert('도구 화면에서 알림 스크립트를 먼저 연결해 주세요'); return; }
    try { await relay('saveScan', { enabled: e.target.checked }); await KV.set('scAlert', { enabled: e.target.checked }); toast(e.target.checked ? '아침 정리를 켰습니다' : '아침 정리를 껐습니다'); }
    catch (err) { e.target.checked = !e.target.checked; alert('저장 실패: ' + err.message); }
  };
  if (await relayOn()) relay('ping').then(async (d) => { if (d.scan) { const cb = $('#scAl'); if (cb) cb.checked = !!d.scan.enabled; await KV.set('scAlert', { enabled: !!d.scan.enabled }); } }).catch(() => {});
}

/* ═════════ 🧮 도구(위험 계산기·연결 설정) ═════════ */
async function viewTools() {
  setTitle('🧮 도구');
  const cfg = await KV.get('relay', {}), pre = await KV.get('calcPrefill', null), cp = await KV.get('calc', { acct: 1000, risk: 1, lev: 3, side: 'long', rr: 2, mmr: 0.5 });
  if (pre) { cp.entry = +pre.entry.toFixed(2); cp.stop = +pre.stop.toFixed(2); cp.sym = pre.sym; cp.side = 'long'; if (pre.rr) cp.rr = pre.rr; await KV.set('calcPrefill', null); }
  view().innerHTML = `<div class="card" style="margin-top:0"><h2>🧮 위험 계산기 <span class="muted">${cp.sym ? '(' + esc(cp.sym) + ' 차트에서 가져옴)' : ''}</span></h2>
      <div class="calcintro">💡 <b>이렇게 씁니다</b>: "이번 거래가 틀리면 <b>최대 얼마까지 잃어도 되는지</b>"를 먼저 정하면, 손절가까지 거리를 보고 <b>몇 주(계약)를 사야 하는지</b> 거꾸로 계산해 줍니다. 손절가에 닿아도 정한 금액만 잃도록 수량을 맞추는 방법입니다.</div>
      <div class="seg" style="margin-top:8px"><label><input type="radio" name="side" value="long"${cp.side !== 'short' ? ' checked' : ''}><span>📈 롱 (오르면 이익)</span></label><label><input type="radio" name="side" value="short"${cp.side === 'short' ? ' checked' : ''}><span>📉 숏 (내리면 이익)</span></label></div>
      <div class="calcgrid">
        <div><label for="acct">① 내 선물 계좌 돈 (USDT)</label><input id="acct" type="number" inputmode="decimal" value="${cp.acct}"><div class="hint">OKX 선물 지갑에 있는 전체 금액</div></div>
        <div><label for="risk">② 이번에 잃어도 되는 돈 (계좌의 %)</label><input id="risk" type="number" inputmode="decimal" step="0.1" value="${cp.risk}"><div class="hint" id="riskHint">보통 1~2%. 1%면 100번 연속 틀려야 계좌가 0</div></div>
        <div><label for="entry">③ 들어갈 가격 (진입가)</label><input id="entry" type="number" inputmode="decimal" value="${cp.entry ?? ''}"><div class="hint">사려는(숏이면 팔려는) 가격</div></div>
        <div><label for="stop">④ 틀렸다고 보고 나올 가격 (손절가)</label><input id="stop" type="number" inputmode="decimal" value="${cp.stop ?? ''}"><div class="hint">롱은 진입가보다 아래, 숏은 위</div></div>
        <div><label for="lev">⑤ 레버리지 (배)</label><input id="lev" type="number" inputmode="decimal" value="${cp.lev}"><div class="hint">높을수록 증거금은 적지만 강제 청산이 가까워짐</div></div>
        <div><label for="rr">⑥ 노리는 이익 (잃을 돈의 몇 배)</label><input id="rr" type="number" inputmode="decimal" step="0.5" value="${cp.rr}"><div class="hint">2면 "1을 걸고 2를 노림" (손익비 1:2)</div></div></div>
      <div id="calcOut" style="margin-top:10px"></div>
      <details style="margin-top:8px"><summary><b>용어 쉽게 보기</b></summary><ul class="steps" style="font-size:13px;margin-top:6px">
        <li><b>손절가</b>: "내 판단이 틀렸다"고 인정하고 나오는 가격. 미리 정해 두어야 큰 손실을 막습니다.</li>
        <li><b>레버리지</b>: 내 돈의 몇 배 크기로 거래하는지. 3배면 100 USDT로 300 USDT어치를 거래.</li>
        <li><b>증거금</b>: 거래하는 동안 거래소에 맡겨 두는 내 돈. 포지션 크기 ÷ 레버리지.</li>
        <li><b>청산가</b>: 손실이 증거금을 거의 다 먹으면 거래소가 강제로 정리하는 가격. 손절가보다 멀리 있어야 안전.</li>
        <li><b>손익비</b>: 잃을 돈 대비 노리는 이익. 1:2면 1을 잃을 각오로 2를 노림. 이기는 확률이 절반이 안 돼도 손익비가 좋으면 버틸 수 있음.</li></ul></details>
      <div class="muted" style="font-size:12px;margin-top:6px">청산가는 격리 증거금·유지증거금률 ${cp.mmr}% 가정의 대략값입니다. 실제는 거래소의 단계별 유지증거금·수수료·펀딩비에 따라 다르니 주문 전 거래소 화면으로 확인하세요. OKX 나스닥 선물은 1계약 = 1주, 최소 0.01계약입니다.</div></div>
    <div class="card"><h2>🔔 알림 스크립트 연결</h2>
      <div class="muted" style="font-size:13px">'가격 위치' 앱과 같은 구글 Apps Script 웹 앱 주소와 APP_KEY를 넣으면 이 앱에서도 디스코드 알림을 켜고 끌 수 있습니다.</div>
      <label for="r_url">스크립트 웹 앱 주소</label><input id="r_url" value="${esc(cfg.url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
      <label for="r_key">앱 키 (APP_KEY)</label><input id="r_key" type="password" value="${esc(cfg.key || '')}" autocomplete="off">
      <button class="btn primary block" id="r_save" type="button" style="margin-top:10px">저장하고 연결 확인</button><div id="r_res" style="margin-top:8px"></div></div>
    <div class="card"><h2>앱 정보</h2><div class="muted" style="font-size:13px">나스닥 선물 v${APP_VERSION} · OKX·바이낸스 공개 시세(키·주문 없음) · 홈 화면에 추가: 크롬 ⋮ → '홈 화면에 추가'<br>계산: 스캐너·QQQ 규칙 신호는 '가격 위치' 앱과 같은 식, 매물대는 최근 200봉 거래량 분포.</div></div>
    <div class="disc">${DISC}</div>`;
  const calc = async () => {
    const v = (id) => parseFloat($('#' + id).value), side = $('[name=side]:checked').value;
    const acct = v('acct'), risk = v('risk'), entry = v('entry'), stop = v('stop'), lev = v('lev'), rr = v('rr');
    await KV.set('calc', { acct, risk, lev, side, rr, mmr: cp.mmr, entry, stop });
    const out = $('#calcOut');
    if (!(acct > 0 && risk > 0 && entry > 0 && stop > 0 && lev > 0)) { out.innerHTML = '<div class="muted">계좌·위험·진입가·손절가·레버리지를 넣으세요.</div>'; return; }
    const dist = side === 'long' ? entry - stop : stop - entry;
    if (dist <= 0) { out.innerHTML = `<div class="errbox">${side === 'long' ? '롱은 손절가가 진입가보다 낮아야' : '숏은 손절가가 진입가보다 높아야'} 합니다.</div>`; return; }
    const riskAmt = acct * risk / 100, qty = Math.floor((riskAmt / dist) * 100) / 100, notional = qty * entry, margin = notional / lev;
    const mmr = cp.mmr / 100, liq = side === 'long' ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
    const target = side === 'long' ? entry + dist * rr : entry - dist * rr, stopPct = (dist / entry) * 100;
    const liqFirst = side === 'long' ? liq >= stop : liq <= stop;
    out.innerHTML = `<div class="calcsum">📌 <b>${qty.toFixed(2)}주(계약)</b>를 ${side === 'long' ? '사면' : '팔면'}, ${fmt(stop)}에서 손절해도 <b>${riskAmt.toFixed(2)} USDT</b>(계좌의 ${risk}%)만 잃고, ${fmt(target)}까지 가면 <b class="up">+${(riskAmt * rr).toFixed(2)} USDT</b>를 법니다.</div>
      <table class="calctbl"><tbody>
        <tr><th>잃는 돈 (손절가에 닿으면)</th><td><b>${riskAmt.toFixed(2)} USDT</b></td></tr>
        <tr><th>손절가까지 거리</th><td>${stopPct.toFixed(2)}% <span class="muted">(1주당 ${dist.toFixed(2)} USDT)</span></td></tr>
        <tr><th>사야 할 수량</th><td><b>${qty.toFixed(2)}주(계약)</b></td></tr>
        <tr><th>포지션 크기 (수량 × 진입가)</th><td>${notional.toFixed(2)} USDT</td></tr>
        <tr><th>내 돈에서 묶이는 금액 (증거금)</th><td>${margin.toFixed(2)} USDT <span class="muted">(계좌의 ${((margin / acct) * 100).toFixed(0)}%)</span></td></tr>
        <tr><th>강제로 정리되는 가격 (대략 청산가)</th><td><b>${fmt(liq)}</b> <span class="muted">(진입가 대비 ${pct(((liq / entry) - 1) * 100)})</span></td></tr>
        <tr><th>목표가 (잃을 돈의 ${rr}배 이익)</th><td>${fmt(target)}</td></tr>
        <tr><th>목표가 도달 시 이익</th><td class="up"><b>+${(riskAmt * rr).toFixed(2)} USDT</b></td></tr></tbody></table>
      ${liqFirst ? '<div class="errbox">⚠️ 손절가에 닿기 전에 <b>강제 청산</b>이 먼저 일어납니다(증거금을 거의 다 잃음). 레버리지를 낮추거나 손절가를 진입가에 더 가깝게 하세요.</div>' : '<div class="okbox" style="font-weight:500">✅ 강제 청산 가격보다 손절가가 먼저입니다.</div>'}
      ${margin > acct ? '<div class="errbox">⚠️ 필요 증거금이 계좌보다 큽니다.</div>' : ''}
      ${qty < 0.01 ? '<div class="warnlist">수량이 최소 단위(0.01)보다 작습니다.</div>' : ''}`;
  };
  view().querySelectorAll('#acct,#risk,#entry,#stop,#lev,#rr').forEach((el) => { el.oninput = calc; });
  const riskHint = () => { const a = parseFloat($('#acct').value), r = parseFloat($('#risk').value); if (a > 0 && r > 0) $('#riskHint').textContent = `= ${(a * r / 100).toFixed(2)} USDT · 보통 1~2%`; };
  $('#acct').addEventListener('input', riskHint); $('#risk').addEventListener('input', riskHint); riskHint();
  view().querySelectorAll('[name=side]').forEach((el) => { el.onchange = calc; });
  calc();
  $('#r_save').onclick = async () => {
    const url = $('#r_url').value.trim(), key = $('#r_key').value.trim(), res = (h) => { $('#r_res').innerHTML = h; };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { alert('주소는 https://script.google.com/macros/s/…/exec 모양이어야 합니다'); return; }
    if (key.length < 8) { alert('앱 키는 8자 이상이어야 합니다'); return; }
    await KV.set('relay', { url, key }); res('<div class="muted">확인 중…</div>');
    try {
      const d = await relay('ping');
      await KV.set('nqAlert', { enabled: !!(d.nq && d.nq.enabled) }); await KV.set('scAlert', { enabled: !!(d.scan && d.scan.enabled) });
      res(`<div class="okbox" style="margin-top:0">✅ 연결됨 · 스크립트 v${d.version} · 디스코드 ${d.discord ? '✅' : '—'} · QQQ 신호 알림 ${d.nq && d.nq.enabled ? '켜짐' : '꺼짐'} · 아침 정리 ${d.scan && d.scan.enabled ? '켜짐' : '꺼짐'}${(d.version || 0) < 9 ? '<br><span style="color:var(--red)">스크립트를 v9 이상으로 바꿔야 아침 정리가 됩니다</span>' : ''}</div>`);
    } catch (e) { res(`<div class="errbox" style="margin-top:0">${esc(e.message)}</div>`); }
  };
}

/* ───────── 시작(자동 업데이트) ───────── */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadSW = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => { document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); }); }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadSW || reloaded) return;
    if (document.querySelector('input:focus')) { toast('새 버전이 나왔습니다. 앱을 다시 열면 바뀝니다'); return; }
    reloaded = true; location.reload();
  });
}
// 차트 탭은 마지막으로 본 종목으로
(async () => { const last = await KV.get('lastChart', 'QQQ'); const a = document.querySelector('.tabs a[data-tab=chart]'); if (a) a.href = '#/c/' + last; })();
render();
