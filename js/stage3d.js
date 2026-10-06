/* 포캣몬 배틀 무대 (T3)
   - three.js r128(전역 THREE) 3D 경기장: 원통형 배경 그림 + 원형 석판 무대(룬 링 발광) + SVG 입간판 캐릭터 + 입자 연출
   - WebGL을 쓸 수 없으면(또는 opts.force2d) 같은 배경 그림·SVG 캐릭터를 쓰는 DOM/CSS 2D 화면으로 대체
   전역: Stage.create(containerEl, { force2d, assetBase }) → stage
   모든 연출 메서드는 동작이 끝나면 resolve 되는 Promise를 돌려주며 절대 reject 하지 않는다. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  var TAU = Math.PI * 2;
  var FOOT = (root.Sprites && Sprites.FOOT) || 0.031;       // 발끝 아래 투명 여백 비율
  var ART_TOP = (root.Sprites && Sprites.ART_TOP) || 0.86;  // 발끝에서 그림 꼭대기까지 높이(판 크기 대비)

  /* ───────────── 공통 유틸 ───────────── */
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function noop() {}
  function other(side) { return side === 'player' ? 'enemy' : 'player'; }
  function isSide(side) { return side === 'player' || side === 'enemy'; }
  var Ez = {
    lin: function (k) { return k; },
    outCubic: function (k) { return 1 - Math.pow(1 - k, 3); },
    inCubic: function (k) { return k * k * k; },
    inQuad: function (k) { return k * k; },
    outQuad: function (k) { return 1 - (1 - k) * (1 - k); },
    inOut: function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; },
    outBack: function (k) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
  };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 어떤 경우에도(예외·지연) resolve 되는 Promise
  function safe(fn, maxMs) {
    return new Promise(function (resolve) {
      var done = false;
      var to = setTimeout(function () { fin(); }, maxMs || 6000);
      function fin() { if (!done) { done = true; clearTimeout(to); resolve(); } }
      try {
        var p = fn();
        if (p && typeof p.then === 'function') p.then(fin, fin); else fin();
      } catch (e) { fin(); }
    });
  }

  function monHeight(id) {
    try {
      var m = root.PData && PData.MONSTERS && PData.MONSTERS[id], h = m && +m.height;
      return h > 0 ? clamp(h, 0.15, 2.5) : 0.45;
    } catch (e) { return 0.45; }
  }
  function spriteSrc(id, shiny) {
    try { return root.Sprites ? Sprites.spriteURL(id, { shiny: !!shiny }) : ''; } catch (e) { return ''; }
  }
  function assetURL(base, rel) {
    if (base) return String(base).replace(/\/?$/, '/') + rel;
    try { if (SCRIPT_SRC) return new URL('../' + rel, SCRIPT_SRC).href; } catch (e) { /* 상대 경로로 대체 */ }
    return rel;
  }
  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }
  function hexRGB(hex) {
    var h = String(hex || '#ffffff').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // 배경 키 → 테마 (룬 링·안개·주변 입자·비네트)
  var THEMES = {
    sea: { rune: '#38b8ff', fog: '#d6f1ff', haze: 0.30, stone: '#efe6d6', amb: 'bubble', vign: 'rgba(4,26,58,.55)' },
    ice: { rune: '#5af2ff', fog: '#eef9ff', haze: 0.36, stone: '#e8f2fb', amb: 'snow', vign: 'rgba(16,46,92,.5)' },
    alley: { rune: '#ff8a2a', fog: '#ffaa66', haze: 0.20, stone: '#c2b0a4', amb: 'dust', vign: 'rgba(28,8,30,.66)' },
    metal: { rune: '#ffc83a', fog: '#f4f8ff', haze: 0.34, stone: '#f2e8d2', amb: 'mote', vign: 'rgba(8,28,72,.48)' },
    dark: { rune: '#ff2440', fog: '#7a0c26', haze: 0.34, stone: '#9a8894', amb: 'ember', vign: 'rgba(22,0,8,.74)' },
    forest: { rune: '#6dff8a', fog: '#e2f6d2', haze: 0.30, stone: '#d6dcbc', amb: 'leaf', vign: 'rgba(6,30,12,.55)' },
    volcano: { rune: '#ff5a1a', fog: '#ff9a5a', haze: 0.26, stone: '#a8908a', amb: 'ash', vign: 'rgba(40,6,0,.68)' },
    temple: { rune: '#c89aff', fog: '#ece0ff', haze: 0.32, stone: '#e6dccc', amb: 'star', vign: 'rgba(20,10,48,.6)' }
  };
  // 기술 타입별 입자 색 (18타입 + 회복)
  var FXC = {
    normal: ['#efe0c0', '#c8b088', '#9a8462'],
    fire: ['#ffd84a', '#ff7a1a', '#ff3a10'],
    water: ['#9ae0ff', '#3aa8ff', '#e8f8ff'],
    grass: ['#a8ff6a', '#3ec94a', '#1e9a3a'],
    electric: ['#fff7a0', '#ffe12a', '#ffffff'],
    ice: ['#effcff', '#9fe3ff', '#56c8ee'],
    fighting: ['#ffc08a', '#ff6a2a', '#ffe6cc'],
    poison: ['#d890ff', '#a040f0', '#7a1ac0'],
    ground: ['#ecd09a', '#c0904a', '#8a6232'],
    flying: ['#f2faff', '#bfe0ff', '#ffffff'],
    psychic: ['#ffa0dc', '#ff5ab4', '#ffd6f2'],
    bug: ['#e0ff5a', '#9ad02a', '#f4ffa8'],
    rock: ['#d6c6a6', '#a8967a', '#7a6a52'],
    ghost: ['#b48aff', '#6a3ac8', '#3a1a78'],
    dragon: ['#5af0e0', '#7a5aff', '#c8a8ff'],
    dark: ['#ff2a3a', '#ff6a7a', '#8b0f2a'],
    steel: ['#fff6c0', '#ffc23a', '#ff8a2a'],
    fairy: ['#ffc0ec', '#ff7ac8', '#fff2fb'],
    heal: ['#8cffb0', '#3ee07a', '#e6ffee']
  };
  // 타입별 공격 방식: melee(돌진) / proj(투사체, T초 비행) / remote(대상 위치에 직접 발현, T초 뒤 명중)
  var TYPEFX = {
    normal: { m: 'melee' }, fighting: { m: 'melee', out: 190, ly: 0.18 }, dark: { m: 'melee' }, steel: { m: 'melee' },
    flying: { m: 'melee', out: 240, ly: 0.8 },
    fire: { m: 'proj', T: 0.34 }, water: { m: 'proj', T: 0.36 }, ice: { m: 'proj', T: 0.36 }, grass: { m: 'proj', T: 0.48 },
    electric: { m: 'proj', T: 0.2 }, poison: { m: 'proj', T: 0.44 }, ghost: { m: 'proj', T: 0.42 }, dragon: { m: 'proj', T: 0.3 },
    bug: { m: 'proj', T: 0.44 }, fairy: { m: 'proj', T: 0.4 },
    psychic: { m: 'remote', T: 0.34 }, ground: { m: 'remote', T: 0.26 }, rock: { m: 'remote', T: 0.46 }
  };
  var FX_TYPES = Object.keys(TYPEFX);
  function fxKey(fx) { return TYPEFX.hasOwnProperty(fx) ? fx : 'normal'; }
  // 상태이상 종류 (지속 표시용)
  var ST_KINDS = { brn: 1, psn: 1, tox: 1, par: 1, slp: 1, frz: 1 };

  /* ───────────── 공통 DOM(CSS·오버레이) ───────────── */
  var CSS = [
    '.pst-root{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;-webkit-user-select:none;user-select:none;background:#0b1020}',
    '.pst-canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}',
    '.pst-vig,.pst-flash,.pst-cam,.pst-shake,.pst-fx{position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none}',
    '.pst-flash{opacity:0}',
    '.pst-cam{transform-origin:50% 50%;transition:transform .7s cubic-bezier(.45,0,.25,1)}',
    '.pst-bg{position:absolute;left:-4%;top:-4%;right:-4%;bottom:-4%;background-size:cover;background-position:50% 58%;background-repeat:no-repeat;opacity:0;transition:opacity .6s ease}',
    '.pst-floor{position:absolute;z-index:2;left:50%;top:77%;width:126%;height:36%;transform:translate(-50%,-50%);border-radius:50%;box-shadow:0 14px 26px rgba(0,0,0,.5)}',
    '.pst-2d .pst-fx{z-index:6}',
    '.pst-ring{position:absolute;left:7%;top:9%;right:7%;bottom:9%;border-radius:50%;border:3px solid var(--rc,#fff);box-shadow:0 0 14px var(--rc,#fff),inset 0 0 14px var(--rc,#fff);animation:pst-pulse 2.6s ease-in-out infinite}',
    '.pst-ring2{left:30%;top:31%;right:30%;bottom:31%;border-width:2px;opacity:.7}',
    '.pst-f{position:absolute;z-index:3;width:0;height:0}',
    '.pst-f-player{z-index:4}',
    '.pst-shadow{position:absolute;left:0;top:0;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.55),rgba(0,0,0,0))}',
    '.pst-move{position:absolute}',
    '.pst-idle{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:50% 96%;animation:pst-breathe 2.7s ease-in-out infinite}',
    '.pst-img{position:absolute;left:0;top:0;width:100%;height:100%;display:block}',
    '.pst-flip{transform:scaleX(-1)}',
    '.pst-aura{position:absolute;left:-14%;top:2%;width:128%;height:96%;border-radius:50%;background:radial-gradient(closest-side,var(--ac,#f24),rgba(0,0,0,0));opacity:0;transition:opacity .4s;animation:pst-auraP 1.4s ease-in-out infinite;mix-blend-mode:screen}',
    '.pst-shield{position:absolute;left:0;top:6%;width:100%;height:100%;border-radius:50%;opacity:0;transform:scale(.6);transition:opacity .3s,transform .35s cubic-bezier(.3,1.6,.5,1);' +
      'background:radial-gradient(circle at 34% 28%,rgba(255,255,255,.6),rgba(255,255,255,0) 18%),radial-gradient(circle,rgba(var(--sc),.08) 48%,rgba(var(--sc),.38) 80%,rgba(var(--sc),.8) 100%);' +
      'border:2px solid rgba(var(--sc),.75);box-shadow:0 0 18px rgba(var(--sc),.7),inset 0 0 14px rgba(var(--sc),.5)}',
    '.pst-shield.on{opacity:1;transform:scale(1)}',
    '.pst-ice{position:absolute;left:0;top:0;width:100%;height:100%;opacity:0;transition:opacity .35s}',
    '.pst-ice.on{opacity:1}',
    '.pst-shard{position:absolute;bottom:3%;width:12%;height:26%;clip-path:polygon(50% 0,100% 45%,50% 100%,0 45%);-webkit-clip-path:polygon(50% 0,100% 45%,50% 100%,0 45%);background:linear-gradient(160deg,#fff,#9fe3ff 60%,#4cc3e8);opacity:.9}',
    '.pst-frozen{filter:saturate(.45) brightness(1.18) drop-shadow(0 0 6px #aef)}',
    '.pst-dot{position:absolute;left:0;top:0;border-radius:50%;pointer-events:none;will-change:transform,opacity}',
    '.pst-slash{position:absolute;left:0;top:0;height:12px;border-radius:50%;background:linear-gradient(90deg,rgba(255,40,60,0),#ff2a3a 28%,#fff 60%,rgba(255,40,60,0));box-shadow:0 0 14px #ff2a3a}',
    '.pst-arrow{position:absolute;left:0;top:0;width:22px;height:26px;clip-path:polygon(50% 0,100% 50%,70% 50%,70% 100%,30% 100%,30% 50%,0 50%);-webkit-clip-path:polygon(50% 0,100% 50%,70% 50%,70% 100%,30% 100%,30% 50%,0 50%)}',
    '.pst-ghost{position:absolute;z-index:3;left:0;top:0;transform-origin:50% 96%}',
    '.pst-wave{position:absolute;left:0;top:0;border-radius:50%;border:4px solid var(--wc,#fff);box-shadow:0 0 12px var(--wc,#fff),inset 0 0 10px var(--wc,#fff)}',
    '.pst-ball{position:absolute;left:0;top:0;z-index:7;pointer-events:none;will-change:transform}',
    '.pst-glyph{position:absolute;left:0;top:0;font:900 20px/1 sans-serif;color:#e4f0ff;-webkit-text-stroke:1px #26365e;text-shadow:0 0 6px #8ab4ff;pointer-events:none}',
    '.pst-st-psn{filter:drop-shadow(0 0 5px rgba(176,80,255,.85)) saturate(.9)}',
    '.pst-st-tox{filter:drop-shadow(0 0 7px rgba(140,40,230,.95)) saturate(.8) brightness(.94)}',
    '.pst-st-brn{filter:drop-shadow(0 0 6px rgba(255,120,40,.9))}',
    '.pst-st-par{filter:drop-shadow(0 0 4px rgba(255,230,60,.9))}',
    '.pst-st-slp{filter:brightness(.74) saturate(.8);animation-duration:4.6s}',
    '.pst-paused .pst-idle,.pst-paused .pst-ring,.pst-paused .pst-aura{animation-play-state:paused}',
    '@keyframes pst-breathe{0%,100%{transform:scale(1,1) rotate(0deg)}25%{transform:scale(1.005,1.012) rotate(.8deg)}50%{transform:scale(1.01,1.024) rotate(0deg)}75%{transform:scale(1.005,1.012) rotate(-.8deg)}}',
    '@keyframes pst-pulse{0%,100%{opacity:.55}50%{opacity:1}}',
    '@keyframes pst-auraP{0%,100%{transform:scale(.94)}50%{transform:scale(1.07)}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('pst-style')) return;
    var s = document.createElement('style');
    s.id = 'pst-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  // Web Animations API → Promise (미지원·실패 시 시간 경과로 resolve)
  function animate(elm, kf, o) {
    return new Promise(function (resolve) {
      var dur = (o && o.duration) || 300, delay = (o && o.delay) || 0;
      var to = setTimeout(resolve, dur + delay + 400);
      function fin() { clearTimeout(to); resolve(); }
      try {
        if (!elm || typeof elm.animate !== 'function') { clearTimeout(to); setTimeout(resolve, dur + delay); return; }
        var a = elm.animate(kf, o);
        a.onfinish = fin;
        a.oncancel = fin;
      } catch (e) { clearTimeout(to); setTimeout(resolve, dur + delay); }
    });
  }
  function prepContainer(c) {
    try {
      var cs = root.getComputedStyle ? getComputedStyle(c) : null;
      if (cs && cs.position === 'static') c.style.position = 'relative';
    } catch (e) { /* 무시 */ }
  }
  function Overlay(rootEl) {
    this.vig = el('div', 'pst-vig', rootEl);
    this.flashEl = el('div', 'pst-flash', rootEl);
  }
  Overlay.prototype.setTheme = function (th) {
    this.vig.style.background = 'radial-gradient(130% 95% at 50% 52%, rgba(0,0,0,0) 58%, ' + th.vign + ' 100%),' +
      'linear-gradient(to bottom, ' + th.vign + ' 0%, rgba(0,0,0,0) 16%, rgba(0,0,0,0) 80%, ' + th.vign + ' 100%)';
  };
  Overlay.prototype.flash = function (color, peak, dur) {
    this.flashEl.style.background = color || '#ffffff';
    return animate(this.flashEl, [{ opacity: 0 }, { opacity: peak == null ? 0.85 : peak, offset: 0.14 }, { opacity: 0 }],
      { duration: dur || 520, easing: 'ease-out' });
  };

  /* ───────────── 3D: 시간 기반 트윈 ───────────── */
  function Tweens() { this.list = []; }
  Tweens.prototype.add = function (dur, fn, ease) {
    var list = this.list;
    if (this.dead) return Promise.resolve();     // 해제된 무대: 즉시 완료
    return new Promise(function (resolve) {
      list.push({ t0: now(), dur: Math.max(1, dur), fn: fn || noop, ease: ease || Ez.lin, resolve: resolve });
    });
  };
  Tweens.prototype.wait = function (ms) { return this.add(ms, noop); };
  Tweens.prototype.step = function (t) {
    var list = this.list;
    if (!list.length) return;
    var fin = [];
    for (var i = 0; i < list.length; i++) {
      var tw = list[i];
      var k = clamp((t - tw.t0) / tw.dur, 0, 1);
      try { tw.fn(tw.ease(k), k); } catch (e) { k = 1; }
      if (k >= 1) { fin.push(tw); list.splice(i, 1); i--; }
    }
    for (var j = 0; j < fin.length; j++) fin[j].resolve();
  };
  Tweens.prototype.clear = function () {
    var l = this.list;
    this.dead = true;
    this.list = [];
    for (var i = 0; i < l.length; i++) l[i].resolve();
  };

  /* ───────────── 3D: 캔버스 텍스처 ───────────── */
  function mkCanvas(w, h, draw) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function radial(ctx, x, y, r0, r1, stops) {
    var g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (var i = 0; i < stops.length; i += 2) g.addColorStop(stops[i], stops[i + 1]);
    return g;
  }
  var DRAW = {
    soft: function (ctx, s) {
      ctx.fillStyle = radial(ctx, s / 2, s / 2, 0, s / 2, [0, 'rgba(255,255,255,1)', 0.22, 'rgba(255,255,255,.75)', 0.55, 'rgba(255,255,255,.22)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
    },
    drop: function (ctx, s) {
      var c = s / 2, r = s * 0.36;
      ctx.fillStyle = radial(ctx, c - r * 0.3, c - r * 0.3, r * 0.1, r * 1.1, [0, '#ffffff', 0.55, 'rgba(232,244,255,.92)', 1, 'rgba(150,172,196,.96)']);
      ctx.beginPath(); ctx.moveTo(c, c - r * 1.25);
      ctx.quadraticCurveTo(c + r * 0.95, c - r * 0.1, c + r, c + r * 0.15);
      ctx.arc(c, c + r * 0.15, r, 0, Math.PI);
      ctx.quadraticCurveTo(c - r * 0.95, c - r * 0.1, c, c - r * 1.25);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,70,110,.55)'; ctx.lineWidth = s * 0.035; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath(); ctx.arc(c - r * 0.36, c - r * 0.05, r * 0.2, 0, TAU); ctx.fill();
    },
    shard: function (ctx, s) {
      var c = s / 2;
      ctx.beginPath(); ctx.moveTo(c, s * 0.04); ctx.lineTo(c + s * 0.19, s * 0.46); ctx.lineTo(c + s * 0.02, s * 0.96); ctx.lineTo(c - s * 0.18, s * 0.5); ctx.closePath();
      var g = ctx.createLinearGradient(c - s * 0.2, 0, c + s * 0.2, s);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#d9f2ff'); g.addColorStop(1, '#9fc6e2');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(30,70,120,.7)'; ctx.lineWidth = s * 0.03; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = s * 0.028;
      ctx.beginPath(); ctx.moveTo(c, s * 0.1); ctx.lineTo(c + s * 0.03, s * 0.86); ctx.stroke();
    },
    spark: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c, [0, 'rgba(255,255,255,1)', 0.12, 'rgba(255,255,255,.95)', 0.32, 'rgba(255,255,255,.25)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createLinearGradient(0, 0, s, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, c - s * 0.025, s, s * 0.05);
      var g2 = ctx.createLinearGradient(0, 0, 0, s);
      g2.addColorStop(0, 'rgba(255,255,255,0)'); g2.addColorStop(0.5, 'rgba(255,255,255,.9)'); g2.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g2; ctx.fillRect(c - s * 0.025, 0, s * 0.05, s);
    },
    puff: function (ctx, s) {
      for (var i = 0; i < 7; i++) {
        var x = s / 2 + rand(-s * 0.16, s * 0.16), y = s / 2 + rand(-s * 0.16, s * 0.16), r = rand(s * 0.2, s * 0.32);
        ctx.fillStyle = radial(ctx, x, y, 0, r, [0, 'rgba(255,255,255,.55)', 0.6, 'rgba(255,255,255,.3)', 1, 'rgba(255,255,255,0)']);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    },
    plus: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c * 0.7, [0, 'rgba(255,255,255,.6)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(c, s * 0.04);
      ctx.quadraticCurveTo(c, c, s * 0.96, c); ctx.quadraticCurveTo(c, c, c, s * 0.96);
      ctx.quadraticCurveTo(c, c, s * 0.04, c); ctx.quadraticCurveTo(c, c, c, s * 0.04);
      ctx.fill();
    },
    ring: function (ctx, s) {
      var c = s / 2, r = s * 0.4;
      ctx.fillStyle = radial(ctx, c, c, 0, r, [0, 'rgba(255,255,255,.06)', 0.8, 'rgba(255,255,255,.18)', 1, 'rgba(255,255,255,.35)']);
      ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = s * 0.05; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(c, c, r * 0.68, Math.PI * 1.1, Math.PI * 1.45); ctx.stroke();
    },
    flake: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c, [0, 'rgba(255,255,255,.7)', 0.4, 'rgba(255,255,255,.2)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = s * 0.06; ctx.lineCap = 'round';
      for (var i = 0; i < 6; i++) {
        ctx.save(); ctx.translate(c, c); ctx.rotate(i * Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.4);
        ctx.moveTo(0, -s * 0.24); ctx.lineTo(s * 0.1, -s * 0.33); ctx.moveTo(0, -s * 0.24); ctx.lineTo(-s * 0.1, -s * 0.33);
        ctx.stroke(); ctx.restore();
      }
    },
    star: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c, [0, 'rgba(255,255,255,.9)', 0.35, 'rgba(255,255,255,.25)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      var n = 10;
      for (var i = 0; i <= n * 2; i++) {
        var a = i / (n * 2) * TAU - Math.PI / 2, r = (i % 2 === 0) ? s * (i % 4 === 0 ? 0.48 : 0.36) : s * 0.12;
        if (i === 0) ctx.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); else ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
      }
      ctx.fill();
    },
    shock: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, s * 0.28, s * 0.5, [0, 'rgba(255,255,255,0)', 0.55, 'rgba(255,255,255,.95)', 0.72, 'rgba(255,255,255,.45)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
    },
    arrow: function (ctx, s) {
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = s * 0.08;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.08); ctx.lineTo(s * 0.9, s * 0.52); ctx.lineTo(s * 0.67, s * 0.52); ctx.lineTo(s * 0.67, s * 0.92);
      ctx.lineTo(s * 0.33, s * 0.92); ctx.lineTo(s * 0.33, s * 0.52); ctx.lineTo(s * 0.1, s * 0.52); ctx.closePath();
      ctx.fill();
    },
    blob: function (ctx, s) {
      ctx.fillStyle = radial(ctx, s / 2, s / 2, 0, s / 2, [0, 'rgba(0,0,0,.85)', 0.45, 'rgba(0,0,0,.55)', 1, 'rgba(0,0,0,0)']);
      ctx.fillRect(0, 0, s, s);
    },
    // 나뭇잎(흰색 → 색을 곱해 물들임, 깃털로도 씀)
    leaf: function (ctx, s) {
      ctx.save(); ctx.translate(s / 2, s / 2); ctx.rotate(-0.55);
      ctx.beginPath(); ctx.moveTo(0, -s * 0.45);
      ctx.quadraticCurveTo(s * 0.32, -s * 0.08, 0, s * 0.45); ctx.quadraticCurveTo(-s * 0.32, -s * 0.08, 0, -s * 0.45); ctx.closePath();
      var g = ctx.createLinearGradient(-s * 0.2, 0, s * 0.2, 0);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#bdbdbd');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(40,40,40,.6)'; ctx.lineWidth = s * 0.035; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -s * 0.38); ctx.lineTo(0, s * 0.42);
      ctx.strokeStyle = 'rgba(70,70,70,.55)'; ctx.lineWidth = s * 0.03; ctx.stroke();
      ctx.restore();
    },
    // 불꽃 혀(끝이 위)
    flame: function (ctx, s) {
      var c = s / 2;
      ctx.beginPath(); ctx.moveTo(c, s * 0.03);
      ctx.bezierCurveTo(c + s * 0.36, s * 0.42, c + s * 0.38, s * 0.72, c, s * 0.95);
      ctx.bezierCurveTo(c - s * 0.38, s * 0.72, c - s * 0.36, s * 0.42, c, s * 0.03);
      var g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,.15)'); g.addColorStop(0.35, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,.95)');
      ctx.fillStyle = g; ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';   // 가장자리를 부드럽게
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = s * 0.06; ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    },
    // 바위 조각
    rock: function (ctx, s) {
      var c = s / 2, n = 7, pts = [];
      for (var i = 0; i < n; i++) {
        var a = i / n * TAU + rand(-0.25, 0.25), r = s * rand(0.3, 0.45);
        pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
      }
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < n; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.closePath();
      var g = ctx.createLinearGradient(s * 0.2, s * 0.1, s * 0.8, s * 0.9);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#c4c4c4'); g.addColorStop(1, '#6e6e6e');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(28,22,16,.85)'; ctx.lineWidth = s * 0.04; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.strokeStyle = 'rgba(40,34,26,.45)'; ctx.lineWidth = s * 0.025;
      ctx.beginPath(); ctx.moveTo(pts[1][0], pts[1][1]); ctx.lineTo(c + s * 0.04, c - s * 0.02); ctx.lineTo(pts[4][0], pts[4][1]); ctx.stroke();
    },
    heart: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c, [0, 'rgba(255,255,255,.55)', 0.5, 'rgba(255,255,255,.15)', 1, 'rgba(255,255,255,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(c, s * 0.8);
      ctx.bezierCurveTo(s * 0.12, s * 0.52, s * 0.16, s * 0.18, c, s * 0.34);
      ctx.bezierCurveTo(s * 0.84, s * 0.18, s * 0.88, s * 0.52, c, s * 0.8);
      ctx.fill();
    },
    // 잠 'Z'
    zz: function (ctx, s) {
      ctx.font = '900 ' + Math.round(s * 0.78) + 'px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = s * 0.1; ctx.strokeStyle = 'rgba(30,44,90,.9)';
      ctx.strokeText('Z', s / 2, s * 0.53);
      ctx.fillStyle = '#ffffff'; ctx.fillText('Z', s / 2, s * 0.53);
    },
    // 벌레 떼 알갱이(테두리 있는 작은 몸통 + 날개)
    dot: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.beginPath(); ctx.ellipse(c - s * 0.16, c - s * 0.14, s * 0.18, s * 0.1, -0.5, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(c + s * 0.16, c - s * 0.14, s * 0.18, s * 0.1, 0.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = 'rgba(30,40,10,.85)'; ctx.lineWidth = s * 0.06;
      ctx.beginPath(); ctx.ellipse(c, c + s * 0.05, s * 0.17, s * 0.22, 0, 0, TAU); ctx.fill(); ctx.stroke();
    },
    // 그림자 구슬(자체 색)
    orb: function (ctx, s) {
      var c = s / 2;
      ctx.fillStyle = radial(ctx, c, c, 0, c, [0, 'rgba(26,6,48,1)', 0.42, 'rgba(46,14,92,1)', 0.6, 'rgba(170,110,255,.95)', 0.78, 'rgba(120,60,230,.45)', 1, 'rgba(90,30,200,0)']);
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = radial(ctx, c * 0.8, c * 0.78, 0, c * 0.3, [0, 'rgba(200,160,255,.45)', 1, 'rgba(200,160,255,0)']);
      ctx.fillRect(0, 0, s, s);
    }
  };
  // 번개(가로로 긴 지그재그)
  function drawBolt(ctx, w, h) {
    var pts = [[0, h / 2]], n = 9;
    for (var i = 1; i < n; i++) pts.push([i / n * w + rand(-w * 0.02, w * 0.02), h / 2 + rand(-h * 0.3, h * 0.3)]);
    pts.push([w, h / 2]);
    function line(lw, a) {
      ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.stroke();
    }
    ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = h * 0.18;
    line(h * 0.16, 0.45);
    line(h * 0.07, 1);
    // 곁가지
    var b = pts[4];
    ctx.lineWidth = h * 0.04; ctx.beginPath(); ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] + w * 0.07, b[1] + h * 0.22); ctx.lineTo(b[0] + w * 0.12, b[1] + h * 0.18); ctx.stroke();
  }
  // 광선(가로 띠, 양 끝 페이드)
  function drawBeam(ctx, w, h) {
    var v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.3, 'rgba(255,255,255,.45)'); v.addColorStop(0.5, 'rgba(255,255,255,1)');
    v.addColorStop(0.7, 'rgba(255,255,255,.45)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.06, 'rgba(255,255,255,1)'); g.addColorStop(0.92, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  // 바람 칼날(흰 초승달 — 색을 곱해 씀)
  function drawGust(ctx, w, h) {
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.72);
    ctx.quadraticCurveTo(w * 0.5, -h * 0.28, w * 0.96, h * 0.72);
    ctx.quadraticCurveTo(w * 0.5, h * 0.18, w * 0.04, h * 0.72);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.35, 'rgba(255,255,255,.85)');
    g.addColorStop(0.7, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fill();
  }
  // 포획 볼 (위 빨강·아래 흰색·검은 띠·가운데 단추)
  function drawBall(ctx, s) {
    var c = s / 2, r = s * 0.45;
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.clip();
    ctx.fillStyle = radial(ctx, c - r * 0.35, c - r * 0.5, r * 0.05, r * 1.5, [0, '#ff9a9a', 0.35, '#ee2a32', 1, '#7a0a12']);
    ctx.fillRect(0, 0, s, c);
    ctx.fillStyle = radial(ctx, c - r * 0.3, c + r * 0.1, r * 0.05, r * 1.5, [0, '#ffffff', 0.55, '#e6e6ee', 1, '#8a8a9a']);
    ctx.fillRect(0, c, s, s - c);
    ctx.fillStyle = '#16161e'; ctx.fillRect(0, c - r * 0.085, s, r * 0.17);
    ctx.restore();
    ctx.lineWidth = s * 0.03; ctx.strokeStyle = '#16161e';
    ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#16161e'; ctx.beginPath(); ctx.arc(c, c, r * 0.27, 0, TAU); ctx.fill();
    ctx.fillStyle = radial(ctx, c - r * 0.05, c - r * 0.05, 0, r * 0.18, [0, '#ffffff', 1, '#d4d4dc']);
    ctx.beginPath(); ctx.arc(c, c, r * 0.17, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,40,.5)'; ctx.lineWidth = s * 0.012;
    ctx.beginPath(); ctx.arc(c, c, r * 0.1, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(c - r * 0.45, c - r * 0.52, r * 0.2, r * 0.11, -0.7, 0, TAU); ctx.fill();
  }
  // 그림 파일이 없을 때 쓰는 자리표시 실루엣(발끝이 아래 3% 위)
  function drawPlaceholder(ctx, s) {
    var cx = s / 2, foot = s * (1 - FOOT);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(cx, foot - s * 0.01, s * 0.2, s * 0.025, 0, 0, TAU); ctx.fill();
    var g = ctx.createLinearGradient(0, s * 0.3, 0, foot);
    g.addColorStop(0, '#c9c2dc'); g.addColorStop(1, '#8a82a6');
    ctx.fillStyle = g; ctx.strokeStyle = '#3a3450'; ctx.lineWidth = s * 0.012; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.ellipse(cx, foot - s * 0.17, s * 0.19, s * 0.17, 0, 0, TAU); ctx.fill(); ctx.stroke();   // 몸
    ctx.beginPath();                                                                                         // 귀
    ctx.moveTo(cx - s * 0.17, s * 0.46); ctx.lineTo(cx - s * 0.15, s * 0.27); ctx.lineTo(cx - s * 0.05, s * 0.38);
    ctx.moveTo(cx + s * 0.17, s * 0.46); ctx.lineTo(cx + s * 0.15, s * 0.27); ctx.lineTo(cx + s * 0.05, s * 0.38);
    ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, s * 0.47, s * 0.16, 0, TAU); ctx.fill(); ctx.stroke();                    // 머리
    ctx.fillStyle = '#3a3450'; ctx.font = '900 ' + Math.round(s * 0.17) + 'px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', cx, s * 0.49);
  }
  var _phURL = null, _ballURL = null;
  function placeholderURL() {
    if (_phURL == null) { try { _phURL = mkCanvas(256, 256, drawPlaceholder).toDataURL(); } catch (e) { _phURL = ''; } }
    return _phURL;
  }
  function ballURL() {
    if (_ballURL == null) { try { _ballURL = mkCanvas(96, 96, drawBall).toDataURL(); } catch (e) { _ballURL = ''; } }
    return _ballURL;
  }
  function drawSlash(ctx, w, h) {
    ctx.shadowColor = 'rgba(255,30,50,1)'; ctx.shadowBlur = h * 0.14;
    ctx.beginPath();
    ctx.moveTo(w * 0.04, h * 0.72);
    ctx.quadraticCurveTo(w * 0.5, -h * 0.28, w * 0.96, h * 0.72);
    ctx.quadraticCurveTo(w * 0.5, h * 0.12, w * 0.04, h * 0.72);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,40,60,0)'); g.addColorStop(0.28, 'rgba(255,50,70,1)');
    g.addColorStop(0.62, 'rgba(255,236,240,1)'); g.addColorStop(1, 'rgba(255,40,60,.15)');
    ctx.fillStyle = g; ctx.fill();
  }
  function drawColumn(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-in';
    var v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.7, 'rgba(255,255,255,.8)'); v.addColorStop(1, 'rgba(255,255,255,.25)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  function drawHaze(ctx, w, h) {
    var v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  function drawSide(ctx, w, h) {
    var v = ctx.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, '#f2ece2'); v.addColorStop(0.08, '#cfc7ba'); v.addColorStop(0.2, '#8f877b'); v.addColorStop(1, '#2c2824');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < 40; i++) {           // 돌 블록 이음새
      var x = (i / 40) * w;
      ctx.fillStyle = 'rgba(20,16,12,.55)'; ctx.fillRect(x, h * 0.12, 2, h * 0.88);
    }
  }
  // 원형 석판 윗면 (중립 회색 — 테마 색을 곱해 물들임)
  function drawStone(ctx, S) {
    var c = S / 2, R = S / 2 * 0.995;
    ctx.fillStyle = radial(ctx, c, c, 0, R, [0, '#e9e5de', 0.6, '#cfc9bf', 0.9, '#aba396', 1, '#8a8276']);
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fill();
    var rings = [0, 0.16, 0.33, 0.5, 0.66, 0.8, 0.995], divs = [1, 8, 14, 20, 26, 34];
    ctx.lineJoin = 'round';
    for (var i = 0; i < rings.length - 1; i++) {
      var r0 = rings[i] * R, r1 = rings[i + 1] * R, n = divs[i], off = Math.random() * TAU;
      for (var j = 0; j < n; j++) {
        var a0 = off + j / n * TAU, a1 = off + (j + 1) / n * TAU;
        ctx.beginPath();
        if (i === 0) ctx.arc(c, c, r1, 0, TAU);
        else { ctx.arc(c, c, r1, a0, a1); ctx.arc(c, c, r0, a1, a0, true); ctx.closePath(); }
        var v = rand(-0.16, 0.12);
        ctx.fillStyle = v > 0 ? 'rgba(255,255,255,' + v.toFixed(3) + ')' : 'rgba(0,0,0,' + (-v).toFixed(3) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(38,32,26,.6)'; ctx.lineWidth = S * 0.004; ctx.stroke();
      }
      // 이음새 하이라이트
      ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = S * 0.002;
      ctx.beginPath(); ctx.arc(c, c, r1 - S * 0.004, 0, TAU); ctx.stroke();
    }
    // 잡티
    for (var k = 0; k < 5000; k++) {
      var a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R;
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,' + rand(0.04, 0.12).toFixed(3) + ')' : 'rgba(255,255,255,' + rand(0.03, 0.1).toFixed(3) + ')';
      ctx.fillRect(c + Math.cos(a) * rr, c + Math.sin(a) * rr, S * 0.002, S * 0.002);
    }
    // 균열
    ctx.strokeStyle = 'rgba(30,24,20,.45)'; ctx.lineWidth = S * 0.0025;
    for (var q = 0; q < 9; q++) {
      var ang = Math.random() * TAU, rad = rand(0.2, 0.9) * R, x = c + Math.cos(ang) * rad, y = c + Math.sin(ang) * rad;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (var st = 0; st < 5; st++) { x += rand(-1, 1) * S * 0.03; y += rand(-1, 1) * S * 0.03; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // 중앙 발바닥 문양(음각)
    function paw(dx, dy, col) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(c + dx, c + S * 0.03 + dy, S * 0.05, S * 0.04, 0, 0, TAU); ctx.fill();
      [[-0.055, -0.035], [-0.02, -0.065], [0.02, -0.065], [0.055, -0.035]].forEach(function (t) {
        ctx.beginPath(); ctx.ellipse(c + t[0] * S + dx, c + t[1] * S + dy, S * 0.017, S * 0.022, 0, 0, TAU); ctx.fill();
      });
    }
    paw(S * 0.002, S * 0.003, 'rgba(255,255,255,.22)');
    paw(0, 0, 'rgba(40,32,26,.38)');
    ctx.strokeStyle = 'rgba(40,32,26,.35)'; ctx.lineWidth = S * 0.004;
    ctx.beginPath(); ctx.arc(c, c, R * 0.155, 0, TAU); ctx.stroke();
    // 가장자리 그늘 + 은은한 광원(왼쪽 위)
    ctx.fillStyle = radial(ctx, c, c, R * 0.72, R, [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,.42)']);
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fill();
    var lg = ctx.createLinearGradient(0, 0, S, S);
    lg.addColorStop(0, 'rgba(255,255,255,.12)'); lg.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.fill();
  }
  // 룬 링 (흰색 — 테마 색으로 가산 발광)
  function drawRunes(ctx, S) {
    var c = S / 2;
    ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ffffff'; ctx.shadowBlur = S * 0.01;
    function ring(r, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c, c, r, 0, TAU); ctx.stroke(); }
    ring(c * 0.955, S * 0.005);
    ring(c * 0.835, S * 0.0035);
    ring(c * 0.33, S * 0.003);
    ring(c * 0.36, S * 0.0015);
    var n = 44, rr = c * 0.895, g = S * 0.018;
    ctx.lineCap = 'round'; ctx.lineWidth = S * 0.0032;
    var P = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      ctx.save(); ctx.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr); ctx.rotate(a + Math.PI / 2);
      if (i % 11 === 0) {
        ctx.beginPath(); ctx.moveTo(0, -g * 1.1); ctx.lineTo(g * 0.7, 0); ctx.lineTo(0, g * 1.1); ctx.lineTo(-g * 0.7, 0); ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath();
        var strokes = 2 + ((i * 7) % 3);
        for (var s = 0; s < strokes; s++) {
          var p0 = P[(i * 3 + s * 5) % 9], p1 = P[(i * 5 + s * 2 + 4) % 9];
          if (p0 === p1) p1 = P[(i + s + 1) % 9];
          ctx.moveTo(p0[0] * g * 0.7, p0[1] * g); ctx.lineTo(p1[0] * g * 0.7, p1[1] * g);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    // 안쪽 원의 작은 마름모
    for (var j = 0; j < 8; j++) {
      var b = j / 8 * TAU + Math.PI / 8, r2 = c * 0.345;
      ctx.save(); ctx.translate(c + Math.cos(b) * r2, c + Math.sin(b) * r2); ctx.rotate(b);
      ctx.beginPath(); ctx.moveTo(-S * 0.008, 0); ctx.lineTo(0, -S * 0.005); ctx.lineTo(S * 0.008, 0); ctx.lineTo(0, S * 0.005); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /* ───────────── 3D: 셰이더 ───────────── */
  var SPR_VS = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var SPR_FS = [
    'uniform sampler2D map; uniform float opacity; uniform float flash; uniform vec3 flashColor;',
    'uniform vec3 tint; uniform float tintAmt; uniform float flipX;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, flipX), vUv.y);',
    '  vec4 t = texture2D(map, uv);',
    '  float a = t.a * opacity;',
    '  if (a < 0.01) discard;',
    '  vec3 c = t.rgb;',
    '  float l = dot(c, vec3(0.299, 0.587, 0.114));',
    '  c = mix(c, tint * (0.25 + 0.95 * l), tintAmt);',
    '  c = mix(c, flashColor, flash);',
    '  gl_FragColor = vec4(c, a);',
    '}'
  ].join('\n');
  var PT_VS = [
    'attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aRot;',
    'uniform float scale;',
    'varying vec3 vColor; varying float vAlpha; varying float vRot;',
    'void main(){',
    '  vColor = aColor; vAlpha = aAlpha; vRot = aRot;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * scale / max(0.1, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var PT_FS = [
    'uniform sampler2D map;',
    'varying vec3 vColor; varying float vAlpha; varying float vRot;',
    'void main(){',
    '  if (vAlpha <= 0.003) discard;',
    '  vec2 c = gl_PointCoord - 0.5;',
    '  float s = sin(vRot), co = cos(vRot);',
    '  vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;',
    '  vec4 t = texture2D(map, vec2(uv.x, 1.0 - uv.y));',
    '  float a = t.a * vAlpha;',
    '  if (a < 0.004) discard;',
    '  gl_FragColor = vec4(vColor * t.rgb, a);',
    '}'
  ].join('\n');
  var SH_VS = [
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'void main(){',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var SH_FS = [
    'uniform vec3 color; uniform float opacity; uniform float time;',
    'varying vec3 vN; varying vec3 vV; varying float vY;',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  float f = pow(1.0 - abs(dot(n, normalize(vV))), 1.8);',
    '  float band = 0.5 + 0.5 * sin(vY * 16.0 - time * 3.0);',
    '  float spec = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 28.0);',
    '  vec3 c = color * (0.10 + f * 1.15 + band * 0.07) + vec3(spec * 0.9);',
    '  gl_FragColor = vec4(c * opacity, 1.0);',
    '}'
  ].join('\n');

  /* ───────────── 3D: 입자 풀 (THREE.Points 한 묶음 = 그리기 1회) ───────────── */
  function Pool(stage, tex, additive, cap) {
    this.cap = cap; this.n = 0; this.ps = [];
    var g = this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.aCol = new THREE.BufferAttribute(new Float32Array(cap * 3), 3);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(cap), 1);
    this.aRot = new THREE.BufferAttribute(new Float32Array(cap), 1);
    var attrs = [this.aPos, this.aCol, this.aSize, this.aAlpha, this.aRot];
    for (var i = 0; i < attrs.length; i++) attrs[i].setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize); g.setAttribute('aAlpha', this.aAlpha); g.setAttribute('aRot', this.aRot);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, scale: stage.pointScale },
      vertexShader: PT_VS, fragmentShader: PT_FS,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 6;
    this.pts.visible = false;
    stage.scene.add(this.pts);
  }
  Pool.prototype.spawn = function (o) {
    if (this.n >= this.cap) return;
    var p = this.ps[this.n];
    if (!p) p = this.ps[this.n] = {};
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.g = o.g || 0; p.drag = o.drag || 0;
    p.life = o.life || 1; p.age = 0; p.delay = o.delay || 0;
    p.s0 = o.s0 != null ? o.s0 : 0.2; p.s1 = o.s1 != null ? o.s1 : p.s0;
    var c = o.c; p.r = c.r; p.gg = c.g; p.b = c.b;
    p.a = o.a != null ? o.a : 1;
    p.rot = o.rot != null ? o.rot : Math.random() * TAU; p.vr = o.vr || 0;
    p.wob = o.wob || 0; p.wf = o.wf || 2; p.ph = Math.random() * TAU;
    p.fin = o.fin != null ? o.fin : 0.08; p.fout = o.fout != null ? o.fout : 0.55;
    this.n++;
  };
  Pool.prototype.update = function (dt) {
    var ps = this.ps, n = this.n;
    if (!n && !this.pts.visible) return;
    var P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array, R = this.aRot.array;
    for (var i = 0; i < n; i++) {
      var p = ps[i];
      if (p.delay > 0) {
        p.delay -= dt;
        P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z; A[i] = 0; S[i] = 0;
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) { n--; ps[i] = ps[n]; ps[n] = p; i--; continue; }
      if (p.drag) { var f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.wob) { p.x += Math.sin(p.age * p.wf + p.ph) * p.wob * dt; p.z += Math.cos(p.age * p.wf * 0.8 + p.ph) * p.wob * 0.6 * dt; }
      p.rot += p.vr * dt;
      var k = p.age / p.life;
      var al = p.a * (k < p.fin ? k / p.fin : 1) * (k > p.fout ? 1 - (k - p.fout) / (1 - p.fout) : 1);
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      C[i * 3] = p.r; C[i * 3 + 1] = p.gg; C[i * 3 + 2] = p.b;
      S[i] = p.s0 + (p.s1 - p.s0) * k; A[i] = al; R[i] = p.rot;
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.pts.visible = n > 0;
    if (n) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
      this.aAlpha.needsUpdate = true; this.aRot.needsUpdate = true;
    }
  };
  Pool.prototype.clear = function () { this.n = 0; this.geo.setDrawRange(0, 0); this.pts.visible = false; };

  /* ───────────── 3D 무대 ───────────── */
  var L3 = {
    cam: [0.0, 2.85, 8.9], look: [0.15, 1.15, 0],
    vfov: 44, hfov: 43,
    player: [-0.95, 0, 2.55], enemy: [1.25, 0, -1.6], shadow: [-0.6, 0, 1.3],
    platR: 3.9,
    bgR: 30, bgArc: 2.2, bgCenterY: -6.4,
    hazeY: -2.0, hazeZ: -13
  };
  // 판 크기(월드 단위): 고양이 0.4m → 1.7, 디지몬 1.2m → 3.1 (뚜렷이 큼)
  function sizeFor(id) { return 1.25 + 1.6 * monHeight(id); }
  // 배경 그림 위·아래 가장자리 띠의 평균색 → 원통 가장자리를 자연스럽게 잇는 색
  function edgeColors(img) {
    try {
      var c = mkCanvas(8, 16, function (ctx, w, h) { ctx.drawImage(img, 0, 0, w, h); });
      var ctx = c.getContext('2d');
      var avg = function (y) {
        var d = ctx.getImageData(1, y, 6, 1).data, r = 0, g = 0, b = 0, n = d.length / 4;
        for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        return new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
      };
      return { top: avg(0), bottom: avg(15) };
    } catch (e) { return null; }   // file:// 등으로 픽셀을 못 읽으면 기본색 유지
  }

  function makeGL(canvas) {
    var attrs = { alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    var gl = null;
    try {
      gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    } catch (e) { gl = null; }
    return gl;
  }

  function Stage3D(container, opts, canvas, gl) {
    var self = this;
    this.mode = '3d';
    this.container = container;
    this.base = opts.assetBase;
    this.disposed = false;
    this.paused = false;
    this.lost = false;
    this.tw = new Tweens();
    this._colCache = {};
    this._texCache = {};
    this._tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3() };

    var rootEl = this.root = el('div', 'pst-root');
    canvas.className = 'pst-canvas';
    rootEl.appendChild(canvas);
    this.overlay = new Overlay(rootEl);

    var r = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, antialias: true, alpha: false });
    r.setClearColor(0x0b1020, 1);
    r.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    this.maxAniso = Math.min(4, r.capabilities.getMaxAnisotropy ? r.capabilities.getMaxAnisotropy() : 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(L3.vfov, 1, 0.1, 140);
    this.pointScale = { value: 400 };
    this.w = 390; this.h = 480; this.bufH = 960; this.fovFit = L3.vfov;

    this._buildTextures();
    this._buildWorld();
    this._buildCamera();
    this.pools = {
      softAdd: new Pool(this, this.tex.soft, true, 360),
      spark: new Pool(this, this.tex.spark, true, 260),
      plus: new Pool(this, this.tex.plus, true, 160),
      drop: new Pool(this, this.tex.drop, false, 220),
      shard: new Pool(this, this.tex.shard, false, 160),
      puff: new Pool(this, this.tex.puff, false, 160),
      ring: new Pool(this, this.tex.ring, false, 80),
      leaf: new Pool(this, this.tex.leaf, false, 90),
      flame: new Pool(this, this.tex.flame, true, 140),
      rock: new Pool(this, this.tex.rock, false, 70),
      heart: new Pool(this, this.tex.heart, false, 40),
      // 일반 블렌딩 판 — 밝은 배경에서 타입 색을 지키는 층
      softN: new Pool(this, this.tex.soft, false, 160),
      sparkN: new Pool(this, this.tex.spark, false, 200),
      flameN: new Pool(this, this.tex.flame, false, 120),
      dotN: new Pool(this, this.tex.dot, false, 80)
    };
    this._bm = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4() };
    this._stTint = {
      psn: { c: new THREE.Color(0.74, 0.42, 1.0), k: 0.26 }, tox: { c: new THREE.Color(0.6, 0.26, 0.95), k: 0.34 },
      brn: { c: new THREE.Color(1.0, 0.56, 0.3), k: 0.2 }, par: { c: new THREE.Color(1.0, 0.95, 0.5), k: 0.14 },
      slp: { c: new THREE.Color(0.42, 0.45, 0.64), k: 0.3 }
    };
    this.amb = { pool: new Pool(this, this.tex.soft, true, 110), type: null, target: 0 };
    this.amb.pool.pts.renderOrder = 5;
    this.quads = [];
    this.fighters = { enemy: this._makeFighter('enemy', 0), player: this._makeFighter('player', 2), shadow: this._makeFighter('shadow', 1) };
    this._applyTheme('dark', true);

    container.appendChild(rootEl);

    // 크기 변화 대응
    this._onResize = function () { self._resize(); };
    if (root.ResizeObserver) { this._ro = new ResizeObserver(this._onResize); this._ro.observe(container); }
    root.addEventListener('resize', this._onResize);
    this._resize();

    // 컨텍스트 손실 대응(렌더만 멈추고 로직은 진행)
    this._onLost = function (e) { e.preventDefault(); self.lost = true; };
    this._onRestore = function () { self.lost = false; };
    canvas.addEventListener('webglcontextlost', this._onLost, false);
    canvas.addEventListener('webglcontextrestored', this._onRestore, false);

    // 렌더 루프 (숨김·일시정지 시 렌더 생략, 트윈은 보조 타이머로 계속 진행 → Promise 보장)
    this._lastFrame = now();
    this._tick = function () {
      if (self.disposed) return;
      self._raf = root.requestAnimationFrame(self._tick);
      if (self.paused || document.hidden || self.lost) return;
      self._update(true);
    };
    this._raf = root.requestAnimationFrame(this._tick);
    this._iv = setInterval(function () {
      if (!self.disposed && now() - self._lastFrame > 150) self._update(false);
    }, 120);
    this._update(true);
  }
  var S3 = Stage3D.prototype;

  S3._col = function (hex) {
    var c = this._colCache[hex];
    if (!c) c = this._colCache[hex] = new THREE.Color(hex);
    return c;
  };

  S3._buildTextures = function () {
    var self = this;
    function ct(canvas, opt) {
      var t = new THREE.CanvasTexture(canvas);
      if (opt && opt.aniso) t.anisotropy = self.maxAniso;
      return t;
    }
    var T = this.tex = {};
    ['soft', 'drop', 'shard', 'spark', 'puff', 'plus', 'ring', 'flake', 'blob', 'leaf', 'flame', 'rock', 'heart', 'zz', 'orb', 'dot'].forEach(function (k) {
      T[k] = ct(mkCanvas(64, 64, function (c, w) { DRAW[k](c, w); }));
    });
    T.bolt = ct(mkCanvas(256, 64, drawBolt));
    T.bolt2 = ct(mkCanvas(256, 64, drawBolt));
    T.beam = ct(mkCanvas(128, 32, drawBeam));
    T.gust = ct(mkCanvas(256, 128, drawGust));
    T.ball = ct(mkCanvas(128, 128, drawBall));
    T.ph = ct(mkCanvas(512, 512, drawPlaceholder));
    T.star = ct(mkCanvas(128, 128, function (c, w) { DRAW.star(c, w); }));
    T.shock = ct(mkCanvas(128, 128, function (c, w) { DRAW.shock(c, w); }));
    T.arrow = ct(mkCanvas(64, 64, function (c, w) { DRAW.arrow(c, w); }));
    T.slash = ct(mkCanvas(256, 128, drawSlash));
    T.column = ct(mkCanvas(64, 128, drawColumn));
    T.haze = ct(mkCanvas(8, 128, drawHaze));
    T.side = ct(mkCanvas(256, 64, drawSide));
    T.side.wrapS = THREE.RepeatWrapping; T.side.repeat.set(3, 1);
    T.stone = ct(mkCanvas(1024, 1024, function (c, w) { drawStone(c, w); }), { aniso: true });
    T.runes = ct(mkCanvas(1024, 1024, function (c, w) { drawRunes(c, w); }), { aniso: true });
  };

  S3._buildWorld = function () {
    var sc = this.scene, T = this.tex, R = L3.platR;
    this.geo = {
      unit: new THREE.PlaneGeometry(1, 1),
      sprite: new THREE.PlaneGeometry(1, 1).translate(0, 0.5 - FOOT, 0),
      sphere: new THREE.SphereGeometry(1, 32, 20)
    };
    // 원통형 배경 (안쪽 면). 그림 비율 1.5 = 호 길이 / 높이 → 늘어짐 없음
    var H = L3.bgArc * L3.bgR / 1.5;
    var bgGeo = new THREE.CylinderGeometry(L3.bgR, L3.bgR, H, 64, 1, true, Math.PI - L3.bgArc / 2, L3.bgArc);
    function bgMesh() {
      var m = new THREE.Mesh(bgGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false }));
      m.position.y = L3.bgCenterY;
      m.renderOrder = -10;
      m.visible = false;
      sc.add(m);
      return m;
    }
    this.bgA = bgMesh(); this.bgB = bgMesh(); this.bgCur = null;
    // 그림 위·아래 끝을 단색으로 녹이는 띠 (세로로 긴 화면·카메라 이동 시 가장자리 숨김)
    var self = this;
    function fade(top) {
      var fh = 16, tex = new THREE.CanvasTexture(mkCanvas(4, 64, function (ctx, w, h) {
        var g = ctx.createLinearGradient(0, 0, 0, h);
        if (top) { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.62, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
        else { g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.38, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,1)'); }
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }));
      var geo = new THREE.CylinderGeometry(L3.bgR - 0.3, L3.bgR - 0.3, fh, 48, 1, true, Math.PI - L3.bgArc / 2 - 0.05, L3.bgArc + 0.1);
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, transparent: true, depthWrite: false, color: 0x0b1020 }));
      // 그림 끝에서 안쪽으로 fh*0.38 만큼 겹쳐 서서히 덮는다
      m.position.y = top ? L3.bgCenterY + H / 2 + fh * 0.5 - fh * 0.38 : L3.bgCenterY - H / 2 - fh * 0.5 + fh * 0.38;
      m.renderOrder = -8.5;
      sc.add(m);
      self.tex['fade' + (top ? 'T' : 'B')] = tex;
      return m;
    }
    this.fadeTop = fade(true); this.fadeBot = fade(false);

    // 지평선 안개
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(70, 8), new THREE.MeshBasicMaterial({ map: T.haze, transparent: true, depthWrite: false, opacity: 0.3 }));
    this.haze.position.set(0, L3.hazeY, L3.hazeZ);
    this.haze.renderOrder = -8;
    sc.add(this.haze);

    // 바닥 접지 그림자 + 룬 빛 번짐
    var ground = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: T.blob, transparent: true, depthWrite: false, opacity: 0.7 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.46; ground.scale.set(R * 3.3, R * 2.6, 1);
    ground.renderOrder = -7;
    sc.add(ground);
    this.halo = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: T.soft, transparent: true, depthWrite: false, opacity: 0.32, blending: THREE.AdditiveBlending }));
    this.halo.rotation.x = -Math.PI / 2; this.halo.position.y = -0.44; this.halo.scale.set(R * 3.0, R * 3.0, 1);
    this.halo.renderOrder = -6;
    sc.add(this.halo);

    // 원형 석판 무대
    this.stoneMat = new THREE.MeshBasicMaterial({ map: T.stone });
    var top = new THREE.Mesh(new THREE.CircleGeometry(R, 96), this.stoneMat);
    top.rotation.x = -Math.PI / 2;
    sc.add(top);
    this.sideMat = new THREE.MeshBasicMaterial({ map: T.side });
    var side = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.04, 0.46, 96, 1, true), this.sideMat);
    side.position.y = -0.23;
    sc.add(side);
    // 룬 링(가산 발광) + 테두리 발광 띠
    this.runeMat = new THREE.MeshBasicMaterial({ map: T.runes, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.rune = new THREE.Mesh(this.geo.unit, this.runeMat);
    this.rune.rotation.x = -Math.PI / 2; this.rune.position.y = 0.012; this.rune.scale.set(R * 2, R * 2, 1);
    this.rune.renderOrder = -5;
    sc.add(this.rune);
    this.rimMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75 });
    var rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.006, R * 1.006, 0.05, 96, 1, true), this.rimMat);
    rim.position.y = -0.05; rim.renderOrder = -5;
    sc.add(rim);
  };

  S3._buildCamera = function () {
    var V = THREE.Vector3;
    this.cam = {
      basePos: new V(L3.cam[0], L3.cam[1], L3.cam[2]), baseLook: new V(L3.look[0], L3.look[1], L3.look[2]),
      fromPos: new V(), fromLook: new V(), toPos: new V(), toLook: new V(), curPos: new V(), curLook: new V(),
      k: 1, tok: 0, punch: 0, ptok: 0, punchTo: new V(), shake: 0,
      pos: new V(), look: new V()
    };
    var c = this.cam;
    c.fromPos.copy(c.basePos); c.toPos.copy(c.basePos); c.curPos.copy(c.basePos);
    c.fromLook.copy(c.baseLook); c.toLook.copy(c.baseLook); c.curLook.copy(c.baseLook);
  };

  S3._makeFighter = function (side, order) {
    var P = L3[side];
    var f = {
      side: side, id: null, shiny: false, size: 1.8, order: order, idle: true, fainted: false, ph: Math.random() * 6,
      base: new THREE.Vector3(P[0], P[1], P[2]),
      a: null, tok: { lunge: 0, knock: 0, side: 0, flash: 0, enter: 0, faint: 0, frz: 0, aura: 0, shield: 0, set: 0, move: 0 },
      frzK: 0, auraK: 0, shieldK: 0, auraCol: new THREE.Color('#ff2440'), auraAcc: 0, trail: 0, st: null, stAcc: 0,
      silCol: new THREE.Color(0.07, 0.0, 0.025), iceCol: new THREE.Color(0.62, 0.9, 1.0)
    };
    this._resetAnim(f);
    f.root = new THREE.Group(); f.root.position.copy(f.base);
    f.holder = new THREE.Group(); f.root.add(f.holder);
    f.bill = new THREE.Group(); f.holder.add(f.bill);
    f.pivot = new THREE.Group(); f.bill.add(f.pivot);
    f.uni = {
      map: { value: null }, opacity: { value: 1 }, flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 1, 1) },
      tint: { value: new THREE.Color(1, 1, 1) }, tintAmt: { value: 0 }, flipX: { value: side === 'enemy' ? 0 : 1 }
    };
    f.mat = new THREE.ShaderMaterial({ uniforms: f.uni, vertexShader: SPR_VS, fragmentShader: SPR_FS, transparent: true, depthWrite: false });
    f.mesh = new THREE.Mesh(this.geo.sprite, f.mat);
    f.mesh.renderOrder = order * 2;
    f.pivot.add(f.mesh);
    // 오라(뒤쪽 발광)
    f.aura = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: this.tex.soft, color: f.auraCol, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    f.aura.position.set(0, 0.42, -0.03); f.aura.scale.set(1.35, 1.15, 1); f.aura.renderOrder = order * 2; f.aura.visible = false;
    f.pivot.add(f.aura);
    // 얼음 결정 덮개
    f.ice = new THREE.Group(); f.ice.visible = false;
    f.iceMat = new THREE.MeshBasicMaterial({ map: this.tex.shard, transparent: true, depthWrite: false, color: new THREE.Color('#e4f8ff'), opacity: 0 });
    [[-0.22, 0.1, 0.32, 0.2], [0.2, 0.08, 0.28, -0.25], [0.02, 0.06, 0.24, 0.05], [-0.3, 0.42, 0.2, 0.5], [0.3, 0.5, 0.2, -0.45]].forEach(function (d) {
      var m = new THREE.Mesh(this.geo.unit, f.iceMat);
      m.position.set(d[0], d[1] + d[2] / 2, 0.03); m.scale.set(d[2] * 0.6, d[2], 1); m.rotation.z = d[3];
      m.renderOrder = order * 2 + 1;
      f.ice.add(m);
    }, this);
    f.pivot.add(f.ice);
    // 보호막 구
    f.shieldUni = { color: { value: new THREE.Color('#8fe8ff') }, opacity: { value: 0 }, time: { value: 0 } };
    f.shield = new THREE.Mesh(this.geo.sphere, new THREE.ShaderMaterial({
      uniforms: f.shieldUni, vertexShader: SH_VS, fragmentShader: SH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    f.shield.renderOrder = order * 2 + 1; f.shield.visible = false;
    f.holder.add(f.shield);
    // 발밑 그림자
    f.shadow = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: this.tex.blob, transparent: true, depthWrite: false, opacity: 0.55 }));
    f.shadow.rotation.x = -Math.PI / 2; f.shadow.position.y = 0.02; f.shadow.renderOrder = -3;
    f.root.add(f.shadow);
    f.root.visible = false;
    this.scene.add(f.root);
    return f;
  };
  S3._resetAnim = function (f) {
    f.a = { lx: 0, ly: 0, lz: 0, rl: 0, kx: 0, kz: 0, rk: 0, sx: 0, rs: 0, mx: 0, my: 0, mz: 0, dy: 0, rotX: 0,
      sc: 1, sq: 1, alpha: 1, flash: 0, shadowA: 1, sil: 0 };
    f.idle = true;
  };

  /* ── 테마·배경 ── */
  S3._applyTheme = function (key, instant) {
    var th = THEMES[key] || THEMES.sea;
    this.theme = th;
    this.overlay.setTheme(th);
    var self = this;
    var from = {
      rune: this.runeMat.color.clone(), stone: this.stoneMat.color.clone(), haze: this.haze.material.color.clone(), hazeA: this.haze.material.opacity
    };
    var to = { rune: new THREE.Color(th.rune), stone: new THREE.Color(th.stone), haze: new THREE.Color(th.fog), hazeA: th.haze };
    function set(k) {
      self.runeMat.color.copy(from.rune).lerp(to.rune, k);
      self.rimMat.color.copy(self.runeMat.color);
      self.halo.material.color.copy(self.runeMat.color);
      self.stoneMat.color.copy(from.stone).lerp(to.stone, k);
      self.sideMat.color.copy(self.stoneMat.color);
      self.haze.material.color.copy(from.haze).lerp(to.haze, k);
      self.haze.material.opacity = from.hazeA + (to.hazeA - from.hazeA) * k;
    }
    if (instant) set(1); else this.tw.add(650, set, Ez.inOut);
    this._setAmbient(th.amb);
  };
  S3._setAmbient = function (type) {
    var A = this.amb;
    if (A.type === type) return;
    A.type = type;
    var cfg = {
      bubble: { tex: 'ring', add: false, n: 46 }, snow: { tex: 'flake', add: false, n: 80 }, dust: { tex: 'soft', add: true, n: 55 },
      mote: { tex: 'plus', add: true, n: 50 }, ember: { tex: 'soft', add: true, n: 70 },
      leaf: { tex: 'leaf', add: false, n: 38 }, ash: { tex: 'soft', add: true, n: 85 }, star: { tex: 'star', add: true, n: 60 }
    }[type] || { tex: 'soft', add: true, n: 40 };
    A.pool.clear();
    A.pool.mat.uniforms.map.value = this.tex[cfg.tex];
    A.pool.mat.blending = cfg.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    A.pool.mat.needsUpdate = true;
    A.target = cfg.n;
    for (var i = 0; i < cfg.n; i++) this._ambSpawn(true);
  };
  S3._ambSpawn = function (prewarm) {
    var A = this.amb, t = A.type, o;
    var x = rand(-8, 8), z = rand(-9, 4.5);
    switch (t) {
      case 'snow':
        o = { x: x, y: rand(1, 7.5), z: z, vx: rand(0.05, 0.25), vy: rand(-0.75, -0.4), life: rand(7, 11), s0: rand(0.09, 0.17), wob: 0.35, wf: rand(0.8, 1.6), c: this._col('#ffffff'), a: 0.95, fin: 0.1, fout: 0.85, vr: rand(-1, 1) };
        break;
      case 'bubble':
        o = { x: x, y: rand(-0.4, 1.5), z: z, vy: rand(0.22, 0.55), life: rand(5, 8), s0: rand(0.1, 0.22), wob: 0.5, wf: rand(1, 2), c: this._col('#dff6ff'), a: 0.85, fin: 0.15, fout: 0.75, rot: 0 };
        break;
      case 'dust':
        o = { x: x, y: rand(0.1, 4.5), z: z, vx: rand(0.08, 0.25), vy: rand(-0.04, 0.06), life: rand(6, 9), s0: rand(0.05, 0.1), wob: 0.25, wf: rand(0.6, 1.2), c: this._col(pick(['#ffd9a8', '#ffc078', '#fff0d0'])), a: 0.7, fin: 0.2, fout: 0.7 };
        break;
      case 'mote':
        o = { x: x, y: rand(0, 5), z: z, vy: rand(0.08, 0.3), life: rand(5, 8), s0: rand(0.08, 0.16), wob: 0.3, wf: rand(0.6, 1.4), c: this._col(pick(['#fff3c0', '#ffe080', '#ffffff'])), a: 0.9, fin: 0.2, fout: 0.65, vr: rand(-0.6, 0.6) };
        break;
      case 'leaf':   // 숲: 천천히 흩날리며 떨어지는 잎
        o = { x: x, y: rand(1.5, 7), z: z, vx: rand(0.15, 0.45), vy: rand(-0.5, -0.25), life: rand(7, 11), s0: rand(0.13, 0.22), wob: 0.9, wf: rand(0.8, 1.6),
          c: this._col(pick(['#8ad04a', '#b8e05a', '#6aa83a', '#e0c85a'])), a: 0.95, fin: 0.1, fout: 0.85, vr: rand(-1.6, 1.6) };
        break;
      case 'ash':    // 화산: 솟구치는 불티 + 잿빛 재
        if (Math.random() < 0.3) o = { x: x, y: rand(0, 6), z: z, vx: rand(0.05, 0.2), vy: rand(-0.25, -0.08), life: rand(6, 9), s0: rand(0.06, 0.12), wob: 0.3, wf: rand(0.6, 1.2), c: this._col(pick(['#6a5a5a', '#8a7a72'])), a: 0.75, fin: 0.2, fout: 0.75 };
        else o = { x: x, y: rand(-0.4, 2.6), z: z, vx: rand(-0.1, 0.15), vy: rand(0.5, 1.2), life: rand(3, 5.5), s0: rand(0.08, 0.17), s1: 0.03, wob: 0.6, wf: rand(1.4, 2.6), c: this._col(pick(['#ff5a1a', '#ff8a2a', '#ffc04a', '#ff3010'])), a: 1, fin: 0.1, fout: 0.55 };
        break;
      case 'star':   // 신전: 반짝이는 별빛 티끌
        o = { x: x, y: rand(0.2, 6.5), z: z, vx: rand(-0.05, 0.05), vy: rand(0.02, 0.12), life: rand(2.5, 5), s0: rand(0.1, 0.22), s1: 0.02, wob: 0.15, wf: rand(0.5, 1),
          c: this._col(pick(['#e8d8ff', '#c8a8ff', '#ffffff', '#ffe8b0'])), a: 0.95, fin: 0.35, fout: 0.55, vr: rand(-0.5, 0.5) };
        break;
      default: // ember
        o = { x: x, y: rand(-0.4, 2.2), z: z, vy: rand(0.3, 0.85), life: rand(4, 7), s0: rand(0.1, 0.2), s1: 0.04, wob: 0.45, wf: rand(1, 2.2), c: this._col(pick(['#ff4a2a', '#ff7a3a', '#ffb04a', '#ff2a40'])), a: 1, fin: 0.12, fout: 0.6 };
    }
    A.pool.spawn(o);
    if (prewarm) { var p = A.pool.ps[A.pool.n - 1]; if (p) p.age = rand(0, p.life * 0.8); }
  };

  // 지속 상태이상의 가벼운 주변 입자 (초당 몇 개)
  S3._stAmbient = function (f, t, dt, wx, wz) {
    var rate = { brn: 5, par: 2.2, psn: 1.6, tox: 2.4, slp: 0.45 }[f.st] || 0;
    f.stAcc += dt * rate;
    if (f.stAcc < 1) return;
    f.stAcc -= 1;
    if (f.stAcc > 2) f.stAcc = 0;
    var s = f.size, y0 = f.holder.position.y;
    if (f.st === 'brn') {
      this.pools.flameN.spawn({ x: wx + rand(-0.3, 0.3) * s, y: y0 + rand(0.05, 0.45) * s, z: wz + 0.05, vy: rand(0.5, 0.9), life: rand(0.45, 0.7), s0: rand(0.18, 0.28) * s, s1: 0.03,
        c: this._col(pick(['#ff6a10', '#ff9a20', '#ff4a10'])), a: 0.85, rot: 0, wob: 0.3 });
    } else if (f.st === 'par') {
      this.pools.sparkN.spawn({ x: wx + rand(-0.32, 0.32) * s, y: y0 + rand(0.1, 0.7) * s, z: wz + 0.06, life: 0.18, s0: rand(0.18, 0.28) * s, s1: 0.02, c: this._col('#ffd820'), a: 1, fin: 0.01, fout: 0.3 });
    } else if (f.st === 'psn' || f.st === 'tox') {
      this.pools.ring.spawn({ x: wx + rand(-0.3, 0.3) * s, y: y0 + rand(0.1, 0.5) * s, z: wz + 0.05, vy: rand(0.3, 0.6), life: rand(0.9, 1.4), s0: rand(0.06, 0.12) * s, s1: 0.12 * s,
        c: this._col(f.st === 'tox' ? '#a050f0' : '#c890ff'), a: 0.9, wob: 0.4, rot: 0 });
    } else if (f.st === 'slp') {
      this._zee(new THREE.Vector3(wx + s * 0.18, y0 + s * 0.78, wz), s, 0);
    }
  };
  // 떠오르는 'Z' 하나
  S3._zee = function (at, s, delay) {
    var x0 = at.x, y0 = at.y, sz = Math.max(0.3, s * 0.24) * this._distK(at.x, at.y, at.z);
    this._quad({ tex: 'zz', color: '#a8c4ff', add: false, pos: at, delay: delay || 0, life: 1.3, order: 8, upd: function (k, m) {
      m.position.x = x0 + k * s * 0.3 + Math.sin(k * 5) * s * 0.05; m.position.y = y0 + k * s * 0.42;
      var g = sz * (0.55 + 0.6 * k); m.scale.set(g, g, 1);
      m.material.opacity = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
    } });
  };

  S3._spriteTex = function (id, shiny) {
    var key = id + (shiny ? '*' : '');
    var cache = this._texCache, self = this;
    if (cache[key]) return cache[key];
    cache[key] = loadImage(spriteSrc(id, shiny)).then(function (img) {
      if (self.disposed) { delete cache[key]; return null; }
      if (!img) return self.tex.ph;            // 그림 파일이 없으면 자리표시 실루엣(공유 텍스처)
      try {
        var cv = mkCanvas(1024, 1024, function (ctx, w, h) { ctx.drawImage(img, 0, 0, w, h); });
        var t = new THREE.CanvasTexture(cv);
        t.anisotropy = self.maxAniso;
        return t;
      } catch (e) { delete cache[key]; return null; }
    });
    return cache[key];
  };

  /* ── 프레임 갱신 ── */
  S3._resize = function () {
    if (this.disposed) return;
    var w = this.container.clientWidth || 390, h = this.container.clientHeight || 480;
    var pr = Math.min(root.devicePixelRatio || 1, 2);
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.bufH = h * pr;
    var aspect = w / h;
    this.camera.aspect = aspect;
    var need = 2 * Math.atan(Math.tan(L3.hfov * Math.PI / 360) / aspect) * 180 / Math.PI;
    this.fovFit = clamp(Math.max(L3.vfov, need), L3.vfov, 75);
    if (this._lastFrame && !this.paused) this._update(true);
  };

  S3._update = function (render) {
    var t = now(), dt = clamp((t - this._lastFrame) / 1000, 0, 0.05);
    this._lastFrame = t;
    this.tw.step(t);
    if (!render) return;
    var ts = t / 1000;
    this._updCamera(ts, dt);
    var F = this.fighters;
    this._updFighter(F.enemy, ts, dt);
    this._updFighter(F.player, ts, dt);
    this._updFighter(F.shadow, ts, dt);
    // 룬 링 맥동 + 회전
    this.runeMat.opacity = 0.78 + 0.22 * Math.sin(ts * 2.1);
    this.rune.rotation.z = ts * 0.05;
    this.rimMat.opacity = 0.55 + 0.25 * Math.sin(ts * 2.1 + 0.6);
    // 주변 입자
    var A = this.amb;
    while (A.pool.n < A.target) this._ambSpawn(false);
    A.pool.update(dt);
    for (var k in this.pools) this.pools[k].update(dt);
    this._updQuads(dt);
    var B = this.ball;
    if (B && B.m.visible) { B.m.quaternion.copy(this.camera.quaternion); B.m.rotateZ(B.rot); }
    try { this.renderer.render(this.scene, this.camera); } catch (e) { /* 렌더 실패는 무시(로직은 계속) */ }
  };

  S3._updCamera = function (t, dt) {
    var c = this.cam, cam = this.camera;
    c.curPos.lerpVectors(c.fromPos, c.toPos, c.k);
    c.curLook.lerpVectors(c.fromLook, c.toLook, c.k);
    var P = c.pos.copy(c.curPos), L = c.look.copy(c.curLook);
    // 느린 흔들림
    P.x += Math.sin(t * 0.29) * 0.17; P.y += Math.sin(t * 0.41 + 1.3) * 0.06; P.z += Math.sin(t * 0.19 + 0.4) * 0.08;
    L.x += Math.sin(t * 0.23 + 0.5) * 0.05; L.y += Math.sin(t * 0.33) * 0.03;
    // 공격 줌(펀치)
    if (c.punch > 0.001) {
      var d = this._tmp.d.subVectors(c.punchTo, P);
      var len = d.length() || 1;
      P.addScaledVector(d, (c.punch * 0.9) / len);
      L.lerp(c.punchTo, c.punch * 0.18);
    }
    // 화면 흔들림
    if (c.shake > 0.002) {
      var s = c.shake;
      P.x += (Math.random() * 2 - 1) * s; P.y += (Math.random() * 2 - 1) * s * 0.8;
      L.x += (Math.random() * 2 - 1) * s * 0.5; L.y += (Math.random() * 2 - 1) * s * 0.5;
      c.shake *= Math.exp(-dt * 6.5);
    } else c.shake = 0;
    cam.position.copy(P);
    cam.lookAt(L);
    cam.fov = this.fovFit * (1 - 0.07 * c.punch);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.pointScale.value = this.bufH / (2 * Math.tan(cam.fov * Math.PI / 360));
  };

  S3._updFighter = function (f, t, dt) {
    if (!f.root.visible) return;
    var a = f.a;
    f.holder.position.set(a.lx + a.kx + a.sx + a.mx, a.ly + a.dy + a.my, a.lz + a.kz + a.mz);
    var wx = f.root.position.x + f.holder.position.x, wz = f.root.position.z + f.holder.position.z;
    f.bill.rotation.y = Math.atan2(this.cam.curPos.x - wx, this.cam.curPos.z - wz);
    var slp = f.st === 'slp';
    var br = f.idle ? Math.sin(t * (slp ? 1.05 : 2.3) + f.ph) * (slp ? 2.2 : 1) : 0;
    var sw = f.idle ? Math.sin(t * (slp ? 0.5 : 1.25) + f.ph) * 0.026 : 0;
    f.pivot.rotation.set(a.rotX, 0, a.rl + a.rk + a.rs + sw);
    var s = f.size * a.sc;
    f.pivot.scale.set(s * (1 - 0.008 * br) * (1 + (1 - a.sq) * 0.6), s * (1 + 0.022 * br) * a.sq, s);
    var u = f.uni;
    u.opacity.value = a.alpha;
    u.flash.value = clamp(a.flash, 0, 1);
    var stt = f.st && this._stTint[f.st];
    if (a.sil > 0.001) { u.tint.value.copy(f.silCol); u.tintAmt.value = a.sil; }
    else if (f.frzK > 0.001) { u.tint.value.copy(f.iceCol); u.tintAmt.value = 0.5 * f.frzK; }
    else if (stt) { u.tint.value.copy(stt.c); u.tintAmt.value = stt.k * (f.st === 'brn' || f.st === 'tox' ? 0.8 + 0.25 * Math.sin(t * 4.5 + f.ph) : 1); }
    else u.tintAmt.value = 0;
    if (f.st && !f.fainted && a.alpha > 0.5) this._stAmbient(f, t, dt, wx, wz);
    // 그림자: 떠오를수록 작고 옅게
    var lift = clamp(1 - Math.max(0, a.dy + a.ly + a.my) / 3, 0.25, 1);
    f.shadow.position.set(f.holder.position.x, 0.02, f.holder.position.z);
    f.shadow.scale.set(f.size * 0.8 * lift, f.size * 0.3 * lift, 1);
    f.shadow.material.opacity = 0.6 * a.alpha * lift * a.shadowA * (1 - a.sil * 0.3);
    // 오라
    if (f.auraK > 0.002) {
      f.aura.visible = true;
      f.aura.material.opacity = f.auraK * (0.6 + 0.25 * Math.sin(t * 4.2 + f.ph));
      var ps = 1 + 0.06 * Math.sin(t * 3.1);
      f.aura.scale.set(1.35 * ps, 1.15 * ps, 1);
      f.auraAcc += dt * 26 * f.auraK;
      while (f.auraAcc >= 1) {
        f.auraAcc -= 1;
        var ang = Math.random() * TAU, rr = f.size * rand(0.15, 0.36);
        this.pools.softAdd.spawn({
          x: wx + Math.cos(ang) * rr, y: f.holder.position.y + rand(0, f.size * 0.6), z: wz + Math.sin(ang) * rr * 0.5,
          vy: rand(0.5, 1.2), life: rand(0.7, 1.2), s0: rand(0.18, 0.32), s1: 0.04, c: f.auraCol, a: 0.85, wob: 0.3
        });
      }
    } else f.aura.visible = false;
    // 이동 궤적 입자(그림자 이동 등)
    if (f.trail > 0) {
      for (var i = 0; i < 2; i++) {
        this.pools.softAdd.spawn({ x: wx + rand(-0.3, 0.3), y: f.holder.position.y + rand(0.1, f.size * 0.7), z: wz + rand(-0.2, 0.2),
          vy: rand(0.2, 0.6), life: rand(0.5, 0.8), s0: 0.3, s1: 0.05, c: this._col('#ff1a30'), a: 0.8 });
      }
    }
    // 보호막
    if (f.shieldK > 0.002) {
      f.shield.visible = true;
      var sk = f.size * 0.6 * f.shieldK * (1 + 0.015 * Math.sin(t * 3));
      f.shield.scale.set(sk, sk * 1.02, sk);
      f.shield.position.set(0, f.size * 0.44, 0);
      f.shieldUni.opacity.value = Math.min(1, f.shieldK) * 0.95;
      f.shieldUni.time.value = t;
    } else f.shield.visible = false;
    // 얼음
    if (f.frzK > 0.01) { f.ice.visible = true; f.iceMat.opacity = f.frzK * 0.92; } else f.ice.visible = false;
  };

  /* ── 사각 이펙트(참격·충격파·화살표 등) ── */
  S3._quad = function (o) {
    var mat = new THREE.MeshBasicMaterial({
      map: this.tex[o.tex], color: this._col(o.color || '#ffffff').clone(), transparent: true, depthWrite: false,
      blending: o.add === false ? THREE.NormalBlending : THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide
    });
    var m = new THREE.Mesh(this.geo.unit, mat);
    m.renderOrder = o.order || 5;
    m.position.copy(o.pos);
    m.visible = false;
    this.scene.add(m);
    this.quads.push({ m: m, age: 0, life: o.life || 0.5, delay: o.delay || 0, mode: o.mode || 'bill', rot: o.rot || 0, upd: o.upd, base: o.pos.clone(),
      a: o.a || null, b: o.b || null, len: 1 });
  };
  // 'beam' 사각형: a→b 선분을 따라 눕히고 카메라 쪽으로 최대한 돌린다(원통형 빌보드)
  S3._orientBeam = function (e) {
    var B = this._bm, m = e.m;
    B.x.subVectors(e.b, e.a);
    var len = B.x.length();
    if (len < 1e-4) { B.x.set(1, 0, 0); len = 1e-4; } else B.x.multiplyScalar(1 / len);
    m.position.addVectors(e.a, e.b).multiplyScalar(0.5);
    B.z.subVectors(this.camera.position, m.position);
    B.z.addScaledVector(B.x, -B.z.dot(B.x));
    if (B.z.lengthSq() < 1e-8) B.z.set(0, 0, 1); else B.z.normalize();
    B.y.crossVectors(B.z, B.x);
    B.m.makeBasis(B.x, B.y, B.z);
    m.quaternion.setFromRotationMatrix(B.m);
    e.len = len;
  };
  S3._beam = function (a, b, o) {
    this._quad({ tex: o.tex || 'beam', color: o.color, pos: a, a: a, b: b, mode: 'beam', life: o.life || 0.4, delay: o.delay || 0, order: o.order || 7, add: o.add, upd: o.upd });
  };
  S3._updQuads = function (dt) {
    var q = this.quads, cam = this.camera;
    for (var i = 0; i < q.length; i++) {
      var e = q[i];
      if (e.delay > 0) { e.delay -= dt; continue; }
      e.age += dt;
      var k = e.age / e.life;
      if (k >= 1) {
        this.scene.remove(e.m); e.m.material.dispose();
        q.splice(i, 1); i--; continue;
      }
      e.m.visible = true;
      if (e.mode === 'ground') e.m.rotation.set(-Math.PI / 2, 0, e.rot);
      else if (e.mode === 'beam') this._orientBeam(e);
      else { e.m.quaternion.copy(cam.quaternion); e.m.rotateZ(e.rot); }
      try { e.upd(k, e.m, e); } catch (err) { e.age = e.life; }
    }
  };
  // 자주 쓰는 사각 이펙트
  // nadd=true: 일반 블렌딩(밝은 배경에서도 색이 하얗게 날아가지 않음)
  S3._shock = function (pos, color, ground, size, delay, life, nadd) {
    var sz = size || 2.2;
    this._quad({ tex: 'shock', color: color, pos: pos, mode: ground ? 'ground' : 'bill', life: life || 0.5, delay: delay || 0, add: !nadd, upd: function (k, m) {
      var s = 0.3 + sz * Ez.outCubic(k); m.scale.set(s, s, 1); m.material.opacity = 0.95 * (1 - k);
    } });
  };
  S3._star = function (pos, color, size, life, nadd) {
    var sz = size || 1.6;
    this._quad({ tex: 'star', color: color, pos: pos, rot: Math.random() * TAU, life: life || 0.3, add: !nadd, upd: function (k, m) {
      var s = sz * (0.4 + 0.8 * Ez.outCubic(k)); m.scale.set(s, s, 1); m.material.opacity = k < 0.2 ? 1 : 1 - (k - 0.2) / 0.8;
    } });
  };

  S3._center = function (f, out) {
    out = out || new THREE.Vector3();
    out.set(f.base.x + f.holder.position.x, f.holder.position.y + f.size * 0.42, f.base.z + f.holder.position.z);
    return out;
  };
  S3._feet = function (f, out) {
    out = out || new THREE.Vector3();
    out.set(f.base.x + f.holder.position.x, 0.05, f.base.z + f.holder.position.z);
    return out;
  };
  S3._shakeCam = function (amp) { this.cam.shake = Math.max(this.cam.shake, amp); };
  // 카메라에서 먼 지점일수록 커지는 이펙트 배율
  S3._distK = function (x, y, z) {
    var p = this.camera.position, dx = p.x - x, dy = p.y - y, dz = p.z - z;
    return clamp(Math.sqrt(dx * dx + dy * dy + dz * dz) / 6.5, 1, 1.75);
  };
  S3._punch = function (target) {
    var c = this.cam, tw = this.tw, tok = ++c.ptok;
    c.punchTo.copy(target);
    tw.add(130, function (e) { if (c.ptok === tok) c.punch = Math.max(c.punch, e); }, Ez.outCubic).then(function () {
      return tw.add(460, function (e) { if (c.ptok === tok) c.punch = 1 - e; }, Ez.inOut);
    });
  };
  // 입자 사방 분출
  S3._burst = function (pool, n, at, o) {
    var P = this.pools[pool];
    for (var i = 0; i < n; i++) {
      var th = Math.random() * TAU, ph = Math.acos(rand(-1, 1));
      var sp = rand(o.sp0, o.sp1);
      var dx = Math.sin(ph) * Math.cos(th), dy = Math.cos(ph), dz = Math.sin(ph) * Math.sin(th);
      if (o.up) dy = Math.abs(dy) * o.up + (1 - o.up) * dy;
      if (o.flat) dy *= o.flat;
      var bx = o.bias ? o.bias.x : 0, by = o.bias ? o.bias.y : 0, bz = o.bias ? o.bias.z : 0;
      var kk = o.k || 1;
      P.spawn({
        x: at.x + (o.jit ? rand(-o.jit, o.jit) : 0), y: at.y + (o.jit ? rand(-o.jit, o.jit) * 0.6 : 0), z: at.z + (o.jit ? rand(-o.jit, o.jit) * 0.5 : 0),
        vx: dx * sp + bx, vy: dy * sp + by + (o.vy || 0), vz: dz * sp + bz,
        g: o.g || 0, drag: o.drag || 0, life: rand(o.l0, o.l1), delay: o.delay ? rand(0, o.delay) : 0,
        s0: rand(o.s0[0], o.s0[1]) * kk, s1: o.s1 != null ? o.s1 * kk : undefined,
        c: this._col(pick(o.cols)), a: o.a != null ? o.a : 1, vr: o.vr ? rand(-o.vr, o.vr) : 0,
        fin: o.fin, fout: o.fout, wob: o.wob
      });
    }
  };

  /* ── 기술 연출 ── */
  // 밝은 배경(숲·신전 등)에서는 가산 블렌딩 색이 하얗게 날아가므로, 타입 색은 일반 블렌딩 층(softN·sparkN·flameN,
  // nadd 사각형)으로 칠하고 가산 블렌딩은 작은 흰·노란 심지에만 쓴다.
  // 진행 방향 기준 가로·세로 직교 벡터
  function frame3(from, to) {
    var d = new THREE.Vector3().subVectors(to, from);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    d.normalize();
    var side = new THREE.Vector3(-d.z, 0, d.x);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    var up = new THREE.Vector3().crossVectors(side, d).normalize();
    if (up.y < 0) up.multiplyScalar(-1);
    return { d: d, side: side, up: up };
  }
  S3._projectile = function (fx, from, to, T) {
    var self = this, cols = FXC[fx] || FXC.normal, i, P = this.pools;
    var fr = frame3(from, to), kd = this._distK(to.x, to.y, to.z);
    function aim(j) { return { x: to.x + rand(-j, j), y: to.y + rand(-j, j), z: to.z + rand(-j, j) }; }
    // from→(목표+흔들림) 직선 비행 입자 하나
    function fly(pool, o) {
      var tg = aim(o.j || 0.15), life = o.life || T, lift = o.lift || 0;
      pool.spawn({ x: from.x + (o.jf ? rand(-o.jf, o.jf) : 0), y: from.y + (o.jf ? rand(-o.jf, o.jf) : 0), z: from.z,
        vx: (tg.x - from.x) / life + (o.vx || 0), vy: (tg.y - from.y) / life + lift + (o.vy || 0), vz: (tg.z - from.z) / life,
        g: o.g || 0, life: life, delay: o.delay || 0, s0: o.s0, s1: o.s1, c: self._col(o.c), a: o.a == null ? 1 : o.a,
        rot: o.rot, vr: o.vr || 0, wob: o.wob || 0, wf: o.wf || 2, fin: 0.05, fout: o.fout || 0.88 });
    }
    switch (fx) {
      case 'fire': {
        for (i = 0; i < 22; i++) {
          var d = i * 0.011;
          fly(P.softN, { delay: d, j: 0.18, lift: T, g: -2, s0: rand(0.22, 0.3), s1: rand(0.46, 0.6), c: pick(['#ff7a1a', '#ff4a10', '#ffa02a']), a: 0.8, fout: 0.8 });
          if (i % 3 === 0) fly(P.softAdd, { delay: d, j: 0.1, lift: T, g: -2, s0: 0.2, s1: 0.32, c: '#ffd84a', a: 0.6 });
          if (i % 2 === 0) fly(P.sparkN, { delay: d, j: 0.25, s0: rand(0.1, 0.16), s1: 0.04, c: pick(['#ffb030', '#ffe060']), vx: rand(-0.6, 0.6), vy: rand(0, 1.2), life: T * 1.15, fout: 0.7 });
        }
        break;
      }
      case 'grass': {
        for (i = 0; i < 8; i++) {
          (function (i) {
            var ph = i / 8 * TAU, R = 0.34, sz = 0.3 * kd;
            self._quad({ tex: 'leaf', color: pick(['#5ad03a', '#3eb82e', '#8ae05a', '#2e9a28']), add: false, pos: from, delay: i * 0.025, life: T, order: 7, rot: rand(0, TAU),
              upd: function (k, m, e) {
                var r = R * (1 - 0.75 * k), ang = ph + k * TAU * 1.7;
                m.position.copy(from).lerp(to, k).addScaledVector(fr.side, Math.cos(ang) * r).addScaledVector(fr.up, Math.sin(ang) * r);
                m.scale.set(sz, sz, 1); e.rot += 0.35; m.material.opacity = k < 0.12 ? k / 0.12 : 1;
              } });
          })(i);
        }
        for (i = 0; i < 8; i++) fly(P.leaf, { delay: rand(0, 0.12), j: 0.3, s0: rand(0.14, 0.2), c: pick(cols), vr: rand(-9, 9), wob: 2, wf: 9 });
        break;
      }
      case 'electric': {
        var a0 = from.clone(), b0 = to.clone();
        [0, 0.07, 0.14].forEach(function (dl, j) {
          self._beam(a0, b0, { tex: j % 2 ? 'bolt2' : 'bolt', color: '#ffd820', add: false, delay: dl, life: 0.16, upd: function (k, m, e) {
            m.scale.set(e.len, 0.6 * kd, 1); m.material.opacity = 1 - k * 0.4;
          } });
          self._beam(a0, b0, { tex: j % 2 ? 'bolt2' : 'bolt', color: '#ffffff', delay: dl, life: 0.16, order: 8, upd: function (k, m, e) {
            m.scale.set(e.len, 0.3 * kd, 1); m.material.opacity = 1 - k * 0.5;
          } });
        });
        this._burst('sparkN', 10, from, { sp0: 1, sp1: 2.6, l0: 0.2, l1: 0.35, s0: [0.15, 0.25], s1: 0.03, cols: ['#ffd820', '#ffe860'], drag: 3 });
        break;
      }
      case 'poison': {
        for (i = 0; i < 11; i++) {
          var dp = i * 0.022;
          fly(P.drop, { delay: dp, j: 0.16, lift: 4.5 * T, g: -9, s0: rand(0.24, 0.36), s1: 0.2, c: pick(cols), rot: 0, fout: 0.92 });
          if (i % 2 === 0) fly(P.softN, { delay: dp, j: 0.1, lift: 4.5 * T, g: -9, s0: 0.5, s1: 0.36, c: '#9a3ae0', a: 0.4, fout: 0.9 });
        }
        break;
      }
      case 'ghost': {
        this._quad({ tex: 'orb', color: '#ffffff', add: false, pos: from, life: T, order: 8, upd: function (k, m) {
          m.position.copy(from).lerp(to, Ez.inQuad(k) * 0.4 + k * 0.6).addScaledVector(fr.up, Math.sin(k * Math.PI * 2) * 0.12);
          var s = (0.55 + 0.06 * Math.sin(k * 40)) * kd; m.scale.set(s, s, 1); m.material.opacity = Math.min(1, k * 6);
          P.softN.spawn({ x: m.position.x + rand(-0.08, 0.08), y: m.position.y + rand(-0.08, 0.08), z: m.position.z, vy: 0.35, life: 0.45, s0: 0.34, s1: 0.05,
            c: self._col(pick(['#6a3ac8', '#4a1a98', '#8a5aff'])), a: 0.6, wob: 0.6 });
        } });
        break;
      }
      case 'dragon': {
        var da = from.clone(), db = from.clone(), L = T + 0.26;
        var grow = function (k) { db.copy(from).lerp(to, Math.min(1, k * L / T)); };
        this._beam(da, db, { color: '#6a4aff', add: false, life: L, upd: function (k, m, e) {
          grow(k); m.scale.set(e.len, 0.9 * kd * (1 - 0.35 * k), 1); m.material.opacity = k < 0.7 ? 0.9 : (1 - k) / 0.3 * 0.9;
        } });
        this._beam(da, db, { color: '#3ae8d8', add: false, life: L, order: 8, upd: function (k, m, e) {
          grow(k); m.scale.set(e.len, 0.42 * kd * (1 + 0.25 * Math.sin(k * 50)), 1); m.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
        } });
        this._beam(da, db, { color: '#ffffff', life: L, order: 9, upd: function (k, m, e) {
          grow(k); m.scale.set(e.len, 0.14 * kd, 1); m.material.opacity = k < 0.7 ? 0.9 : (1 - k) / 0.3 * 0.9;
        } });
        for (i = 0; i < 16; i++) fly(P.softN, { delay: i * 0.012, j: 0.1, s0: rand(0.18, 0.28), s1: 0.1, c: pick(cols), a: 0.85, wob: 3, wf: 14, fout: 0.85 });
        break;
      }
      case 'bug': {
        for (i = 0; i < 24; i++) {
          fly(P.dotN, { delay: rand(0, 0.12), jf: 0.18, j: 0.3, life: T + rand(0, 0.08), s0: rand(0.16, 0.24) * kd, s1: 0.14 * kd, c: pick(['#c8f03a', '#9ad02a', '#e8ff6a']),
            vr: rand(-6, 6), wob: 3.2, wf: rand(9, 15), fout: 0.92 });
        }
        for (i = 0; i < 10; i++) fly(P.sparkN, { delay: rand(0, 0.12), jf: 0.15, j: 0.3, s0: 0.3, s1: 0.2, c: '#b8e030', a: 0.6, wob: 2, wf: 10 });
        break;
      }
      case 'fairy': {
        for (i = 0; i < 18; i++) fly(P.sparkN, { delay: i * 0.012, j: 0.22, lift: T, g: -2, s0: rand(0.32, 0.44) * kd, s1: 0.2, c: pick(['#ff7ac8', '#ff9ad8', '#ffc0ec']), vr: rand(-5, 5), wob: 1.5, wf: 7 });
        for (i = 0; i < 6; i++) fly(P.plus, { delay: i * 0.04, j: 0.2, s0: 0.2, s1: 0.1, c: '#ffffff', a: 0.9, vr: rand(-4, 4), wob: 1, wf: 6 });
        for (i = 0; i < 4; i++) fly(P.heart, { delay: i * 0.05, j: 0.05, vy: rand(-0.4, 0.6), s0: 0.3, s1: 0.22, c: '#ff6ac0', rot: 0, wob: 1, wf: 6 });
        break;
      }
      default: {   // water, ice 및 기타
        var ice = fx === 'ice', n = ice ? 14 : 26, PP = ice ? P.shard : P.drop;
        var g = -6, lift = 0.5 * 6 * T;
        for (i = 0; i < n; i++) {
          var jx = rand(-0.12, 0.12), jy = rand(-0.12, 0.12), jz = rand(-0.1, 0.1);
          var tx = to.x + rand(-0.15, 0.15), ty = to.y + rand(-0.15, 0.15), tzz = to.z + rand(-0.15, 0.15);
          var dd = i * (ice ? 0.02 : 0.011);
          PP.spawn({ x: from.x + jx, y: from.y + jy, z: from.z + jz, vx: (tx - from.x - jx) / T, vy: (ty - from.y - jy) / T + lift, vz: (tzz - from.z - jz) / T,
            g: g, life: T, delay: dd, s0: ice ? rand(0.2, 0.3) : rand(0.13, 0.2), s1: ice ? 0.2 : 0.12, c: this._col(pick(cols)), a: 1,
            fin: 0.05, fout: 0.92, rot: ice ? Math.atan2(ty - from.y, tx - from.x) - Math.PI / 2 : 0, vr: ice ? rand(-6, 6) : 0 });
          if (i % 2 === 0) P.softN.spawn({ x: from.x, y: from.y, z: from.z, vx: (tx - from.x) / T, vy: (ty - from.y) / T + lift, vz: (tzz - from.z) / T,
            g: g, life: T, delay: dd, s0: 0.42, s1: 0.3, c: this._col(cols[1]), a: 0.35, fin: 0.05, fout: 0.9 });
        }
      }
    }
  };

  // 원거리 발현형(에스퍼·땅·바위): 대상 위치에서 T초 동안 차오르는 예비 연출
  S3._remote = function (fx, A, D, to, T) {
    var P = this.pools, i;
    var kd = this._distK(to.x, to.y, to.z), sz = (D ? D.size : 2) * kd;
    var feet = new THREE.Vector3(to.x, 0.05, to.z);
    if (A && A.id) {   // 시전자 발광
      var tf = ++A.tok.flash, a = A.a;
      A.uni.flashColor.value.set(fx === 'psychic' ? '#ff6ac8' : fx === 'rock' ? '#c8a878' : '#b8884a');
      this.tw.add(T * 1000 + 200, function (e, k) { if (tf === A.tok.flash) a.flash = 0.5 * Math.sin(k * Math.PI); })
        .then(function () { if (tf === A.tok.flash) a.flash = 0; });
    }
    if (fx === 'psychic') {
      this.overlay.flash('#ff5ab4', 0.2, T * 1000 + 520);
      this._quad({ tex: 'shock', color: '#ff4ab0', add: false, pos: to, life: T, upd: function (k, m) {
        var s = sz * (2.6 - 2.2 * Ez.inQuad(k)); m.scale.set(s, s, 1); m.material.opacity = 0.3 + 0.6 * k;
      } });
      for (i = 0; i < 14; i++) {
        var th = Math.random() * TAU, R = sz * rand(0.6, 0.9);
        var px = to.x + Math.cos(th) * R, py = to.y + Math.sin(th) * R * 0.8, pz = to.z + 0.1;
        P.softN.spawn({ x: px, y: py, z: pz, vx: (to.x - px) / T, vy: (to.y - py) / T, vz: 0, life: T, delay: rand(0, 0.08), s0: rand(0.2, 0.3), s1: 0.06,
          c: this._col(pick(['#ff4ab0', '#ff7ac8', '#e040a0'])), a: 0.85, fin: 0.2, fout: 0.85 });
      }
    } else if (fx === 'ground') {
      this._shakeCam(0.09);
      this._quad({ tex: 'shock', color: '#8a5a2a', pos: feet, mode: 'ground', life: T, add: false, upd: function (k, m) {
        var s = sz * (0.4 + 0.7 * k); m.scale.set(s, s, 1); m.material.opacity = 0.6 * k;
      } });
      this._burst('puff', 6, feet, { k: kd, sp0: 0.4, sp1: 1, flat: 0.3, vy: 0.5, drag: 2, l0: 0.5, l1: 0.7, s0: [0.3, 0.45], s1: 0.8, cols: FXC.ground, a: 0.7, jit: sz * 0.2 });
    } else if (fx === 'rock') {
      var g = -14;
      for (i = 0; i < 7; i++) {
        var d = i === 0 ? 0 : rand(0, 0.14), life = T - d;
        var x = to.x + rand(-0.35, 0.35) * sz * 0.6, z = to.z + rand(-0.25, 0.25), y0 = to.y + rand(2.6, 3.4), ty = to.y + rand(-0.2, 0.25);
        P.rock.spawn({ x: x, y: y0, z: z, vx: (to.x - x) * 0.3 / life, vy: (ty - y0 - 0.5 * g * life * life) / life, g: g, life: life, delay: d,
          s0: rand(0.36, 0.56) * kd, c: this._col(pick(['#b8a07a', '#a08a68', '#c8b08a'])), a: 1, vr: rand(-5, 5), fin: 0.05, fout: 0.96 });
      }
    }
  };

  S3._impact = function (fx, at, D, dir) {
    var cols = FXC[fx] || FXC.normal, self = this, P = this.pools, i;
    // 멀리 있는 대상일수록 이펙트를 키워 화면상 존재감을 맞춘다
    var k = clamp(this.camera.position.distanceTo(at) / 6.5, 1, 1.75);
    var sz = (D ? D.size : 2) * k;
    var bias = this._tmp.c.copy(dir).multiplyScalar(1.2);
    var feet = this._feet(D || { base: at, holder: { position: { x: 0, y: 0, z: 0 } } }, new THREE.Vector3());
    function cut(list, color, len, wid, life, add) {   // 초승달 칼날 사각형들 [[회전, 지연], ...]
      list.forEach(function (s) {
        self._quad({ tex: s[2] || 'gust', color: color, add: !!add, pos: at, order: 7, rot: s[0], delay: s[1], life: life || 0.42, upd: function (q, m) {
          var g = Ez.outCubic(Math.min(1, q * 2.4)); m.scale.set(sz * len * (0.3 + 0.7 * g), sz * wid, 1); m.material.opacity = q < 0.4 ? 1 : 1 - (q - 0.4) / 0.6;
        } });
      });
    }
    switch (fx) {
      case 'water':
        this._burst('drop', 40, at, { k: k, sp0: 1.5, sp1: 4.5, up: 0.6, g: -9, l0: 0.55, l1: 0.9, s0: [0.13, 0.22], s1: 0.07, cols: cols, bias: bias, vy: 1.3, fout: 0.6 });
        this._burst('ring', 14, at, { k: k, sp0: 0.3, sp1: 1.2, up: 1, vy: 0.6, l0: 0.8, l1: 1.3, s0: [0.15, 0.34], cols: ['#bfeaff', '#8fd4ff'], wob: 0.5, jit: sz * 0.2, a: 0.95 });
        this._burst('softN', 1, at, { sp0: 0, sp1: 0, l0: 0.3, l1: 0.3, s0: [sz * 0.8, sz * 0.8], s1: sz * 1.2, cols: ['#3fa9ff'], a: 0.5, fout: 0.2 });
        this._shock(at, '#3aa8ff', false, sz * 1.1, 0, 0.5, true);
        this._shock(feet, '#5ab8ff', true, sz * 1.2, 0, 0.5, true);
        break;
      case 'ice':
        this._burst('shard', 26, at, { k: k, sp0: 2, sp1: 4.8, g: -6, l0: 0.6, l1: 0.95, s0: [0.22, 0.4], cols: cols, bias: bias, vr: 9, vy: 0.8, fout: 0.65 });
        this._burst('spark', 14, at, { k: k, sp0: 1, sp1: 3, l0: 0.35, l1: 0.6, s0: [0.2, 0.34], s1: 0.05, cols: ['#ffffff', '#bff4ff'], drag: 2 });
        this._burst('sparkN', 10, at, { k: k, sp0: 1, sp1: 3, l0: 0.35, l1: 0.6, s0: [0.2, 0.3], s1: 0.05, cols: ['#56c8ee', '#8fdcff'], drag: 2 });
        this._burst('puff', 7, at, { k: k, sp0: 0.3, sp1: 0.9, l0: 0.8, l1: 1.1, s0: [0.5, 0.8], s1: 1.4, cols: ['#ffffff', '#e4f8ff'], a: 0.6, jit: 0.2 });
        this._star(at, '#7fd8f4', sz * 0.75, 0.3, true);
        this._shock(at, '#7fd8f4', false, sz * 1.0, 0, 0.45, true);
        break;
      case 'dark':
        [[0.62, 0], [-0.62, 0.08]].forEach(function (s) {
          self._quad({ tex: 'slash', pos: at, order: 7, add: false, rot: s[0] + Math.PI * (s[0] > 0 ? 0 : 1), delay: s[1], life: 0.45, upd: function (q, m) {
            var g = Ez.outCubic(Math.min(1, q * 2.6));
            m.scale.set(sz * 1.35 * (0.3 + 0.7 * g), sz * 0.6, 1);
            m.material.opacity = q < 0.4 ? 1 : 1 - (q - 0.4) / 0.6;
          } });
        });
        this._burst('softN', 22, at, { k: k, sp0: 1.5, sp1: 3.6, l0: 0.4, l1: 0.7, s0: [0.24, 0.36], s1: 0.03, cols: cols, drag: 2.5, delay: 0.08, a: 0.9 });
        this._burst('puff', 7, at, { k: k, sp0: 0.5, sp1: 1.3, l0: 0.6, l1: 0.9, s0: [0.4, 0.6], s1: 1.1, cols: ['#2a0612', '#3a0a1a'], a: 0.55, jit: 0.25, delay: 0.18 });
        this._shock(at, '#e01a34', false, sz * 1.2, 0, 0.5, true);
        break;
      case 'steel':
        this._burst('sparkN', 36, at, { k: k, sp0: 3, sp1: 7.5, up: 0.5, g: -12, drag: 1.4, l0: 0.4, l1: 0.7, s0: [0.18, 0.3], s1: 0.05, cols: ['#ffb020', '#ff8a1a', '#ffd040'], bias: bias });
        this._burst('spark', 14, at, { k: k, sp0: 3, sp1: 6, up: 0.5, g: -12, drag: 1.4, l0: 0.3, l1: 0.5, s0: [0.18, 0.28], s1: 0.05, cols: ['#fff6c0', '#ffffff'], bias: bias });
        this._burst('softN', 1, at, { sp0: 0, sp1: 0, l0: 0.25, l1: 0.25, s0: [sz * 0.7, sz * 0.7], s1: sz * 1.1, cols: ['#c0c8d8'], a: 0.6, fout: 0.2 });
        this._star(at, '#fff0b0', sz * 0.75, 0.3);
        this._shock(at, '#a8b4c8', false, sz * 1.1, 0, 0.5, true);
        break;
      case 'fire':
        this.overlay.flash('#ff7a1a', 0.3, 420);
        for (i = 0; i < 30; i++) {
          var core = i % 3 === 0;
          (core ? P.flame : P.flameN).spawn({ x: at.x + rand(-0.3, 0.3) * sz, y: at.y + rand(-0.45, 0.1) * sz, z: at.z + rand(-0.15, 0.25), vx: rand(-0.3, 0.3), vy: rand(1.0, 2.2),
            life: rand(0.5, 0.85), delay: rand(0, 0.18), s0: rand(0.7, 1.05) * k * (core ? 0.55 : 1), s1: 0.15,
            c: this._col(core ? '#ffe060' : pick(['#ff6a10', '#ff3a10', '#ff9a20'])), a: core ? 0.8 : 0.95, rot: 0, wob: 0.6, fin: 0.1, fout: 0.45 });
        }
        this._burst('softN', 14, at, { k: k, sp0: 1.5, sp1: 3.5, l0: 0.35, l1: 0.6, s0: [0.3, 0.45], s1: 0.06, cols: ['#ff6a10', '#ff9a20'], drag: 2.5, bias: bias, a: 0.85 });
        this._burst('sparkN', 14, at, { k: k, sp0: 1.5, sp1: 3.5, up: 0.8, vy: 1.5, g: -3, l0: 0.5, l1: 0.9, s0: [0.12, 0.2], s1: 0.03, cols: ['#ffb030', '#ffd040'], drag: 1 });
        this._burst('puff', 5, at, { k: k, sp0: 0.3, sp1: 0.8, vy: 1, l0: 0.8, l1: 1.1, s0: [0.4, 0.6], s1: 1.2, cols: ['#3a2a22', '#2a1c18'], a: 0.45, jit: 0.3, delay: 0.18 });
        this._shock(at, '#ff6a10', false, sz * 1.15, 0, 0.5, true);
        break;
      case 'grass':
        cut([[0.5, 0], [-0.7, 0.07]], '#3ec832', 1.25, 0.5, 0.4);
        this._burst('leaf', 22, at, { k: k, sp0: 1.6, sp1: 3.6, g: -1.5, drag: 1.4, l0: 0.7, l1: 1.1, s0: [0.2, 0.32], cols: cols, vr: 9, wob: 1, bias: bias });
        this._burst('sparkN', 10, at, { k: k, sp0: 1, sp1: 2.5, l0: 0.3, l1: 0.5, s0: [0.16, 0.26], s1: 0.04, cols: ['#8ae05a', '#3ec94a'], drag: 2 });
        this._shock(at, '#4ac83a', false, sz * 1.0, 0, 0.5, true);
        break;
      case 'electric':
        this.overlay.flash('#fff27a', 0.42, 320);
        for (i = 0; i < 5; i++) {
          (function (i) {
            var wht = i % 2 === 1, rot = rand(0, Math.PI);
            self._quad({ tex: i % 2 ? 'bolt2' : 'bolt', color: wht ? '#ffffff' : '#ffd010', add: wht, pos: at, order: wht ? 8 : 7, rot: rot, delay: i * 0.045, life: 0.22, upd: function (q, m) {
              m.scale.set(sz * (0.95 + 0.3 * q), sz * (wht ? 0.2 : 0.36) * (Math.floor(q * 8) % 2 ? 1 : -1), 1); m.material.opacity = 1 - q * 0.5;
            } });
          })(i);
        }
        this._burst('sparkN', 24, at, { k: k, sp0: 3, sp1: 7, l0: 0.25, l1: 0.5, s0: [0.16, 0.28], s1: 0.03, cols: ['#ffd010', '#ffe84a'], drag: 3 });
        this._burst('spark', 10, at, { k: k, sp0: 2, sp1: 5, l0: 0.2, l1: 0.4, s0: [0.16, 0.24], s1: 0.03, cols: ['#ffffff'], drag: 3 });
        this._star(at, '#ffd820', sz * 0.8, 0.26, true);
        this._shock(at, '#ffd010', false, sz * 1.1, 0, 0.45, true);
        this._shakeCam(0.1);
        break;
      case 'fighting':
        this._star(at, '#ff6a20', sz * 0.95, 0.3, true);
        this._star(at, '#ffffff', sz * 0.5, 0.22);
        this._shock(at, '#ff4a1a', false, sz * 0.9, 0, 0.36, true);
        this._shock(at, '#ff8a3a', false, sz * 1.35, 0.07, 0.45, true);
        this._shock(at, '#ffb060', false, sz * 1.8, 0.14, 0.5, true);
        this._burst('sparkN', 24, at, { k: k, sp0: 3, sp1: 6.5, l0: 0.3, l1: 0.55, s0: [0.18, 0.3], s1: 0.04, cols: ['#ff5a1a', '#ff9a3a', '#ffc070'], drag: 2, bias: bias });
        this._burst('puff', 8, feet, { k: k, sp0: 0.8, sp1: 2, flat: 0.25, vy: 0.3, drag: 2, l0: 0.6, l1: 0.9, s0: [0.4, 0.6], s1: 1.2, cols: ['#efe0c0', '#d8c8a8'], a: 0.75, jit: 0.3 });
        this._shock(feet, '#ff7a3a', true, sz * 1.4, 0, 0.5, true);
        this._shakeCam(0.2);
        break;
      case 'poison':
        this._burst('drop', 26, at, { k: k, sp0: 1.5, sp1: 4, up: 0.6, g: -9, l0: 0.55, l1: 0.9, s0: [0.16, 0.26], s1: 0.08, cols: cols, bias: bias, vy: 1.2, fout: 0.6 });
        this._burst('ring', 16, at, { k: k, sp0: 0.2, sp1: 0.8, up: 1, vy: 0.8, l0: 0.9, l1: 1.4, s0: [0.12, 0.3], cols: ['#c080ff', '#9a40f0', '#d8a8ff'], wob: 0.6, jit: sz * 0.25, a: 0.95 });
        this._burst('puff', 6, at, { k: k, sp0: 0.3, sp1: 0.9, l0: 0.7, l1: 1, s0: [0.45, 0.65], s1: 1.2, cols: ['#7a3ab0', '#5a2a88'], a: 0.5, jit: 0.25 });
        this._shock(at, '#9a40f0', false, sz * 1.1, 0, 0.5, true);
        break;
      case 'ground':
        this._shock(feet, '#a0703a', true, sz * 1.7, 0, 0.5, true);
        this._shock(feet, '#7a5228', true, sz * 2.3, 0.1, 0.6, true);
        this._burst('puff', 20, feet, { k: k, sp0: 1.2, sp1: 3, up: 1, vy: 1.2, g: -1.5, drag: 1.2, l0: 0.7, l1: 1.1, s0: [0.45, 0.75], s1: 1.4, cols: FXC.ground, a: 0.85, jit: sz * 0.3 });
        this._burst('rock', 14, feet, { k: k, sp0: 2.5, sp1: 5, up: 1, vy: 2, g: -12, l0: 0.7, l1: 1, s0: [0.16, 0.3], cols: ['#b8986a', '#8a6a42', '#d0b080'], vr: 8, jit: sz * 0.25, fout: 0.8 });
        this._shakeCam(0.3);
        break;
      case 'flying':
        cut([[0.45, 0], [-0.45 + Math.PI, 0.06]], '#7ab8ff', 1.5, 0.55, 0.42);
        cut([[0.05, 0.12]], '#ffffff', 1.4, 0.4, 0.4, true);
        this._burst('leaf', 14, at, { k: k, sp0: 1, sp1: 2.6, g: -0.8, drag: 1.5, l0: 0.9, l1: 1.4, s0: [0.16, 0.26], cols: ['#ffffff', '#eef6ff', '#dce8f4'], vr: 4, wob: 1.4, jit: 0.2 });
        this._burst('puff', 6, at, { k: k, sp0: 0.8, sp1: 1.8, l0: 0.5, l1: 0.8, s0: [0.4, 0.6], s1: 1.1, cols: ['#ffffff', '#e8f4ff'], a: 0.6, bias: bias });
        this._shock(at, '#7ab8ff', false, sz * 1.1, 0, 0.5, true);
        break;
      case 'psychic':
        for (i = 0; i < 4; i++) this._shock(at, i % 2 ? '#ff8ad0' : '#e0309a', false, sz * (0.9 + i * 0.35), i * 0.09, 0.55, true);
        this._burst('sparkN', 16, at, { k: k, sp0: 1, sp1: 3, l0: 0.35, l1: 0.6, s0: [0.18, 0.28], s1: 0.04, cols: ['#ff4ab0', '#ff8ad0'], drag: 2 });
        this._burst('softN', 12, at, { k: k, sp0: 0.6, sp1: 1.6, l0: 0.5, l1: 0.8, s0: [0.3, 0.45], s1: 0.06, cols: ['#ff5ab4', '#e040a0'], drag: 1.5, a: 0.7 });
        this._star(at, '#ff6ac8', sz * 0.75, 0.3, true);
        break;
      case 'bug':
        cut([[0.35 + Math.PI / 2, 0], [-0.35 + Math.PI / 2, 0.05]], '#9ac820', 0.9, 0.42, 0.32);
        this._burst('dotN', 22, at, { k: k, sp0: 0.8, sp1: 2.4, l0: 0.6, l1: 1.0, s0: [0.16, 0.24], s1: 0.08, cols: ['#c8f03a', '#9ad02a', '#e8ff6a'], drag: 2.5, wob: 3.5, vr: 6, jit: sz * 0.15 });
        this._burst('sparkN', 12, at, { k: k, sp0: 0.8, sp1: 2.6, l0: 0.4, l1: 0.7, s0: [0.16, 0.24], s1: 0.06, cols: ['#c8f03a', '#8ab820'], drag: 2.5 });
        this._burst('puff', 4, at, { k: k, sp0: 0.3, sp1: 0.8, l0: 0.5, l1: 0.8, s0: [0.35, 0.5], s1: 0.9, cols: ['#d8e88a', '#b8c860'], a: 0.4 });
        this._shock(at, '#a8d020', false, sz * 0.95, 0, 0.5, true);
        break;
      case 'rock':
        this._burst('rock', 16, at, { k: k, sp0: 1.5, sp1: 3.6, up: 0.7, g: -10, l0: 0.6, l1: 0.95, s0: [0.16, 0.28], cols: ['#b8a07a', '#a08a68', '#8a7a62'], vr: 8, bias: bias, fout: 0.8 });
        this._burst('puff', 12, feet, { k: k, sp0: 0.8, sp1: 2.2, flat: 0.3, vy: 0.5, drag: 2, l0: 0.7, l1: 1.1, s0: [0.45, 0.7], s1: 1.3, cols: ['#cbb89a', '#a8967a'], a: 0.8, jit: 0.3 });
        this._star(at, '#fff0d0', sz * 0.6, 0.22);
        this._shock(feet, '#a8967a', true, sz * 1.5, 0, 0.5, true);
        this._shakeCam(0.26);
        break;
      case 'ghost':
        this._quad({ tex: 'orb', color: '#ffffff', add: false, pos: at, order: 7, life: 0.45, upd: function (q, m) {
          var s = sz * (0.4 + 1.1 * Ez.outCubic(q)); m.scale.set(s, s, 1); m.material.opacity = 0.9 * (1 - q);
        } });
        this._burst('puff', 9, at, { k: k, sp0: 0.6, sp1: 1.6, l0: 0.7, l1: 1.0, s0: [0.5, 0.75], s1: 1.4, cols: ['#2a1040', '#3a1a5a'], a: 0.7, jit: 0.2 });
        this._burst('softN', 22, at, { k: k, sp0: 0.8, sp1: 2.2, vy: 0.9, l0: 0.6, l1: 1.0, s0: [0.28, 0.42], s1: 0.05, cols: ['#6a3ac8', '#8a5aff', '#4a1a98'], drag: 1.8, wob: 1.2, a: 0.8 });
        this._shock(at, '#6a3ac8', false, sz * 1.2, 0, 0.5, true);
        break;
      case 'dragon':
        this.overlay.flash('#5af0e0', 0.2, 380);
        this._star(at, '#3ae8d8', sz * 0.9, 0.32, true);
        this._star(at, '#ffffff', sz * 0.45, 0.24);
        this._shock(at, '#6a4aff', false, sz * 1.4, 0, 0.5, true);
        this._shock(at, '#3ae8d8', false, sz * 1.0, 0.08, 0.5, true);
        this._burst('softN', 26, at, { k: k, sp0: 2, sp1: 5, l0: 0.4, l1: 0.75, s0: [0.26, 0.4], s1: 0.04, cols: ['#3ae8d8', '#6a4aff', '#9a7aff'], drag: 2, bias: bias, a: 0.9 });
        this._burst('sparkN', 12, at, { k: k, sp0: 1.5, sp1: 4, l0: 0.3, l1: 0.55, s0: [0.18, 0.28], s1: 0.04, cols: ['#3ae8d8', '#8a6aff'], drag: 2 });
        this._shakeCam(0.12);
        break;
      case 'fairy':
        this._burst('sparkN', 18, at, { k: k, sp0: 1, sp1: 2.6, l0: 0.6, l1: 1.0, s0: [0.22, 0.34], s1: 0.06, cols: ['#ff6ac0', '#ff9ad8', '#ffc0ec'], drag: 1.5, vr: 3 });
        this._burst('plus', 8, at, { k: k, sp0: 0.8, sp1: 2, l0: 0.5, l1: 0.8, s0: [0.2, 0.3], s1: 0.05, cols: ['#ffffff'], drag: 1.5, vr: 3 });
        for (i = 0; i < 7; i++) {
          P.heart.spawn({ x: at.x + rand(-0.35, 0.35) * sz, y: at.y + rand(-0.2, 0.3) * sz, z: at.z + 0.1, vy: rand(0.7, 1.3), life: rand(0.8, 1.1), delay: rand(0, 0.2),
            s0: rand(0.28, 0.42) * k, s1: 0.2 * k, c: this._col(pick(['#ff5ab8', '#ff8ad0', '#ff3a9a'])), a: 1, rot: 0, wob: 0.6, fin: 0.1, fout: 0.6 });
        }
        this._star(at, '#ff7ac8', sz * 0.8, 0.32, true);
        this._shock(at, '#ff7ac8', false, sz * 1.1, 0, 0.5, true);
        break;
      default: // normal
        this._star(at, '#fff4e0', sz * 0.85, 0.3);
        this._star(at, '#d8b880', sz * 0.6, 0.26, true);
        this._burst('puff', 18, feet, { k: k, sp0: 0.8, sp1: 2.4, flat: 0.25, vy: 0.4, drag: 2, l0: 0.7, l1: 1.1, s0: [0.45, 0.7], s1: 1.35, cols: cols, a: 0.85, jit: 0.3 });
        this._burst('puff', 7, at, { k: k, sp0: 0.5, sp1: 1.4, l0: 0.5, l1: 0.8, s0: [0.35, 0.55], s1: 0.9, cols: cols, a: 0.65 });
        this._shock(feet, '#c8b088', true, sz * 1.3, 0, 0.5, true);
    }
  };

  /* ───────────── 3D 공개 API ───────────── */
  S3.setBackground = function (key) {
    var self = this;
    return safe(function () {
      if (self.disposed) return null;
      var tok = self.bgTok = (self.bgTok || 0) + 1;
      return loadImage(assetURL(self.base, 'assets/bg/' + key + '.jpg')).then(function (img) {
        if (tok !== self.bgTok || self.disposed) return null;
        self._applyTheme(key, !self.bgCur);
        if (!img) return null;
        var ec = edgeColors(img);
        if (ec) {
          self.renderer.setClearColor(ec.bottom, 1);
          self.fadeBot.material.color.copy(ec.bottom);
          self.fadeTop.material.color.copy(ec.top);
        }
        var tex = new THREE.Texture(img);
        tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
        tex.repeat.x = -1; tex.offset.x = 1;      // 원통 안쪽에서 보므로 좌우 반전 보정
        tex.anisotropy = self.maxAniso;
        tex.needsUpdate = true;
        var inc = self.bgCur === self.bgA ? self.bgB : self.bgA, out = self.bgCur;
        if (inc.material.map) inc.material.map.dispose();
        inc.material.map = tex; inc.material.needsUpdate = true;
        inc.material.opacity = 0; inc.visible = true; inc.renderOrder = -9;
        if (out) out.renderOrder = -10;
        self.bgCur = inc;
        return self.tw.add(out ? 650 : 250, function (e) { inc.material.opacity = e; }, Ez.inOut).then(function () {
          if (out && self.bgCur === inc) out.visible = false;
        });
      });
    }, 8000);
  };

  S3.setFighter = function (side, id, o) {
    var self = this, f = this.fighters[side];
    if (!f || !isSide(side) || !id) return Promise.resolve();
    var tok = ++f.tok.set, shiny = !!(o && o.shiny);
    return safe(function () {
      return self._spriteTex(id, shiny).then(function (tex) {
        if (tok !== f.tok.set || self.disposed || !tex) return;
        f.id = id; f.shiny = shiny; f.size = sizeFor(id);
        f.uni.map.value = tex;
        for (var k in f.tok) if (k !== 'set') f.tok[k]++;
        self._resetAnim(f);
        f.fainted = false; f.frzK = 0; f.auraK = 0; f.shieldK = 0; f.trail = 0; f.st = null; f.stAcc = 0;
        f.uni.flashColor.value.setRGB(1, 1, 1);
        if (side === 'enemy') self.clearBall();
        f.root.visible = true;
      });
    }, 8000);
  };

  S3.clearFighter = function (side) {
    var f = this.fighters[side];
    if (!f || !isSide(side)) return Promise.resolve();
    f.tok.set++;
    for (var k in f.tok) f.tok[k]++;
    f.id = null; f.root.visible = false; f.frzK = 0; f.auraK = 0; f.shieldK = 0; f.trail = 0; f.st = null; f.stAcc = 0;
    this._resetAnim(f);
    if (side === 'enemy') this.clearBall();
    return Promise.resolve();
  };

  S3.enter = function (side) {
    var self = this, f = this.fighters[side];
    return safe(function () {
      if (!f || !f.id || !isSide(side)) return null;
      var tk = ++f.tok.enter, tw = self.tw, H = 2.6;
      f.root.visible = true; f.fainted = false;
      var a = f.a;
      a.rotX = 0; a.alpha = 0; a.dy = H; a.flash = 1; a.shadowA = 1; a.sq = 1;
      f.uni.flashColor.value.setRGB(1, 1, 1);
      return tw.add(430, function (e, k) {
        if (tk !== f.tok.enter) return;
        a.dy = H * (1 - e); a.alpha = Math.min(1, k * 3); a.flash = 1 - k * 0.55;
      }, Ez.inQuad).then(function () {
        if (tk !== f.tok.enter) return null;
        a.dy = 0;
        var feet = self._feet(f, new THREE.Vector3());
        self._burst('puff', 14, feet, { sp0: 1, sp1: 2.2, flat: 0.2, vy: 0.35, drag: 2.2, l0: 0.6, l1: 0.95, s0: [0.35, 0.6], s1: 1.1,
          cols: ['#e8dcc4', '#cbbd9e', '#f5efe2'], a: 0.75, jit: f.size * 0.18 });
        self._shock(feet, self.theme.rune, true, f.size * 1.4);
        self._shakeCam(0.05 + f.size * 0.015);
        return tw.add(380, function (e, k) {
          if (tk !== f.tok.enter) return;
          a.sq = 1 - 0.2 * Math.exp(-5 * k) * Math.cos(k * 9);
          a.flash = 0.45 * (1 - k);
        });
      }).then(function () { if (tk === f.tok.enter) { a.sq = 1; a.flash = 0; } });
    }, 3000);
  };

  S3.attack = function (side, fx) {
    var self = this;
    return safe(function () {
      var A = self.fighters[side], D = self.fighters[other(side)];
      if (!A || !A.id || !isSide(side)) return null;
      fx = fxKey(fx);
      var cfg = TYPEFX[fx], mode = cfg.m, melee = mode === 'melee';
      var from = self._center(A, new THREE.Vector3());
      var hasD = D && D.id && D.root.visible;
      var to = hasD ? self._center(D, new THREE.Vector3()) : new THREE.Vector3(side === 'player' ? 1.2 : -1.05, 1, side === 'player' ? -1.6 : 2.3);
      var dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
      var dist = dir.length() || 1;
      dir.multiplyScalar(1 / dist);
      var reach = melee ? dist * 0.5 : mode === 'remote' ? 0 : dist * 0.1;
      var lean = (side === 'player' ? -1 : 1) * (melee ? 0.2 : 0.08);
      var lyA = melee ? (cfg.ly != null ? cfg.ly : 0.3) : mode === 'remote' ? 0.14 : 0;
      var tk = ++A.tok.lunge, tw = self.tw, a = A.a, out = cfg.out || (melee ? 200 : 160);
      tw.add(out, function (e) {
        if (tk !== A.tok.lunge) return;
        a.lx = dir.x * reach * e; a.lz = dir.z * reach * e; a.ly = Math.sin(e * Math.PI * 0.5) * lyA; a.rl = lean * e;
      }, Ez.outCubic).then(function () {
        return tw.add(360, function (e) {
          if (tk !== A.tok.lunge) return;
          var k = 1 - e;
          a.lx = dir.x * reach * k; a.lz = dir.z * reach * k; a.ly = lyA * k; a.rl = lean * k;
        }, Ez.inOut);
      });
      self._punch(to);
      function land() {
        self._impact(fx, hasD ? self._center(D, new THREE.Vector3()) : to, hasD ? D : null, dir);
        return tw.wait(110);
      }
      if (melee) {
        if (fx === 'flying') {   // 급강하 궤적의 바람
          self._burst('puff', 6, from, { sp0: 0.3, sp1: 0.8, l0: 0.4, l1: 0.6, s0: [0.35, 0.5], s1: 0.9, cols: ['#ffffff', '#e8f4ff'], a: 0.5, bias: dir });
        } else if (fx === 'fighting') {
          self._burst('softAdd', 8, from, { sp0: 0.4, sp1: 1.2, l0: 0.25, l1: 0.4, s0: [0.3, 0.45], s1: 0.05, cols: FXC.fighting, a: 0.7 });
        }
        return tw.wait(out - 30).then(land);
      }
      if (mode === 'remote') {
        self._remote(fx, A, hasD ? D : null, to, cfg.T);
        return tw.wait(cfg.T * 1000).then(land);
      }
      var T = cfg.T || 0.36;
      var muzzle = from.clone().addScaledVector(dir, 0.4);
      muzzle.y += A.size * 0.05;
      self._projectile(fx, muzzle, to, T);
      return tw.wait(T * 1000 + 60).then(land);
    }, 3000);
  };

  S3.hit = function (side, o) {
    var self = this;
    o = o || {};
    return safe(function () {
      var f = self.fighters[side], A = self.fighters[other(side)];
      if (!f || !f.id || !isSide(side)) return null;
      var eff = o.eff == null ? 1 : o.eff;
      var s = 1 + (o.crit ? 0.6 : 0) + (eff > 1 ? 0.5 : 0) - (eff < 1 ? 0.3 : 0);
      var dir = new THREE.Vector3();
      if (A && A.id) dir.set(f.base.x - A.base.x, 0, f.base.z - A.base.z).normalize();
      else dir.set(side === 'player' ? -0.4 : 0.4, 0, side === 'player' ? 1 : -1).normalize();
      var tw = self.tw, a = f.a, tk = ++f.tok.knock, tf = ++f.tok.flash;
      var amp = 0.36 * s, lean = (side === 'player' ? 1 : -1) * 0.14 * s;
      self._shakeCam(0.08 * s);
      var c = self._center(f, new THREE.Vector3());
      if (o.crit) { self.overlay.flash('#ffffff', 0.35, 360); self._star(c, '#fff6c8', f.size * 1.3, 0.32); }
      if (eff > 1) self._shock(c, '#ff5a5a', false, f.size * 1.2);
      var hc = TYPEFX.hasOwnProperty(o.fx) && o.fx !== 'normal' ? [FXC[o.fx][0], FXC[o.fx][1], '#ffffff'] : o.fx === 'recoil' ? ['#ffd0a0', '#ffffff'] : ['#ffffff', '#fff3c0'];
      self._burst('spark', Math.round(10 * s), c, { sp0: 1.5, sp1: 3.5, l0: 0.25, l1: 0.45, s0: [0.14, 0.24], s1: 0.03, cols: hc, drag: 2 });
      if (eff > 1) f.uni.flashColor.value.setRGB(1, 0.28, 0.28); else f.uni.flashColor.value.setRGB(1, 1, 1);
      var p1 = tw.add(90, function (e) {
        if (tk !== f.tok.knock) return;
        a.kx = dir.x * amp * e; a.kz = dir.z * amp * e; a.rk = lean * e;
      }, Ez.outQuad).then(function () {
        return tw.add(400, function (e) {
          if (tk !== f.tok.knock) return;
          var k = 1 - e; a.kx = dir.x * amp * k; a.kz = dir.z * amp * k; a.rk = lean * k;
        }, Ez.inOut);
      });
      var p2 = tw.add(540, function (e, k) {
        if (tf !== f.tok.flash) return;
        a.flash = (Math.floor(k * 6) % 2 === 0 ? 0.88 : 0.0) * (1 - k * 0.4);
      }).then(function () { if (tf === f.tok.flash) a.flash = 0; });
      return Promise.all([p1, p2]);
    }, 3000);
  };

  S3.miss = function (side) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side)) return null;
      var tw = self.tw, a = f.a, tk = ++f.tok.side, d = side === 'player' ? -1 : 1, amp = 0.75;
      self._burst('puff', 6, self._feet(f, new THREE.Vector3()), { sp0: 0.4, sp1: 1, flat: 0.2, vy: 0.2, drag: 2, l0: 0.5, l1: 0.8, s0: [0.3, 0.45], s1: 0.8,
        cols: ['#e8dcc4', '#d8ccb4'], a: 0.6 });
      return tw.add(150, function (e) { if (tk === f.tok.side) { a.sx = d * amp * e; a.rs = -d * 0.12 * e; } }, Ez.outCubic)
        .then(function () { return tw.wait(140); })
        .then(function () { return tw.add(270, function (e) { if (tk === f.tok.side) { a.sx = d * amp * (1 - e); a.rs = -d * 0.12 * (1 - e); } }, Ez.inOut); });
    }, 2500);
  };

  S3.heal = function (side) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side)) return null;
      var tw = self.tw, a = f.a, tf = ++f.tok.flash, P = self.pools.plus, s = f.size;
      var cx = f.base.x + f.holder.position.x, cz = f.base.z + f.holder.position.z;
      var kd = self._distK(cx, s * 0.4, cz);
      for (var i = 0; i < 34; i++) {
        var ang = Math.random() * TAU, r = s * rand(0.12, 0.4);
        P.spawn({ x: cx + Math.cos(ang) * r, y: rand(0, s * 0.7), z: cz + Math.sin(ang) * r * 0.6, vy: rand(0.7, 1.6), life: rand(0.8, 1.2),
          delay: rand(0, 0.45), s0: rand(0.22, 0.4) * kd, s1: 0.08, c: self._col(pick(FXC.heal)), a: 1, wob: 0.3, vr: rand(-2, 2) });
      }
      self._burst('softAdd', 14, new THREE.Vector3(cx, s * 0.4, cz), { k: kd, sp0: 0.2, sp1: 0.6, vy: 0.8, l0: 0.7, l1: 1.1, s0: [0.4, 0.7], s1: 0.1, cols: ['#3ee07a', '#8cffb0'], a: 0.65, jit: s * 0.25, delay: 0.3 });
      self._shock(new THREE.Vector3(cx, 0.05, cz), '#5dff95', true, s * 1.4);
      self._quad({ tex: 'column', color: '#5dff95', pos: new THREE.Vector3(cx, s * 0.62, cz), life: 1.0, upd: function (k, m) {
        m.scale.set(s * 1.1 * (1 - 0.3 * k), s * 1.5, 1); m.material.opacity = 0.9 * Math.sin(k * Math.PI);
      } });
      f.uni.flashColor.value.setRGB(0.55, 1, 0.65);
      return tw.add(1000, function (e, k) {
        if (tf !== f.tok.flash) return;
        a.flash = 0.45 * Math.sin(k * Math.PI);
        a.sc = 1 + 0.04 * Math.sin(k * Math.PI);
      }).then(function () { if (tf === f.tok.flash) { a.flash = 0; a.sc = 1; } });
    }, 3000);
  };

  S3.shield = function (side, on) {
    var self = this, f = this.fighters[side];
    return safe(function () {
      if (!f || !isSide(side)) return null;
      var tk = ++f.tok.shield, from = f.shieldK, to = on ? 1 : 0;
      f.shieldUni.color.value.set(f.id === 'black' ? '#ff5a78' : '#8fe8ff');
      if (on && f.id) {
        self._burst('spark', 14, self._center(f, new THREE.Vector3()), { sp0: 0.8, sp1: 2, l0: 0.4, l1: 0.7, s0: [0.15, 0.25], s1: 0.04,
          cols: [f.id === 'black' ? '#ff8aa0' : '#d8fbff', '#ffffff'], drag: 2 });
      }
      return self.tw.add(on ? 380 : 260, function (e) { if (tk === f.tok.shield) f.shieldK = from + (to - from) * e; }, on ? Ez.outBack : Ez.inQuad);
    }, 2000);
  };

  S3.freeze = function (side, on) {
    var self = this, f = this.fighters[side];
    return safe(function () {
      if (!f || !isSide(side)) return null;
      var tk = ++f.tok.frz, from = f.frzK, to = on ? 1 : 0;
      if (f.id && f.root.visible) {
        var c = self._center(f, new THREE.Vector3());
        if (on) {
          self._burst('spark', 16, c, { sp0: 0.5, sp1: 1.6, l0: 0.4, l1: 0.8, s0: [0.15, 0.28], s1: 0.04, cols: ['#ffffff', '#bff4ff'], jit: f.size * 0.25 });
          self._burst('puff', 6, c, { sp0: 0.2, sp1: 0.6, l0: 0.7, l1: 1, s0: [0.4, 0.6], s1: 1.1, cols: ['#ffffff', '#dff6ff'], a: 0.55, jit: f.size * 0.2 });
        } else if (from > 0.2) {
          self._burst('shard', 18, c, { sp0: 1.5, sp1: 3.2, g: -7, l0: 0.5, l1: 0.8, s0: [0.15, 0.28], cols: FXC.ice, vr: 8, vy: 1, jit: f.size * 0.2 });
        }
      }
      return self.tw.add(on ? 420 : 300, function (e) { if (tk === f.tok.frz) f.frzK = from + (to - from) * e; }, Ez.outCubic);
    }, 2000);
  };

  S3.statFx = function (side, up) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side)) return null;
      var s = f.size, col = up ? '#ff8a3a' : '#4aa8ff', tf = ++f.tok.flash, a = f.a;
      var cx = f.base.x + f.holder.position.x, cz = f.base.z + f.holder.position.z;
      var asz = Math.max(0.3, s * 0.17) * self._distK(cx, s * 0.5, cz);
      for (var i = 0; i < 6; i++) {
        (function (i) {
          var ox = (i - 2.5) / 2.5 * s * 0.34 + rand(-0.05, 0.05), oz = rand(-0.1, 0.25);
          var y0 = up ? s * 0.05 : s * 0.95, y1 = up ? s * 1.0 : s * 0.05;
          self._quad({ tex: 'arrow', color: col, pos: new THREE.Vector3(cx + ox, y0, cz + oz), rot: up ? 0 : Math.PI, delay: (i % 3) * 0.1 + rand(0, 0.08), life: 0.6,
            upd: function (k, m, q) {
              m.position.y = y0 + (y1 - y0) * Ez.outQuad(k);
              m.scale.set(asz, asz, 1);
              m.material.opacity = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
            } });
        })(i);
      }
      self._quad({ tex: 'column', color: col, pos: new THREE.Vector3(cx, s * 0.6, cz), life: 0.9, upd: function (k, m) {
        m.scale.set(s * 0.9, s * 1.4, 1); m.material.opacity = 0.5 * Math.sin(k * Math.PI);
      } });
      f.uni.flashColor.value.set(col);
      return self.tw.add(900, function (e, k) {
        if (tf !== f.tok.flash) return;
        a.flash = 0.28 * Math.abs(Math.sin(k * Math.PI * 2));
      }).then(function () { if (tf === f.tok.flash) a.flash = 0; });
    }, 2500);
  };

  S3.faint = function (side) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side) || f.fainted) return null;
      var tw = self.tw, a = f.a, tk = ++f.tok.faint;
      self.aura(side, null); self.shield(side, false);
      f.tok.frz++; f.frzK = 0; f.st = null;
      f.idle = false;
      var landed = false;
      return tw.add(700, function (e, k) {
        if (tk !== f.tok.faint) return;
        a.rotX = -1.32 * Ez.inQuad(k);
        a.dy = Math.sin(Math.min(1, k * 2.5) * Math.PI) * 0.12 - 0.12 * k;
        if (k > 0.55) a.alpha = 1 - (k - 0.55) / 0.45 * 0.5;
        if (!landed && k > 0.8) {
          landed = true;
          self._burst('puff', 12, self._feet(f, new THREE.Vector3()), { sp0: 0.8, sp1: 1.8, flat: 0.25, vy: 0.3, drag: 2, l0: 0.7, l1: 1.0, s0: [0.4, 0.6], s1: 1.2,
            cols: ['#d8ccb4', '#bfb196', '#efe6d4'], a: 0.75, jit: f.size * 0.25 });
          self._shakeCam(0.06);
        }
      }).then(function () {
        if (tk !== f.tok.faint) return null;
        return tw.add(380, function (e) { if (tk === f.tok.faint) { a.alpha = 0.5 * (1 - e); a.shadowA = 1 - e; } });
      }).then(function () {
        if (tk !== f.tok.faint) return;
        f.fainted = true; f.root.visible = false; f.idle = true;
      });
    }, 3000);
  };

  S3.aura = function (side, color) {
    var self = this, f = this.fighters[side];   // 'shadow'(연출용 그림자)도 허용
    return safe(function () {
      if (!f) return null;
      var tk = ++f.tok.aura, from = f.auraK, to = color ? 1 : 0;
      if (color) f.auraCol.set(color);
      return self.tw.add(450, function (e) { if (tk === f.tok.aura) f.auraK = from + (to - from) * e; }, Ez.inOut);
    }, 2000);
  };

  // 교체로 들어가기: 붉은빛으로 변해 작아지며 주인 쪽으로 빨려 들어간다 (~500ms). 끝나면 숨김.
  S3.recall = function (side) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side) || !f.root.visible) return null;
      var tw = self.tw, a = f.a, tk = ++f.tok.move, tf = ++f.tok.flash;
      f.tok.lunge++; f.tok.knock++; f.tok.side++; f.tok.enter++; f.tok.faint++;
      a.lx = a.ly = a.lz = a.rl = a.kx = a.kz = a.rk = a.sx = a.rs = 0;
      f.idle = false;
      f.uni.flashColor.value.setRGB(1, 0.3, 0.36);
      var c = self._center(f, new THREE.Vector3());
      var tx = side === 'player' ? -2.4 : 0.6, ty = side === 'player' ? 0.6 : 1.7, tz = side === 'player' ? 3.4 : -3.6;
      self._burst('softN', 12, c, { sp0: 0.5, sp1: 1.6, l0: 0.3, l1: 0.55, s0: [0.24, 0.38], s1: 0.04, cols: ['#ff2a3a', '#ff5a6a'], drag: 2, jit: f.size * 0.2, a: 0.85 });
      self._burst('softAdd', 6, c, { sp0: 0.5, sp1: 1.4, l0: 0.3, l1: 0.5, s0: [0.2, 0.3], s1: 0.04, cols: ['#ffffff'], drag: 2, jit: f.size * 0.2 });
      return tw.add(160, function (e) {
        if (tf === f.tok.flash) a.flash = e;
        if (tk === f.tok.move) a.sc = 1 + 0.06 * e;
      }).then(function () {
        if (tk !== f.tok.move) return null;
        var s0 = self._center(f, new THREE.Vector3());
        var cur = s0.clone();
        self._beam(s0, cur, { color: '#ff2a3a', add: false, life: 0.42, upd: function (k, m, e) {
          m.scale.set(e.len, 0.5 * (1 - k), 1); m.material.opacity = 0.9 * (1 - k);
        } });
        var pv = new THREE.Vector3();
        return tw.add(330, function (e, k) {
          if (tk !== f.tok.move) return;
          a.sc = 1.06 * (1 - e) + 0.02; a.mx = tx * e; a.my = ty * e; a.mz = tz * e;
          a.alpha = 1 - Math.max(0, (k - 0.55) / 0.45);
          self._center(f, pv); cur.copy(pv);
          (Math.random() < 0.6 ? self.pools.softN : self.pools.softAdd).spawn({ x: pv.x, y: pv.y, z: pv.z, life: 0.3, s0: 0.42 * (1 - k * 0.5), s1: 0.05, c: self._col(Math.random() < 0.6 ? '#ff2a3a' : '#ffffff'), a: 0.85 });
        }, Ez.inCubic).then(function () {
          if (tk !== f.tok.move) return;
          f.root.visible = false;
          f.frzK = 0; f.auraK = 0; f.shieldK = 0; f.trail = 0; f.st = null;
          f.tok.frz++; f.tok.aura++; f.tok.shield++; f.tok.flash++;
          self._resetAnim(f);
          f.uni.flashColor.value.setRGB(1, 1, 1);
        });
      });
    }, 1500);
  };

  S3._ballMk = function () {
    if (this.ball) return this.ball;
    var m = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: this.tex.ball, transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1) }));
    m.renderOrder = 7; m.visible = false;
    var sh = new THREE.Mesh(this.geo.unit, new THREE.MeshBasicMaterial({ map: this.tex.blob, transparent: true, depthWrite: false, opacity: 0.5 }));
    sh.rotation.x = -Math.PI / 2; sh.renderOrder = -3; sh.visible = false;
    this.scene.add(m); this.scene.add(sh);
    this.ball = { m: m, sh: sh, rot: 0, tok: 0, hidE: false };
    return this.ball;
  };
  // 남아 있는 볼을 치운다. 던지는 중에 불렸다면 숨겨 둔 상대를 되돌린다.
  S3.clearBall = function () {
    var B = this.ball;
    if (B) {
      B.tok++;
      B.m.visible = false; B.sh.visible = false;
      if (B.hidE) {
        B.hidE = false;
        var E = this.fighters.enemy;
        if (E.id && !E.fainted) {
          E.tok.move++; E.tok.flash++;
          this._resetAnim(E);
          E.root.visible = true;
        }
      }
    }
    return Promise.resolve();
  };
  // 포획 볼 던지기: 포물선 → 상대 흡수 → 발밑으로 떨어짐 → shakes번 흔들림 → 성공(볼 남음)/실패(튀어나옴)
  S3.throwBall = function (shakes, caught) {
    var self = this;
    shakes = clamp(Math.floor(+shakes || 0), 0, 3); caught = !!caught;
    return safe(function () {
      if (self.disposed) return null;
      self.clearBall();
      var B = self._ballMk(), tw = self.tw, tok = ++B.tok, E = self.fighters.enemy, m = B.m;
      function live() { return tok === B.tok && !self.disposed; }
      var hasE = !!(E.id && E.root.visible && !E.fainted);
      var es = hasE ? E.size : sizeFor('naru'), R = 0.22;
      var p0 = new THREE.Vector3(-2.3, 0.9, 5.6);
      var tgt = new THREE.Vector3(E.base.x - 0.05, (hasE ? es * 0.5 : 1.0) + 0.15, E.base.z + 0.3);
      var rest = new THREE.Vector3(E.base.x - 0.05, R, E.base.z + 0.45);
      m.visible = true; m.material.color.setRGB(1, 1, 1); m.material.opacity = 1; m.scale.set(R * 2, R * 2, 1); m.position.copy(p0); B.rot = 0;
      B.sh.visible = false;
      var eTok = 0, a = E.a;
      return tw.add(620, function (e, k) {
        if (!live()) return;
        m.position.lerpVectors(p0, tgt, k); m.position.y += Math.sin(k * Math.PI) * 2.0; B.rot = -k * TAU * 2.2;
      }).then(function () {
        if (!live()) return null;
        B.rot = 0;
        self.overlay.flash('#ffffff', 0.4, 360);
        self._shock(tgt, '#ff5a6a', false, 1.4);
        self._burst('softN', 12, tgt, { sp0: 0.8, sp1: 2.2, l0: 0.3, l1: 0.5, s0: [0.22, 0.34], s1: 0.04, cols: ['#ff2a3a', '#ff5a6a'], drag: 2.5, a: 0.85 });
        self._burst('softAdd', 8, tgt, { sp0: 0.8, sp1: 2, l0: 0.3, l1: 0.5, s0: [0.2, 0.3], s1: 0.04, cols: ['#ffffff'], drag: 2.5 });
        if (!hasE) return tw.wait(250);
        eTok = ++E.tok.move; E.tok.flash++; E.tok.lunge++; E.tok.knock++; E.tok.side++;
        E.idle = false; B.hidE = true;
        E.uni.flashColor.value.setRGB(1, 0.32, 0.38);
        var pv = new THREE.Vector3();
        return tw.add(380, function (e, k) {
          if (!live() || eTok !== E.tok.move) return;
          a.flash = Math.min(1, k * 2.5); a.sc = 1 - 0.96 * e; a.my = (tgt.y - R - 0.05) * e;
          a.alpha = 1 - e * e; a.shadowA = 1 - e;
          self._center(E, pv);
          if (Math.random() < 0.6) self.pools.softN.spawn({ x: pv.x + rand(-0.2, 0.2), y: pv.y + rand(-0.2, 0.2), z: pv.z, vx: (tgt.x - pv.x) * 3, vy: (tgt.y - pv.y) * 3, vz: (tgt.z - pv.z) * 3,
            life: 0.3, s0: 0.3, s1: 0.05, c: self._col('#ff5a6a'), a: 0.85 });
        }, Ez.inCubic).then(function () { if (live() && eTok === E.tok.move) E.root.visible = false; });
      }).then(function () {
        if (!live()) return null;
        var from = m.position.clone(), h = from.y - R;
        return tw.add(440, function (e, k) {
          if (!live()) return;
          var kk = Math.min(1, k / 0.62);
          m.position.x = from.x + (rest.x - from.x) * kk; m.position.z = from.z + (rest.z - from.z) * kk;
          m.position.y = k < 0.62 ? R + h * (1 - kk * kk) : R + 0.16 * Math.sin((k - 0.62) / 0.38 * Math.PI);
          if (k >= 0.62 && !B.sh.visible) {
            B.sh.visible = true; B.sh.position.set(rest.x, 0.03, rest.z); B.sh.scale.set(R * 2.4, R * 1.1, 1);
            self._burst('puff', 5, rest, { sp0: 0.4, sp1: 0.9, flat: 0.2, vy: 0.2, drag: 2, l0: 0.4, l1: 0.6, s0: [0.22, 0.32], s1: 0.6, cols: ['#e8dcc4', '#cbbd9e'], a: 0.6 });
          }
        });
      }).then(function () {
        if (!live()) return null;
        m.position.copy(rest);
        var chain = tw.wait(320);
        for (var i = 0; i < shakes; i++) {
          chain = chain.then(function () {
            if (!live()) return null;
            return tw.add(450, function (e, k) {
              if (!live()) return;
              var w = Math.sin(k * TAU) * (1 - k * 0.25);
              B.rot = -0.5 * w; m.position.x = rest.x + w * 0.06; m.position.y = R + Math.abs(w) * 0.02;
            });
          }).then(function () { if (live()) { B.rot = 0; m.position.copy(rest); } return tw.wait(300); });
        }
        return chain;
      }).then(function () {
        if (!live()) return null;
        var top = new THREE.Vector3(rest.x, rest.y + 0.35, rest.z + 0.05);
        if (caught) {
          B.hidE = false;
          self._star(top, '#fff6b0', 0.9, 0.38);
          self._burst('sparkN', 12, top, { sp0: 0.8, sp1: 2, up: 0.8, l0: 0.4, l1: 0.7, s0: [0.14, 0.22], s1: 0.03, cols: ['#ffd820', '#ffe860'], drag: 1.5, g: -2 });
          self._burst('plus', 6, top, { sp0: 0.6, sp1: 1.4, up: 1, l0: 0.5, l1: 0.8, s0: [0.16, 0.24], s1: 0.04, cols: ['#ffe86a', '#ffffff'], drag: 1.5 });
          return tw.add(380, function (e) {
            if (!live()) return;
            var v = 1 - 0.36 * e; m.material.color.setRGB(v, v, v * 1.02);
            var s = R * 2 * (1 + 0.12 * Math.sin(e * Math.PI)); m.scale.set(s, s, 1);
          });
        }
        // 실패: 볼이 열리며 상대가 튀어나온다
        self.overlay.flash('#ffffff', 0.6, 420);
        self._burst('softN', 16, top, { sp0: 1.5, sp1: 3.5, l0: 0.35, l1: 0.6, s0: [0.26, 0.4], s1: 0.04, cols: ['#ff2a3a', '#ff5a6a'], drag: 2.5, a: 0.85 });
        self._burst('softAdd', 10, top, { sp0: 1.5, sp1: 3.5, l0: 0.3, l1: 0.5, s0: [0.24, 0.34], s1: 0.04, cols: ['#ffffff'], drag: 2.5 });
        self._shock(top, '#ffffff', false, 1.6);
        m.visible = false; B.sh.visible = false;
        if (!hasE || !B.hidE || !E.id) { B.hidE = false; return null; }
        B.hidE = false;
        var et = ++E.tok.move;
        self._resetAnim(E);
        E.root.visible = true; E.fainted = false; E.idle = false;
        var a2 = E.a;
        a2.sc = 0.1; a2.flash = 1; a2.alpha = 0.3; E.uni.flashColor.value.setRGB(1, 1, 1);
        return tw.add(420, function (e, k) {
          if (et !== E.tok.move) return;
          a2.sc = 0.1 + 0.9 * e; a2.alpha = Math.min(1, 0.3 + k * 2); a2.flash = 1 - k;
        }, Ez.outBack).then(function () { if (et === E.tok.move) { a2.sc = 1; a2.flash = 0; a2.alpha = 1; E.idle = true; } });
      });
    }, 9000);
  };

  // 상태이상이 걸리거나 매 턴 피해를 줄 때의 1회 연출 (~600ms)
  S3.status = function (side, kind) {
    var self = this;
    if (kind === 'frz') return this.freeze(side, true);
    if (kind === 'thaw') return this.freeze(side, false);
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !f.id || !isSide(side) || !f.root.visible || f.fainted) return null;
      var tw = self.tw, a = f.a, s = f.size, P = self.pools, i;
      var cx = f.base.x + f.holder.position.x, cz = f.base.z + f.holder.position.z, y0 = f.holder.position.y;
      var kd = self._distK(cx, s * 0.5, cz), c = self._center(f, new THREE.Vector3());
      var tf = ++f.tok.flash;
      function pulse(hex, peak, dur, n) {
        f.uni.flashColor.value.set(hex);
        return tw.add(dur, function (e, k) { if (tf === f.tok.flash) a.flash = peak * Math.abs(Math.sin(k * Math.PI * (n || 1))); })
          .then(function () { if (tf === f.tok.flash) a.flash = 0; });
      }
      switch (kind) {
        case 'brn': {
          for (i = 0; i < 22; i++) {
            (i % 3 ? P.flameN : P.flame).spawn({ x: cx + rand(-0.36, 0.36) * s, y: y0 + rand(0, 0.35) * s, z: cz + rand(-0.05, 0.2), vx: rand(-0.15, 0.15), vy: rand(0.9, 1.8), life: rand(0.45, 0.75),
              delay: rand(0, 0.25), s0: rand(0.35, 0.55) * s * 0.55 * kd, s1: 0.06, c: self._col(i % 3 ? pick(['#ff6a10', '#ff9a20', '#ff4a10']) : '#ffe060'), a: 1, rot: 0, wob: 0.5, fin: 0.1, fout: 0.45 });
          }
          self._burst('sparkN', 10, c, { k: kd, sp0: 0.5, sp1: 1.5, up: 1, vy: 1, l0: 0.5, l1: 0.8, s0: [0.12, 0.18], s1: 0.03, cols: ['#ffb030', '#ff7a1a'], jit: s * 0.25 });
          return pulse('#ff7a2a', 0.55, 620, 2);
        }
        case 'psn': case 'tox': {
          var tox = kind === 'tox';
          for (i = 0; i < (tox ? 22 : 15); i++) {
            P.ring.spawn({ x: cx + rand(-0.34, 0.34) * s, y: y0 + rand(0.05, 0.55) * s, z: cz + rand(0, 0.2), vy: rand(0.5, 1.0), life: rand(0.6, 1.0), delay: rand(0, 0.3),
              s0: rand(0.1, 0.2) * kd, s1: rand(0.22, 0.3) * kd, c: self._col(pick(tox ? ['#9a40f0', '#c070ff', '#6a1ab8'] : ['#d8a0ff', '#b070ff', '#e8c0ff'])), a: 0.95, wob: 0.5, rot: 0 });
          }
          self._burst('puff', tox ? 6 : 4, c, { k: kd, sp0: 0.2, sp1: 0.6, vy: 0.4, l0: 0.6, l1: 0.9, s0: [0.35, 0.5], s1: 1, cols: ['#7a3ab0', '#5a2a88'], a: 0.45, jit: s * 0.2 });
          return pulse(tox ? '#8a2ae0' : '#b060ff', tox ? 0.6 : 0.5, 620, tox ? 2 : 1);
        }
        case 'par': {
          var ts = ++f.tok.side;
          for (i = 0; i < 4; i++) {
            (function (i) {
              var p = new THREE.Vector3(cx + rand(-0.3, 0.3) * s, y0 + rand(0.2, 0.7) * s, cz + 0.1);
              self._quad({ tex: i % 2 ? 'bolt2' : 'bolt', color: '#ffd010', add: false, pos: p, order: 8, rot: rand(0, Math.PI), delay: i * 0.09, life: 0.2, upd: function (q, m) {
                m.scale.set(s * 0.55 * kd, s * 0.2 * kd * (Math.floor(q * 6) % 2 ? 1 : -1), 1); m.material.opacity = 1 - q * 0.5;
              } });
            })(i);
          }
          self._burst('sparkN', 18, c, { k: kd, sp0: 1.5, sp1: 3.5, l0: 0.18, l1: 0.35, s0: [0.16, 0.26], s1: 0.03, cols: ['#ffd820', '#ffe860', '#ffc010'], drag: 3, jit: s * 0.2, delay: 0.25 });
          tw.add(460, function (e, k) {
            if (ts !== f.tok.side) return;
            var amp = 0.05 * (1 - k);
            a.sx = rand(-amp, amp); a.rs = rand(-amp, amp) * 0.8;
          }).then(function () { if (ts === f.tok.side) { a.sx = 0; a.rs = 0; } });
          return pulse('#fff27a', 0.6, 600, 3);
        }
        case 'slp': {
          var head = new THREE.Vector3(cx + s * 0.16, y0 + s * 0.72, cz + 0.05);
          for (i = 0; i < 3; i++) self._zee(head, s * (0.8 + i * 0.2), i * 0.22);
          f.uni.flashColor.value.set('#6a78b8');
          return tw.add(650, function (e, k) { if (tf === f.tok.flash) a.flash = 0.25 * Math.sin(k * Math.PI); })
            .then(function () { if (tf === f.tok.flash) a.flash = 0; });
        }
        case 'cnf': {
          var hx = cx, hy = y0 + s * 0.86, hz = cz, ts2 = ++f.tok.side, R = s * 0.3, ssz = Math.max(0.28, s * 0.2) * kd;
          for (i = 0; i < 4; i++) {
            (function (i) {
              self._quad({ tex: 'star', color: i % 2 ? '#ffb020' : '#ffd820', add: false, pos: new THREE.Vector3(hx, hy, hz), order: 8, life: 1.0, upd: function (q, m, e) {
                var ang = i / 4 * TAU + q * TAU * 1.5;
                m.position.set(hx + Math.cos(ang) * R, hy + Math.sin(ang * 2) * 0.04, hz + Math.sin(ang) * R * 0.7);
                m.scale.set(ssz, ssz, 1); e.rot += 0.12;
                m.material.opacity = q < 0.1 ? q / 0.1 : q > 0.75 ? (1 - q) / 0.25 : 1;
              } });
            })(i);
          }
          return tw.add(700, function (e, k) {
            if (ts2 === f.tok.side) a.rs = Math.sin(k * TAU * 2) * 0.12 * (1 - k);
          }).then(function () { if (ts2 === f.tok.side) a.rs = 0; });
        }
        default:
          return null;
      }
    }, 2000);
  };

  // 상태이상이 이어지는 동안의 은은한 표시. null이면 얼음까지 모두 지운다. 즉시 resolve.
  S3.statusTint = function (side, kind) {
    var f = this.fighters[side];
    if (!f || !isSide(side)) return Promise.resolve();
    try {
      kind = ST_KINDS.hasOwnProperty(kind) ? kind : null;
      if (kind === 'frz') {
        f.st = null;
        if (f.frzK < 0.99) this.freeze(side, true);
      } else {
        if (f.frzK > 0) { f.tok.frz++; f.frzK = 0; }
        f.st = kind; f.stAcc = 0;
      }
    } catch (e) { /* 무시 */ }
    return Promise.resolve();
  };

  // 메탈가디언몬 → 블랙 흑화 같은 극적 변신
  S3.transform = function (side, newId, o) {
    var self = this;
    return safe(function () {
      var f = self.fighters[side];
      if (!f || !isSide(side) || !newId) return null;
      var shiny = !!(o && o.shiny);
      if (!f.id) return self.setFighter(side, newId, o).then(function () { return self.enter(side); });
      var texP = self._spriteTex(newId, shiny), tw = self.tw, a = f.a;
      var tf = ++f.tok.flash;
      var hadAura = f.auraK > 0.5, prevCol = f.auraCol.getHex();
      // 쓰러져 있었다면 붉은 기운 속에 다시 일어선다
      var rise = Promise.resolve();
      if (f.fainted || !f.root.visible) {
        f.tok.faint++; f.tok.enter++;
        f.fainted = false; f.root.visible = true; f.idle = false;
        a.rotX = -1.32; a.alpha = 0; a.shadowA = 0; a.dy = 0;
        self.aura(side, '#ff2440');
        rise = tw.add(900, function (e, k) {
          a.rotX = -1.32 * (1 - e); a.alpha = Math.min(1, k * 2); a.shadowA = k;
        }, Ez.inOut).then(function () { f.idle = true; a.rotX = 0; });
      } else if (!hadAura) self.aura(side, '#ff2440');
      return rise.then(function () {
        var c = self._center(f, new THREE.Vector3());
        // 모여드는 붉은 기운
        for (var i = 0; i < 40; i++) {
          var th = Math.random() * TAU, R = rand(1.6, 2.6), life = rand(0.5, 0.8), d = rand(0, 0.7);
          var px = c.x + Math.cos(th) * R, py = c.y + rand(-1.2, 1.4), pz = c.z + Math.sin(th) * R * 0.6;
          self.pools.softAdd.spawn({ x: px, y: py, z: pz, vx: (c.x - px) / life, vy: (c.y - py) / life, vz: (c.z - pz) / life, life: life, delay: d,
            s0: rand(0.2, 0.34), s1: 0.06, c: self._col(pick(['#ff2440', '#ff5a3a', '#c0102a'])), a: 0.95, fin: 0.2, fout: 0.8 });
        }
        f.uni.flashColor.value.setRGB(1, 0.12, 0.18);
        return Promise.all([texP, tw.add(1100, function (e, k) {
          if (tf === f.tok.flash) a.flash = (0.15 + 0.45 * Math.abs(Math.sin(k * 15))) * k;
          a.sc = 1 + 0.035 * Math.sin(k * 40) * k;
          self._shakeCam(0.02 + 0.05 * k);
        })]);
      }).then(function (r) {
        var tex = r[0];
        self.overlay.flash('#ffffff', 0.95, 760);
        self._shakeCam(0.32);
        if (tex) { f.uni.map.value = tex; f.id = newId; f.shiny = shiny; f.size = sizeFor(newId); }
        var c = self._center(f, new THREE.Vector3());
        self._shock(self._feet(f, new THREE.Vector3()), '#ff2440', true, f.size * 2);
        self._shock(c, '#ffffff', false, f.size * 1.6);
        self._burst('softAdd', 36, c, { sp0: 2, sp1: 5, l0: 0.5, l1: 0.9, s0: [0.25, 0.4], s1: 0.04, cols: ['#ff2440', '#ff7a5a', '#ffffff'], drag: 2 });
        self._burst('puff', 12, c, { sp0: 0.8, sp1: 2, l0: 0.8, l1: 1.2, s0: [0.5, 0.8], s1: 1.5, cols: ['#1a0408', '#3a0a14'], a: 0.75, jit: 0.4 });
        f.uni.flashColor.value.setRGB(1, 1, 1);
        a.flash = 1; a.sc = 1.15;
        return tw.add(850, function (e) {
          if (tf === f.tok.flash) a.flash = 1 - e;
          a.sc = 1 + 0.15 * (1 - e);
        }, Ez.outCubic);
      }).then(function () {
        a.sc = 1;
        if (tf === f.tok.flash) a.flash = 0;
        if (hadAura) f.auraCol.setHex(prevCol); else self.aura(side, null);
      });
    }, 7000);
  };

  // 플레이어 뒤 그림자가 일어나 상대 자리로 가서 블랙 메탈가디언몬이 된다
  S3.shadowRise = function () {
    var self = this;
    return safe(function () {
      var P = self.fighters.player, E = self.fighters.enemy, S = self.fighters.shadow, tw = self.tw;
      var texB = self._spriteTex('black', false);
      var hideE = (E.id && E.root.visible) ? tw.add(300, function (e) { E.a.alpha = 1 - e; E.a.shadowA = 1 - e; }).then(function () { E.root.visible = false; }) : Promise.resolve();
      var srcTex = P.id ? P.uni.map.value : null;
      var s0 = { x: P.base.x + 0.5, z: P.base.z - 1.15 };
      var dx = E.base.x - s0.x, dz = E.base.z - s0.z;
      return Promise.all([texB, hideE]).then(function (r) {
        var tb = r[0];
        S.tok.move++;
        self._resetAnim(S);
        S.uni.map.value = srcTex || tb;
        S.id = 'shadow'; S.size = P.id ? P.size : sizeFor('black');
        S.base.set(s0.x, 0, s0.z); S.root.position.copy(S.base);
        S.uni.flipX.value = 1;
        S.idle = false;
        S.a.rotX = -Math.PI / 2 + 0.03; S.a.sil = 1; S.a.alpha = 0; S.a.shadowA = 0;
        S.auraCol.set('#ff1030'); S.auraK = 0;
        S.root.visible = true;
        S._tb = tb;
        return tw.add(450, function (e) { S.a.alpha = 0.92 * e; });
      }).then(function () {
        self.aura('shadow', '#ff1030');
        self._shakeCam(0.05);
        return tw.add(1150, function (e, k) {
          S.a.rotX = (-Math.PI / 2 + 0.03) * (1 - e);
          S.a.shadowA = k;
          if (k > 0.3) self._shakeCam(0.025);
        }, Ez.inOut);
      }).then(function () {
        S.idle = true;
        return tw.wait(380);
      }).then(function () {
        S.trail = 1;
        return tw.add(950, function (e) {
          S.a.mx = dx * e; S.a.mz = dz * e; S.a.my = Math.sin(e * Math.PI) * 0.6;
        }, Ez.inOut);
      }).then(function () {
        S.trail = 0;
        var tb = S._tb;
        self.overlay.flash('#ff1a30', 0.7, 700);
        self._shakeCam(0.3);
        var feet = self._feet(E, new THREE.Vector3()), c = new THREE.Vector3(E.base.x, sizeFor('black') * 0.42, E.base.z);
        self._shock(feet, '#ff2440', true, 4);
        self._burst('softAdd', 34, c, { sp0: 2, sp1: 4.6, l0: 0.5, l1: 0.9, s0: [0.25, 0.4], s1: 0.04, cols: ['#ff2440', '#ff7a5a'], drag: 2 });
        self._burst('puff', 10, c, { sp0: 0.6, sp1: 1.6, l0: 0.8, l1: 1.2, s0: [0.5, 0.8], s1: 1.5, cols: ['#1a0408', '#3a0a14'], a: 0.75, jit: 0.4 });
        S.root.visible = false; S.auraK = 0; S.tok.aura++; S.id = null;
        if (tb) {
          for (var k in E.tok) E.tok[k]++;
          E.id = 'black'; E.shiny = false; E.size = sizeFor('black'); E.uni.map.value = tb;
          self._resetAnim(E);
          E.fainted = false; E.frzK = 0; E.shieldK = 0; E.auraK = 0; E.st = null;
          E.a.sil = 1; E.a.flash = 0.6; E.root.visible = true;
          E.uni.flashColor.value.setRGB(1, 0.2, 0.25);
          var tk = E.tok.flash;
          return tw.add(800, function (e) {
            if (tk !== E.tok.flash) return;
            E.a.sil = 1 - e; E.a.flash = 0.6 * (1 - e);
          }, Ez.outCubic).then(function () { if (tk === E.tok.flash) { E.a.sil = 0; E.a.flash = 0; } });
        }
        return null;
      });
    }, 9000);
  };

  S3.focus = function (side) {
    var self = this;
    return safe(function () {
      var c = self.cam, f = side && isSide(side) ? self.fighters[side] : null;
      c.fromPos.copy(c.curPos); c.fromLook.copy(c.curLook);
      if (f && f.id) {
        var look = new THREE.Vector3(f.base.x, f.size * 0.5, f.base.z);
        var dir = c.basePos.clone().sub(look).normalize();
        c.toLook.copy(look);
        c.toPos.copy(look).addScaledVector(dir, 2.1 + f.size * 1.55);
        c.toPos.y = Math.max(c.toPos.y, look.y + 0.4);
      } else { c.toPos.copy(c.basePos); c.toLook.copy(c.baseLook); }
      c.k = 0;
      var tok = ++c.tok;
      return self.tw.add(750, function (e) { if (c.tok === tok) c.k = e; }, Ez.inOut);
    }, 2000);
  };

  S3.flash = function (color) {
    var self = this;
    return safe(function () { return self.overlay.flash(color || '#ffffff', 0.85, 520); }, 1500);
  };

  S3.screenPos = function (side) {
    var f = this.fighters[side], v = this._tmp.a;
    if (!f || !isSide(side)) return { x: this.w / 2, y: this.h / 3 };
    var size = f.id ? f.size : sizeFor(side === 'player' ? 'naru' : 'black');
    v.set(f.base.x + f.holder.position.x, f.holder.position.y + size * ART_TOP * f.a.sc, f.base.z + f.holder.position.z);
    v.project(this.camera);
    return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h };
  };

  S3.setPaused = function (b) {
    this.paused = !!b;
    if (!this.paused) this._lastFrame = now();
  };

  S3.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    try {
      root.cancelAnimationFrame(this._raf);
      clearInterval(this._iv);
      if (this._ro) this._ro.disconnect();
      root.removeEventListener('resize', this._onResize);
      this.renderer.domElement.removeEventListener('webglcontextlost', this._onLost);
      this.renderer.domElement.removeEventListener('webglcontextrestored', this._onRestore);
      this.tw.clear();
      var seen = [];
      this.scene.traverse(function (o) {
        if (o.geometry && seen.indexOf(o.geometry) < 0) { seen.push(o.geometry); o.geometry.dispose(); }
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      for (var k in this.tex) this.tex[k].dispose();
      var cache = this._texCache;
      Object.keys(cache).forEach(function (key) { cache[key].then(function (t) { if (t) t.dispose(); }); });
      this.renderer.dispose();
      if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    } catch (e) { /* 정리 중 오류 무시 */ }
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  /* ───────────── 2D 대체 무대 (DOM/CSS) ───────────── */
  var L2 = {
    player: { x: 0.28, y: 0.9, mul: 1.12 },
    enemy: { x: 0.68, y: 0.665, mul: 0.72 }
  };
  function size2(id, side, H) { return H * (0.17 + 0.33 * monHeight(id)) * L2[side].mul; }

  function Stage2D(container, opts) {
    var self = this;
    this.mode = '2d';
    this.container = container;
    this.base = opts.assetBase;
    this.disposed = false;
    var r = this.root = el('div', 'pst-root pst-2d');
    this.cam = el('div', 'pst-cam', r);
    this.shk = el('div', 'pst-shake', this.cam);
    this.bgs = [el('div', 'pst-bg', this.shk), el('div', 'pst-bg', this.shk)];
    this.bgi = -1;
    this.floor = el('div', 'pst-floor', this.shk);
    this.ring = el('div', 'pst-ring', this.floor);
    this.ring2 = el('div', 'pst-ring pst-ring2', this.floor);
    this.f = { enemy: this._mk('enemy'), player: this._mk('player') };
    this.fx = el('div', 'pst-fx', this.shk);
    this.overlay = new Overlay(r);
    this._theme('dark');
    container.appendChild(r);
    this._onResize = function () { self._layout(); };
    if (root.ResizeObserver) { this._ro = new ResizeObserver(this._onResize); this._ro.observe(container); }
    root.addEventListener('resize', this._onResize);
    this._layout();
  }
  var S2 = Stage2D.prototype;

  S2._mk = function (side) {
    var f = { side: side, id: null, fainted: false, size: 100 };
    f.wrap = el('div', 'pst-f pst-f-' + side, this.shk);
    f.shadow = el('div', 'pst-shadow', f.wrap);
    f.move = el('div', 'pst-move', f.wrap);
    f.aura = el('div', 'pst-aura', f.move);
    f.idle = el('div', 'pst-idle', f.move);
    f.img = el('img', 'pst-img' + (side === 'player' ? ' pst-flip' : ''), f.idle);
    f.img.alt = ''; f.img.draggable = false;
    f.ice = el('div', 'pst-ice', f.move);
    [[12, 0], [44, 0.2], [72, -0.1], [26, 0.6]].forEach(function (d, i) {
      var s = el('div', 'pst-shard', f.ice);
      s.style.left = d[0] + '%';
      if (i === 3) { s.style.bottom = '38%'; s.style.height = '18%'; }
    });
    f.shield = el('div', 'pst-shield', f.move);
    f.wrap.style.display = 'none';
    return f;
  };
  S2._dims = function () {
    return { W: this.container.clientWidth || 390, H: this.container.clientHeight || 480 };
  };
  S2._layout = function () {
    if (this.disposed) return;
    var d = this._dims();
    for (var side in this.f) {
      var f = this.f[side], L = L2[side];
      var s = f.size = size2(f.id || (side === 'player' ? 'naru' : 'black'), side, d.H);
      f.ax = d.W * L.x; f.ay = d.H * L.y;
      f.wrap.style.left = f.ax + 'px'; f.wrap.style.top = f.ay + 'px';
      f.move.style.width = s + 'px'; f.move.style.height = s + 'px';
      f.move.style.left = (-s / 2) + 'px'; f.move.style.top = (-s * (1 - FOOT)) + 'px';
      f.shadow.style.width = (s * 0.72) + 'px'; f.shadow.style.height = (s * 0.17) + 'px';
    }
  };
  S2._center = function (f) { return { x: f.ax, y: f.ay - f.size * 0.42 }; };
  S2._theme = function (key) {
    var th = THEMES[key] || THEMES.sea;
    this.theme = th;
    this.overlay.setTheme(th);
    this.ring.style.setProperty('--rc', th.rune);
    this.ring2.style.setProperty('--rc', th.rune);
    var shade = 'radial-gradient(closest-side, rgba(255,255,255,.18), rgba(0,0,0,.06) 55%, rgba(0,0,0,.45) 93%, rgba(0,0,0,.65) 100%)';
    this.floor.style.background = shade + ', ' + th.stone;   // 안전한 기본값
    // 석판 이음새(동심원·방사선). conic 미지원 브라우저는 이 대입을 무시하고 위 값 유지
    this.floor.style.background = shade + ', repeating-radial-gradient(closest-side, rgba(0,0,0,0) 0 15.5%, rgba(40,32,26,.38) 15.5% 16.4%),' +
      ' repeating-conic-gradient(from 4deg, rgba(0,0,0,0) 0 14deg, rgba(40,32,26,.28) 14deg 14.8deg), ' + th.stone;
  };
  S2._shake = function (amp, dur) {
    var kf = [];
    for (var i = 0; i <= 6; i++) {
      var k = 1 - i / 6;
      kf.push({ transform: 'translate(' + (rand(-1, 1) * amp * k).toFixed(1) + 'px,' + (rand(-1, 1) * amp * k * 0.8).toFixed(1) + 'px)' });
    }
    kf[6] = { transform: 'translate(0,0)' };
    return animate(this.shk, kf, { duration: dur || 380, easing: 'linear' });
  };
  S2._dots = function (x, y, n, o) {
    var fx = this.fx;
    for (var i = 0; i < n; i++) {
      var d = el('div', 'pst-dot', fx);
      var s = rand(o.s0, o.s1);
      d.style.width = s + 'px'; d.style.height = (o.tall ? s * 1.6 : s) + 'px';
      var col = o.cols[i % o.cols.length];
      d.style.background = col;
      if (o.glow) d.style.boxShadow = '0 0 ' + Math.round(s) + 'px ' + col;
      if (o.square) d.style.borderRadius = '2px';
      var ang = o.ang != null ? o.ang + rand(-o.spread, o.spread) : rand(0, TAU), dist = rand(o.d0, o.d1);
      var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist + (o.fall || 0);
      var x0 = x + (o.jx ? rand(-o.jx, o.jx) : 0) - s / 2, y0 = y + (o.jy ? rand(-o.jy, o.jy) : 0) - s / 2;
      (function (d) {
        animate(d, [
          { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(1) rotate(0deg)', opacity: o.a0 == null ? 1 : o.a0 },
          { transform: 'translate(' + (x0 + dx) + 'px,' + (y0 + dy) + 'px) scale(' + (o.endScale == null ? 0.3 : o.endScale) + ') rotate(' + (o.spin ? rand(-o.spin, o.spin) : 0) + 'deg)', opacity: 0 }
        ], { duration: rand(o.t0, o.t1), delay: o.delay ? rand(0, o.delay) : 0, easing: o.ease || 'cubic-bezier(.2,.7,.3,1)', fill: 'both' })
          .then(function () { if (d.parentNode) d.parentNode.removeChild(d); });
      })(d);
    }
  };
  S2._ok = function (side) { var f = this.f[side]; return !this.disposed && isSide(side) && f && f.id ? f : null; };

  S2.setBackground = function (key) {
    var self = this;
    return safe(function () {
      var url = assetURL(self.base, 'assets/bg/' + key + '.jpg');
      var tok = self.bgTok = (self.bgTok || 0) + 1;
      return loadImage(url).then(function (img) {
        if (tok !== self.bgTok || self.disposed) return null;
        self._theme(key);
        if (!img) return null;
        var first = self.bgi < 0;
        self.bgi = first ? 0 : 1 - self.bgi;
        var inc = self.bgs[self.bgi], out = self.bgs[1 - self.bgi];
        inc.style.backgroundImage = 'url("' + url + '")';
        inc.style.zIndex = '1'; out.style.zIndex = '0';
        inc.style.opacity = '1';
        return wait(first ? 50 : 650).then(function () { if (!first && tok === self.bgTok) out.style.opacity = '0'; });
      });
    }, 8000);
  };

  S2.setFighter = function (side, id, o) {
    var self = this, f = this.f[side];
    if (!f || !isSide(side) || !id) return Promise.resolve();
    var tok = f.tok = (f.tok || 0) + 1;
    return safe(function () {
      var src = spriteSrc(id, o && o.shiny);
      return loadImage(src).then(function (img) {
        if (tok !== f.tok || self.disposed) return;
        if (!img) src = placeholderURL();      // 그림 파일이 없으면 자리표시 실루엣
        if (!src) return;
        f.img.src = src;
        f.id = id; f.fainted = false;
        self._reset2(f);
        self.aura(side, null); self.shield(side, false); self.freeze(side, false);
        if (side === 'enemy') self.clearBall();
        self._layout();
      });
    }, 8000);
  };
  // 진행 중 애니메이션·상태 표시를 지우고 보이는 상태로 되돌린다
  S2._reset2 = function (f) {
    try {
      [f.move, f.img, f.idle].forEach(function (e) { if (e.getAnimations) e.getAnimations().forEach(function (an) { an.cancel(); }); });
    } catch (e) { /* 무시 */ }
    f.wrap.style.display = '';
    f.move.style.opacity = '1'; f.move.style.transform = ''; f.move.style.filter = '';
    f.idle.className = 'pst-idle';
  };

  S2.clearFighter = function (side) {
    var f = this.f[side];
    if (!f || !isSide(side)) return Promise.resolve();
    f.tok = (f.tok || 0) + 1;
    f.id = null; f.wrap.style.display = 'none';
    f.idle.className = 'pst-idle';
    this.freeze(side, false);
    if (side === 'enemy') this.clearBall();
    return Promise.resolve();
  };

  S2.enter = function (side) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f) return null;
      f.wrap.style.display = ''; f.fainted = false; f.move.style.opacity = '1';
      return animate(f.move, [
        { transform: 'translateY(-70%)', opacity: 0, filter: 'brightness(4)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'brightness(1.6)' }
      ], { duration: 420, easing: 'cubic-bezier(.55,0,1,.45)' }).then(function () {
        self._dots(f.ax, f.ay, 12, { cols: ['#e8dcc4', '#cbbd9e'], s0: 10, s1: 18, ang: Math.PI, spread: Math.PI, d0: f.size * 0.2, d1: f.size * 0.45, t0: 500, t1: 800, a0: 0.8, endScale: 1.6 });
        self._shake(5, 260);
        return animate(f.move, [
          { transform: 'scale(1.12,.84)', transformOrigin: '50% 96%' },
          { transform: 'scale(.96,1.05)', transformOrigin: '50% 96%' },
          { transform: 'scale(1,1)', transformOrigin: '50% 96%' }
        ], { duration: 320, easing: 'ease-out' });
      });
    }, 3000);
  };

  S2.attack = function (side, fx) {
    var self = this;
    return safe(function () {
      var A = self._ok(side), D = self.f[other(side)];
      if (!A) return null;
      fx = fxKey(fx);
      var cfg = TYPEFX[fx], mode = cfg.m, melee = mode === 'melee';
      var a = self._center(A), d = self._center(D);
      var reach = melee ? 0.45 : mode === 'remote' ? 0 : 0.1, dx = (d.x - a.x) * reach, dy = (d.y - a.y) * reach;
      var hop = melee ? -(cfg.ly || 0.3) * 40 : mode === 'remote' ? -8 : 0;
      animate(A.move, [{ transform: 'translate(0,0)' }, { transform: 'translate(' + dx + 'px,' + (dy + hop) + 'px)', offset: 0.35 }, { transform: 'translate(0,0)' }],
        { duration: 560, easing: 'ease-out' });
      animate(self.shk, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 500 });
      var cols = FXC[fx], ang = Math.atan2(d.y - a.y, d.x - a.x), dist = Math.sqrt((d.x - a.x) * (d.x - a.x) + (d.y - a.y) * (d.y - a.y));
      var T = Math.round((cfg.T || 0.36) * 1000);
      if (mode === 'proj') {
        var ice = fx === 'ice', sq = ice || fx === 'grass';
        self._dots(a.x, a.y, ice ? 10 : fx === 'electric' ? 8 : 16, { cols: cols, s0: sq ? 9 : 7, s1: sq ? 14 : (fx === 'ghost' ? 22 : 12), ang: ang, spread: fx === 'bug' ? 0.15 : 0.05,
          d0: dist * 0.97, d1: dist * 1.03, t0: T, t1: T + 40, delay: fx === 'electric' ? 40 : 140, a0: 1, endScale: 1, square: sq, spin: sq ? 360 : 0, glow: true, ease: 'linear' });
        if (fx === 'electric') self.overlay.flash('#fff27a', 0.3, 260);
      } else if (mode === 'remote') {
        if (fx === 'psychic') self.overlay.flash('#ff5ab4', 0.2, T + 500);
        if (fx === 'rock') self._dots(d.x, d.y - (D.size || 120) * 1.1, 7, { cols: cols, s0: 14, s1: 22, ang: Math.PI / 2, spread: 0.12, d0: (D.size || 120) * 1.0, d1: (D.size || 120) * 1.15,
          jx: (D.size || 120) * 0.25, t0: T, t1: T + 40, a0: 1, endScale: 1, square: true, spin: 200, ease: 'cubic-bezier(.5,0,1,.6)' });
        if (fx === 'ground') self._shake(4, T);
      }
      var tHit = melee ? Math.max(150, (cfg.out || 200) - 10) : mode === 'remote' ? T : (fx === 'electric' ? 260 : 140 + T);
      return wait(tHit).then(function () {
        self._impact(fx, d, D, ang);
        return wait(110);
      });
    }, 3000);
  };
  // 퍼지는 고리 하나
  S2._wave = function (x, y, size, color, delay, flat) {
    var w = el('div', 'pst-wave', this.fx);
    w.style.setProperty('--wc', color);
    w.style.width = size + 'px'; w.style.height = (flat ? size * 0.32 : size) + 'px';
    var base = 'translate(' + (x - size / 2) + 'px,' + (y - (flat ? size * 0.16 : size / 2)) + 'px)';
    animate(w, [{ transform: base + ' scale(.2)', opacity: 1 }, { transform: base + ' scale(1)', opacity: 0 }], { duration: 480, delay: delay || 0, easing: 'ease-out', fill: 'both' })
      .then(function () { if (w.parentNode) w.parentNode.removeChild(w); });
  };
  S2._slash = function (d, w, rot, color, delay) {
    var sl = el('div', 'pst-slash', this.fx);
    sl.style.width = w + 'px';
    if (color) { sl.style.background = 'linear-gradient(90deg,rgba(255,255,255,0),' + color + ' 28%,#fff 60%,rgba(255,255,255,0))'; sl.style.boxShadow = '0 0 14px ' + color; }
    var base = 'translate(' + (d.x - w / 2) + 'px,' + (d.y - 6) + 'px) rotate(' + rot + 'rad)';
    animate(sl, [{ transform: base + ' scaleX(.2)', opacity: 1 }, { transform: base + ' scaleX(1)', opacity: 1, offset: 0.4 }, { transform: base + ' scaleX(1.05)', opacity: 0 }],
      { duration: 380, delay: delay || 0, fill: 'both' }).then(function () { if (sl.parentNode) sl.parentNode.removeChild(sl); });
  };
  S2._impact = function (fx, d, D, ang) {
    var cols = FXC[fx] || FXC.normal, s = D && D.size ? D.size : 120, self = this;
    var up = -Math.PI / 2, fy = d.y + s * 0.38;
    switch (fx) {
      case 'water': self._dots(d.x, d.y, 18, { cols: cols, s0: 6, s1: 12, d0: s * 0.2, d1: s * 0.5, fall: s * 0.15, t0: 450, t1: 700, glow: true }); break;
      case 'ice': self._dots(d.x, d.y, 16, { cols: cols, s0: 8, s1: 14, d0: s * 0.2, d1: s * 0.5, t0: 450, t1: 700, square: true, spin: 360, glow: true }); break;
      case 'dark':
        self._slash(d, s * 0.95, 0.6, null, 0); self._slash(d, s * 0.95, -0.6, null, 70);
        self._dots(d.x, d.y, 14, { cols: cols, s0: 6, s1: 11, d0: s * 0.2, d1: s * 0.45, t0: 400, t1: 650, glow: true, delay: 80 });
        break;
      case 'steel': self._dots(d.x, d.y, 22, { cols: cols, s0: 4, s1: 8, d0: s * 0.3, d1: s * 0.7, fall: s * 0.2, t0: 300, t1: 550, glow: true }); break;
      case 'fire':
        self.overlay.flash('#ff7a1a', 0.25, 400);
        self._dots(d.x, d.y + s * 0.2, 20, { cols: cols, s0: 10, s1: 18, ang: up, spread: 0.7, d0: s * 0.3, d1: s * 0.7, jx: s * 0.25, t0: 450, t1: 750, glow: true, endScale: 0.2 });
        break;
      case 'grass':
        self._slash(d, s * 0.9, 0.5, '#5ae04a', 0); self._slash(d, s * 0.9, -0.7, '#5ae04a', 60);
        self._dots(d.x, d.y, 16, { cols: cols, s0: 8, s1: 13, d0: s * 0.25, d1: s * 0.6, t0: 500, t1: 800, square: true, spin: 540 });
        break;
      case 'electric':
        self.overlay.flash('#fff27a', 0.4, 320);
        self._dots(d.x, d.y, 24, { cols: cols, s0: 4, s1: 9, d0: s * 0.25, d1: s * 0.7, t0: 220, t1: 420, glow: true });
        self._wave(d.x, d.y, s * 1.0, '#ffe84a', 0);
        break;
      case 'fighting':
        self._wave(d.x, d.y, s * 0.7, '#ffffff', 0); self._wave(d.x, d.y, s * 1.05, '#ff8a4a', 70); self._wave(d.x, d.y, s * 1.4, '#ffc08a', 140);
        self._dots(d.x, d.y, 16, { cols: cols, s0: 5, s1: 10, d0: s * 0.3, d1: s * 0.7, t0: 300, t1: 500, glow: true });
        self._shake(10, 380);
        break;
      case 'poison':
        self._dots(d.x, d.y, 14, { cols: cols, s0: 7, s1: 12, d0: s * 0.2, d1: s * 0.5, fall: s * 0.15, t0: 450, t1: 700, glow: true });
        self._dots(d.x, d.y + s * 0.15, 10, { cols: ['#d8a0ff', '#b070ff'], s0: 8, s1: 14, ang: up, spread: 0.6, d0: s * 0.3, d1: s * 0.6, jx: s * 0.25, t0: 700, t1: 1000, a0: 0.9, endScale: 1.4 });
        break;
      case 'ground':
        self._wave(d.x, fy, s * 1.5, '#c0904a', 0, true); self._wave(d.x, fy, s * 2, '#a87a40', 90, true);
        self._dots(d.x, fy, 16, { cols: cols, s0: 12, s1: 22, ang: up, spread: 0.9, d0: s * 0.3, d1: s * 0.7, jx: s * 0.3, t0: 600, t1: 900, a0: 0.85, endScale: 1.6 });
        self._shake(10, 420);
        break;
      case 'flying':
        self._slash(d, s * 1.1, 0.45, '#bfe0ff', 0); self._slash(d, s * 1.1, -0.45, '#bfe0ff', 60);
        self._dots(d.x, d.y, 10, { cols: cols, s0: 8, s1: 13, d0: s * 0.25, d1: s * 0.55, fall: s * 0.2, t0: 600, t1: 900, spin: 360 });
        break;
      case 'psychic':
        for (var i = 0; i < 3; i++) self._wave(d.x, d.y, s * (0.8 + i * 0.35), i % 2 ? '#ffc8ec' : '#ff6ac8', i * 90);
        self._dots(d.x, d.y, 12, { cols: cols, s0: 5, s1: 9, d0: s * 0.25, d1: s * 0.55, t0: 400, t1: 650, glow: true });
        break;
      case 'bug':
        self._dots(d.x, d.y, 26, { cols: cols, s0: 4, s1: 8, d0: s * 0.15, d1: s * 0.55, t0: 500, t1: 850, glow: true, spin: 720 });
        break;
      case 'rock':
        self._dots(d.x, d.y, 12, { cols: cols, s0: 8, s1: 14, d0: s * 0.25, d1: s * 0.55, fall: s * 0.3, t0: 450, t1: 700, square: true, spin: 360 });
        self._wave(d.x, fy, s * 1.4, '#c8b89a', 0, true);
        self._shake(9, 380);
        break;
      case 'ghost':
        self._wave(d.x, d.y, s * 1.1, '#8a5aff', 0);
        self._dots(d.x, d.y, 14, { cols: ['#2a1040', '#3a1a5a', '#6a3ac8'], s0: 14, s1: 22, d0: s * 0.15, d1: s * 0.4, t0: 600, t1: 900, a0: 0.8, endScale: 1.6 });
        self._dots(d.x, d.y, 10, { cols: cols, s0: 6, s1: 10, ang: up, spread: 0.8, d0: s * 0.3, d1: s * 0.6, t0: 600, t1: 900, glow: true });
        break;
      case 'dragon':
        self.overlay.flash('#5af0e0', 0.2, 360);
        self._wave(d.x, d.y, s * 1.2, '#7a5aff', 0); self._wave(d.x, d.y, s * 0.9, '#5af0e0', 70);
        self._dots(d.x, d.y, 20, { cols: cols, s0: 6, s1: 12, d0: s * 0.3, d1: s * 0.7, t0: 400, t1: 650, glow: true });
        break;
      case 'fairy':
        self._wave(d.x, d.y, s * 1.0, '#ff9ad8', 0);
        self._dots(d.x, d.y, 18, { cols: cols, s0: 6, s1: 11, d0: s * 0.25, d1: s * 0.6, t0: 500, t1: 800, glow: true, spin: 180 });
        break;
      default:
        self._dots(d.x, d.y + s * 0.3, 12, { cols: cols, s0: 14, s1: 24, d0: s * 0.15, d1: s * 0.4, t0: 600, t1: 900, a0: 0.75, endScale: 1.8 });
    }
  };

  S2.hit = function (side, o) {
    var self = this;
    o = o || {};
    return safe(function () {
      var f = self._ok(side);
      if (!f) return null;
      var eff = o.eff == null ? 1 : o.eff;
      var s = 1 + (o.crit ? 0.6 : 0) + (eff > 1 ? 0.5 : 0) - (eff < 1 ? 0.3 : 0);
      var kx = (side === 'player' ? -1 : 1) * 16 * s, ky = (side === 'player' ? 5 : -4) * s;
      var fl = eff > 1 ? 'brightness(1.3) sepia(1) saturate(6) hue-rotate(-35deg)' : 'brightness(3) saturate(0)';
      if (o.crit) self.overlay.flash('#ffffff', 0.35, 360);
      self._shake(6 * s, 400);
      if (TYPEFX.hasOwnProperty(o.fx) && o.fx !== 'normal') {
        var hc = self._center(f);
        self._dots(hc.x, hc.y, Math.round(8 * s), { cols: [FXC[o.fx][0], FXC[o.fx][1], '#ffffff'], s0: 4, s1: 8, d0: f.size * 0.2, d1: f.size * 0.45, t0: 250, t1: 450, glow: true });
      }
      return Promise.all([
        animate(f.move, [{ transform: 'translate(0,0)' }, { transform: 'translate(' + kx + 'px,' + ky + 'px) rotate(' + (kx > 0 ? 6 : -6) + 'deg)', offset: 0.18 }, { transform: 'translate(0,0)' }],
          { duration: 490, easing: 'ease-out' }),
        animate(f.img, [{ filter: 'none' }, { filter: fl }, { filter: 'none' }, { filter: fl }, { filter: 'none' }, { filter: fl }, { filter: 'none' }],
          { duration: 540, easing: 'steps(1,end)' })
      ]);
    }, 3000);
  };

  S2.miss = function (side) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f) return null;
      var d = (side === 'player' ? -1 : 1) * f.size * 0.35;
      return animate(f.move, [{ transform: 'translateX(0)' }, { transform: 'translateX(' + d + 'px) rotate(' + (d > 0 ? -6 : 6) + 'deg)', offset: 0.3 },
        { transform: 'translateX(' + d + 'px)', offset: 0.55 }, { transform: 'translateX(0)' }], { duration: 560, easing: 'ease-in-out' });
    }, 2500);
  };

  S2.heal = function (side) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f) return null;
      var c = self._center(f);
      self._dots(c.x, c.y + f.size * 0.3, 22, { cols: FXC.heal, s0: 5, s1: 10, ang: -Math.PI / 2, spread: 0.25, d0: f.size * 0.4, d1: f.size * 0.8,
        jx: f.size * 0.3, jy: f.size * 0.15, t0: 700, t1: 1000, delay: 300, glow: true, endScale: 0.6 });
      return animate(f.img, [{ filter: 'none' }, { filter: 'brightness(1.35) drop-shadow(0 0 10px #6dff9a)' }, { filter: 'none' }], { duration: 1000, easing: 'ease-in-out' });
    }, 3000);
  };

  S2.shield = function (side, on) {
    var f = this.f[side];
    if (!f || !isSide(side)) return Promise.resolve();
    var c = hexRGB(f.id === 'black' ? '#ff5a78' : '#8fe8ff');
    f.shield.style.setProperty('--sc', c.join(','));
    if (on) f.shield.classList.add('on'); else f.shield.classList.remove('on');
    return wait(on ? 380 : 260);
  };

  S2.freeze = function (side, on) {
    var f = this.f[side];
    if (!f || !isSide(side)) return Promise.resolve();
    if (on) { f.img.classList.add('pst-frozen'); f.ice.classList.add('on'); }
    else { f.img.classList.remove('pst-frozen'); f.ice.classList.remove('on'); }
    return wait(350);
  };

  S2.statFx = function (side, up) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f) return null;
      var col = up ? '#ff8a3a' : '#4aa8ff', ps = [];
      for (var i = 0; i < 5; i++) {
        var ar = el('div', 'pst-arrow', self.fx);
        ar.style.background = col;
        var x = f.ax + (i - 2) * f.size * 0.16 - 11, y0 = up ? f.ay - f.size * 0.1 : f.ay - f.size * 0.85, y1 = up ? f.ay - f.size * 0.9 : f.ay - f.size * 0.1;
        var rot = up ? '' : ' rotate(180deg)';
        (function (ar) {
          ps.push(animate(ar, [{ transform: 'translate(' + x + 'px,' + y0 + 'px)' + rot, opacity: 0 }, { transform: 'translate(' + x + 'px,' + (y0 + (y1 - y0) * 0.3) + 'px)' + rot, opacity: 1, offset: 0.25 },
            { transform: 'translate(' + x + 'px,' + y1 + 'px)' + rot, opacity: 0 }], { duration: 650, delay: (i % 3) * 90, fill: 'both', easing: 'ease-out' })
            .then(function () { if (ar.parentNode) ar.parentNode.removeChild(ar); }));
        })(ar);
      }
      ps.push(animate(f.img, [{ filter: 'none' }, { filter: 'brightness(1.25) drop-shadow(0 0 10px ' + col + ')' }, { filter: 'none' }], { duration: 900 }));
      return Promise.all(ps);
    }, 2500);
  };

  S2.faint = function (side) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f || f.fainted) return null;
      self.aura(side, null); self.shield(side, false); self.freeze(side, false);
      f.idle.className = 'pst-idle';
      return animate(f.move, [{ transform: 'none', opacity: 1, transformOrigin: '50% 96%' },
        { transform: 'translateY(4%) scaleY(.75) rotate(' + (side === 'player' ? -10 : 10) + 'deg)', opacity: 0.8, offset: 0.55, transformOrigin: '50% 96%' },
        { transform: 'translateY(12%) scaleY(.35)', opacity: 0, transformOrigin: '50% 96%' }], { duration: 900, easing: 'ease-in', fill: 'forwards' })
        .then(function () {
          self._dots(f.ax, f.ay, 10, { cols: ['#d8ccb4', '#bfb196'], s0: 12, s1: 20, ang: Math.PI, spread: Math.PI, d0: f.size * 0.15, d1: f.size * 0.4, t0: 500, t1: 800, a0: 0.7, endScale: 1.6 });
          f.fainted = true; f.wrap.style.display = 'none';
          f.move.style.opacity = '1';
          try { if (f.move.getAnimations) f.move.getAnimations().forEach(function (an) { an.cancel(); }); } catch (e) { /* 무시 */ }
        });
    }, 3000);
  };

  S2.aura = function (side, color) {
    var f = this.f[side];
    if (!f || !isSide(side)) return Promise.resolve();
    if (color) f.aura.style.setProperty('--ac', color);
    f.aura.style.opacity = color ? '0.9' : '0';
    return wait(400);
  };

  var RED2D = 'brightness(.7) sepia(1) saturate(12) hue-rotate(-50deg) brightness(1.25)';   // 붉은 빛으로 물드는 필터(교체·포획)
  S2.recall = function (side) {
    var self = this;
    return safe(function () {
      var f = self._ok(side);
      if (!f || f.fainted || f.wrap.style.display === 'none') return null;
      var d = self._dims();
      var tx = side === 'player' ? -d.W * 0.4 : d.W * 0.05, ty = side === 'player' ? d.H * 0.15 : -d.H * 0.22;
      var c = self._center(f);
      self._dots(c.x, c.y, 10, { cols: ['#ff3a4a', '#ffffff', '#ff8a9a'], s0: 6, s1: 11, d0: f.size * 0.1, d1: f.size * 0.35, t0: 300, t1: 500, glow: true });
      return animate(f.move, [
        { transform: 'none', opacity: 1, filter: 'none', transformOrigin: '50% 60%' },
        { transform: 'scale(1.06)', opacity: 1, filter: RED2D, offset: 0.32, transformOrigin: '50% 60%' },
        { transform: 'translate(' + tx + 'px,' + ty + 'px) scale(.04)', opacity: 0, filter: RED2D, transformOrigin: '50% 60%' }
      ], { duration: 500, easing: 'ease-in', fill: 'forwards' }).then(function () {
        f.wrap.style.display = 'none';
        self.aura(side, null); self.shield(side, false); self.freeze(side, false);
        self._reset2(f);
        f.wrap.style.display = 'none';
      });
    }, 1500);
  };

  S2.clearBall = function () {
    this.ballTok = (this.ballTok || 0) + 1;
    if (this.ballEl && this.ballEl.parentNode) this.ballEl.parentNode.removeChild(this.ballEl);
    this.ballEl = null;
    if (this.ballHidE) {
      this.ballHidE = false;
      var E = this.f.enemy;
      if (E.id && !E.fainted) this._reset2(E);
    }
    return Promise.resolve();
  };
  S2.throwBall = function (shakes, caught) {
    var self = this;
    shakes = clamp(Math.floor(+shakes || 0), 0, 3); caught = !!caught;
    return safe(function () {
      if (self.disposed) return null;
      self.clearBall();
      var tok = self.ballTok, E = self.f.enemy, dm = self._dims();
      function live() { return tok === self.ballTok && !self.disposed; }
      var hasE = !!(E.id && !E.fainted && E.wrap.style.display !== 'none');
      var es = E.size || 100, bs = Math.max(18, Math.round(es * 0.24));
      var b = self.ballEl = el('img', 'pst-ball', self.fx);
      b.src = ballURL(); b.alt = '';
      b.style.width = bs + 'px'; b.style.height = bs + 'px';
      var x0 = dm.W * 0.06, y0 = dm.H * 0.9, x1 = E.ax - bs / 2, y1 = E.ay - es * 0.55 - bs / 2;
      var rx = E.ax - bs / 2, ry = E.ay - bs + 2;
      function at(x, y, r, s) { return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + (r || 0).toFixed(1) + 'deg) scale(' + (s || 1) + ')'; }
      var kf = [];
      for (var i = 0; i <= 10; i++) {
        var k = i / 10;
        kf.push({ transform: at(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k - Math.sin(k * Math.PI) * dm.H * 0.3, -k * 790, 1.6 - 0.6 * k) });
      }
      b.style.transform = kf[10].transform;
      return animate(b, kf, { duration: 620, easing: 'linear' }).then(function () {
        if (!live()) return null;
        self.overlay.flash('#ffffff', 0.4, 360);
        self._dots(x1 + bs / 2, y1 + bs / 2, 12, { cols: ['#ff4a5a', '#ffffff'], s0: 5, s1: 9, d0: bs * 0.6, d1: bs * 1.5, t0: 300, t1: 500, glow: true });
        if (!hasE) return wait(250);
        self.ballHidE = true;
        return animate(E.move, [{ transform: 'none', opacity: 1, filter: 'none', transformOrigin: '50% 50%' },
          { transform: 'translateY(-20%) scale(.05)', opacity: 0, filter: RED2D, transformOrigin: '50% 50%' }],
          { duration: 380, easing: 'ease-in', fill: 'forwards' }).then(function () { if (live()) E.move.style.opacity = '0'; });
      }).then(function () {
        if (!live()) return null;
        b.style.transform = at(rx, ry);
        return animate(b, [{ transform: at(x1, y1) }, { transform: at(rx, ry), offset: 0.62 }, { transform: at(rx, ry - bs * 0.4), offset: 0.8 }, { transform: at(rx, ry) }],
          { duration: 440, easing: 'ease-in' });
      }).then(function () {
        if (!live()) return null;
        var chain = wait(320);
        for (var j = 0; j < shakes; j++) {
          chain = chain.then(function () {
            if (!live()) return null;
            return animate(b, [{ transform: at(rx, ry, 0) }, { transform: at(rx - 2, ry, -28), offset: 0.25 }, { transform: at(rx + 2, ry, 24), offset: 0.75 }, { transform: at(rx, ry, 0) }],
              { duration: 450, easing: 'ease-in-out' });
          }).then(function () { return wait(300); });
        }
        return chain;
      }).then(function () {
        if (!live()) return null;
        var cx = rx + bs / 2, cy = ry + bs / 2;
        if (caught) {
          self.ballHidE = false;
          E.wrap.style.display = 'none';
          self._dots(cx, cy - bs * 0.4, 12, { cols: ['#fff27a', '#ffffff'], s0: 5, s1: 9, ang: -Math.PI / 2, spread: 1.1, d0: bs * 0.8, d1: bs * 1.8, t0: 450, t1: 700, glow: true });
          b.style.filter = 'brightness(.66)';
          return animate(b, [{ filter: 'brightness(1.6)' }, { filter: 'brightness(.66)' }], { duration: 380 });
        }
        self.overlay.flash('#ffffff', 0.6, 420);
        self._dots(cx, cy, 16, { cols: ['#ff4a5a', '#ffffff', '#ffb0b8'], s0: 6, s1: 11, d0: bs * 0.8, d1: bs * 2.2, t0: 350, t1: 600, glow: true });
        if (b.parentNode) b.parentNode.removeChild(b);
        self.ballEl = null;
        if (!hasE || !self.ballHidE) { self.ballHidE = false; return null; }
        self.ballHidE = false;
        self._reset2(E);
        return animate(E.move, [{ transform: 'scale(.1)', opacity: 0.3, filter: 'brightness(4)', transformOrigin: '50% 96%' },
          { transform: 'scale(1.06)', opacity: 1, filter: 'brightness(1.6)', offset: 0.7, transformOrigin: '50% 96%' },
          { transform: 'scale(1)', opacity: 1, filter: 'none', transformOrigin: '50% 96%' }], { duration: 420, easing: 'ease-out' });
      });
    }, 9000);
  };

  // 화면 좌표(x,y)에 글자 하나를 띄워 움직인다
  S2._glyph = function (ch, color, size, kf, o) {
    var g = el('div', 'pst-glyph', this.fx);
    g.textContent = ch;
    if (color) g.style.color = color;
    g.style.fontSize = Math.round(size) + 'px';
    return animate(g, kf, o).then(function () { if (g.parentNode) g.parentNode.removeChild(g); });
  };
  S2.status = function (side, kind) {
    var self = this;
    if (kind === 'frz') return this.freeze(side, true);
    if (kind === 'thaw') return this.freeze(side, false);
    return safe(function () {
      var f = self._ok(side);
      if (!f || f.fainted || f.wrap.style.display === 'none') return null;
      var c = self._center(f), s = f.size, up = -Math.PI / 2, i;
      function glow(col, n) {
        var kf = [{ filter: 'none' }];
        for (var j = 0; j < (n || 1); j++) kf.push({ filter: 'brightness(1.3) drop-shadow(0 0 10px ' + col + ')' }, { filter: 'none' });
        return animate(f.img, kf, { duration: 620, easing: 'ease-in-out' });
      }
      switch (kind) {
        case 'brn':
          self._dots(c.x, c.y + s * 0.3, 18, { cols: FXC.fire, s0: 8, s1: 15, ang: up, spread: 0.35, d0: s * 0.35, d1: s * 0.7, jx: s * 0.3, t0: 450, t1: 700, delay: 200, glow: true, endScale: 0.2 });
          return glow('#ff7a2a', 2);
        case 'psn': case 'tox':
          self._dots(c.x, c.y + s * 0.2, kind === 'tox' ? 18 : 12, { cols: kind === 'tox' ? ['#9a40f0', '#c070ff', '#6a1ab8'] : ['#d8a0ff', '#b070ff', '#e8c0ff'], s0: 7, s1: 13, ang: up, spread: 0.4,
            d0: s * 0.3, d1: s * 0.6, jx: s * 0.3, t0: 600, t1: 900, delay: 250, a0: 0.9, endScale: 1.4 });
          return glow(kind === 'tox' ? '#8a2ae0' : '#b060ff', kind === 'tox' ? 2 : 1);
        case 'par':
          self._dots(c.x, c.y, 16, { cols: ['#fff27a', '#ffffff', '#ffe12a'], s0: 3, s1: 7, d0: s * 0.2, d1: s * 0.5, jx: s * 0.2, jy: s * 0.2, t0: 160, t1: 320, delay: 300, glow: true });
          animate(f.move, [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' },
            { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'translateX(0)' }], { duration: 460, easing: 'steps(1,end)' });
          return glow('#fff27a', 3);
        case 'slp': {
          var ps = [];
          for (i = 0; i < 3; i++) {
            var x = c.x + s * 0.15, y = c.y - s * 0.3, sz = 14 + i * 4;
            ps.push(self._glyph('Z', null, sz, [{ transform: 'translate(' + x + 'px,' + y + 'px) scale(.5)', opacity: 0 },
              { transform: 'translate(' + (x + s * 0.1) + 'px,' + (y - s * 0.12) + 'px) scale(.9)', opacity: 1, offset: 0.25 },
              { transform: 'translate(' + (x + s * 0.3) + 'px,' + (y - s * 0.45) + 'px) scale(1.2)', opacity: 0 }], { duration: 1000, delay: i * 220, fill: 'both', easing: 'ease-out' }));
          }
          return Promise.race([wait(700), Promise.all(ps)]);
        }
        case 'cnf': {
          var hx = c.x, hy = c.y - s * 0.48, R = s * 0.28;
          for (i = 0; i < 3; i++) {
            var kf = [];
            for (var q = 0; q <= 8; q++) {
              var ang = i / 3 * TAU + q / 8 * TAU * 1.5;
              kf.push({ transform: 'translate(' + (hx + Math.cos(ang) * R - 7).toFixed(1) + 'px,' + (hy + Math.sin(ang) * R * 0.3 - 7).toFixed(1) + 'px)', opacity: q === 0 || q === 8 ? 0 : 1 });
            }
            self._glyph('★', '#ffe46a', 14, kf, { duration: 900, easing: 'linear', fill: 'both' });
          }
          return animate(f.move, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(5deg)' }, { transform: 'rotate(-3deg)' }, { transform: 'rotate(0deg)' }],
            { duration: 700, easing: 'ease-in-out' });
        }
        default:
          return null;
      }
    }, 2000);
  };
  S2.statusTint = function (side, kind) {
    var f = this.f[side];
    if (!f || !isSide(side)) return Promise.resolve();
    kind = ST_KINDS.hasOwnProperty(kind) ? kind : null;
    f.idle.className = 'pst-idle' + (kind && kind !== 'frz' ? ' pst-st-' + kind : '');
    if (kind === 'frz') this.freeze(side, true);
    else if (f.ice.classList.contains('on')) this.freeze(side, false);
    return Promise.resolve();
  };

  S2.transform = function (side, newId, o) {
    var self = this;
    return safe(function () {
      var f = self.f[side];
      if (!f || !isSide(side) || !newId) return null;
      if (!f.id) return self.setFighter(side, newId, o).then(function () { return self.enter(side); });
      var src = spriteSrc(newId, o && o.shiny);
      var revive = f.fainted || f.wrap.style.display === 'none';
      f.wrap.style.display = ''; f.fainted = false;
      self.aura(side, '#ff2440');
      var rise = revive ? animate(f.move, [{ transform: 'translateY(10%) scaleY(.4)', opacity: 0, transformOrigin: '50% 96%' }, { transform: 'none', opacity: 1, transformOrigin: '50% 96%' }],
        { duration: 800, easing: 'ease-out' }) : Promise.resolve();
      return Promise.all([loadImage(src), rise]).then(function (r) {
        self._shake(5, 1000);
        return animate(f.img, [{ filter: 'none' }, { filter: 'brightness(1.4) sepia(1) saturate(6) hue-rotate(-35deg)' }, { filter: 'none' },
          { filter: 'brightness(1.6) sepia(1) saturate(6) hue-rotate(-35deg)' }, { filter: 'brightness(4)' }], { duration: 1000 }).then(function () { return r[0]; });
      }).then(function (img) {
        self.overlay.flash('#ffffff', 0.95, 760);
        self._shake(12, 500);
        if (img) { f.img.src = src; f.id = newId; self._layout(); }
        var c = self._center(f);
        self._dots(c.x, c.y, 22, { cols: ['#ff2440', '#ff7a5a', '#ffffff'], s0: 6, s1: 12, d0: f.size * 0.3, d1: f.size * 0.7, t0: 500, t1: 800, glow: true });
        return animate(f.img, [{ filter: 'brightness(4)' }, { filter: 'none' }], { duration: 800, easing: 'ease-out' });
      }).then(function () { self.aura(side, null); });
    }, 7000);
  };

  S2.shadowRise = function () {
    var self = this;
    return safe(function () {
      var P = self.f.player, E = self.f.enemy;
      var srcB = spriteSrc('black', false);
      var gSrc = P.id ? P.img.src : srcB;
      var d = self._dims();
      var hideE = (E.id && E.wrap.style.display !== 'none') ? animate(E.move, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }) : Promise.resolve();
      return Promise.all([loadImage(srcB), hideE]).then(function () {
        E.wrap.style.display = 'none';
        try { if (E.move.getAnimations) E.move.getAnimations().forEach(function (an) { an.cancel(); }); } catch (e) { /* 무시 */ }
        var gs = (P.id ? P.size : size2('black', 'player', d.H)) * 0.85;   // 플레이어 뒤쪽이라 약간 작게
        var g = el('img', 'pst-ghost', self.shk);
        g.src = gSrc; g.alt = '';
        g.style.width = gs + 'px'; g.style.height = gs + 'px';
        g.style.filter = 'brightness(0) drop-shadow(0 0 8px #ff1030)';
        var x0 = P.ax + d.W * 0.1 - gs / 2, y0 = P.ay - d.H * 0.1 - gs * (1 - FOOT);
        var es = size2('black', 'enemy', d.H), sc = es / gs;
        var x1 = E.ax - gs / 2, y1 = E.ay - gs * (1 - FOOT);
        if (P.id) g.style.transform = 'scaleX(-1)';
        var flip = P.id ? ' scaleX(-1)' : '';
        return animate(g, [{ transform: 'translate(' + x0 + 'px,' + y0 + 'px) scaleY(0)' + flip, opacity: 0 },
          { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scaleY(.15)' + flip, opacity: 0.9, offset: 0.25 },
          { transform: 'translate(' + x0 + 'px,' + y0 + 'px) scaleY(1)' + flip, opacity: 0.95 }], { duration: 1500, easing: 'ease-in-out', fill: 'forwards' })
          .then(function () { self._shake(4, 600); return wait(350); })
          .then(function () {
            return animate(g, [{ transform: 'translate(' + x0 + 'px,' + y0 + 'px) scale(1)' + flip, opacity: 0.95 },
              { transform: 'translate(' + x1 + 'px,' + y1 + 'px) scale(' + sc + ')' + flip, opacity: 0.95 }], { duration: 950, easing: 'ease-in-out', fill: 'forwards' });
          }).then(function () {
            if (g.parentNode) g.parentNode.removeChild(g);
            self.overlay.flash('#ff1a30', 0.7, 700);
            self._shake(12, 500);
            E.tok = (E.tok || 0) + 1;
            E.img.src = srcB; E.id = 'black'; E.fainted = false;
            E.wrap.style.display = ''; E.move.style.opacity = '1';
            self._layout();
            var c = self._center(E);
            self._dots(c.x, c.y, 20, { cols: ['#ff2440', '#ff7a5a'], s0: 6, s1: 12, d0: E.size * 0.3, d1: E.size * 0.6, t0: 500, t1: 800, glow: true });
            return animate(E.img, [{ filter: 'brightness(0)' }, { filter: 'none' }], { duration: 800, easing: 'ease-out' });
          });
      });
    }, 9000);
  };

  S2.focus = function (side) {
    var f = side && isSide(side) ? this.f[side] : null;
    if (f && f.id) {
      var c = this._center(f);
      this.cam.style.transformOrigin = c.x + 'px ' + c.y + 'px';
      this.cam.style.transform = 'scale(1.32)';
    } else this.cam.style.transform = 'none';
    return wait(720);
  };

  S2.flash = function (color) {
    var self = this;
    return safe(function () { return self.overlay.flash(color || '#ffffff', 0.85, 520); }, 1500);
  };

  S2.screenPos = function (side) {
    var f = this.f[side];
    var d = this._dims();
    if (!f || !isSide(side)) return { x: d.W / 2, y: d.H / 3 };
    try {
      if (f.id && f.wrap.style.display !== 'none') {
        var r = f.img.getBoundingClientRect(), cr = this.container.getBoundingClientRect();
        if (r.width > 0) return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height * (1 - FOOT - ART_TOP) - cr.top };
      }
    } catch (e) { /* 아래 계산값 사용 */ }
    return { x: f.ax, y: f.ay - f.size * ART_TOP };
  };

  S2.setPaused = function (b) {
    if (b) this.root.classList.add('pst-paused'); else this.root.classList.remove('pst-paused');
  };

  S2.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    if (this._ro) this._ro.disconnect();
    root.removeEventListener('resize', this._onResize);
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  /* ───────────── 생성 ───────────── */
  function create(container, opts) {
    opts = opts || {};
    injectCSS();
    prepContainer(container);
    // file:// 에서는 배경 jpg를 WebGL 텍스처로 올릴 수 없으므로(교차 출처) 2D로 진행
    var fileProto = root.location && root.location.protocol === 'file:';
    if (!opts.force2d && !fileProto && root.THREE && THREE.WebGLRenderer && THREE.REVISION) {
      var canvas = document.createElement('canvas');
      var gl = makeGL(canvas);
      if (gl) {
        try { return new Stage3D(container, opts, canvas, gl); } catch (e) {
          var stale = container.querySelector('.pst-root');
          if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
        }
      }
    }
    return new Stage2D(container, opts);
  }

  root.Stage = { create: create, THEMES: THEMES, FX_TYPES: FX_TYPES };
})(typeof window !== 'undefined' ? window : globalThis);
