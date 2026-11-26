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
  return { profile, swings, levels };
})();
