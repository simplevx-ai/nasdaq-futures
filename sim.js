/* 🧪 모의 수익 계산기 — 진입가·투자금·배율·익절·손절을 넣으면 이익/손실 금액을 바로 보여 준다.
 * 선물 스캐너·코인 스캐너가 같은 파일을 쓴다(주문 기능 없음, 계산만). 필요한 전역: $, KV, esc, fmt, pct */
const SIM_DEF = { side: 'long', entry: '', margin: 100, lev: 5, tp: '', sl: '', tpPct: 3, slPct: 1.5, fee: 0.05, mmr: 0.5, unit: 'USDT' };

function simCard(sym) {
  return `<div class="card" style="margin-top:0" id="simCard"><h2>🧪 모의 수익 계산기 <span class="muted">${sym ? '(' + esc(sym) + ')' : ''}</span></h2>
    <div class="calcintro">💡 <b>들어갈 가격·넣을 돈·배율</b>과 <b>익절가·손절가</b>를 넣으면, 맞았을 때 <b>얼마 벌고</b> 틀렸을 때 <b>얼마 잃는지</b> 바로 보여 줍니다. 익절·손절은 가격 대신 %로 넣어도 됩니다.</div>
    <div class="seg" style="margin-top:8px"><label><input type="radio" name="sside" value="long"><span>📈 롱 (오르면 이익)</span></label><label><input type="radio" name="sside" value="short"><span>📉 숏 (내리면 이익)</span></label></div>
    <div class="calcgrid">
      <div><label for="s_entry">① 진입가</label><input id="s_entry" type="number" inputmode="decimal"><div class="hint" id="s_entryHint">들어갈 가격</div></div>
      <div><label for="s_margin">② 넣을 돈 (증거금, USDT)</label><input id="s_margin" type="number" inputmode="decimal"><div class="hint">이 거래에 실제로 거는 내 돈</div></div>
      <div><label for="s_lev">③ 배율 (레버리지)</label><input id="s_lev" type="number" inputmode="decimal"><div class="sim-chips" data-for="s_lev">${[1, 2, 3, 5, 10, 20].map((x) => `<button type="button" class="chip" data-v="${x}">${x}배</button>`).join('')}</div></div>
      <div><label for="s_fee">④ 수수료 (한 번, %)</label><input id="s_fee" type="number" inputmode="decimal" step="0.01"><div class="hint">시장가 보통 0.05% · 들어갈 때·나올 때 두 번</div></div>
      <div><label for="s_tp">⑤ 익절가</label><input id="s_tp" type="number" inputmode="decimal"><div class="sim-chips" data-for="tp">${[1, 2, 3, 5, 10].map((x) => `<button type="button" class="chip" data-v="${x}">+${x}%</button>`).join('')}</div><div class="hint" id="s_tpHint"></div></div>
      <div><label for="s_sl">⑥ 손절가</label><input id="s_sl" type="number" inputmode="decimal"><div class="sim-chips" data-for="sl">${[0.5, 1, 1.5, 2, 3].map((x) => `<button type="button" class="chip" data-v="${x}">-${x}%</button>`).join('')}</div><div class="hint" id="s_slHint"></div></div></div>
    <div id="simOut" style="margin-top:10px"></div>
    <div class="muted" style="font-size:12px;margin-top:6px">모의 계산입니다(주문 없음). 청산가는 격리 증거금·유지증거금률 0.5% 가정 대략값이고, 펀딩비·미끄러짐은 빠져 있습니다. 실제 주문 전 거래소 화면으로 확인하세요.</div></div>`;
}

async function simBind(prefill) {
  const st = Object.assign({}, SIM_DEF, await KV.get('sim', {}));
  if (prefill && prefill.entry) { st.entry = prefill.entry; if (prefill.stop) st.sl = prefill.stop; if (prefill.target) st.tp = prefill.target; }
  const el = (id) => document.getElementById(id);
  if (!el('simCard')) return;
  const put = (id, v) => { el(id).value = v === '' || v == null ? '' : v; };
  put('s_entry', st.entry); put('s_margin', st.margin); put('s_lev', st.lev); put('s_fee', st.fee); put('s_tp', st.tp); put('s_sl', st.sl);
  document.querySelector(`[name=sside][value=${st.side === 'short' ? 'short' : 'long'}]`).checked = true;
  const num = (id) => parseFloat(el(id).value);
  const side = () => document.querySelector('[name=sside]:checked').value;
  // % 칩: 진입가 기준으로 익절·손절 가격을 채움(롱/숏 방향 맞춤)
  document.querySelectorAll('#simCard .sim-chips').forEach((box) => box.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const v = parseFloat(b.dataset.v), f = box.dataset.for, en = num('s_entry'), lg = side() === 'long';
    if (f === 's_lev') { el('s_lev').value = v; }
    else { if (!(en > 0)) { el('s_entry').focus(); return; } const up = f === 'tp' ? lg : !lg; el(f === 'tp' ? 's_tp' : 's_sl').value = +fmt(en * (1 + (up ? 1 : -1) * v / 100)); }
    run();
  }));
  const run = async () => {
    const sd = side(), lg = sd === 'long', entry = num('s_entry'), margin = num('s_margin'), lev = num('s_lev'), fee = (num('s_fee') || 0) / 100, tp = num('s_tp'), sl = num('s_sl');
    await KV.set('sim', { side: sd, entry: el('s_entry').value, margin: el('s_margin').value, lev: el('s_lev').value, fee: el('s_fee').value, tp: el('s_tp').value, sl: el('s_sl').value });
    const out = el('simOut'); if (!out) return;
    const hint = (id, p) => { const h = el(id); if (h) h.textContent = entry > 0 && p > 0 ? `진입가 대비 ${pct((p / entry - 1) * 100)}` : ''; };
    hint('s_tpHint', tp); hint('s_slHint', sl);
    if (!(entry > 0 && margin > 0 && lev > 0)) { out.innerHTML = '<div class="muted">진입가·넣을 돈·배율을 넣으세요.</div>'; return; }
    const size = margin * lev, qty = size / entry, mmr = 0.005;
    const liq = lg ? entry * (1 - 1 / lev + mmr) : entry * (1 + 1 / lev - mmr);
    // 가격 p에서 정리했을 때 손익(수수료 들어갈 때·나올 때 포함)
    const pnl = (p) => (lg ? p - entry : entry - p) * qty - (size + qty * p) * fee;
    const row = (name, p, cls) => {
      if (!(p > 0)) return '';
      const v = pnl(p), r = (v / margin) * 100, mv = ((p / entry) - 1) * 100;
      return `<tr class="${cls || ''}"><th>${name}<div class="muted" style="font-size:11px;font-weight:400">${fmt(p)} (${pct(mv)})</div></th><td class="${v >= 0 ? 'up' : 'down'}"><b>${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT</b><div style="font-size:12px">내 돈 대비 ${pct(r, 1)}</div></td></tr>`;
    };
    const bad = [];
    if (tp > 0 && (lg ? tp <= entry : tp >= entry)) bad.push(lg ? '롱 익절가는 진입가보다 높아야 합니다' : '숏 익절가는 진입가보다 낮아야 합니다');
    if (sl > 0 && (lg ? sl >= entry : sl <= entry)) bad.push(lg ? '롱 손절가는 진입가보다 낮아야 합니다' : '숏 손절가는 진입가보다 높아야 합니다');
    const liqFirst = sl > 0 && (lg ? liq >= sl : liq <= sl);
    const win = tp > 0 ? pnl(tp) : null, loss = sl > 0 ? pnl(sl) : null;
    const rr = win != null && loss != null && loss < 0 ? win / -loss : null;
    const needWin = rr ? (1 / (1 + rr)) * 100 : null; // 본전 승률
    const feeAmt = size * fee * 2;
    const cell = (q) => { const dead = lg ? q <= liq : q >= liq, v = pnl(q); return `<td class="${dead || v < 0 ? 'down' : 'up'}">${dead ? '<b>청산</b>' : (v >= 0 ? '+' : '') + v.toFixed(2)}</td>`; };
    const ladder = [1, 2, 3, 5, 10, 20].map((x) => `<tr><td>${x}%</td>${cell(entry * (1 + x / 100))}${cell(entry * (1 - x / 100))}</tr>`).join('');
    out.innerHTML = `${bad.length ? `<div class="errbox">${bad.map(esc).join('<br>')}</div>` : ''}
      <div class="calcsum">📌 <b>${margin} USDT × ${lev}배 = ${size.toFixed(2)} USDT</b> 어치(약 ${qty >= 1 ? qty.toFixed(3) : qty.toPrecision(4)}개)를 ${lg ? '롱' : '숏'}으로 잡습니다.${win != null ? `<br>✅ 익절 ${fmt(tp)}에 닿으면 <b class="up">+${win.toFixed(2)} USDT</b>` : ''}${loss != null ? `<br>❌ 손절 ${fmt(sl)}에 닿으면 <b class="down">${loss.toFixed(2)} USDT</b>` : ''}${rr ? `<br>⚖️ 손익비 <b>1 : ${rr.toFixed(2)}</b> · 이 손익비면 <b>${needWin.toFixed(0)}%</b> 이상 맞아야 본전` : ''}</div>
      <table class="calctbl"><tbody>
        ${row('✅ 익절', tp, '')}${row('❌ 손절', sl, '')}
        <tr><th>⚠️ 강제 청산가 (대략)</th><td><b>${fmt(liq)}</b> <span class="muted">(진입가 대비 ${pct((liq / entry - 1) * 100)})</span></td></tr>
        <tr><th>수수료 (들어갈 때+나올 때)</th><td>약 ${feeAmt.toFixed(2)} USDT</td></tr>
        <tr><th>1% 움직일 때 손익</th><td>약 ${(size / 100).toFixed(2)} USDT (내 돈의 ${lev}%)</td></tr></tbody></table>
      ${liqFirst ? '<div class="errbox">⚠️ 손절가에 닿기 전에 <b>강제 청산</b>이 먼저 일어납니다. 배율을 낮추거나 손절가를 진입가에 가깝게 하세요.</div>' : sl > 0 ? '<div class="okbox" style="font-weight:500">✅ 손절가가 청산가보다 먼저입니다.</div>' : '<div class="warnlist">손절가를 넣지 않았습니다 — 청산가까지 그대로 잃을 수 있습니다.</div>'}
      <details style="margin-top:8px"><summary><b>가격이 움직이면 (${lg ? '롱' : '숏'}, USDT)</b></summary><div class="tblwrap"><table class="md" style="margin-top:6px"><thead><tr><th>움직임</th><th>오르면</th><th>내리면</th></tr></thead><tbody>${ladder}</tbody></table></div></details>`;
  };
  document.querySelectorAll('#s_entry,#s_margin,#s_lev,#s_fee,#s_tp,#s_sl').forEach((x) => { x.oninput = run; });
  document.querySelectorAll('[name=sside]').forEach((x) => { x.onchange = run; });
  run();
}
