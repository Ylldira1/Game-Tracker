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
    paimon: { name: 'Paimon', icon: '✨', pref: 'get.buddy4', sheet: 'paimon', scale: 2, float: true, flip: true, glow: 'rgba(160,220,255,.4)',
      hello: 'Hi! Paimon is here! ✨', held: 'Hey! Put Paimon down!', lines: ['Ehe~', "Paimon is not emergency food!", "Let's finish those quests!", 'Paimon is the best guide ever!'],
      clicks: ['Taunt'], extras: ['Wait', 'Taunt', 'Wait'] },
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
    function drawSheet(t, fi) {
      const [sx, sy, w, h, ax, ay] = SH.frames[fi != null ? fi : sheetFrame(t)];
      const cw = w * SC, ch = h * SC, flip = K.flip && b.face < 0;
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; } else ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = false;
      if (img.complete) {
        if (flip) { ctx.save(); ctx.translate(cw, 0); ctx.scale(-1, 1); }
        ctx.drawImage(img, sx, sy, w, h, 0, 0, cw, ch);
        if (flip) ctx.restore();
      }
      return [(flip ? w - ax : ax) * SC, ay * SC];
    }

    /* ---------- floating characters (no gravity) ---------- */
    const HOV = 16;
    const shadow = document.createElement('div'); shadow.className = 'buddy-shadow';
    function fxSheet(n, x, y, rev) {
      const A = SH.anims[n]; if (!A) return;
      const ids = A.dirs.r.slice(); if (rev) ids.reverse();
      const c = document.createElement('canvas'); c.className = 'buddy-fxs'; const g = c.getContext('2d');
      document.body.appendChild(c); let i = 0;
      const tick = () => {
        if (i >= ids.length || !on) { c.remove(); return; }
        const [sx, sy, w, h, ax, ay] = SH.frames[ids[i++]];
        const FS = SC * 1.5;
        c.width = w * FS; c.height = h * FS; g.imageSmoothingEnabled = false;
        g.drawImage(img, sx, sy, w, h, 0, 0, w * FS, h * FS);
        c.style.transform = `translate(${Math.round(x - ax * FS)}px,${Math.round(y - ay * FS)}px)`;
        setTimeout(tick, 70);
      };
      tick();
    }
    function pickPlat(exclude) { scan(); const c = plats.filter(p => p.el !== exclude); return c.length ? pick(c) : null; }
    function flyTo(p, x) {
      b.sup = p ? p.el : null;
      b.tx = x != null ? x : (p ? p.l + Math.random() * (p.r - p.l) : innerWidth / 2);
      const nf = b.tx > b.x ? 1 : -1;
      if (nf !== b.face) { b.face = nf; playOnce('Turn'); }
      setState('fly');
    }
    function poof() { fxSheet('Fx', b.x, b.y - b.ht / 2); b.hidden = true; setState('poof', 450); }
    function floatDecide() {
      if (Date.now() - lastAct > 40000) { setState('sleep'); bubble('Zzz…', 1600); return; }
      const roll = Math.random(), r = supRect();
      if (roll < 0.4) { const p = pickPlat(b.sup); if (p) { flyTo(p); return; } }
      if (roll < 0.62 && r && !r.floor) { flyTo({ el: b.sup }, r.l + Math.random() * (r.r - r.l)); return; }
      if (roll < 0.8) { poof(); return; }
      setState('hover', playOnce(pick(K.extras)) + 800);
    }
    function floatFrame(t) {
      if (b.once && t >= b.once.end) b.once = null;
      if (b.st === 'held') return frameOf('Run', 'r', t * 1.6, true);
      if (b.once) return frameOf(b.once.n, 'r', t - b.once.t0, false);
      if (b.st === 'fly' || b.st === 'fall') return frameOf('Run', 'r', t, true);
      if (b.st === 'sleep') return SH.anims.Stand.dirs.r[0];
      return frameOf('Stand', 'r', t, true);
    }
    function floatUpdate(t, dt) {
      let r = supRect();
      if (b.st === 'held') { b.x = mx; b.y = my + b.ht * 0.6; }
      else if (b.st === 'fall') {                     // drifting after being thrown
        b.x += b.vx * dt; b.y += b.vy * dt;
        const damp = Math.pow(0.93, dt); b.vx *= damp; b.vy *= damp;
        if (b.x < 20 || b.x > innerWidth - 20) { b.x = Math.max(20, Math.min(innerWidth - 20, b.x)); b.vx *= -0.6; }
        if (b.y < 60 || b.y > innerHeight - 10) { b.y = Math.max(60, Math.min(innerHeight - 10, b.y)); b.vy *= -0.6; }
        if (Math.hypot(b.vx, b.vy) < 0.4) {
          scan(); let best = null, bd = 1e9;
          for (const p of plats) { const cx = Math.max(p.l, Math.min(p.r, b.x)); const d = Math.hypot(cx - b.x, p.t - HOV - b.y) + (p.t < b.y ? 150 : 0); if (d < bd) { bd = d; best = p; } }
          flyTo(best, best ? Math.max(best.l, Math.min(best.r, b.x)) : null);
        }
      } else if (b.st === 'poof') {
        if (t > b.until) {
          const p = pickPlat(b.sup); b.sup = p ? p.el : null; const rr = supRect();
          b.x = p ? p.l + Math.random() * (p.r - p.l) : innerWidth / 2; b.y = rr.t - HOV; b.hidden = false;
          fxSheet('Fx', b.x, b.y - b.ht / 2, true); setState('hover', 1500 + Math.random() * 2000);
        }
      } else {
        if (!r) {                                     // list was redrawn: re-attach to whatever is now under her
          scan();
          const gap = b.st === 'sleep' ? 4 : HOV;
          const p = plats.find(p => b.x >= p.l - 6 && b.x <= p.r + 6 && Math.abs(p.t - gap - b.y) < 40);
          if (p) b.sup = p.el; else if (b.st === 'sleep') b.sup = null; else flyTo(pickPlat());
          r = supRect();
        }
        if (!r.floor && (r.t < 30 || r.t > innerHeight + 10)) { b.hidden = true; setState('poof', 0); }
        else {
          const sleep = b.st === 'sleep', ty = r.t - (sleep ? 4 : HOV);
          if (b.st === 'fly') {
            const dx = b.tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
            if (d < 3) { b.x = b.tx; setState('hover', 1500 + Math.random() * 2500); }
            else { const sp = Math.min(3.4, 0.6 + d * 0.05) * dt; b.x += dx / d * Math.min(sp, d); b.y += dy / d * Math.min(sp, d); }
          } else {
            b.y += (ty - b.y) * Math.min(1, 0.12 * dt);
            if (b.x < r.l) b.x += (r.l - b.x) * 0.1; if (b.x > r.r) b.x += (r.r - b.x) * 0.1;
            if (sleep) { if (t - lastZ > 1300) { lastZ = t; fx('z', 'zz'); } if (Math.hypot(mx - b.x, my - (b.y - 20)) < 70) wake(); }
            else {
              if (t > b.until) floatDecide();
              if (b.st === 'hover' && !b.once && Math.abs(mx - b.x) < 160 && Math.abs(my - b.y) < 160 && Math.abs(mx - b.x) > 8) { const nf = mx > b.x ? 1 : -1; if (nf !== b.face) { b.face = nf; playOnce('Turn'); } }
            }
          }
        }
      }
      // draw
      let bob = b.st === 'held' ? 0 : Math.sin(t / 520) * 3, extra = '';
      const [ax, ay] = drawSheet(t, floatFrame(t));
      if (b.st === 'sleep') {
        // dozing: slow breathing + slowly nodding off, then a little jolt back up
        const ph = (t % 6500) / 6500;
        const droop = ph < 0.82 ? 3 + 11 * (ph / 0.82) ** 1.6 : 14 - 12 * Math.min(1, (ph - 0.82) / 0.05);
        const jolt = ph > 0.82 && ph < 0.9 ? -3 * Math.sin((ph - 0.82) / 0.08 * Math.PI) : 0;
        bob = Math.sin(t / 1500) * 1.5 + jolt;
        const breathe = 1 + Math.sin(t / 900) * 0.03;
        extra = ` rotate(${(droop * b.face).toFixed(1)}deg) scale(${(2 - breathe).toFixed(3)},${breathe.toFixed(3)})`;
      }
      b.ht = ay;
      cv.style.opacity = b.hidden ? 0 : 1;
      cv.style.transformOrigin = `${Math.round(ax)}px ${Math.round(ay)}px`;
      cv.style.transform = `translate(${Math.round(b.x - ax)}px,${Math.round(b.y + bob - ay)}px)` + extra;
      r = supRect();
      if (r && b.st !== 'held' && !b.hidden) {
        const gap = Math.max(0, r.t - b.y - bob), k = Math.max(0.3, Math.min(1, 1 - gap / 220));
        shadow.style.opacity = (0.55 * k).toFixed(2);
        shadow.style.transform = `translate(${Math.round(b.x)}px,${Math.round(r.t)}px) scale(${k.toFixed(2)})`;
      } else shadow.style.opacity = 0;
      say.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - 190, b.x - 90)))}px,${Math.round(b.y + bob - b.ht - 34)}px)`;
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
      if (K.float) { b.hidden = true; setState('poof', 300); return; }
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
      if (K.float) {
        b.hidden = false; setState('hover', playOnce('Taunt') + 300); fxSheet('Fx', b.x, b.y - b.ht / 2);
        for (let i = 0; i < 4; i++) setTimeout(() => fx(i % 2 ? '✦' : '♥', i % 2 ? 'spark' : 'heart'), i * 120);
        if (text) bubble(text); return;
      }
      if (supRect()) { b.vy = -7.5; b.vx = 0; b.sup = null; setState('fall'); }
      b.happyUntil = performance.now() + 1400; b.poseOnLand = true; b.sitUntil = 0;
      for (let i = 0; i < 4; i++) setTimeout(() => fx(i % 2 ? '✦' : '♥', i % 2 ? 'spark' : 'heart'), i * 120);
      if (text) bubble(text);
    }
    function wake() { lastAct = Date.now(); if (K.float) fxSheet('Fx', b.x, b.y - b.ht / 2); setState(K.float ? 'hover' : 'idle', SH ? playOnce('Wake') + 300 : 900); b.happyUntil = performance.now() + 900; fx('!', 'spark'); bubble(pick(["Huh? I'm up!", 'Five more minutes…', 'Oh! Hi there!']), 1800); }

    function update(t, dt) {
      if (K.float) return floatUpdate(t, dt);
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
        setState(K.float ? 'hover' : 'idle', playOnce(pick(K.clicks)) + 400);
        if (K.float) fxSheet('Fx', b.x, b.y - b.ht / 2);
        for (let i = 0; i < 3; i++) setTimeout(() => fx(i % 2 || K.float ? '✦' : '⚡', 'spark'), i * 120);
        bubble(Math.random() < .5 ? hint() : pick(K.lines));
      }
      else celebrate(Math.random() < .5 ? hint() : pick(K.lines));
      down = null;
    });

    return {
      kind, K, update, celebrate,
      get on() { return on; },
      start() { on = true; if (!cv.isConnected) document.body.append(cv, say); if (K.float) document.body.append(shadow); respawn(); setTimeout(() => bubble(K.hello, 2200), 900); },
      stop() { on = false; cv.remove(); say.remove(); shadow.remove(); },
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

  /* ---------- Buddy collection (one menu item → picker window) ---------- */
  const TAGS = { mochi: 'Walks, jumps & naps', pika: 'Hops, sparks & tumbles', paimon: 'Floats & teleports' };
  const exp = document.getElementById('exportBtn');
  const menuBtn = document.createElement('button'); menuBtn.id = 'buddiesBtn'; menuBtn.className = 'mi';
  menuBtn.innerHTML = `<span class="mi-ic" style="--ic:#ff7eb6"><svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="6" cy="10" rx="2.2" ry="2.8"/><ellipse cx="10" cy="5.5" rx="2.2" ry="2.8"/><ellipse cx="14.5" cy="5.5" rx="2.2" ry="2.8"/><ellipse cx="18.5" cy="10" rx="2.2" ry="2.8"/><path d="M12.2 11c-3.2 0-6.2 4.4-6.2 6.8 0 1.7 1.3 2.7 3 2.7 1.3 0 2.2-.7 3.2-.7s1.9.7 3.2.7c1.7 0 3-1 3-2.7 0-2.4-3-6.8-6.2-6.8z"/></svg></span><span class="mi-tx"><b>Buddies</b><small>Page companions</small></span><span class="mi-badge"></span>`;
  if (exp) exp.parentNode.insertBefore(menuBtn, exp);
  const modal = document.createElement('div'); modal.className = 'modal'; modal.id = 'buddyModal';
  modal.innerHTML = `<div class="card bd-card">
    <div class="modal-head"><h2>🐾 Buddies</h2><button class="icon-btn" type="button" data-close="buddyModal" aria-label="Close">✕</button></div>
    <p class="hint" style="margin:2px 0 12px">Pick who hangs out on your page. Click a buddy to pet it, drag to throw it.</p>
    <div class="bd-grid"></div>
    <div class="bd-foot"><span class="bd-count"></span><span class="spacer"></span>
      <button type="button" class="linkbtn" data-bd="none">Hide all</button><button type="button" class="linkbtn" data-bd="all">Show all</button></div>
  </div>`;
  document.body.appendChild(modal);
  const grid = modal.querySelector('.bd-grid');

  // live previews
  const PS = 3;
  function previewFrame(bd, t) {
    const K = bd.K;
    if (K.sheet) {
      const SH = window.BUDDY_SHEETS[K.sheet], n = SH.anims.Idle ? 'Idle' : 'Stand', A = SH.anims[n];
      const total = A.d.reduce((a, c) => a + c, 0) * 1000 / 60; let acc = 0, tt = t % total, i = 0;
      for (; i < A.d.length; i++) { acc += A.d[i] * 1000 / 60; if (tt < acc) break; }
      return { sheet: SH, fi: A.dirs.dr[Math.min(i, A.d.length - 1)] };
    }
    return null;
  }
  const imgs = {};
  function drawPreview(bd, c, t) {
    const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
    const K = bd.K, bob = K.float ? Math.sin(t / 520) * 3 : 0;
    if (K.sheet) {
      const { sheet, fi } = previewFrame(bd, t);
      const im = imgs[K.sheet] || (imgs[K.sheet] = Object.assign(new Image(), { src: sheet.img }));
      const [sx, sy, w, h, ax, ay] = sheet.frames[fi];
      const top = (K.float ? 18 : 10), ps = Math.min(PS, Math.floor((c.height - top - 8) / ay));
      if (im.complete) g.drawImage(im, sx, sy, w, h, Math.round(c.width / 2 - ax * ps), Math.round(c.height - top - ay * ps + bob), w * ps, h * ps);
    } else {
      const k = t / 1000, blink = (t % 3200) < 130;
      const o = { sx: 1, sy: 1 + Math.sin(k * 3) * 0.025, bob: 0, eyes: blink ? 'closed' : 'open', feet: 0, tuck: false, sway: Math.round(Math.sin(k * 2.2) * 0.6), flap: 0, face: 1 };
      const grid = {}; K.draw((x, y, cc) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < K.W && y >= 0 && y < K.H) grid[x + ',' + y] = cc; }, o, K.W, K.H);
      const ox = Math.round(c.width / 2 - K.W * PS / 2), oy = c.height - 10 - K.H * PS;
      for (const key in grid) { const [x, y] = key.split(',').map(Number); g.fillStyle = K.pal[grid[key]]; g.fillRect(ox + x * PS, oy + y * PS, PS, PS); }
    }
  }
  let prevRaf = 0;
  function previewLoop(t) {
    if (!modal.classList.contains('show')) { prevRaf = 0; return; }
    grid.querySelectorAll('canvas').forEach(c => drawPreview(buddies[+c.dataset.i], c, t));
    prevRaf = requestAnimationFrame(previewLoop);
  }

  function refresh() {
    const n = buddies.filter(x => x.on).length;
    const bdg = menuBtn.querySelector('.mi-badge'); bdg.textContent = n ? `${n} on` : 'Off'; bdg.classList.toggle('off', !n);
    modal.querySelector('.bd-count').textContent = `${n} of ${buddies.length} showing`;
    grid.querySelectorAll('.bd-item').forEach(el => {
      const on = buddies[+el.dataset.i].on;
      el.classList.toggle('on', on); el.setAttribute('aria-pressed', on);
      el.querySelector('.bd-state').textContent = on ? '✓ On' : 'Off';
    });
  }
  grid.innerHTML = buddies.map((bd, i) => `<button type="button" class="bd-item" data-i="${i}" style="--bg:${bd.K.glow}">
      <span class="bd-prev"><canvas width="132" height="120" data-i="${i}"></canvas></span>
      <span class="bd-name">${bd.K.icon} ${bd.K.name}</span>
      <span class="bd-tag">${TAGS[bd.kind] || ''}</span>
      <span class="bd-state"></span></button>`).join('');
  function setOn(bd, v) { if (v === bd.on) return; if (v) { bd.start(); kick(); } else bd.stop(); setPref(bd.K.pref, bd.on); }
  grid.addEventListener('click', e => { const it = e.target.closest('.bd-item'); if (!it) return; const bd = buddies[+it.dataset.i]; setOn(bd, !bd.on); refresh(); });
  modal.addEventListener('click', e => {
    const a = e.target.closest('[data-bd]'); if (a) { buddies.forEach(bd => setOn(bd, a.dataset.bd === 'all')); refresh(); return; }
    if (e.target === modal) modal.classList.remove('show');
  });
  addEventListener('keydown', e => { if (e.key === 'Escape') modal.classList.remove('show'); });
  menuBtn.addEventListener('click', () => {
    const m = document.getElementById('menu'); if (m) m.hidden = true;
    refresh(); modal.classList.add('show');
    if (!prevRaf) prevRaf = requestAnimationFrame(previewLoop);
  });

  buddies.forEach(bd => {
    const wanted = getPref(bd.K.pref) ?? (innerWidth >= 600);
    if (wanted) setTimeout(() => { bd.start(); kick(); refresh(); }, 1200 + Math.random() * 600);
  });
  refresh();
})();
