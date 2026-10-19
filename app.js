// $PONK Jeet Tracker — live stream page.
// Where trades come from:
//   on Netlify with HELIUS_KEY set: a public Solana websocket says "new transaction on the mint", and
//     /api/tx/<sig> (netlify/functions/tx.mjs) decodes it with the key, which never reaches the browser.
//     Covers every pool (pump.fun curve, PumpSwap, Raydium, Jupiter…).
//   otherwise: PumpPortal websocket (free, pump.fun bonding-curve trades only).
// Options: ?demo=1 (?demo=manual: no automatic trades)  ?mute=1  ?vol=0.5  ?swing=0.5  ?whale=3  ?min=0.005  ?source=pumpportal  ?ws=<wss url>  ?debug=1
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const CFG = {
    mint: params.get('mint') || '4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump',
    ws: 'wss://pumpportal.fun/api/data',
    chainWs: params.get('ws') ? [params.get('ws')] : ['wss://api.mainnet-beta.solana.com'],
    source: params.get('source'),
    minSol: parseFloat(params.get('min') ?? '0.001'), // ignore dust trades below this
    debug: params.has('debug'),
    demo: params.has('demo'),
    mute: params.has('mute'),
    vol: clamp(parseFloat(params.get('vol') ?? '0.5'), 0, 1),
    swingSol: parseFloat(params.get('swing') ?? '0.5'), // sells at or above this get the full swing
    whaleSol: parseFloat(params.get('whale') ?? '3'),   // buys at or above this get the parade
    speedJeetMs: 10 * 60e3,   // sold within 10 min of buying
    botMs: 20e3,              // bought and sold (or sold and bought) within 20 s: a bot, not a person
    repentMs: 24 * 3600e3,    // bought back within 24 h of selling
    idleMs: 6 * 60e3,         // no trades for this long -> interlude scene
    watchdogMs: 15 * 60e3,    // no websocket message for this long -> reconnect
    reloadMs: 6 * 3600e3,     // periodic reload keeps a 24/7 page fresh
  };

  // Wallets that get a 👑 DEV tag in the feed. Add the dev's address here.
  const DEV_WALLETS = [];

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');

  // ---------- fit the 1920x1080 canvas to the window ----------
  function fit() {
    stage.style.setProperty('--k', Math.min(innerWidth / 1920, innerHeight / 1080));
  }
  addEventListener('resize', fit);
  fit();

  // ---------- helpers ----------
  function clamp(n, a, b) { return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : b; }
  const short = (w) => (w && w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w || '????');
  const sol = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n >= 0.01 || n === 0 ? n.toFixed(2) : n.toFixed(3));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const todayKey = () => new Date().toLocaleDateString('en-CA');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  function compact(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  }
  function duration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  $('ca').textContent = CFG.mint;

  // ---------- persistent state (survives refresh, resets daily) ----------
  const STORE = 'ponk:v1';
  const fresh = () => ({
    day: todayKey(), jeets: 0, solJeeted: 0, knights: 0, solBought: 0,
    biggestJeet: null, fastestJeet: null, biggestBuy: null, feed: [], army: 0,
    sells: {},                 // wallet -> sells today (repeat offenders)
    shame: [], fame: [],       // top 5 sellers / buyers today, one line per wallet
    streak: { t: '', n: 0 }, best: { buy: 0, sell: 0 },
    pressure: [],              // last 10 trades: 'b' or 's'
  });
  let state = load();
  const wallets = new Map(loadWallets()); // wallet -> { b: lastBuyTs, s: lastSellTs }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.day === todayKey()) return { ...fresh(), ...s };
    } catch {}
    return fresh();
  }
  function loadWallets() {
    try { return JSON.parse(localStorage.getItem(STORE + ':wallets')) || []; } catch { return []; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(state));
        localStorage.setItem(STORE + ':wallets', JSON.stringify([...wallets]));
      } catch {}
    }, 500);
  }
  function rollDay() {
    if (state.day !== todayKey()) { state = fresh(); render(); save(); }
  }
  function pruneWallets() {
    if (wallets.size < 3000) return;
    const cutoff = Date.now() - CFG.repentMs;
    for (const [w, v] of wallets) if (Math.max(v.b || 0, v.s || 0) < cutoff) wallets.delete(w);
  }

  // ---------- rendering of the static parts ----------
  // numbers roll up to their new value instead of jumping
  const shown = {};
  function setStat(id, value, fmt = String) {
    const el = $(id);
    const from = shown[id] ?? 0;
    shown[id] = value;
    if (from === value) { el.textContent = fmt(value); return; }
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    const t0 = performance.now(), dur = 700;
    (function step(now) {
      if (shown[id] !== value) return; // a newer update took over
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      el.textContent = fmt(k < 1 ? from + (value - from) * e : value);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  const int = (n) => String(Math.round(n));
  // Market cap: DexScreener's figure (USD) when we have it; otherwise estimated from the last trade's price.
  let solUsd = 0;
  let lastMcapSol = 0;
  let mcapUsd = 0;
  if (!CFG.demo) try { mcapUsd = +localStorage.getItem(STORE + ':mcap') || 0; } catch {}
  function renderMcap() {
    const el = $('s-mcap');
    if (mcapUsd) el.textContent = `$${compact(mcapUsd)}`;
    else if (lastMcapSol) el.textContent = solUsd ? `$${compact(lastMcapSol * solUsd)}` : `${compact(lastMcapSol)} SOL`;
  }
  function renderStats() {
    setStat('s-jeets', state.jeets, int);
    setStat('s-soljeet', state.solJeeted, sol);
    setStat('s-knights', state.knights, int);
  }
  // battle meter: share of buy volume vs sell volume over the last 10 minutes
  const recent = [];
  function renderMeter() {
    const cutoff = Date.now() - 10 * 60e3;
    while (recent.length && recent[0].at < cutoff) recent.shift();
    let b = 0, s = 0;
    for (const r of recent) r.buy ? (b += r.sol) : (s += r.sol);
    const pct = b + s ? Math.max(4, Math.min(96, (b / (b + s)) * 100)) : 50;
    $('meter-fill').style.width = pct + '%';
    $('meter-knob').style.left = pct + '%';
  }
  setInterval(renderMeter, 20000);
  function render() {
    renderStats();
    renderMcap();
    renderMeter();
    $('feed').innerHTML = state.feed.slice(0, FEED_MAX).map(feedItem).join('');
    renderPressure();
    renderArmy();
    renderMarquee();
  }
  const FEED_MAX = 5;
  function feedItem(e) {
    const sell = e.type === 'sell';
    const label = e.label || (sell ? 'GOT PONKED' : 'JOINED THE ARMY');
    const cls = [sell ? 'sell' : 'buy', e.bot && 'bot', e.dev && 'dev', e.tier === 'whale' && 'whale'].filter(Boolean).join(' ');
    const badge = e.badge ? `<span class="badge ${e.badgeCls || ''}">${esc(e.badge)}</span>` : '';
    return `<li class="${cls}">
      <img src="assets/${sell ? 'jeet-bear.png' : 'ponk-avatar.png'}" alt="">
      <div class="t"><code>${esc(short(e.w))}</code>${badge}<small>${esc(label)}</small></div>
      <div class="amt">${sell ? '-' : '+'}${sol(e.sol)} SOL</div></li>`;
  }
  function pushFeed(e) {
    state.feed.unshift(e);
    state.feed.length = Math.min(state.feed.length, FEED_MAX);
    const ol = $('feed');
    ol.insertAdjacentHTML('afterbegin', feedItem(e));
    while (ol.children.length > FEED_MAX) ol.lastElementChild.remove();
    if (e.tier === 'whale') pinWhale(e);
  }
  // a whale buy stays pinned, glowing, at the top of the feed for 30 s
  let pinTimer = 0;
  function pinWhale(e) {
    $('feed-pin').innerHTML = feedItem({ ...e, badge: 'WHALE', badgeCls: 'new' });
    $('feed-pin').parentElement.classList.add('pinned');
    clearTimeout(pinTimer);
    pinTimer = setTimeout(() => { $('feed-pin').innerHTML = ''; $('feed-pin').parentElement.classList.remove('pinned'); }, 30000);
  }

  // ---------- hall of shame / fame, streaks, pressure ----------
  function bump(list, entry) { // keep each wallet once, best amount, top 5
    const i = list.findIndex((x) => x.w === entry.w);
    if (i >= 0) { if (list[i].sol >= entry.sol) return; list.splice(i, 1); }
    list.push(entry);
    list.sort((a, b) => b.sol - a.sol);
    list.length = Math.min(list.length, 5);
  }
  function boardRow(x, n, sell) {
    const sub = sell
      ? (x.held != null && x.held < 864e5 ? `held ${duration(x.held)}` : x.full ? 'sold everything' : 'paper hands')
      : (n === 0 ? 'royal knight' : 'knight');
    return `<li style="--n:${n}"><img src="assets/${sell ? 'jeet-bear.png' : 'ponk-avatar.png'}" alt="">
      <div class="t"><code>${esc(short(x.w))}</code><small>${n === 0 && sell ? 'KING JEET · ' : ''}${esc(sub)}</small></div>
      <div class="amt">${sell ? '-' : '+'}${sol(x.sol)}</div></li>`;
  }
  function renderBoards() {
    $('shame').innerHTML = state.shame.length ? state.shame.map((x, n) => boardRow(x, n, true)).join('')
      : '<li class="empty">No jeets yet today. Suspicious.</li>';
    $('fame').innerHTML = state.fame.length ? state.fame.map((x, n) => boardRow(x, n, false)).join('')
      : '<li class="empty">The army awaits its first knight.</li>';
    const st = state.streak, kind = st.t === 'buy' ? 'buy' : 'sell';
    $('streaks').innerHTML = `
      <div class="streak-now ${kind}"><b>${st.n || 0}</b><span>${st.t ? (st.t === 'buy' ? 'BUYS' : 'SELLS') + '<br>IN A ROW' + (st.n >= 5 ? ' 🔥' : '') : 'WAITING FOR<br>THE FIRST TRADE'}</span></div>
      <div class="streak-grid">
        <div><b style="color:var(--green)">${state.best.buy}</b><span>Best buy streak</span></div>
        <div><b style="color:#ff6b5e">${state.best.sell}</b><span>Best sell streak</span></div>
        <div><b style="color:var(--green)">${sol(state.solBought)}</b><span>SOL bought</span></div>
        <div><b style="color:#ff6b5e">${sol(state.solJeeted)}</b><span>SOL jeeted</span></div>
      </div>`;
  }
  function renderPressure() {
    $('chips').innerHTML = state.pressure.map((t) => `<i class="${t}">${t === 'b' ? '▲' : '▼'}</i>`).join('');
  }

  // tabs rotate: LIVE most of the time, the boards in between
  const TABS = [
    { id: 'live', ms: 20000 },
    { id: 'shame', ms: 9000 },
    { id: 'fame', ms: 9000 },
    { id: 'streaks', ms: 8000, has: () => state.jeets + state.knights > 0 },
  ];
  let tabIdx = 0;
  function showTab(i) {
    tabIdx = i;
    const t = TABS[i];
    if (t.id !== 'live') renderBoards();
    document.querySelectorAll('#tabs span').forEach((el) => {
      el.classList.remove('on');
      if (el.dataset.tab === t.id) { el.style.setProperty('--ms', t.ms + 'ms'); void el.offsetWidth; el.classList.add('on'); }
    });
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.dataset.view === t.id));
    setTimeout(() => {
      let n = (tabIdx + 1) % TABS.length;
      while (TABS[n].has && !TABS[n].has()) n = (n + 1) % TABS.length;
      showTab(n);
    }, t.ms);
  }

  // the Ponkeror reacts to what happens in the feed (at most one line every 6 s)
  let quipAt = 0;
  function quip(text) {
    const now = Date.now();
    if (now - quipAt < 6000) return;
    quipAt = now;
    say(text);
  }

  // frenzy: 5+ trades inside 30 s lights the panel up
  const arrivals = [];
  let frenzyTimer = 0;
  function checkFrenzy(now) {
    arrivals.push(now);
    while (arrivals.length && now - arrivals[0] > 30000) arrivals.shift();
    if (arrivals.length < 5) return;
    const panel = $('feed-panel');
    if (!panel.classList.contains('frenzy')) quip('FRENZY! Hold the line, knights!');
    panel.classList.add('frenzy');
    clearTimeout(frenzyTimer);
    frenzyTimer = setTimeout(() => panel.classList.remove('frenzy'), 20000);
  }

  // a comet flies from where the action happened to its line in the feed
  function cometToFeed(e) {
    const k = parseFloat(getComputedStyle(stage).getPropertyValue('--k')) || 1;
    const s = stage.getBoundingClientRect();
    const toStage = (r) => ({ x: (r.left - s.left + 40) / k, y: (r.top - s.top + r.height / 2) / k });
    const liveOn = TABS[tabIdx].id === 'live';
    const target = liveOn && $('feed').firstElementChild ? $('feed').firstElementChild : $('tabs');
    const to = toStage(target.getBoundingClientRect());
    let from;
    if (e.type === 'sell') from = { x: 860, y: 320 };
    else {
      const last = $('army').lastElementChild;
      from = last ? toStage(last.getBoundingClientRect()) : { x: 120, y: 990 };
    }
    FX.comet(from.x, from.y, to.x, to.y, e.type === 'sell' ? '#ff6b5e' : '#6fd83a');
  }
  const ARMY_MAX = 34;
  const soldier = (i) => `<img src="assets/ponk-avatar.png" alt="" style="--i:${i}">`;
  function renderArmy() {
    const row = $('army');
    const n = Math.min(state.army, ARMY_MAX);
    row.innerHTML = Array.from({ length: n }, (_, i) => soldier(i)).join('') +
      (state.army > ARMY_MAX ? `<span class="more">+${state.army - ARMY_MAX}</span>` : '');
  }
  function growArmy() {
    state.army++;
    const row = $('army');
    if (state.army <= ARMY_MAX) row.insertAdjacentHTML('beforeend', soldier(state.army - 1));
    else renderArmy();
    const last = row.lastElementChild;
    if (last) {
      // burst of green where the new knight landed (stage coordinates)
      const k = parseFloat(getComputedStyle(stage).getPropertyValue('--k')) || 1;
      const r = last.getBoundingClientRect(), s = stage.getBoundingClientRect();
      FX.hop((r.left - s.left + r.width / 2) / k, (r.top - s.top) / k);
    }
  }
  function renderMarquee() {
    const bits = [
      '<b>PONK ALL JEETS</b> — buy and get knighted, sell and get PONKED, live',
      state.biggestJeet && `Biggest jeet today: <b>${esc(short(state.biggestJeet.w))}</b> dumped ${sol(state.biggestJeet.sol)} SOL`,
      state.fastestJeet && `Fastest jeet: <b>${esc(short(state.fastestJeet.w))}</b> held for ${duration(state.fastestJeet.ms)}`,
      state.biggestBuy && `Biggest knight today: <b>${esc(short(state.biggestBuy.w))}</b> bought ${sol(state.biggestBuy.sol)} SOL`,
      'Nobody will DM you the real CA. Check it right here.',
      'Diamond hands get knighted. Paper hands get the bat.',
    ].filter(Boolean);
    const el = $('marquee');
    const html = bits.join('&nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;');
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // ---------- speech bubble ----------
  const LINES = [
    'PONK ALL JEETS.',
    'Sell if you want. The bat remembers.',
    'Every chart is a comeback arc until it isn\'t.',
    'Sunday night ritual: close the app. Reopen it 4 minutes later.',
    'Paper hands get the bat. Diamond hands get knighted.',
    'Buy to be knighted. Sell to be PONKED.',
    'I aped because the dog had a cool hat. Now I am emperor.',
    'Bears fear the bat.',
    () => (state.jeets ? `${state.jeets} jeets ponked today. The bat is warm.` : 'No jeets yet today. Suspicious.'),
    () => (state.knights ? `${state.knights} new knights today. The army grows.` : 'The army awaits its first knight.'),
  ];
  let lineIdx = 0;
  function say(text) {
    const b = $('bubble');
    b.classList.add('out');
    setTimeout(() => {
      let n = 0; // words stay whole, each character pops in
      $('bubble-text').innerHTML = text.split(' ').map((word) => `<span class="w">${
        [...word].map((c) => `<span class="c" style="--n:${n++}">${esc(c)}</span>`).join('')}</span>`).join(' ');
      b.classList.remove('out');
    }, 450);
  }
  // the crown catches the light now and then
  setInterval(() => { if (!busy) { FX.sparkle(848, 200, 46, 45); setTimeout(() => FX.sparkle(905, 245, 26, 35), 220); } }, 21000);
  setInterval(() => {
    if (busy) return;
    const l = LINES[lineIdx++ % LINES.length];
    say(typeof l === 'function' ? l() : l);
  }, 18000);

  // ---------- sound (synthesized, no files) ----------
  let ac = null;
  function audio() {
    if (CFG.mute) return null;
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    }
    if (ac.state === 'suspended') {
      ac.resume().catch(() => {});
      $('sound').hidden = false;
    }
    return ac.state === 'running' ? ac : null;
  }
  $('sound').addEventListener('click', () => { ac?.resume().then(() => { $('sound').hidden = true; }); });
  function ponkSound(power = 1) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const out = a.createGain(); out.gain.value = CFG.vol; out.connect(a.destination);
    // body: pitch-dropping thump
    const o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220 - power * 40, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18 + power * 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + power * 0.25);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.6 + power * 0.3);
    // knock: short filtered noise (the bat)
    const n = a.createBufferSource(), buf = a.createBuffer(1, a.sampleRate * 0.08, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    n.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
    const ng = a.createGain(); ng.gain.value = 0.6 + power * 0.3;
    n.connect(f).connect(ng).connect(out); n.start(t);
  }
  function knightSound(big = false) {
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 987.77];
    notes.forEach((hz, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'triangle'; o.frequency.value = hz;
      const s = t + i * (big ? 0.12 : 0.08);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.25 * CFG.vol, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + (big ? 0.6 : 0.3));
      o.connect(g).connect(a.destination); o.start(s); o.stop(s + 0.7);
    });
  }

  function dingSound() { // the jeet disappears into the sky
    const a = audio(); if (!a) return;
    const t = a.currentTime;
    [1760, 2637].forEach((hz, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.12 * CFG.vol, t + i * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.05 + 0.5);
      o.connect(g).connect(a.destination); o.start(t + i * 0.05); o.stop(t + 0.6);
    });
  }

  // ---------- trade intake ----------
  const seen = new Set();
  const queue = [];
  let lastTradeAt = Date.now();

  function onTrade(tr) {
    if (!tr || (tr.txType !== 'buy' && tr.txType !== 'sell')) return;
    if (tr.mint && tr.mint !== CFG.mint) return;
    if ((+tr.solAmount || 0) < CFG.minSol) return;
    if (tr.signature) {
      if (seen.has(tr.signature)) return;
      seen.add(tr.signature);
      if (seen.size > 1000) seen.delete(seen.values().next().value);
    }
    rollDay();
    lastTradeAt = Date.now();
    if (!CFG.demo) setStatus('live', 'LIVE ON SOLANA'); // a real trade made it through, whichever source carried it
    DIAG.trades++; DIAG.lastTrade = lastTradeAt;
    if (tr.marketCapSol) { lastMcapSol = +tr.marketCapSol; renderMcap(); }
    if (!CFG.demo) mcapFromTrade(tr);
    soonMcap();

    const now = Date.now();
    const w = tr.traderPublicKey;
    const amount = +tr.solAmount || 0;
    const mem = wallets.get(w) || {};
    const e = { type: tr.txType, w, sol: amount, at: now };
    e.dev = DEV_WALLETS.includes(w);
    // a buy and a sell from the same wallet seconds apart is a bot (sandwich/MEV), not a person
    e.bot = !e.dev && (e.type === 'sell' ? mem.b && now - mem.b <= CFG.botMs : mem.s && now - mem.s <= CFG.botMs);

    if (e.bot) {
      e.label = 'NOT EVEN WORTH THE BAT';
      e.badge = 'BOT'; e.badgeCls = 'bot';
      mem[e.type === 'sell' ? 's' : 'b'] = now;
      wallets.set(w, mem);
      pushFeed(e);
      if (Math.random() < 0.3) quip('A bot. Not even worth the bat.');
      save();
      return; // bots don't count, don't get ponked, don't join the army
    }

    if (e.type === 'sell') {
      const fullExit = tr.newTokenBalance !== undefined && +tr.newTokenBalance < 1;
      const held = mem.b ? now - mem.b : Infinity;
      const count = (state.sells[w] || 0) + 1;
      state.sells[w] = count;
      e.tier = fullExit ? 'mega' : amount >= CFG.swingSol ? 'swing' : 'tap';
      if (e.dev) e.label = 'THE DEV SOLD';
      else if (mem.rp) e.label = 'RE-JEET · REPENTED, THEN JEETED AGAIN';
      else if (held <= CFG.speedJeetMs) e.label = `SPEED JEET · held ${duration(held)}`;
      else if (fullExit) e.label = 'SOLD EVERYTHING';
      else e.label = 'PAPER HANDS';
      if (e.dev) { e.badge = '👑 DEV'; e.badgeCls = 'dev'; }
      else if (mem.rp) { e.badge = 'RE-JEET'; e.badgeCls = 're'; }
      else if (count >= 2) { e.badge = `JEET x${count}`; e.badgeCls = 'x'; }
      if (count === 3) quip(`${short(w)} again?! Third time today.`);
      state.jeets++;
      state.solJeeted += amount;
      if (!state.biggestJeet || amount > state.biggestJeet.sol) state.biggestJeet = { w, sol: amount };
      if (held <= CFG.speedJeetMs && (!state.fastestJeet || held < state.fastestJeet.ms)) state.fastestJeet = { w, ms: held };
      bump(state.shame, { w, sol: amount, held: Number.isFinite(held) ? held : null, full: fullExit });
      if (Object.keys(state.sells).length > 2000) state.sells = {};
      mem.s = now;
      mem.rp = false;
    } else {
      const repented = mem.s && now - mem.s <= CFG.repentMs;
      const first = !mem.b && !mem.s;
      e.tier = amount >= CFG.whaleSol ? 'whale' : 'knight';
      if (e.dev) e.label = 'THE DEV IS BUYING';
      else if (repented) e.label = 'JEET REPENTED. FORGIVEN… FOR NOW';
      else if (amount >= CFG.whaleSol) e.label = 'KNIGHTED BY THE EMPEROR';
      else if (first) e.label = 'NEW KNIGHT';
      else e.label = 'RETURNING KNIGHT';
      if (e.dev) { e.badge = '👑 DEV'; e.badgeCls = 'dev'; quip('The dev is buying. Respect.'); }
      else if (first) { e.badge = 'NEW'; e.badgeCls = 'new'; }
      state.knights++;
      state.solBought += amount;
      if (!state.biggestBuy || amount > state.biggestBuy.sol) state.biggestBuy = { w, sol: amount };
      bump(state.fame, { w, sol: amount });
      mem.b = now;
      if (repented) mem.rp = true;
    }
    wallets.set(w, mem);
    pruneWallets();

    // streaks and pressure
    const st = state.streak;
    if (st.t === e.type) st.n++; else { st.t = e.type; st.n = 1; }
    if (st.n > state.best[e.type]) state.best[e.type] = st.n;
    if (e.type === 'sell' && st.n === 3) quip('3 jeets in a row… the bat is thirsty.');
    if (e.type === 'sell' && st.n === 5) quip('5 JEETS IN A ROW. I see you.');
    if (e.type === 'buy' && st.n === 5) quip('5 knights in a row. The kingdom grows.');
    if (e.type === 'buy' && st.n === 10) quip('10 KNIGHTS! THE ARMY MARCHES!');
    state.pressure.push(e.type === 'buy' ? 'b' : 's');
    if (state.pressure.length > 10) state.pressure.shift();

    pushFeed(e);
    renderStats();
    renderPressure();
    if (TABS[tabIdx].id !== 'live') renderBoards();
    checkFrenzy(now);
    recent.push({ at: now, buy: e.type === 'buy', sol: amount });
    renderMeter();
    renderMarquee();
    save();

    if (e.tier === 'knight') { growArmy(); knightSound(false); cometToFeed(e); return; } // buys never block the queue
    if (e.tier === 'whale') growArmy();
    cometToFeed(e);
    queue.push(e);
    if (queue.length > 40) {
      const i = queue.findIndex((q) => q.tier === 'tap');
      queue.splice(i < 0 ? 0 : i, 1);
    }
    pump();
  }

  // ---------- animation queue ----------
  let busy = false;
  let combo = 0, comboAt = 0;

  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const e = queue.shift();
      const speed = queue.length > 6 ? 0.45 : queue.length > 2 ? 0.7 : 1;
      if (e.tier === 'mega' && queue.length < 8) await megaScene(e);
      else if (e.tier === 'whale' && queue.length < 8) await whaleScene(e);
      else if (e.type === 'sell') await ponk(e, speed);
      else knightSound(true);
    }
    busy = false;
  }

  function shake(big) {
    stage.classList.remove('shake', 'shake-big'); void stage.offsetWidth;
    stage.classList.add(big ? 'shake-big' : 'shake');
  }

  // The background render is 2000x1105, fitted to cover the 1920x1080 stage (see .world in style.css).
  const FIT = { k: 0.9774, x: -17.4 };
  const toStage = (x, y) => ({ x: x * FIT.k + FIT.x, y: y * FIT.k });

  // The Ponkeror's forearm + bat is its own sprite, pivoting at the elbow (numbers from tools/cut-arm.py).
  const ELBOW = toStage(600, 628);
  const REACH = 713 * FIT.k;              // elbow to the end of the bat
  const REST = -110.4;                    // direction of the bat at rest, in degrees
  const WINDUP = -18, STRIKE = 92, FOLLOW = 112; // arm rotation for each beat of the swing
  const polar = (deg, r) => ({ x: ELBOW.x + r * Math.cos(deg * Math.PI / 180), y: ELBOW.y + r * Math.sin(deg * Math.PI / 180) });
  const HIT = polar(REST + STRIKE, REACH * 0.84); // where the barrel meets the jeet
  const SKY = () => ({ x: 1500 + Math.random() * 300, y: 90 + Math.random() * 90 }); // where jeets vanish

  const arm = $('arm');
  const armImg = arm.querySelector('img');
  function armAngle() {
    const m = new DOMMatrix(getComputedStyle(armImg).transform);
    return Math.atan2(m.b, m.a) * 180 / Math.PI;
  }
  function armSet(frames, opts) {
    const from = armAngle();
    armImg.getAnimations().forEach((an) => an.cancel());
    return armImg.animate([{ transform: `rotate(${from}deg)` }, ...frames], { fill: 'forwards', ...opts });
  }
  function windUp(speed) {
    armSet([{ transform: `rotate(${WINDUP}deg)` }], { duration: 320 * speed, easing: 'cubic-bezier(.2,.8,.3,1)' });
  }
  // swing; resolves on the frame the bat lands. Then: hit-stop, follow-through, settle with a little overshoot.
  async function strike(speed) {
    const swingMs = 120, hold = 90, follow = 160, settle = 650 * Math.max(speed, 0.6);
    const start = armAngle();
    const swing = armSet([{ transform: `rotate(${STRIKE}deg)` }], { duration: swingMs, easing: 'cubic-bezier(.55,0,.9,.45)' });
    // motion blur: two fading copies trail the arm through the swing
    [16, 32].forEach((delay, i) => {
      const g = armImg.cloneNode();
      g.className = 'ghost';
      g.style.opacity = i ? 0.16 : 0.32;
      arm.insertBefore(g, armImg);
      g.animate([{ transform: `rotate(${start}deg)` }, { transform: `rotate(${STRIKE}deg)` }],
        { duration: swingMs, delay, easing: 'cubic-bezier(.55,0,.9,.45)', fill: 'both' })
        .finished.then(() => g.animate([{ opacity: g.style.opacity }, { opacity: 0 }], { duration: 120, fill: 'forwards' }).finished)
        .then(() => g.remove());
    });
    await swing.finished;
    const T = follow + settle;
    armImg.getAnimations().forEach((an) => an.cancel());
    armImg.animate([
      { transform: `rotate(${STRIKE}deg)`, easing: 'cubic-bezier(.2,.8,.3,1)' },
      { transform: `rotate(${FOLLOW}deg)`, offset: follow / T, easing: 'cubic-bezier(.3,1.35,.5,1)' },
      { transform: 'rotate(0deg)' },
    ], { duration: T, delay: hold, fill: 'both' });
  }

  // the swing's motion streak follows the barrel's arc
  const ARC_R = REACH * 0.9;
  const arcPt = (deg) => polar(deg, ARC_R);
  const A0 = arcPt(REST + WINDUP), A1 = arcPt(REST + STRIKE);
  const ARC = `M${A0.x} ${A0.y} A${ARC_R} ${ARC_R} 0 0 1 ${A1.x} ${A1.y}`;
  const ARC_LEN = ARC_R * ((STRIKE - WINDUP) * Math.PI / 180);
  function swoosh(layer, big) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'swoosh');
    svg.setAttribute('viewBox', '0 0 1920 1080');
    svg.innerHTML = `<path d="${ARC}" stroke="#fff8ec" stroke-width="${big ? 64 : 44}" opacity=".85"/>
      <path d="${ARC}" stroke="#ffc21a" stroke-width="${big ? 22 : 14}"/>`;
    layer.appendChild(svg);
    const paths = [...svg.querySelectorAll('path')];
    paths.forEach((p) => {
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'round');
      p.style.strokeDasharray = ARC_LEN;
    });
    return Promise.all(paths.map((p) => p.animate(
      [{ strokeDashoffset: ARC_LEN }, { strokeDashoffset: 0 }],
      { duration: 120, easing: 'cubic-bezier(.55,0,.9,.45)', fill: 'forwards' }).finished))
      .then(() => {
        // the streak wipes away behind the swing
        paths.forEach((p) => p.animate([{ strokeDashoffset: 0, opacity: 1 }, { strokeDashoffset: -ARC_LEN, opacity: 0.2 }],
          { duration: 320, easing: 'cubic-bezier(.2,.6,.3,1)', fill: 'forwards' }));
        setTimeout(() => svg.remove(), 360);
      });
  }

  function place(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; return el; }
  function tmp(layer, cls, x, y, ms) {
    const d = place(document.createElement('div'), x, y);
    d.className = cls; layer.appendChild(d);
    setTimeout(() => d.remove(), ms);
    return d;
  }
  function stageFlash(cls, ms) {
    stage.classList.add(cls);
    setTimeout(() => stage.classList.remove(cls), ms);
  }
  function bgPunch() {
    const bg = $('bg');
    bg.classList.remove('punch'); void bg.offsetWidth; bg.classList.add('punch');
  }

  async function ponk(e, speed) {
    const layer = $('hits');
    const big = e.tier !== 'tap';
    const el = document.createElement('div');
    el.className = 'jeet';
    el.innerHTML = `<img src="assets/jeet-bear.png" alt=""><div class="tag">${esc(short(e.w))} · ${sol(e.sol)} SOL</div>`;
    layer.appendChild(el);

    // 1. the jeet scurries in, bobbing
    const from = { x: 2000, y: 760 + Math.random() * 120 };
    const at = { x: HIT.x - 85, y: HIT.y - 75 };
    const lerp = (k) => ({ x: from.x + (at.x - from.x) * k, y: from.y + (at.y - from.y) * k });
    const frames = [0, 0.25, 0.5, 0.75, 1].map((k, i) => {
      const p = lerp(k);
      return { transform: `translate(${p.x}px,${p.y - (i % 2 ? 26 : 0)}px) rotate(${i === 4 || i % 2 ? -8 : 8}deg)` };
    });
    const approach = el.animate(frames, { duration: 800 * speed, easing: 'cubic-bezier(.4,.25,.6,1)', fill: 'forwards' });

    // 2. he winds up, then swings so the bat lands exactly as the jeet arrives
    const dur = 800 * speed;
    setTimeout(() => windUp(speed), dur * 0.35);
    const swing = sleep(Math.max(0, dur - 120)).then(() => Promise.all([swoosh(layer, big), strike(speed)]));
    await Promise.all([approach.finished, swing]);

    // 3. impact: hit-stop, squash, sparks, speed lines, PONK
    ponkSound(big ? 1 : 0.4);
    shake(big);
    bgPunch();
    stageFlash(big ? 'impact-big' : 'impact', big ? 70 : 50);
    if (big) setTimeout(() => stageFlash('impact', 60), 70);
    tmp(layer, 'lines', HIT.x, HIT.y, 460);
    FX.ring(HIT.x, HIT.y, '#fff8ec', big ? 320 : 220);
    FX.sparks(HIT.x, HIT.y, big ? 46 : 24, big ? 1.2 : 0.9);
    FX.fur(HIT.x + 30, HIT.y, big ? 18 : 8);
    if (big) FX.stars(HIT.x, HIT.y - 40, 7);
    burst(layer, HIT.x, HIT.y - 20, big ? 'PONK!!' : 'PONK!', big ? 1 : 0.75);
    await el.animate([
      { transform: `translate(${at.x}px,${at.y}px) rotate(-8deg) scale(1)` },
      { transform: `translate(${at.x + 20}px,${at.y + 20}px) rotate(-14deg) scale(1.3,.68)` },
    ], { duration: big ? 110 : 80, fill: 'forwards' }).finished;

    const now = Date.now();
    combo = now - comboAt < 6000 ? combo + 1 : 1;
    comboAt = now;
    if (combo >= 3) {
      const c = tmp(layer, 'combo', HIT.x, HIT.y - 260, 1300);
      c.textContent = `COMBO x${combo}`;
      FX.sparkle(HIT.x - 150, HIT.y - 250, 34, 30);
    }
    if (e.label && e.label.startsWith('SPEED')) say(`${short(e.w)} held for ${e.label.split('held ')[1]}. PONK.`);

    // 4. off to orbit, with a motion trail, and a twinkle where it disappears
    const sky = SKY();
    const end = { x: sky.x - 85, y: sky.y - 75 };
    const spin = big ? 1440 : 900;
    const flight = [
      { transform: `translate(${at.x + 20}px,${at.y + 20}px) rotate(-14deg) scale(1.3,.68)` },
      { transform: `translate(${at.x + 120}px,${at.y - 140}px) rotate(${spin * 0.25}deg) scale(.95,1.1)`, offset: 0.18 },
      { transform: `translate(${(at.x + end.x) / 2 + 120}px,${Math.min(at.y, end.y) - 200}px) rotate(${spin * 0.65}deg) scale(.45)`, offset: 0.6 },
      { transform: `translate(${end.x}px,${end.y}px) rotate(${spin}deg) scale(.04)` },
    ];
    const flightMs = (big ? 1200 : 950) * speed;
    const ghosts = [1, 2].map((i) => {
      const g = el.cloneNode(true);
      g.classList.add('ghost');
      g.querySelector('.tag')?.remove();
      layer.insertBefore(g, el);
      g.animate(flight, { duration: flightMs, delay: i * 45, easing: 'cubic-bezier(.3,.2,.4,1)', fill: 'both' })
        .finished.then(() => g.remove());
      return g;
    });
    el.querySelector('.tag').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 200, fill: 'forwards' });
    await el.animate(flight, { duration: flightMs, easing: 'cubic-bezier(.3,.2,.4,1)', fill: 'forwards' }).finished;
    el.remove();
    ghosts.forEach((g) => setTimeout(() => g.remove(), 200));
    FX.sparkle(sky.x, sky.y, big ? 44 : 32, 38);
    dingSound();
    await sleep(200 * speed);
  }

  function burst(layer, x, y, text, scale) {
    const pts = [];
    const spikes = 14;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 ? 105 + Math.random() * 15 : 190 + Math.random() * 25;
      const a = (Math.PI * i) / spikes;
      pts.push(`${200 + r * Math.cos(a)},${200 + r * Math.sin(a)}`);
    }
    const b = document.createElement('div');
    b.className = 'burst';
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.style.width = b.style.height = 420 * scale + 'px';
    b.style.margin = `${-210 * scale}px 0 0 ${-210 * scale}px`;
    b.innerHTML = `<svg viewBox="0 0 400 400"><polygon points="${pts.join(' ')}" fill="#ffc21a" stroke="#1a1a1a" stroke-width="8" stroke-linejoin="round"/>
      <polygon points="${pts.map((p) => p.split(',').map((v) => 200 + (v - 200) * 0.72).join(',')).join(' ')}" fill="#fff8ec"/>
      <text x="200" y="228" text-anchor="middle" font-size="${text.length > 5 ? 80 : 100}" fill="#e8322b">${text}</text></svg>`;
    layer.appendChild(b);
    setTimeout(() => b.remove(), 950);
  }

  // ---------- full-screen scenes ----------
  async function scene({ img, fallback, cls, title, sub, tag, ms, onShow }) {
    const s = $('scene');
    const im = $('scene-img');
    im.onerror = fallback ? () => { im.onerror = null; im.src = fallback; } : null;
    im.src = img;
    // each letter slams in on its own
    $('scene-title').innerHTML = [...title].map((c, n) =>
      `<span class="l" style="--n:${n}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    $('scene-sub').textContent = sub;
    $('scene-tag').textContent = tag || '';
    s.className = 'scene ' + (cls || '');
    void s.offsetWidth;
    s.classList.add('on');
    onShow?.();
    await sleep(ms);
    s.classList.remove('on');
    await sleep(350);
  }
  async function megaScene(e) {
    ponkSound(1.6);
    shake(true);
    setTimeout(() => ponkSound(1), 180);
    await scene({
      img: 'assets/ponkeror-bonk-bear.webp', title: 'MEGA PONK!', sub: `${short(e.w)} dumped everything · ${sol(e.sol)} SOL`, tag: e.label, ms: 4200,
      onShow: () => {
        const head = { x: 1290, y: 640 };
        FX.ring(head.x, head.y, '#fff8ec', 520);
        FX.sparks(head.x, head.y, 70, 1.6);
        FX.fur(head.x, head.y, 30);
        FX.stars(head.x, head.y - 80, 9);
        setTimeout(() => { FX.ring(head.x, head.y, '#ffc21a', 700); FX.sparks(head.x, head.y, 40, 1.3); shake(true); }, 450);
        setTimeout(() => FX.confetti(140), 700);
      },
    });
  }
  async function whaleScene(e) {
    knightSound(true);
    await scene({
      img: 'assets/ponkeror-parade-bat.png', fallback: 'assets/ponkeror-parade.webp', cls: 'whale', title: `ALL HAIL SIR ${short(e.w)}`, sub: `+${sol(e.sol)} SOL · welcome to the army`, tag: e.label, ms: 4200,
      onShow: () => {
        FX.confetti(180);
        FX.coins(45);
        setTimeout(() => FX.confetti(90, false, 960, 1080), 500);
        [0, 300, 650].forEach((d) => setTimeout(() => FX.sparkle(860 + Math.random() * 200, 300 + Math.random() * 120, 50, 40), d));
      },
    });
  }

  // idle interludes so the stream never looks dead
  const INTERLUDES = [
    { img: 'assets/ponk-dj.webp', cls: 'calm', title: 'PONK FM', sub: 'No jeets detected. Vibes only.', tag: 'HOLDERS ONLY', ms: 12000 },
    { img: 'assets/ponk-astronaut.webp', cls: 'calm', title: 'STILL HOLDING', sub: 'Jeets sold. We went to the moon instead.', tag: 'PONK TO THE MOON', ms: 12000 },
  ];
  let interludeIdx = 0, lastInterlude = Date.now();
  setInterval(async () => {
    const now = Date.now();
    if (busy || now - lastTradeAt < CFG.idleMs || now - lastInterlude < CFG.idleMs) return;
    lastInterlude = now;
    busy = true;
    await scene(INTERLUDES[interludeIdx++ % INTERLUDES.length]);
    busy = false;
    pump();
  }, 15000);

  // ---------- live data ----------
  function setStatus(kind, text) {
    const s = $('status');
    s.className = 'status ' + kind;
    s.querySelector('span').textContent = text;
  }
  const log = (...a) => { if (CFG.debug) console.log('[ponk]', ...a); };

  // ?debug=1 shows an on-screen health panel (source, socket, counters) so a screenshot says it all
  const DIAG = { src: '-', socket: '-', poll: '-', msgs: 0, sigs: 0, decoded: 0, notTrade: 0, apiErr: 0, trades: 0, lastMsg: 0, lastTrade: 0, health: '-', err: '' };
  if (CFG.debug) {
    const box = document.createElement('pre');
    box.style.cssText = 'position:absolute;left:24px;top:130px;z-index:40;margin:0;padding:14px 16px;border-radius:14px;background:rgba(0,0,0,.82);color:#9effa0;font:600 15px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre;border:1px solid #2ee66b';
    stage.appendChild(box);
    const ago = (t) => (t ? Math.round((Date.now() - t) / 1000) + 's ago' : 'never');
    setInterval(() => {
      box.textContent = [
        'PONK DEBUG', `source      ${DIAG.src}`, `/api/health ${DIAG.health}`, `socket      ${DIAG.socket}`, `chain poll  ${DIAG.poll}`,
        `messages    ${DIAG.msgs} (last ${ago(DIAG.lastMsg)})`, `tx seen     ${DIAG.sigs}`,
        `decoded     ${DIAG.decoded} trades, ${DIAG.notTrade} not trades, ${DIAG.apiErr} api errors`,
        `on screen   ${DIAG.trades} (last ${ago(DIAG.lastTrade)})`, `market cap  ${mcapUsd ? '$' + compact(mcapUsd) + ' (' + (DIAG.mcapSrc || 'saved') + ')' : lastMcapSol ? 'from trades' : 'none yet'}`,
        DIAG.err ? `last error  ${DIAG.err}` : '',
      ].filter(Boolean).join('\n');
    }, 1000);
  }

  // Several feeds can run at once. The badge says LIVE only once a feed has confirmed its subscription
  // (or a real trade arrived), not merely because a socket opened.
  const openFeeds = new Set();
  let pollOkAt = 0; // last successful poll of the chain (see pollRecent)
  function updateStatus() {
    if (CFG.demo) return;
    if (openFeeds.size || Date.now() - pollOkAt < 60000) setStatus('live', 'LIVE ON SOLANA');
    else setStatus('', 'RECONNECTING');
  }
  function feedState(label, open) {
    if (open) openFeeds.add(label); else openFeeds.delete(label);
    updateStatus();
  }
  setInterval(updateStatus, 10000);

  // One websocket per feed, with backoff reconnects and a watchdog for silent drops.
  function feed({ url, label, onOpen, onMessage, keepAlive, watchdogMs }) {
    let ws = null, lastMsgAt = 0, retry = 0, ka = 0;
    function open() {
      const u = typeof url === 'function' ? url() : url;
      DIAG.socket = 'connecting ' + u.replace(/\?.*$/, '');
      try { ws = new WebSocket(u); } catch { return again(); }
      ws.onopen = () => {
        DIAG.socket = 'open ' + u.replace(/\?.*$/, '');
        retry = 0;
        lastMsgAt = Date.now();
        onOpen(ws);
        DIAG.socket = 'open, waiting for subscription ack';
        if (keepAlive) ka = setInterval(() => { try { ws.send(keepAlive); } catch {} }, 50000);
      };
      ws.onmessage = (m) => {
        lastMsgAt = Date.now();
        DIAG.msgs++; DIAG.lastMsg = lastMsgAt;
        let d; try { d = JSON.parse(m.data); } catch { return; }
        log(d);
        onMessage(d, () => { feedState(label, true); DIAG.socket = 'subscribed ' + u.replace(/\?.*$/, ''); });
      };
      ws.onclose = (ev) => { DIAG.socket = `closed (code ${ev.code}), retrying`; again(); };
      ws.onerror = () => { try { ws.close(); } catch {} };
    }
    function again() {
      clearInterval(ka);
      if (ws) { ws.onclose = ws.onerror = ws.onmessage = null; try { ws.close(); } catch {} ws = null; }
      feedState(label, false);
      setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
    }
    setInterval(() => {
      if (ws && ws.readyState === 1 && Date.now() - lastMsgAt > watchdogMs) again();
    }, 60000);
    open();
  }

  // PumpPortal: trades arrive already parsed
  function connectPumpPortal() {
    feed({
      url: CFG.ws, label: 'PUMPPORTAL', watchdogMs: CFG.watchdogMs,
      onOpen: (ws) => ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [CFG.mint] })),
      onMessage: (d, ack) => {
        if (d.errors || d.error) { DIAG.err = 'PumpPortal ' + (d.errors || d.error); console.warn('[ponk] PumpPortal:', d.errors || d.error); return; }
        if (d.message && !d.txType) { // PumpPortal answers in a "message" field: an ack, or an error (e.g. API key / balance)
          if (/success/i.test(d.message)) ack();
          else { DIAG.err = 'PumpPortal: ' + d.message; console.warn('[ponk] PumpPortal:', d.message); }
          return;
        }
        if (d.txType) ack();
        onTrade(d);
      },
    });
  }

  // Solana: a public websocket reports each transaction that mentions the mint;
  // our Netlify function decodes it (with the Helius key kept server-side).
  const pending = new Set();
  async function onSignature(sig) {
    if (pending.has(sig) || seen.has(sig)) return;
    pending.add(sig);
    DIAG.sigs++;
    try {
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`/api/tx/${sig}`).catch(() => null);
        if (r && r.status === 200) {
          const { trade } = await r.json();
          log('decoded', sig, trade);
          if (trade) DIAG.decoded++; else DIAG.notTrade++;
          if (trade) onTrade(trade);
          return;
        }
        if (!r || r.status >= 400) { DIAG.apiErr++; DIAG.err = `/api/tx ${r ? r.status : 'network'}`; }
        if (r && r.status !== 202 && r.status < 500) return;
        await sleep(800 * (i + 1));
      }
    } finally {
      setTimeout(() => pending.delete(sig), 60000);
    }
  }
  // Polling, independent of any websocket: every 5 s ask the public Solana RPC (plain HTTP, no key) for the
  // latest transactions on the mint, and decode the new ones through /api/tx. If the public RPC refuses,
  // fall back to the site's own /api/recent (Helius, server-side) every 20 s.
  // The first answer only marks what already happened, so old trades don't replay on load.
  const PUBLIC_RPC = params.get('rpc') || 'https://api.mainnet-beta.solana.com';
  async function latestSignatures() {
    try {
      const r = await fetch(PUBLIC_RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [CFG.mint, { limit: 25, commitment: 'confirmed' }] }),
      });
      const j = await r.json();
      if (j.error || !Array.isArray(j.result)) throw new Error(j.error ? j.error.message : 'bad answer');
      return { via: 'public rpc', signatures: j.result.filter((x) => !x.err).map((x) => x.signature) };
    } catch (err) {
      DIAG.err = 'public rpc: ' + err.message;
      const r = await fetch('/api/recent');
      if (!r.ok) throw new Error('/api/recent ' + r.status);
      return { via: 'server', slow: true, ...(await r.json()) };
    }
  }
  function pollRecent() {
    const known = new Set();
    let first = true;
    async function tick() {
      let wait = 5000;
      try {
        const { signatures = [], via, slow } = await latestSignatures();
        if (slow) wait = 20000;
        let fresh = 0;
        for (const sig of signatures.slice().reverse()) { // oldest first
          if (known.has(sig)) continue;
          known.add(sig);
          if (!first && !seen.has(sig)) { fresh++; onSignature(sig); }
        }
        if (known.size > 500) known.clear();
        DIAG.poll = `ok via ${via} ${new Date().toLocaleTimeString()}${first ? ' (baseline)' : `, ${fresh} new`}`;
        first = false;
        pollOkAt = Date.now();
        updateStatus();
      } catch (err) { DIAG.poll = 'error: ' + err.message; wait = 20000; }
      setTimeout(tick, wait);
    }
    tick();
  }

  function connectChain() {
    let n = 0; // rotate public endpoints when one drops us
    feed({
      url: () => CFG.chainWs[n++ % CFG.chainWs.length], label: 'SOLANA', watchdogMs: 5 * 60e3,
      onOpen: (ws) => ws.send(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [CFG.mint] }, { commitment: 'confirmed' }],
      })),
      onMessage: (d, ack) => {
        if (d.id === 'ka') return; // keep-alive reply
        if (d.id === 1 && typeof d.result === 'number') { ack(); return; } // logsSubscribe confirmed
        if (d.error) { DIAG.err = 'RPC ' + (d.error.message || d.error); console.warn('[ponk] RPC:', d.error.message || d.error); return; }
        const v = d.method === 'logsNotification' && d.params?.result?.value;
        if (v && !v.err && v.signature) onSignature(v.signature);
      },
    });
  }

  // Market cap from DexScreener (covers the pump.fun curve and PumpSwap). Straight from the browser,
  // or through /api/mcap (netlify/functions/mcap.mjs) if the browser can't reach it.
  // DexScreener lags a minute or more on fresh tokens, so live trades move the number between its updates;
  // DexScreener only takes over again once the trades have gone quiet.
  let supply = 1e9, liveMcapAt = 0;
  function setMcap(v, live) {
    if (!(v > 0)) return;
    mcapUsd = v;
    if (live) liveMcapAt = Date.now();
    try { localStorage.setItem(STORE + ':mcap', String(v)); } catch {}
    renderMcap();
  }
  function pickPair(j) {
    const pairs = (j && j.pairs || []).filter((p) => p.baseToken && p.baseToken.address === CFG.mint);
    pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    return pairs[0];
  }
  async function refreshMcap() {
    let pair, v = 0;
    try {
      pair = pickPair(await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${CFG.mint}`, { cache: 'no-store' })).json());
      v = pair ? +(pair.marketCap || pair.fdv) || 0 : 0;
    } catch (err) { log('dexscreener', err.message); }
    if (!v && !CFG.demo) {
      try {
        const j = await (await fetch('/api/mcap', { cache: 'no-store' })).json();
        v = +j.marketCap || 0;
        pair = { priceUsd: j.priceUsd, priceNative: j.priceNative };
      } catch {}
    }
    if (pair && +pair.priceUsd > 0 && +pair.priceNative > 0) {
      solUsd = pair.priceUsd / pair.priceNative;            // SOL price, from the same source
      if (v) supply = v / pair.priceUsd;                     // tokens counted in the market cap
    }
    if (v && Date.now() - liveMcapAt > 60000) setMcap(v, false);
    DIAG.mcapSrc = Date.now() - liveMcapAt > 60000 ? 'dexscreener' : 'live trades';
  }
  // live market cap from a trade: exact from PumpPortal (marketCapSol), estimated from a decoded swap otherwise
  function mcapFromTrade(tr) {
    if (!solUsd) return;
    if (tr.pool && tr.marketCapSol) return setMcap(tr.marketCapSol * solUsd, true);
    const sol = +tr.solAmount, tok = +tr.tokenAmount;
    if (!(sol >= 0.02 && tok > 0)) return;                   // tiny swaps are mostly fees and tips
    const fee = 1.01;                                        // the pool's cut sits inside the SOL amount
    const price = tr.txType === 'buy' ? sol / tok / fee : (sol / tok) * fee;
    setMcap(price * supply * solUsd, true);
  }
  let mcapTimer = 0;
  function soonMcap() { // a trade just moved the price: refresh a few seconds later, once
    if (CFG.demo || mcapTimer) return;
    mcapTimer = setTimeout(() => { mcapTimer = 0; refreshMcap(); }, 4000);
  }

  // SOL price, only for the trade-based estimate when DexScreener is unavailable
  async function refreshSol() {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      const j = await r.json();
      solUsd = +j.solana.usd || solUsd;
      renderMcap();
    } catch {}
  }

  // ---------- demo mode: fake trades for testing and teasers ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const fakeWallet = () => Array.from({ length: 44 }, () => B58[(Math.random() * 58) | 0]).join('');
  function demo() {
    setStatus('demo', 'DEMO MODE');
    const pool = Array.from({ length: 12 }, fakeWallet);
    let mcap = 420;
    const tick = () => {
      const r = Math.random();
      const reuse = Math.random() < 0.5;
      const w = reuse ? pool[(Math.random() * pool.length) | 0] : fakeWallet();
      const sell = r < 0.55;
      const amount = sell ? (Math.random() < 0.2 ? 0.8 + Math.random() * 4 : Math.random() * 0.6) : (Math.random() < 0.12 ? 3 + Math.random() * 6 : Math.random() * 1.5);
      mcap = Math.max(50, mcap + (sell ? -amount : amount) * 3);
      onTrade({
        signature: fakeWallet() + fakeWallet(), mint: CFG.mint, traderPublicKey: w,
        txType: sell ? 'sell' : 'buy', solAmount: amount,
        newTokenBalance: sell && Math.random() < 0.15 ? 0 : 1e6, marketCapSol: mcap,
      });
      if (!sell) pool.push(w);
      setTimeout(tick, 1200 + Math.random() * 4500);
    };
    tick();
  }

  // ---------- boot ----------
  render();
  showTab(0);
  refreshSol();
  setInterval(refreshSol, 5 * 60e3);
  if (!CFG.demo) { refreshMcap(); setInterval(refreshMcap, 15000); }
  setInterval(rollDay, 60e3);
  setTimeout(function reload() {
    if (busy || queue.length) return setTimeout(reload, 10000);
    location.reload();
  }, CFG.reloadMs);
  audio();
  if (CFG.demo) {
    window.ponkTrade = onTrade; // lets a recording script drive the page
    if (params.get('demo') === 'manual') setStatus('demo', 'DEMO MODE'); else demo();
  }
  else {
    // With the Helius key set: the Solana feed plus the server safety net (deduplicated by signature).
    // PumpPortal now requires a funded API key, so it is only a fallback without the key, or with ?source=pumpportal.
    if (CFG.source === 'pumpportal') { DIAG.src = 'PUMPPORTAL'; connectPumpPortal(); }
    else {
      fetch('/api/health').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))
        .then((h) => {
          DIAG.health = h.ready ? 'ready (key set)' : 'not ready -> PumpPortal';
          if (!h.ready) { DIAG.src = 'PUMPPORTAL'; connectPumpPortal(); return; }
          DIAG.src = 'SOLANA + SERVER POLL';
          connectChain();
          pollRecent();
        });
    }
  }
})();
