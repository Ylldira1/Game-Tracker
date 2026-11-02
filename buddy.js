/* Mochi — a little pixel buddy that lives on the page.
   Walks on top of panels/banners/menu items, jumps between them, idles, sleeps,
   can be clicked (hops + tells you what's due) or dragged & thrown.
   Self-contained: remove the <script src="buddy.js"> line to turn it off for good. */
(() => {
  const KEY = 'get.buddy';
  const getPref = () => { try { const v = localStorage.getItem(KEY); return v === null ? null : JSON.parse(v); } catch (e) { return null; } };
  const setPref = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let on = getPref() ?? (innerWidth >= 600);

  /* ---------- sprite ---------- */
  const S = 2, W = 22, H = 21;              // 22x21 pixel grid, drawn at 2x
  const PAL = { K: '#1a1030', B: '#a78bfa', D: '#7c5ce0', L: '#e4dcff', C: '#22d3ee', C2: '#0e9fb3', P: '#ff7eb6', G: '#5ee6a0', G2: '#2fb877', W: '#ffffff' };
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S; cv.className = 'buddy'; cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  const say = document.createElement('div'); say.className = 'buddy-say';

  function sprite(o) {
    // o: {sx, sy, bob, eyes, feet, tuck, sway, flap, face}
    ctx.clearRect(0, 0, cv.width, cv.height);
    const grid = {};
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W && y >= 0 && y < H) grid[x + ',' + y] = c; };
    const rx = 7.5 * o.sx, ry = 6.5 * o.sy, cx = 10.5, cy = 18.5 - ry + o.bob - (o.tuck ? 1 : 0);
    const inside = (x, y) => (((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2) <= 1;
    // feet (behind body)
    if (!o.tuck) {
      const fy = 19, a = o.feet || 0;
      for (let i = 0; i < 3; i++) { put(cx - 4.5 + a + i, fy, 'K'); put(cx + 1.5 - a + i, fy, 'K'); }
      put(cx - 4.5 + a, fy + 1, 'K'); put(cx - 3.5 + a, fy + 1, 'K'); put(cx - 2.5 + a, fy + 1, 'K');
      put(cx + 1.5 - a, fy + 1, 'K'); put(cx + 2.5 - a, fy + 1, 'K'); put(cx + 3.5 - a, fy + 1, 'K');
    }
    // body
    const scarfY = Math.round(cy + ry * 0.3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      let c = 'B';
      if (y > cy + ry * 0.45) c = 'D';
      if (((x - cx + 3) / 2.4) ** 2 + ((y - cy + 3) / 1.7) ** 2 < 1) c = 'L';
      if (y === scarfY) c = 'C'; else if (y === scarfY + 1) c = 'C2';
      put(x, y, edge ? 'K' : c);
    }
    // scarf tail (behind = left side, sprite faces right)
    const tx = Math.round(cx - rx), f = o.flap || 0;
    put(tx - 1, scarfY + 1, 'C'); put(tx - 2, scarfY + 1 + f, 'C'); put(tx - 3, scarfY + 2 + f, 'C2'); put(tx - 2, scarfY + 2 + f, 'K');
    // sprout
    const top = Math.round(cy - ry), sw = o.sway || 0;
    put(cx, top - 1, 'G2'); put(cx, top - 2, 'G2');
    put(cx + 1 + sw, top - 3, 'G'); put(cx + 2 + sw, top - 3, 'G'); put(cx + 2 + sw, top - 4, 'G');
    put(cx - 1 + sw, top - 3, 'G'); put(cx - 2 + sw, top - 4, 'G2');
    // face (looks to the right)
    const ey = Math.round(cy - 1), e1 = Math.round(cx - 2), e2 = Math.round(cx + 3);
    for (const ex of [e1, e2]) {
      if (o.eyes === 'closed') { put(ex, ey + 1, 'K'); put(ex + 1, ey + 1, 'K'); }
      else if (o.eyes === 'happy') { put(ex - 1, ey + 1, 'K'); put(ex, ey, 'K'); put(ex + 1, ey + 1, 'K'); }
      else if (o.eyes === 'wide') { put(ex, ey - 1, 'K'); put(ex + 1, ey - 1, 'K'); put(ex, ey, 'W'); put(ex + 1, ey, 'K'); put(ex, ey + 1, 'K'); put(ex + 1, ey + 1, 'K'); }
      else { put(ex, ey, 'W'); put(ex + 1, ey, 'K'); put(ex, ey + 1, 'K'); put(ex + 1, ey + 1, 'K'); }
    }
    put(e1 - 1, ey + 2, 'P'); put(e2 + 2, ey + 2, 'P');
    if (o.eyes === 'happy' || o.eyes === 'wide') { put(cx + 1, ey + 3, 'K'); put(cx + 2, ey + 3, 'K'); }
    else if (o.eyes !== 'closed') put(cx + 1.5, ey + 3, 'K');
    // paint (mirror when facing left)
    for (const k in grid) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillStyle = PAL[grid[k]];
      ctx.fillRect((o.face < 0 ? W - 1 - x : x) * S, y * S, S, S);
    }
  }

  /* ---------- world ---------- */
  const SEL = '.gban,.panel,.ev,.stat,.sb-item,.tchip,.qrow';
  let plats = [], lastScan = 0;
  function scan() {
    plats = [];
    document.querySelectorAll(SEL).forEach(el => {
      if (!el.offsetParent) return;
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.top < 40 || r.top > innerHeight - 30 || r.left < 0 || r.right > innerWidth) return;
      plats.push({ el, l: r.left + 10, r: r.right - 10, t: r.top });
    });
    lastScan = performance.now();
  }

  const G = 0.55;
  const b = { x: 200, y: -40, vx: 0, vy: 0, face: 1, st: 'fall', sup: null, until: 0, tx: 0, land: 0, blink: 0 };
  let mx = -999, my = -999, lastAct = Date.now(), lastZ = 0, down = null, raf = 0, lastT = 0;

  function setState(st, ms) { b.st = st; b.until = performance.now() + (ms || 0); }
  function standOn(p) { b.sup = p ? p.el : null; b.vx = 0; b.vy = 0; b.land = performance.now(); setState('idle', 600 + Math.random() * 1800); }
  function respawn() {
    scan();
    const p = plats[Math.floor(Math.random() * plats.length)];
    b.x = p ? p.l + Math.random() * (p.r - p.l) : innerWidth / 2;
    b.y = -30; b.vx = 0; b.vy = 0; b.sup = null; setState('fall');
  }

  function supRect() {
    if (!b.sup) return { l: 16, r: innerWidth - 16, t: innerHeight - 2, floor: true };
    if (!b.sup.isConnected || !b.sup.offsetParent) return null;
    const r = b.sup.getBoundingClientRect();
    return { l: r.left + 10, r: r.right - 10, t: r.top };
  }

  function decide(now) {
    const r = supRect(); if (!r) return;
    if (Date.now() - lastAct > 40000 && !r.floor) { setState('sleep'); bubble('Zzz…', 1600); return; }
    const roll = Math.random();
    if (r.floor || roll < 0.42) {               // jump somewhere
      if (jumpSomewhere()) return;
    }
    if (roll < 0.8) {                           // stroll
      b.tx = r.l + Math.random() * (r.r - r.l);
      if (Math.abs(b.tx - b.x) > 20) { b.face = b.tx > b.x ? 1 : -1; setState('walk'); return; }
    }
    setState('idle', 1200 + Math.random() * 2500);
  }

  function jumpSomewhere() {
    scan();
    const cands = plats.filter(p => p.el !== b.sup && Math.abs((p.l + p.r) / 2 - b.x) < 650 && p.t - b.y > -260 && p.t - b.y < 360);
    if (!cands.length) return false;
    const p = cands[Math.floor(Math.random() * cands.length)];
    const tx = Math.max(p.l, Math.min(p.r, b.x + (Math.random() - .5) * 300 + ((p.l + p.r) / 2 - b.x) * .6));
    const T = Math.max(28, Math.min(52, Math.abs(tx - b.x) / 9 + 26));
    b.vx = (tx - b.x) / T;
    b.vy = (p.t - b.y - 0.5 * G * T * T) / T;
    b.face = b.vx >= 0 ? 1 : -1; b.sup = null; setState('fall');
    return true;
  }

  /* ---------- effects ---------- */
  function fx(ch, cls) {
    const s = document.createElement('span'); s.className = 'buddy-fx ' + (cls || ''); s.textContent = ch;
    s.style.left = (b.x - 6 + (Math.random() - .5) * 26) + 'px'; s.style.top = (b.y - 46) + 'px';
    document.body.appendChild(s); setTimeout(() => s.remove(), 1400);
  }
  let sayT = 0;
  function bubble(text, ms) { say.textContent = text; say.classList.add('show'); clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('show'), ms || 2600); }
  function hint() {
    const n = id => parseInt((document.getElementById(id) || {}).textContent) || 0;
    const soon = n('sToday'), todo = n('sActive');
    const lines = [];
    if (soon) lines.push(`${soon} quest${soon > 1 ? 's' : ''} ending in 24h! ⏳`);
    if (todo) lines.push(`${todo} left to do. Let's go!`, 'Did you do your dailies?');
    else lines.push('All clear! You did it ✦');
    lines.push('Hehe, that tickles!', 'Pull luck +1 ✦', 'I believe in your 50/50!');
    return soon && Math.random() < .6 ? lines[0] : lines[Math.floor(Math.random() * lines.length)];
  }
  function celebrate(text) {
    lastAct = Date.now();
    if (b.st === 'held') return;
    const r = supRect(); if (r) { b.vy = -7.5; b.vx = 0; b.sup = null; setState('fall'); }
    b.happyUntil = performance.now() + 1400;
    for (let i = 0; i < 4; i++) setTimeout(() => fx(i % 2 ? '✦' : '♥', i % 2 ? 'spark' : 'heart'), i * 120);
    if (text) bubble(text);
  }

  /* ---------- loop ---------- */
  function step(t) {
    raf = requestAnimationFrame(step);
    const dt = Math.min(2.5, (t - (lastT || t)) / 16.67); lastT = t;
    if (t - lastScan > 250) scan();

    if (b.st === 'held') {
      b.x = mx; b.y = my + 30;
    } else if (b.st === 'fall') {
      b.vy += G * dt;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      let landed = null;
      if (b.vy > 0) for (const p of plats) if (nx >= p.l && nx <= p.r && b.y <= p.t + 1 && ny >= p.t && (!landed || p.t < landed.t)) landed = p;
      b.x = nx; b.y = ny;
      if (b.x < 16 || b.x > innerWidth - 16) { b.x = Math.max(16, Math.min(innerWidth - 16, b.x)); b.vx *= -0.5; }
      if (landed) { b.y = landed.t; standOn(landed); }
      else if (b.y >= innerHeight - 2) { b.y = innerHeight - 2; standOn(null); }
    } else {
      // standing: ride along with the element we're on (scrolling, re-renders)
      let r = supRect();
      if (!r) {
        scan();
        const p = plats.find(p => b.x >= p.l && b.x <= p.r && Math.abs(p.t - b.y) < 40);
        if (p) { b.sup = p.el; r = supRect(); } else { setState('fall'); return; }
      }
      if (!r.floor && (r.t < 30 || r.t > innerHeight + 10)) { respawn(); return; }
      b.y = r.t;
      if (b.x < r.l - 4 || b.x > r.r + 4) { b.vx = b.face * 1.5; setState('fall'); return; }  // walked off / platform shrank
      if (b.st === 'walk') {
        b.x += b.face * 1.15 * dt;
        if ((b.face > 0 && b.x >= b.tx) || (b.face < 0 && b.x <= b.tx) || b.x <= r.l || b.x >= r.r) { b.x = Math.max(r.l, Math.min(r.r, b.x)); setState('idle', 800 + Math.random() * 2000); }
      } else if (b.st === 'sleep') {
        if (t - lastZ > 1300) { lastZ = t; fx('z', 'zz'); }
      } else if (b.st === 'idle' && t > b.until) decide(t);
      // look at the cursor when it's close
      if (b.st === 'idle' && Math.abs(mx - b.x) < 160 && Math.abs(my - b.y) < 160 && Math.abs(mx - b.x) > 8) b.face = mx > b.x ? 1 : -1;
      if (b.st === 'sleep' && Math.hypot(mx - b.x, my - (b.y - 20)) < 70) wake();
    }

    // pose
    const k = t / 1000, o = { sx: 1, sy: 1, bob: 0, eyes: 'open', feet: 0, tuck: false, sway: Math.round(Math.sin(k * 2.2) * 0.6), flap: 0, face: b.face };
    const happy = (b.happyUntil || 0) > t;
    if (b.st === 'walk') {
      const ph = Math.floor(t / 110) % 4;
      o.feet = [-1, 0, 1, 0][ph]; o.bob = [0, -1, 0, -1][ph]; o.flap = ph % 2;
    } else if (b.st === 'fall') {
      o.tuck = true; o.sy = b.vy < 0 ? 1.08 : 0.98; o.sx = b.vy < 0 ? 0.94 : 1.02; o.eyes = happy ? 'happy' : 'wide'; o.flap = Math.floor(t / 90) % 2 ? 1 : -1;
    } else if (b.st === 'held') {
      o.tuck = false; o.feet = Math.floor(t / 140) % 2 ? 1 : -1; o.eyes = 'wide'; o.sy = 1.1; o.sx = .92; o.flap = 1;
    } else if (b.st === 'sleep') {
      o.sy = 0.8 + Math.sin(k * 1.6) * 0.03; o.sx = 1.12; o.eyes = 'closed'; o.sway = 1;
    } else {
      o.sy = 1 + Math.sin(k * 3) * 0.025;
      if (t - b.land < 140) { o.sy = 0.84; o.sx = 1.12; }
      if (t > b.blink) { if (t > b.blink + 130) b.blink = t + 2200 + Math.random() * 2600; else o.eyes = 'closed'; }
    }
    if (happy && b.st !== 'sleep') o.eyes = 'happy';
    sprite(o);
    cv.style.transform = `translate(${Math.round(b.x - W * S / 2)}px,${Math.round(b.y - H * S + 2)}px)`;
    say.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - 190, b.x - 90)))}px,${Math.round(b.y - H * S - 34)}px)`;
  }

  function wake() { lastAct = Date.now(); setState('idle', 900); b.happyUntil = performance.now() + 900; fx('!', 'spark'); bubble(['Huh? I\'m up!', 'Five more minutes…', 'Oh! Hi there!'][Math.floor(Math.random() * 3)], 1800); }

  /* ---------- input ---------- */
  addEventListener('pointermove', e => {
    mx = e.clientX; my = e.clientY; lastAct = Date.now();
    if (down) {
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (d > 6 && b.st !== 'held') { setState('held'); document.body.classList.add('buddy-drag'); getSelection().removeAllRanges(); b.sup = null; bubble('Wheee!', 1200); }
      down.vx = (e.clientX - down.px) * 0.6; down.vy = (e.clientY - down.py) * 0.6; down.px = e.clientX; down.py = e.clientY;
    }
  }, { passive: true });
  addEventListener('keydown', () => { lastAct = Date.now(); }, { passive: true });
  addEventListener('scroll', () => scan(), { passive: true, capture: true });
  addEventListener('resize', () => { scan(); if (b.x > innerWidth - 16) b.x = innerWidth - 40; });
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    mx = e.clientX; my = e.clientY;
    down = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, vx: 0, vy: 0 };
  });
  cv.addEventListener('pointerup', () => {
    if (!down) return;
    document.body.classList.remove('buddy-drag');
    if (b.st === 'held') {
      b.vx = Math.max(-16, Math.min(16, down.vx)); b.vy = Math.max(-16, Math.min(16, down.vy)); setState('fall');
    } else if (b.st === 'sleep') wake();
    else celebrate(hint());
    down = null;
  });
  // react to completing a quest (the app shows a "win" toast)
  const toastEl = document.getElementById('toast');
  if (toastEl) new MutationObserver(() => {
    if (on && toastEl.classList.contains('win') && toastEl.style.display === 'block') celebrate(['Nice! ✦', 'Quest cleared!', 'GG!', 'Look at you go!'][Math.floor(Math.random() * 4)]);
  }).observe(toastEl, { attributes: true, attributeFilter: ['class', 'style'] });

  /* ---------- on/off (account menu) ---------- */
  function start() {
    if (!cv.isConnected) { document.body.append(cv, say); }
    respawn(); lastT = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    setTimeout(() => bubble('Hi! I\'m Mochi ✦', 2200), 900);
  }
  function stop() { cancelAnimationFrame(raf); cv.remove(); say.remove(); document.querySelectorAll('.buddy-fx').forEach(s => s.remove()); }
  const btn = document.createElement('button');
  const label = () => { btn.textContent = on ? '🐾 Hide buddy' : '🐾 Show buddy'; };
  btn.id = 'buddyBtn'; label();
  btn.addEventListener('click', () => { on = !on; setPref(on); label(); on ? start() : stop(); });
  const exp = document.getElementById('exportBtn');
  if (exp) exp.parentNode.insertBefore(btn, exp);
  document.addEventListener('visibilitychange', () => { if (!on) return; if (document.hidden) cancelAnimationFrame(raf); else { lastT = 0; raf = requestAnimationFrame(step); } });
  if (on) setTimeout(start, 1200);   // let the app draw first
})();
