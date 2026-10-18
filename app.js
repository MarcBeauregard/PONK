// $PONK Jeet Tracker — live stream page.
// Trades come from the PumpPortal websocket (no API key, straight from the browser).
// URL options: ?demo=1  ?mute=1  ?vol=0.5  ?swing=0.5  ?whale=3  ?mint=<address>
(() => {
  'use strict';

  const params = new URLSearchParams(location.search);
  const CFG = {
    mint: params.get('mint') || '4jjQjDRYd7xLcFMViRsz4GvtgU6gPZgbVaxN3Rq9pump',
    ws: 'wss://pumpportal.fun/api/data',
    demo: params.has('demo'),
    mute: params.has('mute'),
    vol: clamp(parseFloat(params.get('vol') ?? '0.5'), 0, 1),
    swingSol: parseFloat(params.get('swing') ?? '0.5'), // sells at or above this get the full swing
    whaleSol: parseFloat(params.get('whale') ?? '3'),   // buys at or above this get the parade
    speedJeetMs: 10 * 60e3,   // sold within 10 min of buying
    repentMs: 24 * 3600e3,    // bought back within 24 h of selling
    idleMs: 6 * 60e3,         // no trades for this long -> interlude scene
    watchdogMs: 15 * 60e3,    // no websocket message for this long -> reconnect
    reloadMs: 6 * 3600e3,     // periodic reload keeps a 24/7 page fresh
  };

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
  const sol = (n) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
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
  function setStat(id, text) {
    const el = $(id);
    if (el.textContent === text) return;
    el.textContent = text;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  let solUsd = 0;
  let lastMcapSol = 0;
  function renderMcap() {
    if (!lastMcapSol) return;
    $('s-mcap').textContent = solUsd ? `$${compact(lastMcapSol * solUsd)}` : `${compact(lastMcapSol)} SOL`;
  }
  function render() {
    setStat('s-jeets', String(state.jeets));
    setStat('s-soljeet', sol(state.solJeeted));
    setStat('s-knights', String(state.knights));
    renderMcap();
    $('feed').innerHTML = state.feed.map(feedItem).join('');
    renderArmy();
    renderMarquee();
  }
  function feedItem(e) {
    const sell = e.type === 'sell';
    const label = e.label || (sell ? 'GOT PONKED' : 'JOINED THE ARMY');
    return `<li class="${sell ? 'sell' : 'buy'}">
      <img src="assets/${sell ? 'jeet-bear.png' : 'ponk-avatar.png'}" alt="">
      <div class="t"><code>${esc(short(e.w))}</code><small>${esc(label)}</small></div>
      <div class="amt">${sell ? '-' : '+'}${sol(e.sol)} SOL</div></li>`;
  }
  function pushFeed(e) {
    state.feed.unshift(e);
    state.feed.length = Math.min(state.feed.length, 6);
    const ol = $('feed');
    ol.insertAdjacentHTML('afterbegin', feedItem(e));
    while (ol.children.length > 6) ol.lastElementChild.remove();
  }
  const ARMY_MAX = 34;
  function renderArmy() {
    const row = $('army');
    const shown = Math.min(state.army, ARMY_MAX);
    row.innerHTML = '<img src="assets/ponk-avatar.png" alt="">'.repeat(shown) +
      (state.army > ARMY_MAX ? `<span class="more">+${state.army - ARMY_MAX}</span>` : '');
  }
  function growArmy() {
    state.army++;
    const row = $('army');
    if (state.army <= ARMY_MAX) row.insertAdjacentHTML('beforeend', '<img src="assets/ponk-avatar.png" alt="">');
    else renderArmy();
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
    setTimeout(() => { $('bubble-text').textContent = text; b.classList.remove('out'); }, 450);
  }
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

  // ---------- trade intake ----------
  const seen = new Set();
  const queue = [];
  let lastTradeAt = Date.now();

  function onTrade(tr) {
    if (!tr || (tr.txType !== 'buy' && tr.txType !== 'sell')) return;
    if (tr.mint && tr.mint !== CFG.mint) return;
    if (tr.signature) {
      if (seen.has(tr.signature)) return;
      seen.add(tr.signature);
      if (seen.size > 1000) seen.delete(seen.values().next().value);
    }
    rollDay();
    lastTradeAt = Date.now();
    if (tr.marketCapSol) { lastMcapSol = +tr.marketCapSol; renderMcap(); }

    const now = Date.now();
    const w = tr.traderPublicKey;
    const amount = +tr.solAmount || 0;
    const mem = wallets.get(w) || {};
    const e = { type: tr.txType, w, sol: amount, at: now };

    if (e.type === 'sell') {
      const fullExit = tr.newTokenBalance !== undefined && +tr.newTokenBalance < 1;
      const held = mem.b ? now - mem.b : Infinity;
      e.tier = fullExit ? 'mega' : amount >= CFG.swingSol ? 'swing' : 'tap';
      if (held <= CFG.speedJeetMs) e.label = `SPEED JEET · held ${duration(held)}`;
      else if (fullExit) e.label = 'SOLD EVERYTHING';
      else e.label = 'PAPER HANDS';
      state.jeets++;
      state.solJeeted += amount;
      if (!state.biggestJeet || amount > state.biggestJeet.sol) state.biggestJeet = { w, sol: amount };
      if (held <= CFG.speedJeetMs && (!state.fastestJeet || held < state.fastestJeet.ms)) state.fastestJeet = { w, ms: held };
      mem.s = now;
    } else {
      const repented = mem.s && now - mem.s <= CFG.repentMs;
      e.tier = amount >= CFG.whaleSol ? 'whale' : 'knight';
      e.label = repented ? 'JEET REPENTED. FORGIVEN… FOR NOW' : amount >= CFG.whaleSol ? 'KNIGHTED BY THE EMPEROR' : 'JOINED THE ARMY';
      state.knights++;
      state.solBought += amount;
      if (!state.biggestBuy || amount > state.biggestBuy.sol) state.biggestBuy = { w, sol: amount };
      mem.b = now;
    }
    wallets.set(w, mem);
    pruneWallets();

    pushFeed(e);
    setStat('s-jeets', String(state.jeets));
    setStat('s-soljeet', sol(state.solJeeted));
    setStat('s-knights', String(state.knights));
    renderMarquee();
    save();

    if (e.tier === 'knight') { growArmy(); knightSound(false); return; } // buys never block the queue
    if (e.tier === 'whale') growArmy();
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

  const HIT = { x: 1150, y: 430 }; // just in front of the Ponkeror
  async function ponk(e, speed) {
    const layer = $('hits');
    const big = e.tier !== 'tap';
    const el = document.createElement('div');
    el.className = 'jeet';
    el.innerHTML = `<img src="assets/jeet-bear.png" alt=""><div class="tag">${esc(short(e.w))} · ${sol(e.sol)} SOL</div>`;
    layer.appendChild(el);

    const from = { x: 2000, y: 760 + Math.random() * 120 };
    const at = { x: HIT.x - 85, y: HIT.y - 75 };
    const approach = el.animate(
      [{ transform: `translate(${from.x}px,${from.y}px) rotate(12deg)` },
       { transform: `translate(${at.x}px,${at.y}px) rotate(-4deg)` }],
      { duration: 650 * speed, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    await approach.finished;

    // the hit
    ponkSound(big ? 1 : 0.4);
    shake(big);
    if (big) { const f = document.createElement('div'); f.className = 'flash'; layer.appendChild(f); setTimeout(() => f.remove(), 400); }
    burst(layer, HIT.x, HIT.y - 20, big ? 'PONK!!' : 'PONK!', big ? 1 : 0.75);

    const now = Date.now();
    combo = now - comboAt < 6000 ? combo + 1 : 1;
    comboAt = now;
    if (combo >= 3) {
      const c = document.createElement('div');
      c.className = 'combo'; c.textContent = `COMBO x${combo}`;
      c.style.left = HIT.x + 'px'; c.style.top = (HIT.y - 260) + 'px';
      layer.appendChild(c); setTimeout(() => c.remove(), 1300);
    }
    if (e.label && e.label.startsWith('SPEED')) say(`${short(e.w)} held for ${e.label.split('held ')[1]}. PONK.`);

    const fly = el.animate(
      [{ transform: `translate(${at.x}px,${at.y}px) rotate(-4deg) scale(1)` },
       { transform: `translate(${at.x + 900}px,${at.y - 700}px) rotate(${big ? 1080 : 540}deg) scale(${big ? 0.4 : 0.6})`, opacity: 0.2 }],
      { duration: (big ? 900 : 700) * speed, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
    await fly.finished;
    el.remove();
    await sleep(250 * speed);
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
      <text x="200" y="228" text-anchor="middle" font-size="${text.length > 5 ? 92 : 104}" fill="#e8322b">${text}</text></svg>`;
    layer.appendChild(b);
    setTimeout(() => b.remove(), 950);
  }

  // ---------- full-screen scenes ----------
  async function scene({ img, cls, title, sub, tag, ms }) {
    const s = $('scene');
    $('scene-img').src = img;
    $('scene-title').textContent = title;
    $('scene-sub').textContent = sub;
    $('scene-tag').textContent = tag || '';
    s.className = 'scene ' + (cls || '');
    void s.offsetWidth;
    s.classList.add('on');
    await sleep(ms);
    s.classList.remove('on');
    await sleep(350);
  }
  async function megaScene(e) {
    ponkSound(1.6);
    shake(true);
    setTimeout(() => ponkSound(1), 180);
    await scene({ img: 'assets/ponkeror-bonk-bear.webp', title: 'MEGA PONK!', sub: `${short(e.w)} dumped everything · ${sol(e.sol)} SOL`, tag: e.label, ms: 3800 });
  }
  async function whaleScene(e) {
    knightSound(true);
    await scene({ img: 'assets/ponkeror-parade.webp', cls: 'whale', title: `ALL HAIL SIR ${short(e.w)}`, sub: `+${sol(e.sol)} SOL · welcome to the army`, tag: e.label, ms: 3800 });
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

  // ---------- live data: PumpPortal websocket ----------
  function setStatus(kind, text) {
    const s = $('status');
    s.className = 'status ' + kind;
    s.querySelector('span').textContent = text;
  }
  let ws = null, lastMsgAt = 0, retry = 0;
  function connect() {
    setStatus('', 'CONNECTING');
    try { ws = new WebSocket(CFG.ws); } catch { return reconnect(); }
    ws.onopen = () => {
      retry = 0;
      lastMsgAt = Date.now();
      ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [CFG.mint] }));
      setStatus('live', 'LIVE ON SOLANA');
    };
    ws.onmessage = (m) => {
      lastMsgAt = Date.now();
      let d; try { d = JSON.parse(m.data); } catch { return; }
      onTrade(d);
    };
    ws.onclose = () => reconnect();
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  function reconnect() {
    if (ws) { ws.onclose = ws.onerror = ws.onmessage = null; try { ws.close(); } catch {} ws = null; }
    setStatus('', 'RECONNECTING');
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    setTimeout(connect, delay);
  }
  setInterval(() => {
    if (ws && ws.readyState === 1 && Date.now() - lastMsgAt > CFG.watchdogMs) reconnect();
  }, 60000);

  // SOL price for the market cap in USD (optional; falls back to SOL)
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
  refreshSol();
  setInterval(refreshSol, 5 * 60e3);
  setInterval(rollDay, 60e3);
  setTimeout(function reload() {
    if (busy || queue.length) return setTimeout(reload, 10000);
    location.reload();
  }, CFG.reloadMs);
  audio();
  if (CFG.demo) demo(); else connect();
})();
