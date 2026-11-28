/* 나스닥 선물 — 매물대(거래량 프로파일)와 지지·저항 가격 계산 (화면·네트워크 없이 계산만)
 * 봉: 오래된 것부터 [{t, o, h, l, c, v}]. 매물대는 각 봉의 거래량을 그 봉의 고가~저가 사이에 고르게 나눠 쌓는다.
 * POC: 거래가 가장 많이 쌓인 가격 / 가치 영역(VAH~VAL): 거래의 70%가 몰린 범위
 * HVN: 거래가 많이 쌓인 마디(지지·저항이 되기 쉬움) / LVN: 거래가 적은 빈 구간(가격이 빨리 지나가기 쉬움)
 */
const LV = (() => {
  function profile(cs, bins) {
    bins = bins || 48;
    if (!cs || cs.length < 10) return null;
    const lo = Math.min(...cs.map((k) => k.l)), hi = Math.max(...cs.map((k) => k.h));
    if (!(hi > lo)) return null;
    const step = (hi - lo) / bins, vol = new Array(bins).fill(0), up = new Array(bins).fill(0);
    for (const k of cs) {
      const a = Math.max(0, Math.min(bins - 1, Math.floor((k.l - lo) / step))), b = Math.max(0, Math.min(bins - 1, Math.floor((k.h - lo) / step)));
      const share = (k.v || 0) / (b - a + 1);
      for (let j = a; j <= b; j++) { vol[j] += share; if (k.c >= k.o) up[j] += share; }
    }
    const total = vol.reduce((s, x) => s + x, 0); if (!total) return null;
    const poc = vol.indexOf(Math.max(...vol));
    let inside = vol[poc], dn = poc, upi = poc;
    while (inside < total * 0.7 && (dn > 0 || upi < bins - 1)) {
      const nd = dn > 0 ? vol[dn - 1] : -1, nu = upi < bins - 1 ? vol[upi + 1] : -1;
      if (nd >= nu) { dn--; inside += vol[dn]; } else { upi++; inside += vol[upi]; }
    }
    const mid = (j) => lo + step * (j + 0.5), mean = total / bins;
    const hvn = [], lvn = [];
    for (let j = 1; j < bins - 1; j++) {
      if (vol[j] >= mean * 1.3 && vol[j] >= vol[j - 1] && vol[j] >= vol[j + 1] && j !== poc) hvn.push(mid(j));
      if (vol[j] <= mean * 0.45 && vol[j] <= vol[j - 1] && vol[j] <= vol[j + 1]) lvn.push(mid(j));
    }
    return { lo, hi, step, bins: vol, upBins: up, poc: mid(poc), pocIdx: poc, vah: lo + step * (upi + 1), val: lo + step * dn, hvn, lvn, total };
  }
  function swings(cs, w) {
    w = w || 5; const highs = [], lows = [];
    for (let i = w; i < cs.length - w; i++) {
      let hi = true, lo = true;
      for (let k = i - w; k <= i + w; k++) { if (k === i) continue; if (cs[k].h > cs[i].h) hi = false; if (cs[k].l < cs[i].l) lo = false; }
      if (hi) highs.push({ i, p: cs[i].h }); if (lo) lows.push({ i, p: cs[i].l });
    }
    return { highs, lows };
  }
  const emaLast = (c, n) => { if (c.length < n) return null; const k = 2 / (n + 1); let e = c[0]; for (let i = 1; i < c.length; i++) e = c[i] * k + e * (1 - k); return e; };
  // 현재가 아래 지지·위 저항: 매물대(POC·VAH·VAL·HVN)·스윙 고저점·EMA50/200을 ATR 0.5배 안에서 묶음
  function levels(cs, atr) {
    const p = cs[cs.length - 1].c, vp = profile(cs.slice(-200)), sw = swings(cs.slice(-200)), c = cs.map((k) => k.c);
    const A = atr || p * 0.01, cand = [];
    const add = (price, label) => { if (Number.isFinite(price) && price > 0) cand.push({ p: price, label }); };
    if (vp) { add(vp.poc, '매물대 중심(POC)'); add(vp.vah, '가치영역 상단(VAH)'); add(vp.val, '가치영역 하단(VAL)'); vp.hvn.forEach((x) => add(x, '매물 마디(HVN)')); }
    sw.highs.slice(-8).forEach((s) => add(s.p, '스윙 고점')); sw.lows.slice(-8).forEach((s) => add(s.p, '스윙 저점'));
    const e50 = emaLast(c, 50), e200 = emaLast(c, 200); add(e50, 'EMA50'); add(e200, 'EMA200');
    const group = (L) => {
      const out = [];
      for (const x of L.sort((a, b) => a.p - b.p)) {
        const g = out.find((q) => Math.abs(q.p - x.p) <= A * 0.5);
        if (g) { g.items.push(x); g.p = g.items.reduce((s, y) => s + y.p, 0) / g.items.length; } else out.push({ p: x.p, items: [x] });
      }
      return out.map((g) => ({ p: g.p, labels: [...new Set(g.items.map((y) => y.label))], n: new Set(g.items.map((y) => y.label)).size, dist: ((g.p / p) - 1) * 100 }));
    };
    const sup = group(cand.filter((x) => x.p < p * 0.999)).sort((a, b) => b.p - a.p).slice(0, 4);
    const res = group(cand.filter((x) => x.p > p * 1.001)).sort((a, b) => a.p - b.p).slice(0, 4);
    let where = '';
    if (vp) where = p > vp.vah ? '가치영역 위(매물 적은 위쪽, 강세 쪽)' : p < vp.val ? '가치영역 아래(매물 적은 아래쪽, 약세 쪽)' : p >= vp.poc ? '가치영역 안 · POC 위' : '가치영역 안 · POC 아래';
    const inLvn = vp ? vp.lvn.some((x) => Math.abs(x - p) <= vp.step) : false;
    return { price: p, vp, sup, res, where, inLvn };
  }
  // 매수 검토 가격대(반등 쪽): 현재가 아래 1.5 ATR 안의 지지(근거 2개 이상 우선) 주변. 무효(손절) = 가격대 아래 1 ATR, 1차 목표 = 가장 가까운 저항
  // 1·2·3차 목표: 진입 쪽(dir=1 위, -1 아래)의 저항(지지)을 가까운 순서로, 0.5 ATR 안에 붙은 것은 하나로. 없으면 손절 폭의 2배, 모자라면 앞 목표에서 손절 폭만큼씩
  function tgts(mid, risk, lvls, dir, A) {
    const out = [];
    lvls.filter((p) => (p - mid) * dir >= risk * 0.8).sort((x, y) => (x - y) * dir).forEach((p) => { if (out.length < 3 && (!out.length || Math.abs(p - out[out.length - 1]) >= A * 0.5)) out.push(p); });
    if (!out.length) out.push(mid + dir * risk * 2); // 저항(지지)이 없으면 손절 폭의 2배
    while (out.length < 3) out.push(out[out.length - 1] + dir * Math.max(risk, A)); // 모자라면 앞 목표에서 손절 폭(최소 1 ATR)씩 더
    return out.slice(0, 3);
  }
  function buyZone(lv, a) {
    const A = a.atr, p = a.price; if (!A || !lv) return null;
    const near = lv.sup.filter((s) => p - s.p <= 1.5 * A);
    const pick = near.find((s) => s.n >= 2) || near[0] || lv.sup[0]; if (!pick) return null;
    const low = pick.p - 0.25 * A, high = Math.min(p, pick.p + 0.5 * A), stop = low - A;
    const mid = (low + high) / 2, targets = tgts(mid, mid - stop, lv.res.map((x) => x.p), 1, A), target = targets[0];
    return { low, high, stop, target, targets, rr: (target - mid) / (mid - stop), basis: pick.labels, star: pick.n >= 2, inZone: p >= low && p <= high * 1.001, dist: ((high / p) - 1) * 100 };
  }
  // 매도(숏) 검토 가격대(하락 전환 쪽): 현재가 위 1.5 ATR 안의 저항 주변. 무효 = 가격대 위 1 ATR, 1차 목표 = 가장 가까운 지지
  function sellZone(lv, a) {
    const A = a.atr, p = a.price; if (!A || !lv) return null;
    const near = lv.res.filter((s) => s.p - p <= 1.5 * A);
    const pick = near.find((s) => s.n >= 2) || near[0] || lv.res[0]; if (!pick) return null;
    const high = pick.p + 0.25 * A, low = Math.max(p, pick.p - 0.5 * A), stop = high + A;
    const mid = (low + high) / 2, targets = tgts(mid, stop - mid, lv.sup.map((x) => x.p), -1, A), target = targets[0];
    return { low, high, stop, target, targets, rr: (mid - target) / (stop - mid), basis: pick.labels, star: pick.n >= 2, inZone: p <= high && p >= low * 0.999, dist: ((low / p) - 1) * 100 };
  }
  // RSI 다이버전스(최근 40봉, 좌우 3봉 기준 스윙): 강세 = 가격 저점은 낮아졌는데 RSI 저점은 높아짐 / 약세 = 그 반대(고점)
  function divergence(cs, rsiArr) {
    const n = cs.length, from = Math.max(3, n - 40), lows = [], highs = [];
    for (let i = from; i < n - 3; i++) {
      let lo = true, hi = true;
      for (let k = i - 3; k <= i + 3; k++) { if (k === i) continue; if (cs[k].l < cs[i].l) lo = false; if (cs[k].h > cs[i].h) hi = false; }
      if (lo && rsiArr[i] != null) lows.push(i); if (hi && rsiArr[i] != null) highs.push(i);
    }
    const bull = lows.length >= 2 && (() => { const a = lows[lows.length - 2], b = lows[lows.length - 1]; return cs[b].l < cs[a].l && rsiArr[b] > rsiArr[a] + 1 && n - 1 - b <= 12; })();
    const bear = highs.length >= 2 && (() => { const a = highs[highs.length - 2], b = highs[highs.length - 1]; return cs[b].h > cs[a].h && rsiArr[b] < rsiArr[a] - 1 && n - 1 - b <= 12; })();
    return { bull, bear };
  }
  // 강한 신호 확인(기본 점수 4 이상일 때 추가로 5가지를 더 봄 → 3가지 이상이면 '강한 신호')
  function strong(cs, a, hi, lv, rsiArr) {
    const A = a.atr, p = a.price, last3 = cs.slice(-3), avg = cs.slice(-23, -3).reduce((s, k) => s + k.v, 0) / 20;
    const dv = divergence(cs, rsiArr);
    const buy = [
      { name: '상위 봉도 반등 쪽(상위 봉 반등 점수 3 이상)', ok: !!(hi && !hi.error && hi.upScore >= 3) },
      { name: '지지 근처(지지 가격 위 1 ATR 안)', ok: !!(lv && lv.sup[0] && p - lv.sup[0].p <= A) },
      { name: '그날 평균 거래가격(VWAP) 위', ok: a.vwapGap != null && a.vwapGap > 0 },
      { name: '최근 3봉 안에 거래량 1.5배 이상 양봉', ok: avg > 0 && last3.some((k) => k.v >= avg * 1.5 && k.c > k.o) },
      { name: 'RSI 강세 다이버전스(가격 저점↓·RSI 저점↑)', ok: dv.bull },
    ];
    const sell = [
      { name: '상위 봉도 하락 전환 쪽(상위 봉 하락 전환 점수 3 이상)', ok: !!(hi && !hi.error && hi.dnScore >= 3) },
      { name: '저항 근처(저항 가격 아래 1 ATR 안)', ok: !!(lv && lv.res[0] && lv.res[0].p - p <= A) },
      { name: '그날 평균 거래가격(VWAP) 아래', ok: a.vwapGap != null && a.vwapGap < 0 },
      { name: '최근 3봉 안에 거래량 1.5배 이상 음봉', ok: avg > 0 && last3.some((k) => k.v >= avg * 1.5 && k.c < k.o) },
      { name: 'RSI 약세 다이버전스(가격 고점↑·RSI 고점↓)', ok: dv.bear },
    ];
    const nb = buy.filter((x) => x.ok).length, ns = sell.filter((x) => x.ok).length;
    return { buy, sell, nb, ns, strongBuy: a.upScore >= 4 && nb >= 3, strongSell: a.dnScore >= 4 && ns >= 3 };
  }
  // 주식 분할(예: 10:1) 맞추기: 봉 기록에 분할 전 가격이 남아 있으면 변동성·매물대가 틀어짐.
  // 직전 종가→이번 시가, 또는 한 봉 안의 시가→종가가 1.85배 넘게 바뀌고 그 비율이 흔한 분할 비율에 가까우면 그 앞 봉들을 같은 비율로 맞춘다.
  const SPLIT_N = [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50, 100];
  // 알려진 분할(봉 하나 안에서 분할과 큰 등락이 겹치면 비율이 헷갈려서 정답을 적어 둠). at = 분할 적용 시각(UTC)
  const KNOWN_SPLITS = { SNDK: [{ at: Date.UTC(2026, 10, 19, 21, 1), n: 8 }] }; // 샌디스크 8:1, 2026-11-19 미국 장 마감 뒤
  function fixSplits(cs, sym) {
    if (!cs || cs.length < 3) return cs;
    const out = cs.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));
    let fixed = 0;
    for (let i = out.length - 1; i >= 1; i--) {
      const k = out[i];
      let r = out[i - 1].c / k.o, within = false;
      if (!(r > 1.85 || r < 0.54)) { r = k.o / k.c; within = true; if (!(r > 1.85 || r < 0.54)) continue; }
      const big = r > 1 ? r : 1 / r, kn = (KNOWN_SPLITS[String(sym || '').toUpperCase()] || []).find((x) => Math.abs(k.t - x.at) <= 3 * 86400e3 && big >= x.n * 0.6 && big <= x.n * 1.6);
      const n = kn ? kn.n : SPLIT_N.reduce((p, q) => (Math.abs(q - big) < Math.abs(p - big) ? q : p));
      if (!kn && Math.abs(n - big) / n > (n <= 3 ? 0.06 : 0.25)) continue; // 분할 비율과 멀면 진짜 급등락으로 보고 그대로 둠(2·3배는 거의 딱 맞을 때만)
      const f = r > 1 ? 1 / n : n;
      for (let j = 0; j < i; j++) { const x = out[j]; x.o *= f; x.h *= f; x.l *= f; x.c *= f; x.v /= f; }
      if (within) { // 분할이 그 봉 안에서 일어남: 분할 전 쪽 값(시가와, 분할 전에 찍힌 고가·저가)만 맞춤
        k.o *= f; const hi = Math.max(k.o, k.c), lo = Math.min(k.o, k.c);
        if (f < 1 && k.h > hi * 1.5) k.h *= f;
        if (f > 1 && k.l < lo / 1.5) k.l *= f;
        k.h = Math.max(k.h, hi); k.l = Math.min(k.l, lo);
      }
      fixed++;
    }
    out.splits = fixed;
    return out;
  }
  return { profile, swings, levels, buyZone, sellZone, divergence, strong, fixSplits };
})();
