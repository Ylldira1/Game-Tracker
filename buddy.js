/* Page buddies — little pixel characters that live on the page.
   They walk on top of panels/banners/menu items, jump between them, idle, sleep,
   can be clicked (hop + tell you what's due) or dragged & thrown.
   Self-contained: remove the <script src="buddy.js"> line to turn them off for good. */
(() => {
  const getPref = k => { try { const v = localStorage.getItem(k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const S = 2;

  /* ---------- sprites ---------- */
  function drawMochi(put, o, W, H) {
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
  }

  const KINDS = {
    mochi: { name: 'Mochi', icon: '🐾', pref: 'get.buddy', W: 22, H: 21, draw: drawMochi, glow: 'rgba(167,139,250,.35)',
      pal: { K: '#1a1030', B: '#a78bfa', D: '#7c5ce0', L: '#e4dcff', C: '#22d3ee', C2: '#0e9fb3', P: '#ff7eb6', G: '#5ee6a0', G2: '#2fb877', W: '#ffffff' },
      hello: "Hi! I'm Mochi ✦", lines: ['Hehe, that tickles!', 'Pull luck +1 ✦', 'I believe in your 50/50!'] },
    pika: { name: 'Pikachu', icon: '⚡', pref: 'get.buddy3', sheet: 'pika', scale: 2, glow: 'rgba(255,220,60,.35)',
      hello: 'Pika pika! ⚡', held: 'Pikaaa?! ⚡', lines: ['Pika?', 'Pikaaa~ ⚡', 'Chu! Do your quests!', 'Pika pi! ✦'],
      clicks: ['Pose', 'Shock', 'Charge', 'Nod'], extras: ['LookUp', 'Eat', 'DeepBreath', 'Rotate', 'Nod', 'Sit'] },
  };

  /* ---------- shared world ---------- */
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
  let mx = -999, my = -999, lastAct = Date.now();
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function hint() {
    const n = id => parseInt((document.getElementById(id) || {}).textContent) || 0;
    const soon = n('sToday'), todo = n('sActive');
    if (soon && Math.random() < .6) return `${soon} quest${soon > 1 ? 's' : ''} ending in 24h! ⏳`;
    return todo ? pick([`${todo} left to do. Let's go!`, 'Did you do your dailies?']) : 'All clear! You did it ✦';
  }

  /* ---------- one buddy ---------- */
  function makeBuddy(kind) {
    const K = KINDS[kind];
    const SH = K.sheet ? (window.BUDDY_SHEETS || {})[K.sheet] : null;
    if (K.sheet && !SH) return null;                       // sprite data file not loaded
    const W = K.W || 24, H = K.H || 30, SC = K.scale || S;
    let img = null; if (SH) { img = new Image(); img.src = SH.img; }
    const cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S; cv.className = 'buddy'; cv.setAttribute('aria-hidden', 'true');
    cv.style.setProperty('--glow', K.glow);
    const ctx = cv.getContext('2d');
    const say = document.createElement('div'); say.className = 'buddy-say';
    const b = { x: 200, y: -40, vx: 0, vy: 0, face: 1, st: 'fall', sup: null, until: 0, tx: 0, land: 0, blink: 0, happyUntil: 0 };
    let lastZ = 0, down = null, sayT = 0, on = false;
    b.ht = H * S;

    /* sprite-sheet animation (PMD-style packs) */
    const animLen = n => SH.anims[n].d.reduce((a, c) => a + c, 0) * 1000 / 60;
    function frameOf(n, dir, ms, loop) {
      const A = SH.anims[n], total = animLen(n), tt = loop ? ms % total : Math.min(ms, total - 1);
      let acc = 0;
      for (let i = 0; i < A.d.length; i++) { acc += A.d[i] * 1000 / 60; if (tt < acc) return A.dirs[dir][i]; }
      return A.dirs[dir][A.d.length - 1];
    }
    function playOnce(n) {
      if (!SH || !SH.anims[n]) return 0;
      const now = performance.now(); b.once = { n, t0: now, end: now + animLen(n) };
      return animLen(n);
    }
    function sheetFrame(t) {
      const right = b.face > 0, side = right ? 'r' : 'l', diag = right ? 'dr' : 'dl';
      if (b.once && t >= b.once.end) b.once = null;
      if (b.once && b.st !== 'held' && b.st !== 'fall' && b.st !== 'walk') return frameOf(b.once.n, diag, t - b.once.t0, false);
      if (b.st === 'walk') return frameOf('Walk', side, t, true);
      if (b.st === 'fall') { const A = SH.anims.Hop.dirs[side]; return A[Math.min(b.vy < -3 ? 3 : b.vy < 2 ? 5 : 7, A.length - 1)]; }
      if (b.st === 'held') return frameOf('Pull', diag, t, true);
      if (b.st === 'sleep') return frameOf('Sleep', 'dr', t, true);
      if (b.sitUntil > t) return frameOf('Sit', diag, t - b.sitT0, false);
      return frameOf('Idle', diag, t, true);
    }
    function drawSheet(t) {
      const [sx, sy, w, h, ax, ay] = SH.frames[sheetFrame(t)];
      const cw = w * SC, ch = h * SC;
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; } else ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      if (img.complete) ctx.drawImage(img, sx, sy, w, h, 0, 0, cw, ch);
      return [ax * SC, ay * SC];
    }

    function render(o) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      const grid = {};
      const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < W && y >= 0 && y < H) grid[x + ',' + y] = c; };
      K.draw(put, o, W, H);
      for (const k in grid) {
        const [x, y] = k.split(',').map(Number);
        ctx.fillStyle = K.pal[grid[k]] || '#f0f';
        ctx.fillRect((o.face < 0 ? W - 1 - x : x) * S, y * S, S, S);
      }
    }
    const setState = (st, ms) => { b.st = st; b.until = performance.now() + (ms || 0); };
    const standOn = p => { b.sup = p ? p.el : null; b.vx = 0; b.vy = 0; b.land = performance.now(); setState('idle', 600 + Math.random() * 1800); };
    function afterLand(hard) {
      if (!SH) return;
      if (hard) { const ms = playOnce('HitGround'); setState('idle', ms + 400); bubble(pick(['Pika…!', 'Ow ow…']), 1400); }
      else if (b.poseOnLand) { const ms = playOnce('Pose'); setState('idle', ms + 500); }
      b.poseOnLand = false;
    }
    function respawn() {
      scan(); const p = pick(plats);
      b.x = p ? p.l + Math.random() * (p.r - p.l) : innerWidth / 2;
      b.y = -30; b.vx = 0; b.vy = 0; b.sup = null; setState('fall');
    }
    function supRect() {
      if (!b.sup) return { l: 16, r: innerWidth - 16, t: innerHeight - 2, floor: true };
      if (!b.sup.isConnected || !b.sup.offsetParent) return null;
      const r = b.sup.getBoundingClientRect();
      return { l: r.left + 10, r: r.right - 10, t: r.top };
    }
    function jumpSomewhere() {
      scan();
      const cands = plats.filter(p => p.el !== b.sup && Math.abs((p.l + p.r) / 2 - b.x) < 650 && p.t - b.y > -260 && p.t - b.y < 360);
      if (!cands.length) return false;
      const p = pick(cands);
      const tx = Math.max(p.l, Math.min(p.r, b.x + (Math.random() - .5) * 300 + ((p.l + p.r) / 2 - b.x) * .6));
      const T = Math.max(28, Math.min(52, Math.abs(tx - b.x) / 9 + 26));
      b.vx = (tx - b.x) / T; b.vy = (p.t - b.y - 0.5 * G * T * T) / T;
      b.face = b.vx >= 0 ? 1 : -1; b.sup = null; setState('fall');
      return true;
    }
    function decide() {
      const r = supRect(); if (!r) return;
      if (Date.now() - lastAct > 40000 && !r.floor) { setState('sleep'); bubble('Zzz…', 1600); return; }
      const roll = Math.random();
      if (SH && !r.floor && Math.random() < 0.3) {
        const n = pick(K.extras), now = performance.now();
        if (n === 'Sit') { b.sitT0 = now; b.sitUntil = now + 3000 + Math.random() * 4000; setState('idle', b.sitUntil - now); }
        else setState('idle', playOnce(n) + 500);
        return;
      }
      if ((r.floor || roll < 0.42) && jumpSomewhere()) return;
      if (roll < 0.8) {
        b.tx = r.l + Math.random() * (r.r - r.l);
        if (Math.abs(b.tx - b.x) > 20) { b.face = b.tx > b.x ? 1 : -1; setState('walk'); return; }
      }
      setState('idle', 1200 + Math.random() * 2500);
    }
    function fx(ch, cls) {
      const s = document.createElement('span'); s.className = 'buddy-fx ' + (cls || ''); s.textContent = ch;
      s.style.left = (b.x - 6 + (Math.random() - .5) * 26) + 'px'; s.style.top = (b.y - b.ht - 6) + 'px';
      document.body.appendChild(s); setTimeout(() => s.remove(), 1400);
    }
    function bubble(text, ms) { say.textContent = text; say.classList.add('show'); clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('show'), ms || 2600); }
    function celebrate(text) {
      if (!on || b.st === 'held') return;
      if (supRect()) { b.vy = -7.5; b.vx = 0; b.sup = null; setState('fall'); }
      b.happyUntil = performance.now() + 1400; b.poseOnLand = true; b.sitUntil = 0;
      for (let i = 0; i < 4; i++) setTimeout(() => fx(i % 2 ? '✦' : '♥', i % 2 ? 'spark' : 'heart'), i * 120);
      if (text) bubble(text);
    }
    function wake() { lastAct = Date.now(); setState('idle', SH ? playOnce('Wake') + 300 : 900); b.happyUntil = performance.now() + 900; fx('!', 'spark'); bubble(pick(["Huh? I'm up!", 'Five more minutes…', 'Oh! Hi there!']), 1800); }

    function update(t, dt) {
      if (b.st === 'held') { b.x = mx; b.y = my + b.ht * 0.6; }
      else if (b.st === 'fall') {
        b.vy += G * dt;
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
        let landed = null;
        if (b.vy > 0) for (const p of plats) if (nx >= p.l && nx <= p.r && b.y <= p.t + 1 && ny >= p.t && (!landed || p.t < landed.t)) landed = p;
        b.x = nx; b.y = ny;
        if (b.x < 16 || b.x > innerWidth - 16) { b.x = Math.max(16, Math.min(innerWidth - 16, b.x)); b.vx *= -0.5; }
        const hard = b.vy > 11;
        if (landed) { b.y = landed.t; standOn(landed); afterLand(hard); }
        else if (b.y >= innerHeight - 2) { b.y = innerHeight - 2; standOn(null); afterLand(hard); }
      } else {
        let r = supRect();
        if (!r) {
          scan();
          const p = plats.find(p => b.x >= p.l && b.x <= p.r && Math.abs(p.t - b.y) < 40);
          if (p) { b.sup = p.el; r = supRect(); } else { setState('fall'); return; }
        }
        if (!r.floor && (r.t < 30 || r.t > innerHeight + 10)) { respawn(); return; }
        b.y = r.t;
        if (b.x < r.l - 4 || b.x > r.r + 4) { b.vx = b.face * 1.5; setState('fall'); return; }
        if (b.st === 'walk') {
          b.x += b.face * 1.15 * dt;
          if ((b.face > 0 && b.x >= b.tx) || (b.face < 0 && b.x <= b.tx) || b.x <= r.l || b.x >= r.r) { b.x = Math.max(r.l, Math.min(r.r, b.x)); setState('idle', 800 + Math.random() * 2000); }
        } else if (b.st === 'sleep') {
          if (t - lastZ > 1300) { lastZ = t; fx('z', 'zz'); }
          if (Math.hypot(mx - b.x, my - (b.y - 20)) < 70) wake();
        } else if (b.st === 'idle' && t > b.until) decide();
        if (b.st === 'idle' && Math.abs(mx - b.x) < 160 && Math.abs(my - b.y) < 160 && Math.abs(mx - b.x) > 8) b.face = mx > b.x ? 1 : -1;
      }
      // pose
      const k = t / 1000, o = { sx: 1, sy: 1, bob: 0, eyes: 'open', feet: 0, tuck: false, sit: false, sway: Math.round(Math.sin(k * 2.2) * 0.6), flap: 0, face: b.face };
      const happy = b.happyUntil > t;
      if (b.st === 'walk') { const ph = Math.floor(t / 110) % 4; o.feet = [-1, 0, 1, 0][ph]; o.bob = [0, -1, 0, -1][ph]; o.flap = ph % 2 ? 1 : 0; }
      else if (b.st === 'fall') { o.tuck = true; o.sy = b.vy < 0 ? 1.08 : 0.98; o.sx = b.vy < 0 ? 0.94 : 1.02; o.eyes = happy ? 'happy' : 'wide'; o.flap = b.vy < 0 ? 1 : -1; }
      else if (b.st === 'held') { o.feet = Math.floor(t / 140) % 2 ? 1 : -1; o.eyes = 'wide'; o.sy = 1.1; o.sx = .92; o.flap = o.feet; }
      else if (b.st === 'sleep') { o.sy = 0.8 + Math.sin(k * 1.6) * 0.03; o.sx = 1.12; o.eyes = 'closed'; o.sway = 1; o.sit = true; o.bob = Math.sin(k * 1.6) > .6 ? 1 : 0; }
      else {
        o.sy = 1 + Math.sin(k * 3) * 0.025;
        if (t - b.land < 140) { o.sy = 0.84; o.sx = 1.12; o.bob = 1; }
        if (t > b.blink) { if (t > b.blink + 130) b.blink = t + 2200 + Math.random() * 2600; else o.eyes = 'closed'; }
      }
      if (happy && b.st !== 'sleep') o.eyes = 'happy';
      if (SH) {
        const [ax, ay] = drawSheet(t);
        b.ht = ay;
        cv.style.transform = `translate(${Math.round(b.x - ax)}px,${Math.round(b.y - ay)}px)`;
      } else {
        render(o); b.ht = H * S - 2;
        cv.style.transform = `translate(${Math.round(b.x - W * S / 2)}px,${Math.round(b.y - H * S + 2)}px)`;
      }
      say.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - 190, b.x - 90)))}px,${Math.round(b.y - b.ht - 34)}px)`;
    }

    cv.addEventListener('pointerdown', e => {
      e.preventDefault(); cv.setPointerCapture(e.pointerId);
      mx = e.clientX; my = e.clientY;
      down = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, vx: 0, vy: 0 };
    });
    cv.addEventListener('pointermove', e => {
      if (!down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 && b.st !== 'held') {
        setState('held'); b.sup = null; document.body.classList.add('buddy-drag'); getSelection().removeAllRanges(); bubble(K.held || 'Wheee!', 1200);
      }
      down.vx = (e.clientX - down.px) * 0.6; down.vy = (e.clientY - down.py) * 0.6; down.px = e.clientX; down.py = e.clientY;
    });
    cv.addEventListener('pointerup', () => {
      if (!down) return;
      document.body.classList.remove('buddy-drag');
      if (b.st === 'held') { b.vx = Math.max(-16, Math.min(16, down.vx)); b.vy = Math.max(-16, Math.min(16, down.vy)); setState('fall'); }
      else if (b.st === 'sleep') wake();
      else if (SH) {
        lastAct = Date.now(); b.sitUntil = 0;
        setState('idle', playOnce(pick(K.clicks)) + 400);
        for (let i = 0; i < 3; i++) setTimeout(() => fx(i % 2 ? '✦' : '⚡', 'spark'), i * 120);
        bubble(Math.random() < .5 ? hint() : pick(K.lines));
      }
      else celebrate(Math.random() < .5 ? hint() : pick(K.lines));
      down = null;
    });

    return {
      kind, K, update, celebrate,
      get on() { return on; },
      start() { on = true; if (!cv.isConnected) document.body.append(cv, say); respawn(); setTimeout(() => bubble(K.hello, 2200), 900); },
      stop() { on = false; cv.remove(); say.remove(); },
    };
  }

  /* ---------- loop, input, menu ---------- */
  const buddies = Object.keys(KINDS).map(makeBuddy).filter(Boolean);
  let raf = 0, lastT = 0;
  function loop(t) {
    const live = buddies.filter(x => x.on);
    if (!live.length || document.hidden) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    const dt = Math.min(2.5, (t - (lastT || t)) / 16.67); lastT = t;
    if (t - lastScan > 250) scan();
    live.forEach(x => x.update(t, dt));
  }
  const kick = () => { if (!raf) { lastT = 0; raf = requestAnimationFrame(loop); } };

  addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; lastAct = Date.now(); }, { passive: true });
  addEventListener('keydown', () => { lastAct = Date.now(); }, { passive: true });
  addEventListener('scroll', () => scan(), { passive: true, capture: true });
  addEventListener('resize', () => scan());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });

  const toastEl = document.getElementById('toast');
  if (toastEl) new MutationObserver(() => {
    if (toastEl.classList.contains('win') && toastEl.style.display === 'block') {
      lastAct = Date.now();
      buddies.forEach((x, i) => setTimeout(() => x.celebrate(pick(['Nice! ✦', 'Quest cleared!', 'GG!', 'Look at you go!'])), i * 250));
    }
  }).observe(toastEl, { attributes: true, attributeFilter: ['class', 'style'] });

  const exp = document.getElementById('exportBtn');
  buddies.forEach(bd => {
    const wanted = getPref(bd.K.pref) ?? (innerWidth >= 600);
    const btn = document.createElement('button');
    const label = () => { btn.textContent = `${bd.K.icon} ${bd.on ? 'Hide' : 'Show'} ${bd.K.name}`; };
    btn.addEventListener('click', () => { if (bd.on) bd.stop(); else { bd.start(); kick(); } setPref(bd.K.pref, bd.on); label(); });
    if (exp) exp.parentNode.insertBefore(btn, exp);
    if (wanted) setTimeout(() => { bd.start(); kick(); label(); }, 1200 + Math.random() * 600);
    label();
  });
})();
