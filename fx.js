// Particle and effect layer for the stream page: one canvas over the whole stage.
// Exposes window.FX. Kept cheap enough to run 24/7 in an OBS browser source.
(() => {
  'use strict';

  const W = 1920, H = 1080, MAX = 700;
  const cv = document.getElementById('fx');
  const ctx = cv.getContext('2d');
  cv.width = W; cv.height = H;

  const parts = [];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const BRAND = ['#ff7a00', '#ffc21a', '#6fd83a', '#e8322b', '#fff8ec'];

  function add(p) {
    if (parts.length >= MAX) parts.splice(0, parts.length - MAX + 1);
    parts.push(Object.assign({ age: 0, vx: 0, vy: 0, g: 0, drag: 1, rot: 0, vr: 0, a: 1 }, p));
  }

  // ---------- emitters ----------
  function sparks(x, y, n = 30, power = 1) {
    for (let i = 0; i < n; i++) {
      const ang = rand(0, Math.PI * 2), sp = rand(6, 22) * power;
      add({ kind: 'spark', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.35, drag: 0.94, life: rand(25, 50), w: rand(2, 5), color: pick(['#fff8ec', '#ffc21a', '#ffe9a0']) });
    }
  }
  function fur(x, y, n = 14) {
    for (let i = 0; i < n; i++) {
      add({ kind: 'dot', x, y, vx: rand(-9, 12), vy: rand(-14, 2), g: 0.5, drag: 0.97, life: rand(40, 70), r: rand(3, 8), color: pick(['#6b4426', '#8a5a33', '#4a2e18']) });
    }
  }
  function stars(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n;
      add({ kind: 'star', x, y, vx: Math.cos(ang) * rand(5, 9), vy: Math.sin(ang) * rand(5, 9) - 3, g: 0.12, drag: 0.95, life: rand(45, 65), r: rand(12, 20), vr: rand(-0.3, 0.3), color: '#ffc21a' });
    }
  }
  function confetti(n = 120, fromTop = true, x = W / 2, y = H / 2) {
    for (let i = 0; i < n; i++) {
      add({
        kind: 'confetti',
        x: fromTop ? rand(0, W) : x, y: fromTop ? rand(-200, -10) : y,
        vx: fromTop ? rand(-2, 2) : rand(-16, 16), vy: fromTop ? rand(3, 8) : rand(-22, -6),
        g: 0.18, drag: 0.985, life: rand(140, 220), w: rand(10, 18), h: rand(6, 10),
        rot: rand(0, 6), vr: rand(-0.25, 0.25), flip: rand(0, 6), color: pick(BRAND),
      });
    }
  }
  function coins(n = 40) {
    for (let i = 0; i < n; i++) {
      add({ kind: 'coin', x: rand(100, W - 100), y: rand(-400, -20), vx: rand(-1.5, 1.5), vy: rand(4, 9), g: 0.25, drag: 0.99, life: 200, r: rand(16, 26), flip: rand(0, 6) });
    }
  }
  function sparkle(x, y, size = 40, life = 40) {
    add({ kind: 'sparkle', x, y, life, r: size, rot: rand(0, 1) });
  }
  function ring(x, y, color = '#fff8ec', max = 260) {
    add({ kind: 'ring', x, y, life: 22, r: 20, max, color });
  }
  function hop(x, y) { // little green burst when a knight joins
    for (let i = 0; i < 12; i++) {
      const ang = rand(-Math.PI, 0);
      add({ kind: 'dot', x, y, vx: Math.cos(ang) * rand(2, 6), vy: Math.sin(ang) * rand(3, 8), g: 0.25, drag: 0.96, life: rand(30, 45), r: rand(2, 5), color: pick(['#6fd83a', '#b6ff8a', '#ffc21a']) });
    }
  }

  // ambient: slow snow and drifting gold motes, always alive
  for (let i = 0; i < 70; i++) {
    add({ kind: 'snow', x: rand(0, W), y: rand(0, H), vx: rand(-0.3, 0.3), vy: rand(0.3, 1.1), life: Infinity, r: rand(1, 3.2), a: rand(0.25, 0.7), sway: rand(0, 6) });
  }
  for (let i = 0; i < 18; i++) {
    add({ kind: 'mote', x: rand(0, W), y: rand(0, H), vx: rand(-0.2, 0.2), vy: rand(-0.5, -0.15), life: Infinity, r: rand(1.5, 3.5), a: rand(0.3, 0.8), sway: rand(0, 6) });
  }

  // ---------- drawing ----------
  function starPath(r, points = 5, inner = 0.45) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 ? r * inner : r, a = (Math.PI * i) / points - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  let last = performance.now(), t = 0;
  function frame(now) {
    const dt = Math.min(3, (now - last) / 16.67); // 1 = one 60fps frame
    last = now; t += dt;
    ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const k = p.life === Infinity ? 0 : p.age / p.life;
      p.vx *= p.drag ** dt; p.vy *= p.drag ** dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;

      ctx.save();
      ctx.translate(p.x, p.y);
      switch (p.kind) {
        case 'snow':
        case 'mote': {
          p.x += Math.sin(t / 60 + p.sway) * 0.3;
          if (p.y > H + 10) { p.y = -10; p.x = rand(0, W); }
          if (p.y < -10) { p.y = H + 10; p.x = rand(0, W); }
          ctx.globalAlpha = p.kind === 'mote' ? p.a * (0.6 + 0.4 * Math.sin(t / 20 + p.sway)) : p.a;
          ctx.fillStyle = p.kind === 'mote' ? '#ffd67a' : '#ffffff';
          if (p.kind === 'mote') { ctx.shadowColor = '#ffc21a'; ctx.shadowBlur = 8; }
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
          break;
        }
        case 'spark': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color; ctx.lineWidth = p.w * (1 - k * 0.6); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * 2, -p.vy * 2); ctx.stroke();
          break;
        }
        case 'dot': {
          ctx.globalAlpha = 1 - k * k;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill();
          break;
        }
        case 'star': {
          ctx.globalAlpha = 1 - k * k;
          ctx.rotate(p.rot);
          starPath(p.r * (1 - k * 0.4));
          ctx.fillStyle = p.color; ctx.fill();
          ctx.lineWidth = 3; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
          break;
        }
        case 'confetti': {
          ctx.globalAlpha = k > 0.8 ? (1 - k) * 5 : 1;
          p.x += Math.sin(t / 8 + p.flip) * 0.8;
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(t / 6 + p.flip));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          break;
        }
        case 'coin': {
          ctx.globalAlpha = k > 0.85 ? (1 - k) * 6.6 : 1;
          const sx = Math.cos(t / 5 + p.flip);
          ctx.scale(Math.abs(sx) < 0.08 ? 0.08 : sx, 1);
          ctx.fillStyle = '#ffc21a'; ctx.strokeStyle = '#b87400'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 7); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#b87400'; ctx.font = `bold ${p.r}px Bangers, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('P', 0, 2);
          break;
        }
        case 'sparkle': {
          const s = Math.sin(k * Math.PI);
          ctx.globalAlpha = s;
          ctx.rotate(p.rot + k * 0.8);
          ctx.shadowColor = '#fff'; ctx.shadowBlur = 20;
          starPath(p.r * s, 4, 0.18);
          ctx.fillStyle = '#ffffff'; ctx.fill();
          break;
        }
        case 'ring': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color; ctx.lineWidth = 14 * (1 - k) + 1;
          ctx.beginPath(); ctx.arc(0, 0, p.r + (p.max - p.r) * (1 - (1 - k) ** 3), 0, 7); ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.FX = { sparks, fur, stars, confetti, coins, sparkle, ring, hop };
})();
