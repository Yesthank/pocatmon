/* 포캣몬 필드(오버월드) 렌더러 — Canvas 2D 도트 그림
   전역: Field.create(hostEl) → f   (f.mode === 'canvas')
   - 화면만 그린다. 입력·충돌·스크립트·저장은 모른다(main.js 가 움직임을 지시한다).
   - 논리 해상도(타일 16px)의 작은 캔버스에 그리고, CSS image-rendering: pixelated 로 정수배 확대한다.
     (휴대폰에서 확대 비용이 0이고 도트가 흐려지지 않는다)
   - 지형·건물은 맵을 불러올 때 오프스크린 캔버스 두 장(바닥층, 위로 걸치는 층)에 미리 그린다.
     매 프레임에는 보이는 칸의 작은 애니메이션(수풀·꽃·물·용암)과 캐릭터·말풍선·입자만 그린다.
   - Promise 를 돌려주는 메서드는 어떤 경우에도 resolve 하며 reject 하지 않는다(제한 시간 타이머로 마무리).
   데이터 계약: js/maps.js (LEGEND 문자, BUILDINGS 크기, doorOf 문 규칙, LOOKS 사람 모양) — PMaps 는 선택 의존. */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var T = 16;          // 타일 한 변(논리 px)
  var SPR_H = 24;      // 사람 스프라이트 높이
  var SPR_UP = 7;      // 사람 스프라이트가 자기 칸 위로 올라가는 양(머리)
  var OVER = 8;        // 나무·건물이 윗칸으로 걸치는 높이
  var HEAD_UP = 4;     // 칸 위쪽에서 머리 꼭대기까지(위로)
  var OUTLINE = 0x1e1426;
  var DIRS = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
  var DIR_ROW = { down: 0, up: 1, left: 2, right: 3 };
  var TAU = Math.PI * 2;

  /* ───────────── 공통 유틸 ───────────── */
  function now() { return (root.performance && performance.now) ? performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function noop() {}
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  function ctx2d(c) { var x = c.getContext('2d'); if (x) x.imageSmoothingEnabled = false; return x; }

  // 어떤 경우에도(예외·지연) resolve 되는 Promise
  function safe(fn, maxMs) {
    return new Promise(function (resolve) {
      var done = false;
      var to = setTimeout(fin, maxMs || 4000);
      function fin() { if (!done) { done = true; clearTimeout(to); resolve(); } }
      try {
        var p = fn();
        if (p && typeof p.then === 'function') p.then(fin, fin); else fin();
      } catch (e) { fin(); }
    });
  }

  /* 색: 내부는 0xRRGGBB 정수, 투명은 -1 */
  var _rgb = {};
  function rgb(c, def) {
    if (typeof c === 'number') return c;
    if (typeof c !== 'string') return def === undefined ? -1 : def;
    if (_rgb[c] !== undefined) return _rgb[c] < 0 && def !== undefined ? def : _rgb[c];
    var h = c.replace('#', ''), v = -1;
    if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (/^[0-9a-f]{6}$/i.test(h)) v = parseInt(h, 16);
    _rgb[c] = v;
    return v < 0 && def !== undefined ? def : v;
  }
  var _css = {};
  function css(c) { var s = _css[c]; if (!s) { s = '#' + ('00000' + (c >>> 0).toString(16)).slice(-6); _css[c] = s; } return s; }
  function mix(a, b, t) {
    var ar = a >> 16 & 255, ag = a >> 8 & 255, ab = a & 255, br = b >> 16 & 255, bg = b >> 8 & 255, bb = b & 255;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  }
  // 어둡게는 차가운 보라 쪽으로, 밝게는 따뜻한 흰색 쪽으로(도트 그림 색 이동)
  function shade(c, k) { return k >= 0 ? mix(c, 0xfffbe8, k) : mix(c, 0x1c1030, -k); }
  function lum(c) { return ((c >> 16 & 255) * 0.3 + (c >> 8 & 255) * 0.59 + (c & 255) * 0.11) / 255; }

  /* 결정적 해시(타일마다 다른 무늬) */
  function hash(x, y, s) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rng(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function ri(r, n) { return (r() * n) | 0; }

  /* ───────────── 픽셀 버퍼(스프라이트·건물·나무) ─────────────
     작은 정수 색 배열에 그린 뒤 자동 외곽선을 두르고 캔버스로 바꾼다. */
  function PB(w, h) { this.w = w; this.h = h; this.d = new Int32Array(w * h); this.d.fill(-1); }
  PB.prototype.px = function (x, y, c) {
    if (c == null || c < 0) return;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = c;
  };
  PB.prototype.clr = function (x, y) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = -1; };
  PB.prototype.get = function (x, y) { if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1; return this.d[y * this.w + x]; };
  PB.prototype.rect = function (x, y, w, h, c) { for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.px(x + i, y + j, c); };
  PB.prototype.hl = function (x0, x1, y, c) { for (var x = x0; x <= x1; x++) this.px(x, y, c); };
  PB.prototype.vl = function (x, y0, y1, c) { for (var y = y0; y <= y1; y++) this.px(x, y, c); };
  PB.prototype.ell = function (cx, cy, rx, ry, c) {
    for (var y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (var x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        var dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.px(x, y, c);
      }
    }
  };
  PB.prototype.line = function (x0, y0, x1, y1, c) {
    var dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy, n = 0;
    for (;;) {
      this.px(x0, y0, c);
      if ((x0 === x1 && y0 === y1) || ++n > 200) break;
      var e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  };
  PB.prototype.map = function (fn) { for (var i = 0; i < this.d.length; i++) if (this.d[i] >= 0) this.d[i] = fn(this.d[i], i % this.w, (i / this.w) | 0); };
  // 바깥 외곽선: 투명 칸 중 4방향 이웃이 불투명이면 그 이웃 색을 어둡게 한 색으로 칠한다(색 외곽선)
  PB.prototype.outline = function (dark, k, skipBottom) {
    var w = this.w, h = this.h, src = new Int32Array(this.d), d = this.d;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (src[i] >= 0) continue;
        var n = -1;
        if (y + 1 < h && src[i + w] >= 0 && !skipBottom) n = src[i + w];
        else if (y > 0 && src[i - w] >= 0) n = src[i - w];
        else if (x > 0 && src[i - 1] >= 0) n = src[i - 1];
        else if (x + 1 < w && src[i + 1] >= 0) n = src[i + 1];
        else if (skipBottom && y + 1 < h && src[i + w] >= 0) n = src[i + w];
        if (n >= 0) d[i] = mix(n, dark, k);
      }
    }
    return this;
  };
  PB.prototype.flipX = function () {
    var o = new PB(this.w, this.h);
    for (var y = 0; y < this.h; y++) for (var x = 0; x < this.w; x++) o.d[y * this.w + x] = this.d[y * this.w + (this.w - 1 - x)];
    return o;
  };
  PB.prototype.putTo = function (ctx, ox, oy) {
    var tmp = mk(this.w, this.h), tctx = tmp.getContext('2d');
    var img = tctx.createImageData(this.w, this.h), a = img.data;
    for (var i = 0; i < this.d.length; i++) {
      var c = this.d[i];
      if (c < 0) continue;
      a[i * 4] = c >> 16 & 255; a[i * 4 + 1] = c >> 8 & 255; a[i * 4 + 2] = c & 255; a[i * 4 + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    if (ctx) ctx.drawImage(tmp, ox || 0, oy || 0);
    return tmp;
  };
  PB.prototype.canvas = function () { return this.putTo(null); };

  /* ───────────── 테마 ─────────────
     ground: 바닥 종류, g: 바닥색, tall: 수풀색, tree: 나무 모양, amb: 주변 입자, grade: 색 보정 */
  var THEME_SRC = {
    town: { kind: 'grass', g: '#8ad46a', tall: '#2f9a44', water: '#4aa8ee', path: '#e9cf98', paved: '#dcd7cf', tree: 'round', leaf: '#48ac50', trunk: '#8a5a36',
      bush: '#4bb050', rock: '#aaa59c', wall: '#c9bdae', cliff: '#b98a5a', fence: '#f6f2ea', flowers: ['#ff5a72', '#ffd23c', '#ffffff', '#7ab8ff'],
      gym: '#e89a2a', walls: '#f7efe0', amb: 'petal', grade: 'rgba(255,236,190,0.05)', vig: 0.16, void: '#1c3a24' },
    forest: { kind: 'grass', g: '#62b452', tall: '#1f7a36', water: '#3f9ad8', path: '#d4b47c', paved: '#c9c4b6', tree: 'round', leaf: '#2f8c3e', trunk: '#6e4426',
      bush: '#3a9a40', rock: '#9a978c', wall: '#a8a08e', cliff: '#9c7448', fence: '#a8743e', flowers: ['#ffd23c', '#ff8ac0', '#ffffff'],
      gym: '#4caf50', walls: '#efe4cc', amb: 'leaf', grade: 'rgba(20,70,40,0.10)', vig: 0.30, void: '#0f2a16' },
    coast: { kind: 'sand', g: '#f2dea4', tall: '#6eaa3e', water: '#2ec0d8', path: '#dcbc80', paved: '#ece6d8', tree: 'palm', leaf: '#3fae4a', trunk: '#a8783e',
      bush: '#5ab650', rock: '#bfae94', wall: '#e2d6c0', cliff: '#c8a070', fence: '#b07a46', flowers: ['#ff7aa8', '#ffd23c', '#ffffff'],
      gym: '#2a8ad8', walls: '#fbf4e4', amb: 'sparkle', grade: 'rgba(255,230,170,0.06)', vig: 0.14, void: '#0e3a4a' },
    volcano: { kind: 'basalt', g: '#4e4248', tall: '#5c6a2a', tallTip: '#e8a040', water: '#3a78b8', path: '#7c5c4a', paved: '#6c6066', tree: 'dead', leaf: '#3a3030', trunk: '#3a2c2c',
      bush: '#6a4a2a', rock: '#5e5054', wall: '#5a4a4a', cliff: '#5a4446', fence: '#5a3a2a', flowers: ['#ff7a2a', '#ffd23c', '#ff4a3a'],
      gym: '#e8542c', walls: '#c8b8b0', amb: 'ember', grade: 'rgba(255,90,30,0.10)', vig: 0.34, void: '#1a0c0c' },
    glacier: { kind: 'snow', g: '#eef5fb', tall: '#4aa0a0', tallTip: '#d8fff8', water: '#58b4e8', path: '#c4d4e4', paved: '#d4dde8', tree: 'pine', leaf: '#2a7a6a', trunk: '#6a4a3a',
      bush: '#5a9a9a', rock: '#9fb4c8', wall: '#a8bccc', cliff: '#8aa4bc', fence: '#8a6a52', flowers: ['#8ad8ff', '#ffffff', '#b8a8ff'],
      gym: '#4cc3e8', walls: '#f4f8fc', amb: 'snow', grade: 'rgba(130,190,255,0.10)', vig: 0.22, void: '#1a2a3a', roofSnow: true },
    alley: { kind: 'cobble', g: '#8e8c98', tall: '#4a8a3a', water: '#4a7a9a', path: '#a8988a', paved: '#b6b2ac', tree: 'round', leaf: '#4a8e4a', trunk: '#5a4030',
      bush: '#4a8a48', rock: '#7a7884', wall: '#a85c4a', cliff: '#7a7078', fence: '#4a4a56', flowers: ['#ffd23c', '#ff5aa0', '#ffffff'],
      gym: '#9341c9', walls: '#e4d4c8', amb: 'dust', grade: 'rgba(70,30,120,0.12)', vig: 0.32, void: '#16121e' },
    temple: { kind: 'marble', g: '#ece4d4', tall: '#7a6ac8', tallTip: '#e0d4ff', water: '#6ac0e0', path: '#dccca8', paved: '#f6f0e4', tree: 'blossom', leaf: '#f2a6c8', trunk: '#6a4a4a',
      bush: '#c88ad0', rock: '#cbc3b2', wall: '#e2d8c6', cliff: '#c4b8a0', fence: '#b08a5a', flowers: ['#ffffff', '#c8a8ff', '#ffd23c'],
      gym: '#6a4ac0', walls: '#fbf6ec', amb: 'mote', grade: 'rgba(255,225,255,0.07)', vig: 0.20, void: '#2a2034' },
    summit: { kind: 'rocky', g: '#a0a0a8', tall: '#7a8a46', tallTip: '#d8d890', water: '#5a9ad0', path: '#b4a892', paved: '#bcbcc0', tree: 'pine', leaf: '#3a6a52', trunk: '#5a4a3e',
      bush: '#6a7a52', rock: '#7c7c86', wall: '#8e8e98', cliff: '#7a7a84', fence: '#7a5a42', flowers: ['#ffffff', '#ffe27a', '#b8c8ff'],
      gym: '#c8d0e0', walls: '#eef0f4', amb: 'wind', grade: 'rgba(170,190,225,0.10)', vig: 0.26, void: '#1e2026', roofSnow: true },
    ruins: { kind: 'earth', g: '#7c4034', tall: '#6a2a3a', tallTip: '#d0606a', water: '#4a5a7a', path: '#9a6c52', paved: '#8a7a74', tree: 'dead', leaf: '#4a2a2a', trunk: '#4a2a26',
      bush: '#5a2a30', rock: '#5e4a48', wall: '#6e5a56', cliff: '#5e3a34', fence: '#4a3028', flowers: ['#c02a3a', '#ff7a5a', '#e0c0a0'],
      gym: '#8a0f2a', walls: '#c8b4aa', amb: 'ash', grade: 'rgba(120,0,30,0.13)', vig: 0.40, void: '#1a0808' }
  };
  var _themes = {};
  function theme(name) {
    var key = THEME_SRC[name] ? name : 'town';
    if (_themes[key]) return _themes[key];
    var s = THEME_SRC[key], th = { name: key };
    Object.keys(s).forEach(function (k) { th[k] = s[k]; });
    ['g', 'tall', 'water', 'path', 'paved', 'leaf', 'trunk', 'bush', 'rock', 'wall', 'cliff', 'fence', 'gym', 'walls', 'void'].forEach(function (k) { th[k] = rgb(s[k], 0x808080); });
    th.flowers = s.flowers.map(function (c) { return rgb(c, 0xffffff); });
    th.gD = shade(th.g, -0.14); th.gL = shade(th.g, 0.2); th.gD2 = shade(th.g, -0.28);
    th.tallD = shade(th.tall, -0.42); th.tallL = s.tallTip ? rgb(s.tallTip) : shade(th.tall, 0.32); th.tallM = shade(th.tall, -0.16);
    th.tallB = mix(shade(th.tall, -0.25), th.g, 0.25);
    th.pathD = shade(th.path, -0.16); th.pathL = shade(th.path, 0.18);
    th.pavedD = shade(th.paved, -0.2); th.pavedL = shade(th.paved, 0.25);
    th.waterD = shade(th.water, -0.22); th.waterL = shade(th.water, 0.45); th.foam = mix(th.water, 0xffffff, 0.78);
    th.leafD = shade(th.leaf, -0.3); th.leafL = shade(th.leaf, 0.28);
    th.vigCss = 'radial-gradient(ellipse 80% 70% at 50% 46%, rgba(0,0,0,0) 58%, rgba(8,4,16,' + s.vig + ') 100%)';
    _themes[key] = th;
    return th;
  }
  var SAND = 0xf0dca2, SNOW = 0xeef5fb, ICE = 0xbfe6f6, LAVA = 0xf0602a;

  /* ───────────── 타일 그리기 도구(바닥층 ctx 직접) ───────────── */
  function F(ctx, x, y, w, h, c) { ctx.fillStyle = css(c); ctx.fillRect(x, y, w, h); }
  // 타일 안으로 잘라서 칠하기
  function FC(ctx, ox, oy, x, y, w, h, c) {
    var x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(16, x + w), y1 = Math.min(16, y + h);
    if (x1 > x0 && y1 > y0) F(ctx, ox + x0, oy + y0, x1 - x0, y1 - y0, c);
  }

  // 바닥 종류별 무늬
  function drawGround(ctx, ox, oy, th, kind, tx, ty) {
    var r = rng(hash(tx, ty, 11)), i, n, x, y, c;
    switch (kind) {
      case 'sand': {
        var sd = shade(SAND, -0.1), sl = shade(SAND, 0.35);
        F(ctx, ox, oy, 16, 16, SAND);
        for (i = 0; i < 6; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, sd);
        for (i = 0; i < 3; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, sl);
        if (r() < 0.22) { x = ri(r, 10); y = 2 + ri(r, 12); F(ctx, ox + x, oy + y, 5, 1, sl); F(ctx, ox + x + 1, oy + y + 1, 3, 1, sd); }
        if (r() < 0.06) { x = 2 + ri(r, 11); y = 2 + ri(r, 11); F(ctx, ox + x, oy + y, 2, 1, 0xffb8c8); F(ctx, ox + x, oy + y + 1, 2, 1, 0xe08aa0); }
        break;
      }
      case 'snow': {
        var nd = 0xd2e2f2, nl = 0xffffff;
        F(ctx, ox, oy, 16, 16, SNOW);
        for (i = 0; i < 3; i++) { x = ri(r, 14); y = ri(r, 15); F(ctx, ox + x, oy + y, 2, 1, nd); }
        for (i = 0; i < 2; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, nl);
        if (r() < 0.25) { x = ri(r, 9); y = 3 + ri(r, 11); F(ctx, ox + x + 1, oy + y, 5, 1, nd); F(ctx, ox + x, oy + y + 1, 1, 1, nd); F(ctx, ox + x + 6, oy + y + 1, 1, 1, nd); }
        break;
      }
      case 'basalt': {
        var b = th.g, bd = shade(b, -0.3), bl = shade(b, 0.14);
        F(ctx, ox, oy, 16, 16, b);
        n = 1 + ri(r, 2);
        for (i = 0; i < n; i++) {
          x = ri(r, 12); y = ri(r, 12);
          var len = 3 + ri(r, 4);
          for (var k = 0; k < len; k++) { F(ctx, ox + clamp(x + k, 0, 15), oy + clamp(y + ((k + i) % 3 === 0 ? 1 : 0) + (k >> 1), 0, 15), 1, 1, bd); }
        }
        for (i = 0; i < 4; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, bl);
        if (r() < 0.14) { x = 2 + ri(r, 11); y = 2 + ri(r, 11); F(ctx, ox + x, oy + y, 2, 1, 0xd0401a); F(ctx, ox + x + 1, oy + y + 1, 2, 1, 0xff8a2a); }
        break;
      }
      case 'cobble': {
        var cb = th.g, grout = shade(cb, -0.32);
        F(ctx, ox, oy, 16, 16, grout);
        for (var hrow = 0; hrow < 2; hrow++) {
          var off = ((ty * 2 + hrow) & 1) * 4;
          for (var kx = -1; kx < 3; kx++) {
            var sx = kx * 8 + off, sy = hrow * 8;
            var v = (hash(tx * 4 + kx, ty * 2 + hrow, 3) % 5) - 2;
            c = shade(cb, v * 0.035);
            FC(ctx, ox, oy, sx, sy, 7, 7, c);
            FC(ctx, ox, oy, sx, sy, 6, 1, shade(c, 0.2));
            FC(ctx, ox, oy, sx, sy + 1, 1, 5, shade(c, 0.12));
            FC(ctx, ox, oy, sx + 1, sy + 6, 6, 1, shade(c, -0.18));
            FC(ctx, ox, oy, sx + 6, sy + 1, 1, 5, shade(c, -0.12));
          }
        }
        if (r() < 0.15) { F(ctx, ox + ri(r, 14), oy + 6 + 8 * ri(r, 2), 2, 1, 0x5a8a3a); }
        break;
      }
      case 'marble': {
        var m = th.g, md = shade(m, -0.1), ml = shade(m, 0.4);
        F(ctx, ox, oy, 16, 16, m);
        F(ctx, ox, oy + 15, 16, 1, md); F(ctx, ox + 15, oy, 1, 16, md);
        F(ctx, ox, oy, 15, 1, ml); F(ctx, ox, oy, 1, 15, ml);
        if ((tx + ty) % 2 === 0) { F(ctx, ox + 7, oy + 7, 2, 2, shade(m, -0.06)); }
        if (r() < 0.35) { x = 2 + ri(r, 8); y = 2 + ri(r, 8); for (i = 0; i < 4; i++) F(ctx, ox + x + i, oy + y + (i >> 1), 1, 1, shade(m, -0.05)); }
        break;
      }
      case 'rocky': {
        var rk = th.g, rd = shade(rk, -0.22), rl = shade(rk, 0.2);
        F(ctx, ox, oy, 16, 16, rk);
        n = 2 + ri(r, 2);
        for (i = 0; i < n; i++) { x = ri(r, 14); y = ri(r, 14); F(ctx, ox + x, oy + y, 2, 1, rl); F(ctx, ox + x, oy + y + 1, 2, 1, rd); }
        if (r() < 0.4) { x = ri(r, 10); y = ri(r, 14); F(ctx, ox + x, oy + y, 3, 1, rd); F(ctx, ox + x + 3, oy + y + 1, 2, 1, rd); }
        if (r() < 0.25) { x = 1 + ri(r, 12); y = 3 + ri(r, 11); F(ctx, ox + x, oy + y, 1, 2, 0x8a8a4a); F(ctx, ox + x + 2, oy + y, 1, 2, 0x8a8a4a); F(ctx, ox + x + 1, oy + y + 1, 1, 1, 0xa8a860); }
        break;
      }
      case 'earth': {
        var e = th.g, ed = shade(e, -0.24), el = shade(e, 0.16);
        F(ctx, ox, oy, 16, 16, e);
        for (i = 0; i < 5; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, ed);
        for (i = 0; i < 2; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, el);
        if (r() < 0.35) { x = ri(r, 11); y = ri(r, 13); F(ctx, ox + x, oy + y, 3, 1, ed); F(ctx, ox + x + 2, oy + y + 1, 3, 1, ed); }
        if (r() < 0.2) { x = 1 + ri(r, 13); y = 1 + ri(r, 13); F(ctx, ox + x, oy + y, 2, 1, el); F(ctx, ox + x, oy + y + 1, 2, 1, ed); }
        break;
      }
      default: { // grass
        F(ctx, ox, oy, 16, 16, th.g);
        n = 1 + ri(r, 3);
        for (i = 0; i < n; i++) {
          x = 1 + ri(r, 12); y = 1 + ri(r, 13);
          F(ctx, ox + x, oy + y, 1, 2, th.gD); F(ctx, ox + x + 2, oy + y, 1, 2, th.gD); F(ctx, ox + x + 1, oy + y + 1, 1, 1, th.gD);
        }
        for (i = 0; i < 2; i++) F(ctx, ox + ri(r, 16), oy + ri(r, 16), 1, 1, th.gL);
        if (r() < 0.07) { x = 2 + ri(r, 12); y = 2 + ri(r, 12); F(ctx, ox + x, oy + y, 1, 1, r() < 0.5 ? 0xffffff : 0xffe066); }
      }
    }
  }

  /* ───────────── 수풀(조우 풀) 타일 ─────────────
     풀포기 묶음을 픽셀 버퍼에 그리고 진한 외곽선을 둘러 '들어가면 뭔가 나오는' 풀로 보이게 한다.
     front 판은 아래쪽 풀포기만 담아 그 칸에 선 캐릭터의 하반신을 덮는다. */
  var GRASS_FRAMES = 4; // 0 기본, 1·2 흔들림, 3 밟힘
  function grassPB(th, frame) {
    var g = new PB(16, 16);
    var lean = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    var squash = frame === 3;
    function clump(cx, base, hgt) {
      var hs = squash ? [2, 3, 3, 2] : [hgt - 2, hgt, hgt, hgt - 2];
      var xs = [-3, -1, 1, 3];
      var spread = squash ? 1 : 0;
      for (var b = 0; b < 4; b++) {
        var bx = cx + xs[b], hh = hs[b];
        var tipLean = (b === 0 ? -1 - spread : b === 3 ? 1 + spread : 0) + lean;
        for (var k = 0; k < hh; k++) {
          var f = k / Math.max(1, hh - 1);
          var x = Math.round(bx + tipLean * f);
          var y = base - k;
          var col = k >= hh - 2 ? th.tallL : (k < 2 ? th.tallM : th.tall);
          g.px(x, y, col);
          if (k < hh - 2) g.px(x + 1, y, k < 2 ? th.tallM : th.tall);
        }
      }
    }
    // 위 줄(밑동 y=7), 아래 줄(밑동 y=15) — 아래 줄은 타일 경계에 걸쳐 이웃 칸과 이어진다
    clump(4, 7, 6); clump(12, 7, 6);
    clump(0, 15, 7); clump(8, 15, 7); clump(16, 15, 7);
    g.outline(th.tallD, 0.55);
    return g;
  }
  function grassTiles(th) {
    if (th._grass) return th._grass;
    var full = [], front = [];
    for (var f = 0; f < GRASS_FRAMES; f++) {
      var pb = grassPB(th, f);
      var c = mk(16, 16), x = ctx2d(c);
      F(x, 0, 0, 16, 16, th.tallB);
      F(x, 0, 13, 16, 3, th.tallD);
      F(x, 0, 6, 16, 2, mix(th.tallB, th.tallD, 0.5));
      pb.putTo(x, 0, 0);
      full.push(c);
      // 앞판: 아래쪽 8줄만(+ 바닥 3줄은 꽉 채운다)
      var fr = new PB(16, 16);
      for (var y = 8; y < 16; y++) for (var xx = 0; xx < 16; xx++) fr.d[y * 16 + xx] = pb.d[y * 16 + xx];
      var c2 = mk(16, 16), x2 = ctx2d(c2);
      F(x2, 0, 13, 16, 3, th.tallD);
      fr.putTo(x2, 0, 0);
      front.push(c2);
    }
    th._grass = { full: full, front: front };
    return th._grass;
  }

  /* 꽃밭 타일(2프레임) */
  function flowerTiles(th) {
    if (th._flowers) return th._flowers;
    var out = [];
    for (var v = 0; v < 3; v++) {
      var frames = [];
      for (var f = 0; f < 2; f++) {
        var c = mk(16, 16), x = ctx2d(c), r = rng(hash(v, 3, 77));
        drawGround(x, 0, 0, th, th.kind, v * 7 + 1, 5);
        var spots = [[3, 3], [10, 2], [6, 8], [13, 9], [2, 12], [9, 13]];
        for (var i = 0; i < spots.length; i++) {
          if (i >= 4 + (v % 3)) break;
          var px = spots[i][0] + ((v * 3 + i) % 2), py = spots[i][1];
          var sway = (f === 1 && i % 2 === 0) ? 1 : 0;
          var col = th.flowers[(i + v) % th.flowers.length];
          var cd = shade(col, -0.3);
          // 잎
          F(x, px - 1, py + 2, 1, 1, th.name === 'glacier' ? 0x4a9a8a : 0x3f9a3a);
          F(x, px + 2, py + 2, 1, 1, th.name === 'glacier' ? 0x4a9a8a : 0x3f9a3a);
          F(x, px, py + 3, 1, 1, 0x2f7a2e);
          // 꽃잎(+모양)
          var qx = px + sway;
          F(x, qx, py, 2, 2, cd);
          F(x, qx - 1, py, 1, 1, col); F(x, qx + 2, py + 1, 1, 1, col);
          F(x, qx + 1, py - 1, 1, 1, col); F(x, qx, py + 2, 1, 1, col);
          F(x, qx, py, 1, 1, col);
          F(x, qx + 1, py + 1, 1, 1, col === 0xffd23c ? 0xff8a2a : 0xffe066);
        }
        frames.push(c);
      }
      out.push(frames);
    }
    th._flowers = out;
    return out;
  }

  /* ───────────── 나무·덤불·바위·표지판 스프라이트 ───────────── */
  function treePB(th, v) {
    var g = new PB(16, 24), r = rng(hash(v, 9, th.name.length * 31)), x, y;
    var trunk = th.trunk, tD = shade(trunk, -0.3), tL = shade(trunk, 0.2);
    var L = th.leaf, LD = th.leafD, LL = th.leafL;
    var kind = th.tree;
    if (kind === 'pine') {
      g.rect(7, 18, 2, 4, trunk); g.px(8, 18, tD); g.px(8, 19, tD);
      var tiers = [[0, 6, 3], [4, 12, 5], [9, 18, 7]]; // [top, bottom, halfwidth]
      for (var t = 0; t < tiers.length; t++) {
        var top = tiers[t][0] + 1, bot = tiers[t][1], hw = tiers[t][2] - (v === 1 && t === 0 ? 1 : 0);
        for (y = top; y <= bot; y++) {
          var w = Math.round(hw * (y - top + 1) / (bot - top + 1));
          for (x = 8 - w; x <= 7 + w; x++) {
            var c = x >= 8 ? LD : L;
            if (x < 8 && (x + y) % 3 === 0 && y > top + 1) c = LL;
            g.px(x, y, c);
          }
        }
        if (th.roofSnow) {
          for (y = top; y <= Math.min(bot, top + 2); y++) {
            var w2 = Math.round(hw * (y - top + 1) / (bot - top + 1));
            for (x = 8 - w2; x <= 7 + w2; x++) if (y === top || x < 8) g.px(x, y, y === top ? 0xffffff : 0xe4f0fa);
          }
          g.px(8 - hw, bot, 0xffffff); g.px(7 + hw, bot, 0xe4f0fa);
        }
      }
    } else if (kind === 'palm') {
      // 휘어진 줄기 + 부채꼴 잎
      var pts = [[9, 22], [9, 21], [9, 20], [8, 19], [8, 18], [8, 17], [8, 16], [7, 15], [7, 14], [7, 13], [7, 12], [7, 11], [6, 10], [6, 9], [6, 8], [6, 7]];
      for (var p = 0; p < pts.length; p++) { g.px(pts[p][0], pts[p][1], p % 3 === 0 ? tD : trunk); g.px(pts[p][0] + 1, pts[p][1], p % 3 === 0 ? tD : tL); }
      var fronds = [[-6, 3], [-5, -1], [-2, -4], [3, -4], [6, -1], [7, 3]];
      for (var fi = 0; fi < fronds.length; fi++) {
        var ex = 6 + fronds[fi][0], ey = 5 + fronds[fi][1];
        g.line(6, 5, ex, ey, fi % 2 ? LD : L);
        g.line(6, 6, ex, ey + 1, fi % 2 ? L : LD);
        g.px(ex, ey + 2, LD);
      }
      g.rect(5, 4, 3, 2, LL);
      g.px(5, 7, 0x7a4a22); g.px(7, 7, 0x6a3a1a); g.px(6, 8, 0x7a4a22);
    } else if (kind === 'dead') {
      var bark = th.name === 'ruins' ? 0x5a3a34 : 0x4a3e40, bD = shade(bark, -0.3), bL = shade(bark, 0.22);
      g.rect(7, 9, 2, 13, bark); g.vl(7, 9, 21, bL);
      g.px(6, 21, bark); g.px(9, 21, bark); g.px(5, 22, bD); g.px(10, 22, bD);
      g.line(7, 13, 3, 8, bark); g.line(3, 8, 2, 5, bark); g.line(4, 9, 4, 4, bL);
      g.line(8, 11, 12, 6, bark); g.line(12, 6, 13, 3, bark); g.line(11, 7, 9, 3, bL);
      g.line(7, 9, 6, 2, bark); g.line(8, 9, 9, 1, bD);
      if (v === 1) { g.line(8, 16, 12, 13, bark); g.px(13, 12, bark); }
      if (th.name === 'volcano') { g.px(7, 15, 0xff7a2a); g.px(8, 18, 0xd0401a); }
    } else { // round / blossom
      var blossom = kind === 'blossom';
      g.rect(6, 15, 4, 7, trunk); g.vl(6, 15, 21, tL); g.vl(9, 15, 21, tD);
      g.px(5, 21, trunk); g.px(10, 21, tD); g.hl(5, 10, 22, tD);
      // 수관: 큰 원 + 위쪽 봉우리
      var cx = 7.5 + (v === 2 ? 0.5 : 0);
      g.ell(cx, 10, 7, 6.5, L);
      g.ell(cx - 2.5, 5.5, 4.2, 4.5, L);
      g.ell(cx + 2.5, 5, 4.2, 4.5, L);
      if (v === 1) g.ell(cx, 3.5, 3.5, 3, L);
      // 음영: 오른쪽 아래 어둡게, 왼쪽 위 밝게
      g.map(function (c, px, py) {
        if (c !== L) return c;
        var d = (px - 4) + (py - 3) * 1.1;
        if (py > 13 || px + py > 22) return LD;
        if (d < 3 && (px + py) % 2 === 0) return LL;
        if (d < 1) return LL;
        return L;
      });
      // 잎 덩어리 무늬(작은 호)
      for (var i = 0; i < 5; i++) {
        x = 3 + ri(r, 10); y = 4 + ri(r, 9);
        if (g.get(x, y) < 0 || g.get(x + 2, y + 1) < 0) continue;
        g.px(x, y + 1, LD); g.px(x + 1, y + 1, LD); g.px(x + 2, y, LD);
      }
      if (blossom) {
        for (i = 0; i < 10; i++) { x = 2 + ri(r, 12); y = 2 + ri(r, 12); if (g.get(x, y) >= 0 && y < 15) g.px(x, y, r() < 0.5 ? 0xffffff : 0xffd8ea); }
      } else if (th.name === 'town' && v === 0) {
        g.px(4, 9, 0xff4a4a); g.px(10, 7, 0xff4a4a); g.px(8, 12, 0xff4a4a);
      }
      if (th.roofSnow) { g.map(function (c, px, py) { return (py < 5 && c !== LD) ? (py < 3 ? 0xffffff : 0xe4f0fa) : c; }); }
    }
    g.outline(OUTLINE, 0.6);
    return g;
  }
  function bushPB(th, v) {
    var g = new PB(16, 16), r = rng(hash(v, 4, 5)), B = th.bush, BD = shade(B, -0.3), BL = shade(B, 0.28);
    g.ell(7.5, 10, 7, 5.5, B);
    g.ell(5, 6.5, 3.6, 3.2, B); g.ell(10.5, 6.5, 3.6, 3.2, B);
    g.map(function (c, x, y) { return y > 12 || x + y > 21 ? BD : (x + y < 11 ? BL : c); });
    for (var i = 0; i < 3; i++) { var x = 3 + ri(r, 9), y = 6 + ri(r, 6); if (g.get(x, y) >= 0) { g.px(x, y, BD); g.px(x + 1, y - 1, BD); } }
    if (th.name === 'town' || th.name === 'forest') { if (v === 1) { g.px(4, 9, 0xff4a5a); g.px(10, 11, 0xff4a5a); g.px(8, 7, 0xffffff); } }
    if (th.roofSnow) g.map(function (c, x, y) { return y < 6 ? 0xffffff : c; });
    g.outline(OUTLINE, 0.6);
    return g;
  }
  function rockPB(th, v) {
    var g = new PB(16, 16), R = th.rock, RD = shade(R, -0.3), RL = shade(R, 0.3);
    g.ell(8, 10.5, 6.8, 5, R);
    g.ell(6.5, 7, 4.5, 3.6, R);
    if (v === 1) g.ell(11, 8, 3.2, 3, R);
    g.map(function (c, x, y) { return (y > 12 || x > 11 && y > 9) ? RD : (x + y < 11 ? RL : c); });
    g.line(7, 9, 9, 11, RD); g.px(10, 11, RD); g.px(5, 7, 0xffffff);
    if (th.roofSnow) g.map(function (c, x, y) { return y < 7 ? 0xffffff : c; });
    if (th.name === 'temple') { g.px(8, 12, 0xb8a0e8); g.px(9, 12, 0xd8c8ff); }
    g.outline(OUTLINE, 0.62);
    return g;
  }
  function signPB() {
    var g = new PB(16, 16), W = 0xc89050, WD = 0x8a5a2e, WL = 0xe8b878;
    g.rect(7, 11, 2, 4, WD); g.px(7, 11, 0x6a4020);
    g.rect(2, 3, 12, 8, W);
    g.hl(2, 13, 3, WL); g.hl(2, 13, 10, WD); g.vl(13, 3, 10, WD);
    g.hl(4, 11, 5, WD); g.hl(4, 9, 7, WD);
    g.px(3, 4, 0x6a4020); g.px(12, 4, 0x6a4020);
    g.outline(OUTLINE, 0.65);
    return g;
  }
  function fencePB(th, mask) { // mask: 1 위, 2 오른쪽, 4 아래, 8 왼쪽
    var g = new PB(16, 16), W = th.fence, WD = shade(W, -0.28), WL = shade(W, 0.25);
    var picket = lum(W) > 0.7;
    if (mask & 10 || !(mask & 5)) { // 가로
      var x0 = (mask & 8) ? 0 : 5, x1 = (mask & 2) ? 15 : 10;
      g.hl(x0, x1, 6, W); g.hl(x0, x1, 7, WD); g.hl(x0, x1, 11, W); g.hl(x0, x1, 12, WD);
    }
    if (mask & 5) { // 세로
      var y0 = (mask & 1) ? 0 : 5, y1 = (mask & 4) ? 15 : 13;
      g.rect(7, y0, 2, y1 - y0 + 1, W); g.vl(8, y0, y1, WD);
    }
    // 기둥
    g.rect(6, picket ? 2 : 3, 4, picket ? 12 : 11, W);
    g.vl(9, 3, 13, WD); g.vl(6, 3, 12, WL);
    if (picket) { g.clr(6, 2); g.clr(9, 2); g.hl(7, 8, 1, W); }
    else g.hl(6, 9, 3, WL);
    g.outline(OUTLINE, 0.55);
    return g;
  }

  /* ───────────── 건물 ───────────── */
  var BLD_DEF = { center: { w: 4, h: 3 }, shop: { w: 4, h: 3 }, gym: { w: 5, h: 4 }, lab: { w: 5, h: 3 }, house: { w: 3, h: 3 } };
  function bdef(kind) {
    var P = root.PMaps, B = P && P.BUILDINGS && P.BUILDINGS[kind];
    return B ? { w: B.w | 0, h: B.h | 0 } : (BLD_DEF[kind] || BLD_DEF.house);
  }
  function doorTile(b) {
    var P = root.PMaps;
    try { if (P && typeof P.doorOf === 'function' && P.BUILDINGS && P.BUILDINGS[b.kind]) return P.doorOf(b); } catch (e) { /* 아래 규칙으로 */ }
    var B = bdef(b.kind);
    return { x: b.x + Math.floor(B.w / 2), y: b.y + B.h - 1 };
  }
  function windowAt(g, cx, y, w, h, frame, glass) {
    var x = cx - (w >> 1);
    g.rect(x - 1, y - 1, w + 2, h + 2, frame);
    g.rect(x, y, w, h, glass);
    var gl = shade(glass, 0.5);
    g.px(x, y, gl); g.px(x + 1, y, gl); g.px(x, y + 1, gl); g.px(x + w - 2, y + h - 2, shade(glass, 0.25));
    g.hl(x, x + w - 1, y + h - 1, shade(glass, -0.2));
    if (w >= 8) g.vl(x + (w >> 1), y, y + h - 1, frame);
    g.hl(x - 1, x + w, y + h + 1, shade(frame, -0.25));
  }
  function glassDoor(g, cx, bottom, w, h, frame) {
    var x = cx - (w >> 1), y = bottom - h + 1;
    g.rect(x - 1, y - 1, w + 2, h + 1, frame);
    g.rect(x, y, w, h, 0x9ad4ee);
    g.vl(cx, y, bottom, frame);
    g.px(x + 1, y + 1, 0xe8f8ff); g.px(x + 1, y + 2, 0xe8f8ff); g.px(cx + 2, y + 1, 0xe8f8ff);
    g.hl(x, x + w - 1, bottom, shade(frame, -0.2));
    g.rect(x, y + h - 4, w, 1, shade(0x9ad4ee, -0.15));
  }
  function woodDoor(g, cx, bottom, w, h, wood) {
    var x = cx - (w >> 1), y = bottom - h + 1, wd = shade(wood, -0.28), wl = shade(wood, 0.2);
    g.rect(x - 1, y - 1, w + 2, h + 1, wd);
    g.rect(x, y, w, h, wood);
    g.rect(x + 1, y + 1, w - 2, 4, wl); g.rect(x + 1, y + 7, w - 2, 4, wl);
    g.rect(x + 2, y + 2, w - 4, 2, wood); g.rect(x + 2, y + 8, w - 4, 2, wood);
    g.px(x + w - 2, y + (h >> 1) + 1, 0xffd34d);
  }
  function roofShingles(g, x0, x1, y0, y1, c, step, seed) {
    var cD = shade(c, -0.22), cL = shade(c, 0.18);
    for (var y = y0; y <= y1; y++) g.hl(x0, x1, y, c);
    for (y = y0 + step - 1; y <= y1; y += step) {
      g.hl(x0, x1, y, cD);
      var off = ((y / step) | 0) % 2 ? 0 : (step >> 1) + 1;
      for (var x = x0 + off; x <= x1; x += step * 2) g.vl(x, y - step + 1, y - 1, cD);
      g.hl(x0, x1, y - step + 1, cL);
    }
  }
  function snowRoof(g, x0, x1, y0, seed) {
    var r = rng(seed);
    g.hl(x0, x1, y0, 0xffffff); g.hl(x0, x1, y0 + 1, 0xffffff); g.hl(x0, x1, y0 + 2, 0xe4f0fa);
    for (var x = x0; x <= x1; x++) if (r() < 0.3) { g.px(x, y0 + 3, 0xe4f0fa); if (r() < 0.4) g.px(x, y0 + 4, 0xe4f0fa); }
  }
  function wallTint(th, c) {
    if (th.name === 'ruins') return mix(c, 0x8a6a60, 0.4);
    if (th.name === 'volcano') return mix(c, 0x6a5a58, 0.35);
    if (th.name === 'alley') return mix(c, 0xb08070, 0.2);
    return c;
  }
  var HOUSE_ROOFS = [0xd8583a, 0x3a78c0, 0x4a9a5a, 0x8a5ac0, 0xc8843a, 0xb0404a];

  function buildingPB(b, th) {
    var B = bdef(b.kind), W = B.w * 16, H = B.h * 16, Y = OVER;
    var g = new PB(W, H + OVER);
    var door = doorTile(b), dcx = (door.x - b.x) * 16 + 8, bottom = H + OVER - 1;
    var dcol = door.x - b.x;
    var seed = hash(b.x, b.y, 404);
    var kind = BLD_DEF[b.kind] ? b.kind : 'house';
    var i, rb;
    var wall = wallTint(th, th.walls), wallS = shade(wall, -0.14), wallD = shade(wall, -0.3);
    var frame = 0xf8f8f8, glass = 0x6ab8e8;
    if (kind === 'center' || kind === 'shop') {
      var roof = kind === 'center' ? 0xe2474f : 0x3f7ee0, roofD = shade(roof, -0.4);
      rb = Y + 16;
      roofShingles(g, 1, W - 2, 2, rb - 2, roof, 4, seed);
      g.hl(3, W - 4, 1, shade(roof, 0.3)); g.hl(1, W - 2, 2, shade(roof, 0.3));
      g.hl(0, W - 1, rb - 1, shade(roof, -0.15)); g.hl(0, W - 1, rb, roofD);
      if (th.roofSnow) snowRoof(g, 1, W - 2, 1, seed);
      g.rect(2, rb + 1, W - 4, bottom - rb, wall);
      g.hl(2, W - 3, rb + 1, wallD); g.hl(2, W - 3, rb + 2, wallS);
      g.rect(2, bottom - 3, W - 4, 4, kind === 'center' ? shade(roof, -0.1) : 0x5a6a8a);
      g.hl(2, W - 3, bottom - 4, kind === 'center' ? 0xffffff : 0xd8e0f0);
      for (i = 0; i < B.w; i++) {
        if (i === dcol) continue;
        windowAt(g, i * 16 + 8, rb + 6, 10, 8, frame, glass);
        if (kind === 'shop') { // 줄무늬 차양
          for (var ax = i * 16 + 1; ax <= i * 16 + 14; ax++) { var st = ((ax >> 1) % 2) ? 0xffffff : roof; g.px(ax, rb + 3, st); g.px(ax, rb + 4, st); g.px(ax, rb + 5, (ax % 2) ? shade(st, -0.2) : -1); }
        }
      }
      glassDoor(g, dcx, bottom, 12, 14, 0x5a5a66);
      g.rect(dcx - 8, bottom - 16, 16, 2, kind === 'center' ? roof : 0xffffff);
      // 지붕 앞 표지
      var ex = dcx, ey = Math.round((2 + rb) / 2) + 1;
      if (kind === 'center') {
        g.ell(ex, ey, 7.5, 6.5, 0xffffff);
        g.ell(ex, ey, 5.6, 4.8, roof);
        // 발바닥 문양
        g.rect(ex - 2, ey, 4, 3, 0xffffff); g.hl(ex - 1, ex, ey + 3, 0xffffff);
        g.px(ex - 3, ey - 2, 0xffffff); g.px(ex - 1, ey - 3, 0xffffff); g.px(ex, ey - 3, 0xffffff); g.px(ex + 2, ey - 2, 0xffffff);
      } else {
        g.rect(ex - 10, ey - 4, 20, 9, 0x2a4a9a);
        g.rect(ex - 9, ey - 3, 18, 7, 0xffffff);
        // 가방 아이콘 + 줄
        g.rect(ex - 7, ey - 1, 5, 4, roof); g.px(ex - 6, ey - 2, roofD); g.px(ex - 4, ey - 2, roofD); g.px(ex - 5, ey - 3, roofD);
        g.hl(ex - 1, ex + 7, ey - 1, 0x2a4a9a); g.hl(ex - 1, ex + 5, ey + 1, 0x2a4a9a); g.hl(ex - 1, ex + 6, ey + 3, 0x8aa0d0);
      }
    } else if (kind === 'gym') {
      var gr = th.gym, grD = shade(gr, -0.4), gold = 0xffd34d, goldD = 0xc08a1a;
      rb = Y + 22;
      roofShingles(g, 1, W - 2, 3, rb - 2, gr, 5, seed);
      g.hl(2, W - 3, 2, shade(gr, 0.35)); g.hl(4, W - 5, 1, shade(gr, 0.35));
      g.hl(0, W - 1, rb - 1, shade(gr, -0.2)); g.hl(0, W - 1, rb, grD);
      g.hl(1, W - 2, rb - 3, gold);
      if (th.roofSnow) snowRoof(g, 1, W - 2, 1, seed);
      // 깃발
      g.vl(5, 1, 10, 0x5a5a66); g.rect(6, 1, 4, 3, gold); g.clr(9, 3);
      g.vl(W - 6, 1, 10, 0x5a5a66); g.rect(W - 10, 1, 4, 3, gold); g.clr(W - 10, 3);
      // 벽(석재)
      var stone = wallTint(th, 0xe6dccb), stoneD = shade(stone, -0.18);
      g.rect(2, rb + 1, W - 4, bottom - rb, stone);
      for (var sy = rb + 4; sy < bottom - 2; sy += 5) { g.hl(2, W - 3, sy, stoneD); for (var sx = 2 + ((sy / 5) % 2 ? 0 : 5); sx < W - 2; sx += 10) g.vl(sx, sy - 4, sy - 1, stoneD); }
      g.hl(2, W - 3, rb + 1, shade(stone, -0.35)); g.hl(2, W - 3, rb + 2, stoneD);
      g.rect(2, bottom - 2, W - 4, 3, shade(stone, -0.3));
      // 기둥
      [dcx - 13, dcx + 10].forEach(function (px) {
        g.rect(px, rb + 2, 4, bottom - rb - 2, 0xfaf6ee); g.vl(px + 3, rb + 2, bottom, 0xcfc6b6); g.vl(px, rb + 2, bottom, 0xffffff);
        g.hl(px - 1, px + 4, rb + 2, 0xd8cfbf); g.hl(px - 1, px + 4, bottom, 0xbfb6a6);
      });
      // 작은 창
      for (i = 0; i < B.w; i++) { if (Math.abs(i - dcol) <= 0) continue; if (i === dcol - 1 || i === dcol + 1) continue; windowAt(g, i * 16 + 8, rb + 7, 8, 6, 0xf0ece4, glass); }
      // 큰 문
      var dw = 16, dh = 19, dx0 = dcx - 8, dy0 = bottom - dh + 1;
      g.rect(dx0 - 1, dy0 - 2, dw + 2, dh + 2, 0x4a3a3a);
      g.rect(dx0, dy0, dw, dh, shade(gr, -0.3)); g.vl(dcx, dy0, bottom, 0x2a2026);
      g.rect(dx0 + 2, dy0 + 2, 5, 6, shade(gr, -0.1)); g.rect(dx0 + 9, dy0 + 2, 5, 6, shade(gr, -0.1));
      g.px(dcx - 2, dy0 + 11, gold); g.px(dcx + 1, dy0 + 11, gold);
      // 배지 문장
      var bx = dcx, by = Math.round((3 + rb) / 2) - 1;
      for (var k = 0; k <= 8; k++) { var hw = k <= 4 ? k : 8 - k; g.hl(bx - hw - 1, bx + hw, by - 4 + k, goldD); }
      for (k = 1; k <= 7; k++) { var hw2 = k <= 4 ? k - 1 : 7 - k; g.hl(bx - hw2 - 1 + (k <= 4 ? 0 : 0), bx + hw2, by - 4 + k, gold); }
      g.rect(bx - 1, by - 1, 2, 2, gr); g.px(bx - 1, by - 1, shade(gr, 0.5));
      g.px(bx - 2, by - 3, 0xffffff);
    } else if (kind === 'lab') {
      var rf = 0xc4ccd6, rfD = shade(rf, -0.25);
      rb = Y + 12;
      g.rect(1, 2, W - 2, rb - 2, rf);
      g.hl(1, W - 2, 2, shade(rf, 0.35)); g.hl(0, W - 1, rb - 1, rfD); g.hl(0, W - 1, rb, shade(rf, -0.45));
      // 태양광 판
      for (i = 0; i < 3; i++) {
        var px0 = 5 + i * 15;
        g.rect(px0, 4, 12, 7, 0x2a4a8a);
        g.vl(px0 + 4, 4, 10, 0x5a7ac8); g.vl(px0 + 8, 4, 10, 0x5a7ac8); g.hl(px0, px0 + 11, 7, 0x5a7ac8);
        g.px(px0, 4, 0x9ab8f0); g.hl(px0, px0 + 11, 11, 0x8a929e);
      }
      // 안테나 접시
      g.vl(W - 10, 3, 11, 0x8a929e); g.ell(W - 8, 5, 4, 3, 0xffffff); g.ell(W - 8, 5, 2, 1.5, 0xd8dee6); g.px(W - 8, 5, 0xe84a5a);
      if (th.roofSnow) snowRoof(g, 1, W - 2, 1, seed);
      var lw = wallTint(th, 0xf3f5f7);
      g.rect(2, rb + 1, W - 4, bottom - rb, lw);
      g.hl(2, W - 3, rb + 1, shade(lw, -0.3));
      g.rect(2, rb + 3, W - 4, 2, 0x3ab0a0);
      g.rect(2, bottom - 2, W - 4, 3, 0x8a929e);
      // 띠 창
      for (i = 0; i < B.w; i++) {
        if (i === dcol) continue;
        var wx = i * 16 + 2, wy = rb + 8;
        g.rect(wx - 1, wy - 1, 14, 11, 0x6a7280);
        g.rect(wx, wy, 12, 9, 0x8acff0);
        g.vl(wx + 6, wy, wy + 8, 0xd8e8f4);
        g.px(wx + 1, wy + 1, 0xffffff); g.px(wx + 2, wy + 1, 0xffffff); g.px(wx + 1, wy + 2, 0xffffff); g.px(wx + 8, wy + 1, 0xffffff);
        g.hl(wx, wx + 11, wy + 8, 0x5aa0d0);
      }
      glassDoor(g, dcx, bottom, 12, 15, 0x6a7280);
      g.rect(dcx - 6, bottom - 18, 12, 2, 0x3ab0a0);
    } else { // house
      var hr = HOUSE_ROOFS[seed % HOUSE_ROOFS.length];
      if (th.name === 'ruins' || th.name === 'volcano') hr = mix(hr, 0x3a2a2a, 0.45);
      rb = Y + 18;
      // 박공 지붕: 위쪽 몇 줄은 좁게
      roofShingles(g, 1, W - 2, 3, rb - 2, hr, 4, seed);
      for (var ry = 3; ry < 7; ry++) { var ind = 6 - ry; for (var q = 1; q <= ind; q++) { g.d[ry * W + q] = -1; g.d[ry * W + (W - 1 - q)] = -1; } }
      g.hl(5, W - 6, 2, shade(hr, 0.3));
      g.hl(0, W - 1, rb - 1, shade(hr, -0.18)); g.hl(0, W - 1, rb, shade(hr, -0.42));
      // 굴뚝
      g.rect(W - 13, 1, 5, 8, 0xa85a40); g.hl(W - 14, W - 8, 1, 0x7a3a2a); g.vl(W - 9, 2, 8, 0x7a3a2a);
      if (th.roofSnow) snowRoof(g, 3, W - 4, 3, seed);
      var hw0 = wallTint(th, th.walls), hwS = shade(hw0, -0.12);
      g.rect(2, rb + 1, W - 4, bottom - rb, hw0);
      for (var ly = rb + 4; ly < bottom; ly += 4) g.hl(2, W - 3, ly, hwS);
      g.hl(2, W - 3, rb + 1, shade(hw0, -0.35));
      g.vl(2, rb + 1, bottom, shade(hw0, -0.2)); g.vl(W - 3, rb + 1, bottom, shade(hw0, -0.2));
      for (i = 0; i < B.w; i++) {
        if (i === dcol) continue;
        windowAt(g, i * 16 + 8, rb + 6, 8, 7, 0xffffff, glass);
        // 화분
        g.rect(i * 16 + 3, rb + 15, 10, 2, 0x8a5a36);
        for (var fx = 0; fx < 4; fx++) g.px(i * 16 + 4 + fx * 2, rb + 14, [0xff5a6e, 0xffd23c, 0xff8ac0, 0xffffff][(fx + seed) % 4]);
      }
      woodDoor(g, dcx, bottom, 10, 14, 0x9a6038);
    }
    g.outline(OUTLINE, 0.7, true);
    return g;
  }

  /* ───────────── 사람 스프라이트(look → 4방향 × 3프레임) ───────────── */
  var HAIRS = { short: 1, long: 1, spiky: 1, bun: 1, twin: 1, cap: 1, bald: 1, hood: 1 };
  var DEFAULT_LOOK = { skin: '#f6d2b0', hair: 'short', hairColor: '#5a3a22', shirt: '#5a8ad0', pants: '#3a3a50', shoes: '#2a2a2a' };
  function lookOf(look) {
    var src = null, P = root.PMaps;
    if (typeof look === 'string') src = P && P.LOOKS && P.LOOKS[look];
    else if (look && typeof look === 'object') src = look;
    src = src || DEFAULT_LOOK;
    var L = {};
    L.skin = rgb(src.skin, 0xf6d2b0);
    L.hair = HAIRS[src.hair] ? src.hair : 'short';
    L.hairC = rgb(src.hairColor, 0x5a3a22);
    L.shirt = rgb(src.shirt, 0x5a8ad0);
    L.pants = rgb(src.pants, 0x3a3a50);
    L.shoes = rgb(src.shoes, 0x2a2a2a);
    L.accent = rgb(src.accent, -1);
    L.hatC = rgb(src.hat, -1);
    if (L.hair === 'cap' && L.hatC < 0) L.hatC = L.accent >= 0 ? L.accent : 0xe8384a;
    L.coat = !!src.coat;
    L.coatC = typeof src.coat === 'string' ? rgb(src.coat, 0xf2f2f2) : (lum(L.shirt) > 0.8 ? L.shirt : 0xf2f2f2);
    L.apron = !!src.apron;
    L.apronC = typeof src.apron === 'string' ? rgb(src.apron, 0xffffff) : 0xffffff;
    if (L.apron && L.apronC === L.shirt) L.apronC = mix(L.apronC, 0xffffff, 0.35);
    L.fur = rgb(src.fur, -1);
    L.key = [L.skin, L.hair, L.hairC, L.shirt, L.pants, L.shoes, L.accent, L.hatC, L.coat ? L.coatC : -1, L.apron ? L.apronC : -1, L.fur].join(',');
    // 파생색
    L.skinS = shade(L.skin, -0.2); L.skinL = shade(L.skin, 0.4);
    L.hairS = shade(L.hairC, -0.28); L.hairL = shade(L.hairC, lum(L.hairC) > 0.75 ? 0.6 : 0.32);
    L.hatS = shade(L.hatC, -0.3); L.hatL = shade(L.hatC, 0.3);
    L.shirtS = shade(L.shirt, -0.22); L.shirtL = shade(L.shirt, 0.22);
    L.pantsS = shade(L.pants, -0.25);
    L.shoesS = shade(L.shoes, -0.3);
    L.coatS = shade(L.coatC, -0.2);
    L.apronS = shade(L.apronC, -0.2);
    L.eye = 0x2a1c30;
    L.blush = mix(L.skin, 0xff5a78, 0.42);
    L.mouth = mix(L.skin, 0x9a3a3a, 0.4);
    return L;
  }

  function headShape(g, c) { g.hl(5, 10, 3, c); g.hl(4, 11, 4, c); g.rect(3, 5, 10, 7, c); g.hl(4, 11, 12, c); }
  function capTop(g, c) { g.hl(5, 10, 3, c); g.hl(4, 11, 4, c); g.rect(3, 5, 10, 2, c); }
  function spikes(g, H) {
    g.px(4, 2, H); g.px(3, 1, H); g.px(7, 2, H); g.px(8, 2, H); g.px(8, 1, H); g.px(11, 2, H); g.px(12, 1, H);
    g.px(2, 5, H); g.px(1, 4, H); g.px(13, 5, H); g.px(14, 4, H); g.hl(4, 11, 3, H);
  }
  function legsFront(g, L, fr) {
    function leg(x, lift) {
      if (lift) { g.rect(x, 18, 3, 1, L.pants); g.rect(x, 19, 3, 2, L.shoes); g.hl(x, x + 2, 20, L.shoesS); }
      else { g.rect(x, 18, 3, 2, L.pants); g.rect(x, 20, 3, 2, L.shoes); g.hl(x, x + 2, 21, L.shoesS); }
    }
    leg(5, fr === 1); leg(8, fr === 2);
    g.px(7, 18, L.pantsS);
    g.hl(4, 11, 17, L.pants);
  }
  function armsFront(g, L, fr) {
    var sl = L.coat ? L.coatC : L.shirt;
    function arm(x, off) { g.rect(x, 13, 1, 3 + off, shade(sl, -0.08)); g.px(x, 16 + off, L.skin); }
    arm(3, fr === 2 ? -1 : fr === 1 ? 1 : 0);
    arm(12, fr === 1 ? -1 : fr === 2 ? 1 : 0);
  }
  function hairBase(g, L) { // 앞·뒤 공통 위쪽 머리
    capTop(g, L.hairC);
    g.px(5, 4, L.hairL); g.px(6, 4, L.hairL); g.px(4, 5, L.hairL);
  }

  function drawDown(g, L, fr) {
    var H = L.hairC, Hs = L.hairS;
    legsFront(g, L, fr);
    g.rect(4, 13, 8, 4, L.shirt); g.hl(4, 11, 16, L.shirtS); g.px(5, 14, L.shirtL);
    g.px(7, 13, L.skinS); g.px(8, 13, L.skinS);
    if (L.coat) {
      g.rect(4, 13, 8, 5, L.coatC); g.hl(4, 11, 17, L.coatS);
      g.rect(7, 13, 2, 4, L.accent >= 0 ? L.accent : 0x6a8ac0); g.px(7, 13, L.skinS); g.px(8, 13, L.skinS);
      g.px(6, 13, L.coatS); g.px(9, 13, L.coatS);
    } else if (L.accent >= 0) { g.hl(4, 11, 13, L.accent); g.px(9, 14, L.accent); g.px(9, 15, shade(L.accent, -0.2)); }
    if (L.apron) { g.rect(5, 14, 6, 4, L.apronC); g.px(5, 13, L.apronC); g.px(10, 13, L.apronC); g.hl(6, 9, 16, L.apronS); }
    armsFront(g, L, fr);
    headShape(g, L.skin);
    // 머리카락
    var st = L.hair;
    if (st === 'hood') {
      g.hl(5, 10, 2, H); g.hl(4, 11, 3, H); g.rect(3, 4, 10, 9, H); g.rect(2, 6, 1, 7, H); g.rect(13, 6, 1, 7, H);
      g.rect(4, 7, 8, 6, L.skin); g.hl(4, 11, 7, L.skinS); g.hl(5, 10, 6, Hs);
      g.rect(2, 13, 1, 5, Hs); g.rect(13, 13, 1, 5, Hs);
      g.px(5, 3, L.hairL); g.px(4, 4, L.hairL);
    } else if (st === 'cap') {
      capTop(g, L.hatC); g.hl(5, 7, 4, L.hatL); g.px(4, 5, L.hatL);
      var em = L.accent >= 0 && L.accent !== L.hatC ? L.accent : 0xffffff;
      g.rect(7, 4, 2, 2, em);
      g.hl(2, 13, 7, L.hatS); g.hl(3, 12, 6, L.hatC);
      g.px(3, 8, H); g.px(12, 8, H); g.px(3, 9, Hs); g.px(12, 9, Hs);
    } else if (st === 'bald') {
      g.px(5, 4, L.skinL); g.px(6, 4, L.skinL); g.px(4, 5, L.skinL);
      g.vl(3, 6, 9, H); g.vl(12, 6, 9, H); g.px(5, 7, H); g.px(10, 7, H); g.px(6, 7, H); g.px(9, 7, H);
    } else {
      hairBase(g, L);
      [3, 4, 5, 7, 8, 10, 11, 12].forEach(function (x) { g.px(x, 7, H); });
      g.px(3, 8, H); g.px(12, 8, H); g.px(3, 9, Hs); g.px(12, 9, Hs);
      if (st === 'long') { g.rect(2, 7, 2, 9, H); g.rect(12, 7, 2, 9, H); g.vl(3, 9, 15, Hs); g.vl(12, 9, 15, Hs); }
      else if (st === 'spiky') { spikes(g, H); g.px(6, 7, H); g.px(4, 8, H); g.px(11, 8, H); }
      else if (st === 'bun' && L.hatC < 0) { g.hl(6, 9, 1, H); g.hl(5, 10, 2, H); g.px(6, 1, L.hairL); }
      else if (st === 'twin') {
        g.rect(1, 7, 2, 6, H); g.rect(13, 7, 2, 6, H); g.px(1, 12, Hs); g.px(14, 12, Hs); g.px(2, 13, Hs); g.px(13, 13, Hs);
        var tie = L.accent >= 0 ? L.accent : 0xff5a7a; g.px(2, 6, tie); g.px(13, 6, tie); g.px(3, 6, tie); g.px(12, 6, tie);
      }
    }
    if (L.hatC >= 0 && st !== 'cap') { g.hl(5, 10, 2, L.hatC); g.hl(4, 11, 3, L.hatC); g.hl(4, 11, 4, L.hatC); g.hl(3, 12, 5, L.hatS); g.px(7, 3, H === L.hatC ? 0xe84a6a : H); g.px(8, 3, H === L.hatC ? 0xe84a6a : H); }
    // 얼굴
    g.px(5, 8, L.eye); g.px(5, 9, L.eye); g.px(10, 8, L.eye); g.px(10, 9, L.eye);
    g.px(4, 10, L.blush); g.px(11, 10, L.blush);
    g.px(7, 11, L.mouth); g.px(8, 11, L.mouth);
  }

  function drawUp(g, L, fr) {
    var H = L.hairC, Hs = L.hairS;
    legsFront(g, L, fr);
    g.rect(4, 13, 8, 4, L.shirt); g.hl(4, 11, 16, L.shirtS);
    if (L.coat) { g.rect(4, 13, 8, 5, L.coatC); g.hl(4, 11, 17, L.coatS); g.vl(7, 15, 17, L.coatS); }
    else if (L.accent >= 0) g.hl(4, 11, 13, L.accent);
    if (L.apron) { g.px(5, 13, L.apronC); g.px(10, 13, L.apronC); g.px(6, 14, L.apronC); g.px(9, 14, L.apronC); g.hl(7, 8, 15, L.apronC); g.px(6, 16, L.apronC); g.px(9, 16, L.apronC); }
    armsFront(g, L, fr);
    headShape(g, L.skin);
    var st = L.hair;
    if (st === 'hood') {
      g.hl(5, 10, 2, H); g.hl(4, 11, 3, H); g.rect(3, 4, 10, 9, H); g.rect(2, 6, 1, 7, H); g.rect(13, 6, 1, 7, H);
      g.vl(7, 4, 11, Hs); g.px(5, 3, L.hairL); g.px(4, 4, L.hairL);
      g.rect(3, 13, 10, 5, Hs); g.vl(7, 13, 17, shade(Hs, -0.15));
    } else if (st === 'cap') {
      g.hl(5, 10, 3, L.hatC); g.hl(4, 11, 4, L.hatC); g.rect(3, 5, 10, 3, L.hatC); g.hl(5, 7, 4, L.hatL);
      g.hl(6, 9, 7, L.hatS); g.px(7, 6, L.hatS); g.px(8, 6, L.hatS);
      g.rect(3, 8, 10, 4, H); g.hl(3, 12, 11, Hs);
    } else if (st === 'bald') {
      g.px(6, 4, L.skinL); g.px(7, 4, L.skinL); g.px(5, 5, L.skinL);
      g.rect(3, 8, 10, 3, H); g.hl(4, 11, 11, Hs);
    } else {
      hairBase(g, L); g.rect(3, 7, 10, 5, H); g.hl(3, 12, 11, Hs);
      if (st === 'long') { g.rect(3, 12, 10, 4, H); g.rect(2, 7, 1, 9, H); g.rect(13, 7, 1, 9, H); g.hl(3, 12, 15, Hs); g.hl(4, 11, 16, Hs); }
      else if (st === 'spiky') spikes(g, H);
      else if (st === 'bun') { if (L.hatC < 0) { g.hl(6, 9, 1, H); g.hl(5, 10, 2, H); } g.rect(6, 5, 4, 3, Hs); g.rect(7, 5, 2, 2, L.hairL); }
      else if (st === 'twin') { g.rect(1, 7, 2, 6, H); g.rect(13, 7, 2, 6, H); var tie = L.accent >= 0 ? L.accent : 0xff5a7a; g.px(2, 6, tie); g.px(13, 6, tie); }
    }
    if (L.hatC >= 0 && st !== 'cap') { g.hl(5, 10, 2, L.hatC); g.hl(4, 11, 3, L.hatC); g.hl(4, 11, 4, L.hatC); g.hl(3, 12, 5, L.hatS); }
  }

  function drawLeft(g, L, fr) {
    var H = L.hairC, Hs = L.hairS;
    // 다리
    if (fr === 0) { g.rect(6, 18, 4, 2, L.pants); g.rect(5, 20, 5, 2, L.shoes); g.hl(5, 9, 21, L.shoesS); g.vl(8, 18, 19, L.pantsS); }
    else if (fr === 1) {
      g.rect(9, 18, 3, 1, L.pantsS); g.rect(9, 19, 3, 2, L.shoesS);
      g.rect(4, 18, 3, 2, L.pants); g.rect(3, 20, 4, 2, L.shoes); g.hl(3, 6, 21, L.shoesS);
    } else {
      g.rect(9, 18, 3, 2, L.pantsS); g.rect(9, 20, 3, 2, L.shoesS);
      g.rect(4, 18, 3, 1, L.pants); g.rect(3, 19, 4, 2, L.shoes); g.hl(3, 6, 20, L.shoesS);
    }
    g.hl(5, 10, 17, L.pants);
    // 몸통
    g.rect(5, 13, 6, 4, L.shirt); g.hl(5, 10, 16, L.shirtS);
    if (L.coat) { g.rect(4, 13, 7, 5, L.coatC); g.hl(4, 10, 17, L.coatS); g.px(5, 13, L.accent >= 0 ? L.accent : 0x6a8ac0); }
    else if (L.accent >= 0) { g.hl(5, 10, 13, L.accent); g.px(11, 14, L.accent); g.px(12, 14, L.accent); g.px(12, 15, shade(L.accent, -0.2)); }
    if (L.apron) { g.rect(4, 14, 2, 4, L.apronC); g.px(5, 13, L.apronC); }
    // 팔
    var sl = shade(L.coat ? L.coatC : L.shirt, -0.12);
    if (fr === 0) { g.rect(7, 13, 2, 3, sl); g.rect(7, 16, 2, 1, L.skin); }
    else if (fr === 1) { g.rect(6, 13, 2, 2, sl); g.rect(5, 15, 2, 1, sl); g.rect(4, 16, 2, 1, L.skin); }
    else { g.rect(8, 13, 2, 2, sl); g.rect(9, 15, 2, 1, sl); g.rect(10, 16, 2, 1, L.skin); }
    // 머리
    headShape(g, L.skin);
    var st = L.hair;
    if (st === 'hood') {
      g.hl(5, 10, 2, H); g.hl(4, 11, 3, H); g.rect(4, 4, 9, 9, H); g.rect(13, 6, 1, 6, H);
      g.rect(3, 7, 5, 6, L.skin); g.hl(3, 7, 7, L.skinS); g.vl(8, 7, 12, Hs);
      g.rect(10, 13, 3, 5, Hs); g.px(6, 3, L.hairL);
    } else if (st === 'cap') {
      capTop(g, L.hatC); g.hl(6, 9, 4, L.hatL);
      g.hl(1, 6, 7, L.hatS); g.hl(3, 11, 6, L.hatC);
      var em = L.accent >= 0 && L.accent !== L.hatC ? L.accent : 0xffffff; g.rect(5, 4, 2, 2, em);
      g.rect(8, 7, 5, 4, H); g.hl(9, 12, 11, Hs); g.px(8, 9, L.skin); g.px(8, 10, L.skinS);
    } else if (st === 'bald') {
      g.px(6, 4, L.skinL); g.px(7, 4, L.skinL);
      g.rect(9, 7, 4, 4, H); g.px(4, 7, H); g.px(5, 7, H);
    } else {
      hairBase(g, L);
      g.hl(3, 5, 7, H); g.hl(7, 12, 7, H); g.rect(8, 8, 5, 3, H); g.hl(9, 12, 11, Hs);
      g.px(8, 9, L.skin); g.px(8, 10, L.skinS);
      if (st === 'long') { g.rect(9, 11, 4, 5, H); g.vl(13, 7, 14, H); g.hl(10, 12, 16, Hs); }
      else if (st === 'spiky') { g.px(5, 2, H); g.px(4, 1, H); g.px(8, 2, H); g.px(8, 1, H); g.px(11, 2, H); g.px(12, 1, H); g.px(13, 5, H); g.px(14, 4, H); g.px(13, 8, H); g.px(14, 8, H); g.hl(4, 11, 3, H); }
      else if (st === 'bun') { g.rect(11, 1, 3, 3, H); g.px(11, 1, L.hairL); g.px(13, 3, Hs); }
      else if (st === 'twin') { g.rect(13, 7, 2, 6, H); g.px(14, 12, Hs); g.px(12, 7, L.accent >= 0 ? L.accent : 0xff5a7a); g.px(13, 6, L.accent >= 0 ? L.accent : 0xff5a7a); }
    }
    if (L.hatC >= 0 && st !== 'cap') {
      g.hl(5, 10, 2, L.hatC); g.hl(4, 11, 3, L.hatC); g.hl(4, 11, 4, L.hatC); g.hl(3, 12, 5, L.hatS);
      if (st === 'bun') { g.rect(11, 3, 3, 3, H); g.px(11, 3, L.hairL); }
    }
    // 얼굴
    g.px(4, 8, L.eye); g.px(4, 9, L.eye); g.px(5, 10, L.blush); g.px(3, 11, L.mouth);
  }

  var _sheets = {};
  function trainerSheet(look) {
    var L = lookOf(look);
    if (_sheets['p' + L.key]) return _sheets['p' + L.key];
    var c = mk(48, 96), x = ctx2d(c);
    for (var f = 0; f < 3; f++) {
      var dn = new PB(16, 24); drawDown(dn, L, f); dn.outline(OUTLINE, 0.72); dn.putTo(x, f * 16, 0);
      var up = new PB(16, 24); drawUp(up, L, f); up.outline(OUTLINE, 0.72); up.putTo(x, f * 16, 24);
      var lf = new PB(16, 24); drawLeft(lf, L, f); lf.outline(OUTLINE, 0.72); lf.putTo(x, f * 16, 48);
      lf.flipX().putTo(x, f * 16, 72);
    }
    _sheets['p' + L.key] = c;
    return c;
  }

  // 작은 고양이(따라오는 동료) 16×16
  function catSheet(look) {
    var L = lookOf(look), fur = L.fur >= 0 ? L.fur : (look && typeof look === 'object' && look.shirt ? L.shirt : 0xf0a040);
    var key = 'c' + fur;
    if (_sheets[key]) return _sheets[key];
    var fD = shade(fur, -0.28), fL = shade(fur, 0.3), pink = 0xff9ab0, eye = 0x2a1c30;
    var c = mk(48, 64), x = ctx2d(c);
    for (var f = 0; f < 3; f++) {
      var s = f === 0 ? 0 : (f === 1 ? -1 : 1);
      // 아래
      var d = new PB(16, 16);
      d.ell(8, 12, 4, 2.8, fur); d.px(6 + s, 15, fD); d.px(9 - s, 15, fD);
      d.px(12, 11, fur); d.px(13, 10, fur); d.px(13, 9, fD);
      d.ell(8, 7.5, 4.6, 3.8, fur); d.px(4, 3, fur); d.px(4, 4, fur); d.px(5, 4, pink); d.px(11, 3, fur); d.px(11, 4, fur); d.px(10, 4, pink);
      d.px(6, 7, eye); d.px(6, 8, eye); d.px(9, 7, eye); d.px(9, 8, eye); d.px(7, 9, pink); d.px(8, 9, pink);
      d.px(5, 6, fL); d.hl(6, 9, 12, fL);
      d.outline(OUTLINE, 0.7); d.putTo(x, f * 16, 0);
      // 위
      var u = new PB(16, 16);
      u.ell(8, 12, 4, 2.8, fur); u.px(6 - s, 15, fD); u.px(9 + s, 15, fD);
      u.ell(8, 7.5, 4.6, 3.8, fur); u.px(4, 3, fur); u.px(4, 4, fur); u.px(11, 3, fur); u.px(11, 4, fur);
      u.vl(8, 8, 13, fD); u.px(8, 4, fD); u.px(8, 5, fD);
      u.vl(8, 13, 15, fur); u.px(9, 15, fD);
      u.outline(OUTLINE, 0.7); u.putTo(x, f * 16, 16);
      // 왼쪽
      var l = new PB(16, 16);
      l.ell(9.5, 11.5, 5, 2.8, fur);
      l.px(13, 9, fur); l.px(14, 8, fur); l.px(14, 7, fur); l.px(13, 6, fD);
      l.px(6 + s, 14, fD); l.px(7 + s, 14, fD); l.px(11 - s, 14, fD); l.px(12 - s, 14, fD);
      l.ell(5.5, 7.5, 3.8, 3.4, fur); l.px(3, 3, fur); l.px(3, 4, fur); l.px(4, 4, pink); l.px(7, 3, fur); l.px(7, 4, fur);
      l.px(3, 7, eye); l.px(3, 8, eye); l.px(2, 9, pink); l.hl(8, 12, 10, fL);
      l.outline(OUTLINE, 0.7); l.putTo(x, f * 16, 32); l.flipX().putTo(x, f * 16, 48);
    }
    _sheets[key] = c;
    return c;
  }

  var _misc = {};
  function ballCanvas() {
    if (_misc.ball) return _misc.ball;
    var g = new PB(14, 14);
    g.ell(7, 7, 5.6, 5.6, 0xffffff);
    g.map(function (c, x, y) { return y < 7 ? 0xe8384a : (y === 7 ? 0x2a2030 : (x + y > 15 ? 0xd8d8e0 : c)); });
    g.map(function (c, x, y) { return (y < 7 && x + y < 8) ? 0xff7a84 : c; });
    g.hl(2, 11, 7, 0x2a2030);
    g.rect(5, 5, 4, 4, 0x2a2030); g.rect(6, 6, 2, 2, 0xffffff);
    g.px(4, 3, 0xffffff); g.px(5, 3, 0xffd0d4);
    g.outline(OUTLINE, 0.7);
    _misc.ball = g.canvas();
    return _misc.ball;
  }
  function shadowCanvas(w) {
    var k = 'sh' + w;
    if (_misc[k]) return _misc[k];
    var c = mk(w, 5), x = c.getContext('2d');
    x.fillStyle = 'rgba(20,10,40,0.28)';
    x.fillRect(2, 0, w - 4, 5); x.fillRect(1, 1, w - 2, 3); x.fillRect(0, 2, w, 1);
    _misc[k] = c;
    return c;
  }
  var EMO = {
    '!': { col: 0xe8384a, rows: ['..##..', '..##..', '..##..', '..##..', '..##..', '......', '..##..', '..##..'] },
    '?': { col: 0x3a5ad8, rows: ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..', '..##..'] },
    '♥': { col: 0xe8384a, rows: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] },
    '…': { col: 0x4a4a5a, rows: ['##.##.##', '##.##.##'] },
    '♪': { col: 0x2a9a6a, rows: ['...###', '...#.#', '...#.#', '...#..', '.###..', '####..', '.##...'] }
  };
  function emoteCanvas(kind) {
    var e = EMO[kind] || EMO['…'];
    var k = 'emo' + (EMO[kind] ? kind : '…');
    if (_misc[k]) return _misc[k];
    var g = new PB(16, 15);
    g.rect(2, 1, 12, 11, 0xffffff);
    g.rect(1, 2, 14, 9, 0xffffff);
    g.px(6, 12, 0xffffff); g.px(7, 12, 0xffffff); g.px(8, 12, 0xffffff); g.px(7, 13, 0xffffff);
    g.hl(2, 13, 10, 0xe4e4f0); g.vl(14, 3, 10, 0xe4e4f0);
    var rows = e.rows, h = rows.length, w = rows[0].length, ox = 8 - Math.ceil(w / 2), oy = 6 - Math.ceil(h / 2) + (h <= 2 ? 1 : 0);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) if (rows[y][x] === '#') g.px(ox + x, oy + y, e.col);
    if (kind === '♥') g.px(ox + 1, oy + 1, 0xffb8c0);
    g.outline(0x2a2030, 0.9);
    _misc[k] = g.canvas();
    return _misc[k];
  }

  /* 몬스터 그림(일러스트) — 논리 해상도 크기로 부드럽게 줄여 캐시한다 */
  var _imgs = {};
  function monImage(url, hPx) {
    var rec = _imgs[url];
    if (!rec) {
      rec = _imgs[url] = { img: null, state: 'loading', scaled: {} };
      try {
        var im = new Image();
        im.onload = function () { rec.img = im; rec.state = 'ok'; };
        im.onerror = function () { rec.state = 'fail'; };
        im.src = url;
      } catch (e) { rec.state = 'fail'; }
    }
    if (rec.state !== 'ok') return rec;
    if (!rec.scaled[hPx]) {
      try {
        var src = rec.img, w = src.naturalWidth || src.width, h = src.naturalHeight || src.height;
        var cur = src, cw = w, ch = h;
        // 반씩 여러 번 줄여 품질을 높인다(부드럽게)
        while (cw / 2 > hPx * 1.5) {
          var nw = Math.max(1, Math.round(cw / 2)), nh = Math.max(1, Math.round(ch / 2));
          var tmp = mk(nw, nh), tx = tmp.getContext('2d');
          tx.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in tx) tx.imageSmoothingQuality = 'high';
          tx.drawImage(cur, 0, 0, nw, nh);
          cur = tmp; cw = nw; ch = nh;
        }
        var outW = Math.max(1, Math.round(hPx * w / h)), out = mk(outW, hPx), ox = out.getContext('2d');
        ox.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in ox) ox.imageSmoothingQuality = 'high';
        ox.drawImage(cur, 0, 0, outW, hPx);
        var fl = mk(outW, hPx), fx = fl.getContext('2d');
        fx.translate(outW, 0); fx.scale(-1, 1); fx.drawImage(out, 0, 0);
        rec.scaled[hPx] = { n: out, f: fl };
      } catch (e) { rec.state = 'fail'; }
    }
    return rec;
  }
  function monPlaceholder(hPx) {
    var k = 'monph' + hPx;
    if (_misc[k]) return _misc[k];
    var s = hPx / 32, g = new PB(Math.round(32 * s), hPx), c = 0x5a4a78;
    g.ell(16 * s, 21 * s, 10 * s, 8 * s, c);
    g.ell(16 * s, 11 * s, 8 * s, 7 * s, c);
    g.line(Math.round(10 * s), Math.round(7 * s), Math.round(9 * s), Math.round(1 * s), c);
    g.line(Math.round(22 * s), Math.round(7 * s), Math.round(23 * s), Math.round(1 * s), c);
    g.ell(9.5 * s, 4 * s, 2 * s, 3.5 * s, c); g.ell(22.5 * s, 4 * s, 2 * s, 3.5 * s, c);
    g.px(Math.round(13 * s), Math.round(11 * s), 0xffe066); g.px(Math.round(19 * s), Math.round(11 * s), 0xffe066);
    g.outline(OUTLINE, 0.6);
    _misc[k] = g.canvas();
    return _misc[k];
  }

  /* ───────────── 정적 맵 레이어 ───────────── */
  var FLOOR = { '.': 'g', ',': 'tall', '=': 'path', 'p': 'paved', 'F': 'g', 's': 'sand', 'n': 'snow', 'i': 'ice', 'b': 'bridge',
    'T': 'g', 'B': 'g', 'f': 'g', 'r': 'g', 'c': 'cliff', 'W': 'wall', '~': 'water', 'L': 'lava', 'S': 'g', '#': 'g' };
  var ANIM = { ',': 1, 'F': 2, '~': 3, 'L': 4 };

  function buildMap(map) {
    var rows = (map && map.tiles) || [];
    var H = rows.length, W = 0, x, y;
    for (y = 0; y < H; y++) W = Math.max(W, String(rows[y] || '').length);
    W = Math.max(1, W); H = Math.max(1, H);
    var th = theme(map && map.theme);
    var M = { w: W, h: H, th: th, map: map, chars: new Array(W * H), anim: new Uint8Array(W * H), phase: new Uint8Array(W * H), rustle: {} };
    for (y = 0; y < H; y++) {
      var row = String(rows[y] || '');
      for (x = 0; x < W; x++) {
        var ch = row[x] || '.';
        if (!FLOOR[ch]) ch = '.';
        M.chars[y * W + x] = ch;
        M.anim[y * W + x] = ANIM[ch] || 0;
        M.phase[y * W + x] = hash(x, y, 21) & 255;
      }
    }
    function at(xx, yy) { if (xx < 0 || yy < 0 || xx >= W || yy >= H) return null; return M.chars[yy * W + xx]; }
    M.at = at;
    var base = mk(W * T, H * T), bx = ctx2d(base);
    var over = mk(W * T, H * T), ox = ctx2d(over);
    M.base = base; M.over = over;
    var grass = grassTiles(th), flw = flowerTiles(th);

    function floorBase(ch) {
      var f = FLOOR[ch];
      if (f === 'path') return th.path;
      if (f === 'paved') return th.paved;
      if (f === 'sand') return SAND;
      if (f === 'snow') return SNOW;
      if (f === 'ice') return ICE;
      if (f === 'tall') return th.tallB;
      return th.kind === 'sand' ? SAND : th.kind === 'snow' ? SNOW : th.g;
    }
    // 이웃이 같은 종류가 아니면 가장자리를 섞는다(테두리 디더)
    // 이웃이 같은 종류가 아니면 가장자리를 물결 모양으로 섞는다. 깊이는 전역 좌표 해시라 이웃 칸과 이어진다.
    function blendEdges(ox0, oy0, tx, ty, same, inner) {
      var nb = [[0, -1], [1, 0], [0, 1], [-1, 0]], k, i;
      var side = [false, false, false, false];
      for (k = 0; k < 4; k++) {
        var nc = at(tx + nb[k][0], ty + nb[k][1]);
        if (nc === null || same(nc)) continue;
        side[k] = true;
        var col = floorBase(nc);
        for (i = 0; i < 16; i++) {
          var gpos = (k === 0 || k === 2) ? tx * 16 + i : ty * 16 + i;
          var line = (k === 0) ? ty * 2 : (k === 2) ? ty * 2 + 1 : (k === 1) ? tx * 2 + 1 : tx * 2;
          var hv = hash(gpos >> 1, line, k & 1 ? 71 : 37), dep = (hv % 5 === 0) ? 2 : (hv % 5 < 3 ? 1 : 0);
          for (var d = 0; d <= dep; d++) {
            var c = d < dep ? col : (inner >= 0 ? inner : ((gpos + d) % 2 ? col : -1));
            if (c < 0) continue;
            var px = k === 1 ? 15 - d : k === 3 ? d : i, py = k === 0 ? d : k === 2 ? 15 - d : i;
            F(bx, ox0 + px, oy0 + py, 1, 1, c);
          }
        }
      }
      // 안쪽 모서리: 양옆은 같은 종류인데 대각선만 다를 때
      var dg = [[-1, -1, 0, 3], [1, -1, 0, 1], [1, 1, 2, 1], [-1, 1, 2, 3]];
      for (k = 0; k < 4; k++) {
        if (side[dg[k][2]] || side[dg[k][3]]) continue;
        var dc = at(tx + dg[k][0], ty + dg[k][1]);
        if (dc === null || same(dc)) continue;
        var cx0 = dg[k][0] < 0 ? 0 : 15, cy0 = dg[k][1] < 0 ? 0 : 15, sx = dg[k][0] < 0 ? 1 : -1, sy = dg[k][1] < 0 ? 1 : -1;
        F(bx, ox0 + cx0, oy0 + cy0, 1, 1, floorBase(dc));
        if (inner >= 0) { F(bx, ox0 + cx0 + sx, oy0 + cy0, 1, 1, inner); F(bx, ox0 + cx0, oy0 + cy0 + sy, 1, 1, inner); }
      }
    }
    function isWaterish(c) { return c === '~' || c === 'b'; }

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var c = M.chars[y * W + x], ox0 = x * T, oy0 = y * T, f = FLOOR[c];
        var gk = th.kind;
        if (f === 'tall') { bx.drawImage(grass.full[0], ox0, oy0); continue; }
        if (c === 'F') { bx.drawImage(flw[hash(x, y, 8) % 3][0], ox0, oy0); continue; }
        if (f === 'path') {
          var r = rng(hash(x, y, 2));
          F(bx, ox0, oy0, 16, 16, th.path);
          for (var i = 0; i < 5; i++) F(bx, ox0 + ri(r, 16), oy0 + ri(r, 16), 1, 1, th.pathD);
          for (i = 0; i < 3; i++) F(bx, ox0 + ri(r, 16), oy0 + ri(r, 16), 1, 1, th.pathL);
          if (r() < 0.25) { var px1 = 2 + ri(r, 11), py1 = 2 + ri(r, 11); F(bx, ox0 + px1, oy0 + py1, 2, 1, th.pathL); F(bx, ox0 + px1, oy0 + py1 + 1, 2, 1, shade(th.path, -0.3)); }
          blendEdges(ox0, oy0, x, y, function (n) { return n === '=' || n === 'b' || n === 'p' || n === '#'; }, th.pathD);
          continue;
        }
        if (f === 'paved') {
          F(bx, ox0, oy0, 16, 16, th.pavedD);
          for (var hr = 0; hr < 2; hr++) {
            var off = ((y * 2 + hr) & 1) * 4;
            for (var kx = -1; kx < 3; kx++) {
              var sx = kx * 8 + off, sy = hr * 8, v = (hash(x * 4 + kx, y * 2 + hr, 6) % 3) - 1, pc = shade(th.paved, v * 0.03);
              FC(bx, ox0, oy0, sx, sy, 7, 7, pc);
              FC(bx, ox0, oy0, sx, sy, 7, 1, th.pavedL);
              FC(bx, ox0, oy0, sx, sy + 6, 7, 1, shade(pc, -0.08));
            }
          }
          var nbp = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          for (var k2 = 0; k2 < 4; k2++) {
            var nc2 = at(x + nbp[k2][0], y + nbp[k2][1]);
            if (nc2 === null || nc2 === 'p' || nc2 === '#' || nc2 === '=') continue;
            var cd = shade(th.paved, -0.35);
            if (k2 === 0) F(bx, ox0, oy0, 16, 1, cd); else if (k2 === 2) F(bx, ox0, oy0 + 15, 16, 1, cd);
            else if (k2 === 1) F(bx, ox0 + 15, oy0, 1, 16, cd); else F(bx, ox0, oy0, 1, 16, cd);
          }
          continue;
        }
        if (f === 'sand' || f === 'snow') {
          drawGround(bx, ox0, oy0, th, f, x, y);
          blendEdges(ox0, oy0, x, y, function (n) { return FLOOR[n] === f || (f === 'sand' && th.kind === 'sand' && FLOOR[n] === 'g') || (f === 'snow' && th.kind === 'snow' && FLOOR[n] === 'g') || n === '~'; }, -1);
          continue;
        }
        if (f === 'ice') {
          var ir = rng(hash(x, y, 9));
          F(bx, ox0, oy0, 16, 16, ICE);
          for (i = 0; i < 2; i++) { var ix = ri(ir, 10), iy = 2 + ri(ir, 10); for (var d = 0; d < 4; d++) F(bx, ox0 + ix + d, oy0 + iy - d, 1, 1, 0xffffff); }
          F(bx, ox0 + ri(ir, 14), oy0 + ri(ir, 14), 2, 1, shade(ICE, -0.1));
          var nbi = [[0, -1], [1, 0], [0, 1], [-1, 0]];
          for (k2 = 0; k2 < 4; k2++) {
            var ni = at(x + nbi[k2][0], y + nbi[k2][1]);
            if (ni === null || ni === 'i') continue;
            var ic = shade(ICE, -0.25);
            if (k2 === 0) F(bx, ox0, oy0, 16, 1, ic); else if (k2 === 2) F(bx, ox0, oy0 + 15, 16, 1, shade(ICE, -0.35));
            else if (k2 === 1) F(bx, ox0 + 15, oy0, 1, 16, ic); else F(bx, ox0, oy0, 1, 16, ic);
          }
          continue;
        }
        if (f === 'water' || f === 'bridge') {
          var overWater = f === 'water' || isWaterish(at(x - 1, y)) || isWaterish(at(x + 1, y)) || isWaterish(at(x, y - 1)) || isWaterish(at(x, y + 1));
          if (f === 'bridge' && !overWater) { drawGround(bx, ox0, oy0, th, gk, x, y); }
          else drawWater(bx, ox0, oy0, x, y);
          if (f === 'bridge') drawBridge(bx, ox0, oy0, x, y);
          continue;
        }
        if (f === 'lava') { drawLava(bx, ox0, oy0, x, y); continue; }
        if (f === 'cliff') { drawCliff(bx, ox0, oy0, x, y); continue; }
        if (f === 'wall') { drawWall(bx, ox0, oy0, x, y); continue; }
        drawGround(bx, ox0, oy0, th, gk, x, y);
      }
    }

    function drawWater(ctx, ox0, oy0, tx, ty) {
      var r = rng(hash(tx, ty, 13));
      F(ctx, ox0, oy0, 16, 16, th.water);
      if ((tx + ty) % 2 === 0) F(ctx, ox0 + 3, oy0 + 9, 10, 3, mix(th.water, th.waterD, 0.35));
      for (var i = 0; i < 2; i++) { var wx = 1 + ri(r, 10), wy = 2 + ri(r, 12); F(ctx, ox0 + wx, oy0 + wy, 4, 1, mix(th.water, th.waterL, 0.5)); F(ctx, ox0 + wx + 1, oy0 + wy + 1, 2, 1, th.waterD); }
      var land = function (n) { return n !== null && !isWaterish(n); };
      var u = land(at(tx, ty - 1)), d = land(at(tx, ty + 1)), l = land(at(tx - 1, ty)), rr = land(at(tx + 1, ty));
      var edge = shade(th.water, -0.45), foam = th.foam;
      // 물가: 위쪽은 땅 그림자 + 거품, 다른 방향은 거품 띠
      if (u) { F(ctx, ox0, oy0, 16, 2, th.waterD); F(ctx, ox0, oy0, 16, 1, edge); for (i = 0; i < 16; i += 3) F(ctx, ox0 + i, oy0 + 2, 2, 1, foam); }
      if (d) { F(ctx, ox0, oy0 + 14, 16, 2, foam); F(ctx, ox0, oy0 + 15, 16, 1, mix(foam, 0xffffff, 0.5)); for (i = 1; i < 16; i += 4) F(ctx, ox0 + i, oy0 + 13, 2, 1, foam); }
      if (l) { F(ctx, ox0, oy0, 2, 16, foam); F(ctx, ox0, oy0, 1, 16, mix(foam, 0xffffff, 0.5)); for (i = 1; i < 16; i += 4) F(ctx, ox0 + 2, oy0 + i, 1, 2, foam); }
      if (rr) { F(ctx, ox0 + 14, oy0, 2, 16, foam); F(ctx, ox0 + 15, oy0, 1, 16, mix(foam, 0xffffff, 0.5)); for (i = 3; i < 16; i += 4) F(ctx, ox0 + 13, oy0 + i, 1, 2, foam); }
      if (u && l) F(ctx, ox0, oy0, 3, 3, edge);
      if (u && rr) F(ctx, ox0 + 13, oy0, 3, 3, edge);
      // 안쪽 모서리
      if (!u && !l && land(at(tx - 1, ty - 1))) F(ctx, ox0, oy0, 2, 2, foam);
      if (!u && !rr && land(at(tx + 1, ty - 1))) F(ctx, ox0 + 14, oy0, 2, 2, foam);
      if (!d && !l && land(at(tx - 1, ty + 1))) F(ctx, ox0, oy0 + 14, 2, 2, foam);
      if (!d && !rr && land(at(tx + 1, ty + 1))) F(ctx, ox0 + 14, oy0 + 14, 2, 2, foam);
    }
    function drawBridge(ctx, ox0, oy0, tx, ty) {
      var wood = 0xc08850, wD = shade(wood, -0.3), wL = shade(wood, 0.22), rail = 0x7a4a2a;
      var vertical = isWaterish(at(tx - 1, ty)) || isWaterish(at(tx + 1, ty)) || (at(tx, ty - 1) === 'b' || at(tx, ty + 1) === 'b');
      if (at(tx - 1, ty) === 'b' || at(tx + 1, ty) === 'b') vertical = false;
      if (vertical) {
        F(ctx, ox0 + 2, oy0, 12, 16, wood);
        for (var i = 0; i < 16; i += 4) { F(ctx, ox0 + 2, oy0 + i + 3, 12, 1, wD); F(ctx, ox0 + 2, oy0 + i, 12, 1, wL); }
        F(ctx, ox0, oy0, 2, 16, rail); F(ctx, ox0 + 14, oy0, 2, 16, rail);
        F(ctx, ox0 + 1, oy0, 1, 16, shade(rail, 0.3)); F(ctx, ox0 + 15, oy0, 1, 16, shade(rail, -0.3));
        F(ctx, ox0, oy0 + 6, 2, 3, shade(rail, -0.35)); F(ctx, ox0 + 14, oy0 + 6, 2, 3, shade(rail, -0.35));
      } else {
        F(ctx, ox0, oy0 + 2, 16, 12, wood);
        for (i = 0; i < 16; i += 4) { F(ctx, ox0 + i + 3, oy0 + 2, 1, 12, wD); F(ctx, ox0 + i, oy0 + 2, 1, 12, wL); }
        F(ctx, ox0, oy0, 16, 2, rail); F(ctx, ox0, oy0 + 14, 16, 2, rail);
        F(ctx, ox0, oy0, 16, 1, shade(rail, 0.3)); F(ctx, ox0, oy0 + 15, 16, 1, shade(rail, -0.35));
      }
    }
    // 동그란 덩어리(바닥층에 직접)
    function blob(ctx, cx, cy, rx, ry, c, ox0, oy0) {
      for (var yy = Math.floor(cy - ry); yy <= Math.ceil(cy + ry); yy++) {
        var dy = (yy + 0.5 - cy) / ry;
        if (dy * dy > 1) continue;
        var hw = rx * Math.sqrt(1 - dy * dy), x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
        FC(ctx, ox0, oy0, x0, yy, x1 - x0, 1, c);
      }
    }
    function drawLava(ctx, ox0, oy0, tx, ty) {
      var r = rng(hash(tx, ty, 17)), i;
      F(ctx, ox0, oy0, 16, 16, 0xe8501e);
      // 흐르는 밝은 줄기
      for (i = 0; i < 2; i++) blob(ctx, 2 + ri(r, 12), 2 + ri(r, 12), 4 + ri(r, 3), 2, 0xff7a24, ox0, oy0);
      blob(ctx, 3 + ri(r, 10), 3 + ri(r, 10), 2.5, 1.5, 0xffb03a, ox0, oy0);
      // 식은 껍질 조각(어두운 판 + 갈라진 빛)
      for (i = 0; i < 2; i++) {
        var cx = 2 + ri(r, 12), cy = 2 + ri(r, 12), rx = 2 + ri(r, 2), ry = 1.5 + ri(r, 2) * 0.5;
        blob(ctx, cx, cy + 1, rx, ry, 0x9a2a14, ox0, oy0);
        blob(ctx, cx, cy, rx, ry, 0x5a2420, ox0, oy0);
        FC(ctx, ox0, oy0, Math.round(cx - rx + 1), Math.round(cy - 1), 2, 1, 0x7a3a30);
      }
      for (i = 0; i < 2; i++) FC(ctx, ox0, oy0, ri(r, 15), ri(r, 15), 1, 1, 0xfff0a0);
      var nb = [[0, -1], [1, 0], [0, 1], [-1, 0]], rim = 0x3a2626, rimL = 0x6a3a30;
      for (var k = 0; k < 4; k++) {
        var n = at(tx + nb[k][0], ty + nb[k][1]);
        if (n === null || n === 'L') continue;
        for (var j = 0; j < 16; j++) {
          var g = (k === 0 || k === 2) ? tx * 16 + j : ty * 16 + j;
          var dep = 1 + (hash(g >> 1, k * 1000 + ((k & 1) ? tx : ty), 3) % 3 === 0 ? 1 : 0);
          var glow = 0xffa030;
          if (k === 0) { F(ctx, ox0 + j, oy0, 1, dep, rim); F(ctx, ox0 + j, oy0 + dep, 1, 1, glow); }
          else if (k === 2) { F(ctx, ox0 + j, oy0 + 16 - dep, 1, dep, rimL); F(ctx, ox0 + j, oy0 + 15 - dep, 1, 1, glow); }
          else if (k === 1) { F(ctx, ox0 + 16 - dep, oy0 + j, dep, 1, rim); F(ctx, ox0 + 15 - dep, oy0 + j, 1, 1, glow); }
          else { F(ctx, ox0, oy0 + j, dep, 1, rim); F(ctx, ox0 + dep, oy0 + j, 1, 1, glow); }
        }
      }
    }
    function drawCliff(ctx, ox0, oy0, tx, ty) {
      var C = th.cliff, CD = shade(C, -0.25), CL = shade(C, 0.2), CDD = shade(C, -0.45);
      var u = at(tx, ty - 1) !== 'c' && at(tx, ty - 1) !== null, d = at(tx, ty + 1) !== 'c' && at(tx, ty + 1) !== null;
      var l = at(tx - 1, ty) !== 'c' && at(tx - 1, ty) !== null, rr = at(tx + 1, ty) !== 'c' && at(tx + 1, ty) !== null;
      F(ctx, ox0, oy0, 16, 16, C);
      // 지층
      var r = rng(hash(tx, ty, 23));
      for (var sy = 5; sy < 16; sy += 5) { for (var x2 = 0; x2 < 16; x2++) F(ctx, ox0 + x2, oy0 + sy + ((hash(tx * 16 + x2, sy, 1) % 3 === 0) ? 1 : 0), 1, 1, CD); }
      for (var i = 0; i < 3; i++) { var cx = ri(r, 15), cy = ri(r, 12); F(ctx, ox0 + cx, oy0 + cy, 1, 3, CD); F(ctx, ox0 + cx + 1, oy0 + cy, 1, 2, CL); }
      if (u) { // 위쪽 언덕 테두리(바닥색 입술)
        var lip = th.kind === 'snow' ? SNOW : th.kind === 'sand' ? SAND : th.g;
        F(ctx, ox0, oy0, 16, 3, lip); F(ctx, ox0, oy0, 16, 1, shade(lip, 0.2));
        for (var x3 = 0; x3 < 16; x3++) if (hash(tx * 16 + x3, ty, 4) % 3 === 0) F(ctx, ox0 + x3, oy0 + 3, 1, 1, lip);
        F(ctx, ox0, oy0 + 4, 16, 1, CDD);
      }
      if (d) { F(ctx, ox0, oy0 + 14, 16, 2, CDD); }
      if (l) { F(ctx, ox0, oy0, 1, 16, CDD); F(ctx, ox0 + 1, oy0, 1, 16, CL); }
      if (rr) { F(ctx, ox0 + 15, oy0, 1, 16, CDD); F(ctx, ox0 + 14, oy0, 1, 16, CD); }
    }
    function drawWall(ctx, ox0, oy0, tx, ty) {
      var Wc = th.wall, WD = shade(Wc, -0.3), WL = shade(Wc, 0.22);
      var u = at(tx, ty - 1) !== 'W', d = at(tx, ty + 1) !== 'W', l = at(tx - 1, ty) !== 'W', rr = at(tx + 1, ty) !== 'W';
      F(ctx, ox0, oy0, 16, 16, WD);
      for (var row = 0; row < 4; row++) {
        var off = ((ty * 4 + row) & 1) * 4;
        for (var k = -1; k < 3; k++) {
          var v = (hash(tx * 3 + k, ty * 4 + row, 8) % 3) - 1, bc = shade(Wc, v * 0.05);
          FC(ctx, ox0, oy0, k * 8 + off, row * 4, 7, 3, bc);
          FC(ctx, ox0, oy0, k * 8 + off, row * 4, 7, 1, shade(bc, 0.15));
        }
      }
      if (u) { F(ctx, ox0, oy0, 16, 3, WL); F(ctx, ox0, oy0, 16, 1, shade(WL, 0.25)); F(ctx, ox0, oy0 + 3, 16, 1, WD); }
      if (d) F(ctx, ox0, oy0 + 15, 16, 1, shade(Wc, -0.5));
      if (l) F(ctx, ox0, oy0, 1, 16, shade(Wc, -0.45));
      if (rr) F(ctx, ox0 + 15, oy0, 1, 16, shade(Wc, -0.45));
      if (th.name === 'ruins' && hash(tx, ty, 2) % 3 === 0) { F(ctx, ox0 + 5, oy0 + 5, 1, 4, 0x2a1a1a); F(ctx, ox0 + 6, oy0 + 8, 1, 3, 0x2a1a1a); }
      if (th.name === 'alley' && hash(tx, ty, 2) % 4 === 0) { F(ctx, ox0 + 3, oy0 + 6, 6, 3, 0xe84ac8); F(ctx, ox0 + 4, oy0 + 7, 4, 1, 0xffffff); }
    }

    // 물체: 행 순서(아래 행이 위 행을 덮음). 윗칸으로 걸치는 부분은 over 층에도 그린다.
    var trees = [treePB(th, 0).canvas(), treePB(th, 1).canvas(), treePB(th, 2).canvas()];
    var bushes = [bushPB(th, 0).canvas(), bushPB(th, 1).canvas()];
    var rocks = [rockPB(th, 0).canvas(), rockPB(th, 1).canvas()];
    var sign = signPB().canvas();
    var fences = {};
    var blds = (map && Array.isArray(map.buildings)) ? map.buildings.filter(function (b) { return b && isFinite(b.x) && isFinite(b.y); }) : [];
    var byRow = {};
    blds.forEach(function (b) { var B = bdef(b.kind); var ry = b.y + B.h - 1; (byRow[ry] = byRow[ry] || []).push(b); });
    function overhang(img, dx, dy, w) {
      ox.save(); ox.beginPath(); ox.rect(dx, dy, w, OVER); ox.clip(); ox.drawImage(img, dx, dy); ox.restore();
    }
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        var ch2 = M.chars[y * W + x], X = x * T, Y = y * T, hv = hash(x, y, 31);
        if (ch2 === 'T') {
          // 나무 그림자
          bx.fillStyle = 'rgba(20,10,40,0.22)'; bx.fillRect(X + 2, Y + 13, 12, 3); bx.fillRect(X + 1, Y + 14, 14, 1);
          var tr = trees[hv % 3];
          bx.drawImage(tr, X, Y - OVER); overhang(tr, X, Y - OVER, 16);
        } else if (ch2 === 'B') bx.drawImage(bushes[hv % 2], X, Y);
        else if (ch2 === 'r') { bx.fillStyle = 'rgba(20,10,40,0.2)'; bx.fillRect(X + 2, Y + 14, 12, 2); bx.drawImage(rocks[hv % 2], X, Y); }
        else if (ch2 === 'S') { bx.fillStyle = 'rgba(20,10,40,0.22)'; bx.fillRect(X + 4, Y + 14, 8, 2); bx.drawImage(sign, X, Y); }
        else if (ch2 === 'f') {
          var mask = (at(x, y - 1) === 'f' ? 1 : 0) | (at(x + 1, y) === 'f' ? 2 : 0) | (at(x, y + 1) === 'f' ? 4 : 0) | (at(x - 1, y) === 'f' ? 8 : 0);
          if (!fences[mask]) fences[mask] = fencePB(th, mask).canvas();
          bx.drawImage(fences[mask], X, Y);
        }
      }
      var list = byRow[y];
      if (list) {
        for (var bi = 0; bi < list.length; bi++) {
          var b = list[bi];
          try {
            var img = buildingPB(b, th).canvas();
            var BX = b.x * T, BY = b.y * T - OVER;
            bx.fillStyle = 'rgba(20,10,40,0.2)'; bx.fillRect(BX + 2, BY + img.height, img.width - 2, 2);
            bx.drawImage(img, BX, BY); overhang(img, BX, BY, img.width);
          } catch (e) { /* 건물 하나가 실패해도 맵은 그린다 */ }
        }
      }
    }
    return M;
  }

  /* ───────────── 주변 입자 ───────────── */
  var AMB = {
    petal: { n: 7, cols: [0xffc8dc, 0xffffff, 0xffe0ec], vx: 7, vy: 6, sway: 5, sz: 2 },
    leaf: { n: 9, cols: [0x9ad84a, 0xe0c040, 0x6ac04a], vx: 6, vy: 10, sway: 8, sz: 2 },
    sparkle: { n: 8, cols: [0xffffff, 0xfff4c0], vx: 0, vy: 0, twinkle: 1, sz: 1 },
    ember: { n: 16, cols: [0xffb030, 0xff6020, 0xffe080], vx: 3, vy: -12, sway: 4, sz: 1, flicker: 1 },
    snow: { n: 34, cols: [0xffffff, 0xe4f0ff], vx: -4, vy: 12, sway: 4, sz: 1 },
    mote: { n: 14, cols: [0xfff0b0, 0xffffff, 0xe8d0ff], vx: 0, vy: -4, sway: 5, sz: 1, twinkle: 1 },
    wind: { n: 9, cols: [0xffffff], vx: 46, vy: 2, streak: 1, sz: 1 },
    ash: { n: 16, cols: [0x6a5a5a, 0xa07060, 0xff6040], vx: 3, vy: 6, sway: 4, sz: 1 },
    dust: { n: 6, cols: [0xd8d0e8], vx: 4, vy: -1, sway: 3, sz: 1, twinkle: 1 }
  };

  /* ───────────── 렌더러 ───────────── */
  function FieldView(host) {
    this.mode = 'canvas';
    this.host = host;
    this.disposed = false;
    this.paused = false;
    this.map = null;
    this.ents = {};
    this.order = [];
    this.followId = null;
    this.cover = 0;        // 검은 덮개(0~1), 페이드 뒤에도 유지
    this.fx = null;        // 진행 중 화면 전환
    this.timers = [];
    this.pend = [];        // dispose 때 풀어 줄 resolve 목록
    this.cam = { x: 0, y: 0 };
    this.lastCam = { x: 0, y: 0 };
    this.lastT = 0;
    this.amb = null;
    this.cssTile = 40;
    this.R = 1;
    this.S = 1; this.vw = 1; this.vh = 1;
    try {
      if (root.getComputedStyle && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    } catch (e) { /* 무시 */ }
    var wrap = document.createElement('div');
    wrap.className = 'fld-root';
    wrap.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;background:#000;';
    var cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;display:block;';
    cv.style.imageRendering = 'crisp-edges';
    cv.style.imageRendering = 'pixelated';
    var vig = document.createElement('div');
    vig.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;';
    wrap.appendChild(cv); wrap.appendChild(vig);
    host.appendChild(wrap);
    this.wrap = wrap; this.cv = cv; this.vig = vig;
    this.ctx = cv.getContext('2d', { alpha: false }) || cv.getContext('2d');
    var self = this;
    this._loop = function () { self._raf = 0; if (!self._running()) return; self._raf = requestAnimationFrame(self._loop); self._safeRender(); };
    this._onResize = function () { self.resize(); };
    this._onVis = function () { self._kick(); };
    root.addEventListener('resize', this._onResize);
    root.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', this._onVis);
    if (root.ResizeObserver) { try { this._ro = new ResizeObserver(this._onResize); this._ro.observe(host); } catch (e) { this._ro = null; } }
    this.resize();
    this._kick();
  }
  var P = FieldView.prototype;

  P._running = function () { return !this.disposed && !this.paused && !(document.hidden); };
  P._kick = function () { if (this._running() && !this._raf) this._raf = requestAnimationFrame(this._loop); };
  P._later = function (ms, fn) {
    var self = this;
    var id = setTimeout(function () { var i = self.timers.indexOf(id); if (i >= 0) self.timers.splice(i, 1); try { fn(); } catch (e) { /* 무시 */ } }, ms);
    this.timers.push(id);
    return id;
  };
  // 시간 기반 연출: ms 뒤에 반드시 끝나는 Promise (dispose 때도 resolve)
  P._anim = function (ms, onEnd) {
    var self = this;
    return new Promise(function (resolve) {
      var done = false;
      function fin() { if (done) return; done = true; var i = self.pend.indexOf(fin); if (i >= 0) self.pend.splice(i, 1); try { if (onEnd) onEnd(); } catch (e) { /* 무시 */ } resolve(); }
      self.pend.push(fin);
      if (self.disposed) { fin(); return; }
      self._later(ms, fin);
    });
  };

  P.resize = function () {
    if (this.disposed) return;
    var cw = this.host.clientWidth || 390, ch = this.host.clientHeight || 560;
    var dpr = clamp(root.devicePixelRatio || 1, 1, 4);
    var dw = Math.round(cw * dpr), dh = Math.round(ch * dpr);
    // 가로에 타일 약 10칸이 들어가는 정수 배율(장치 픽셀 기준)
    var best = 1, bestErr = 1e9;
    for (var s = 1; s <= 16; s++) { var tiles = dw / (T * s), err = Math.abs(tiles - 10) + (tiles < 8.5 ? 3 : 0) + (tiles > 12 ? 2 : 0); if (err < bestErr) { bestErr = err; best = s; } }
    var S = best, vw = Math.ceil(dw / S), vh = Math.ceil(dh / S);
    this.S = S; this.dpr = dpr; this.vw = vw; this.vh = vh;
    this.offX = Math.floor((dw - vw * S) / 2); this.offY = Math.floor((dh - vh * S) / 2);
    this._applyRes();
    this.cv.style.width = (vw * S / dpr) + 'px';
    this.cv.style.height = (vh * S / dpr) + 'px';
    this.cv.style.left = (this.offX / dpr) + 'px';
    this.cv.style.top = (this.offY / dpr) + 'px';
    this.cssTile = T * S / dpr;
    if (this.ctx) this.ctx.imageSmoothingEnabled = false;
    this._spiral = null;
    this._safeRender();
  };

  // 몬스터 일러스트가 있으면 캔버스 해상도를 장치 픽셀(R = S)로 올려 그림을 부드럽고 선명하게 그린다.
  // 그리기 코드는 같고(setTransform 으로 논리 좌표 유지) 일러스트가 없는 맵에서는 논리 해상도(R = 1)로 돌아간다.
  P._applyRes = function () {
    var want = 1;
    for (var i = 0; i < this.order.length; i++) if (this.order[i].kind === 'mon' && !this.order[i].hidden) { want = this.S; break; }
    this.R = want;
    var w = this.vw * want, h = this.vh * want;
    if (this.cv.width !== w) this.cv.width = w;
    if (this.cv.height !== h) this.cv.height = h;
  };

  P.loadMap = function (map) {
    var self = this;
    return safe(function () {
      if (self.disposed) return;
      var M;
      try { M = buildMap(map || {}); } catch (e) { if (root.console) console.warn('[Field] loadMap 실패', e); return; }
      self.map = M;
      self.vig.style.background = M.th.vigCss;
      self._initAmb(M.th.amb);
      self._safeRender();
    }, 5000);
  };

  /* 엔티티 */
  function normDir(d) { return DIRS[d] ? d : 'down'; }
  P._mkEnt = function (o) {
    var e = { id: String(o.id), x: o.x | 0, y: o.y | 0, dir: normDir(o.dir), look: o.look, kind: o.kind || 'npc', hidden: !!o.hidden,
      img: o.img || null, size: +o.size > 0 ? +o.size : 2, mv: null, bp: null, emo: null, leg: 0, rx: 0, ry: 0, fr: 0, born: now() };
    this._sheetFor(e);
    return e;
  };
  P._sheetFor = function (e) {
    try {
      if (e.kind === 'player' || e.kind === 'npc') e.sheet = trainerSheet(e.look);
      else if (e.kind === 'cat') e.sheet = catSheet(e.look);
      else e.sheet = null;
    } catch (err) { e.sheet = null; }
  };
  P._finishEnt = function (e) {
    if (!e) return;
    if (e.mv && e.mv.fin) e.mv.fin();
    if (e.bp && e.bp.fin) e.bp.fin();
    if (e.emo && e.emo.fin) e.emo.fin();
  };
  P.setEntities = function (list) {
    var self = this;
    Object.keys(this.ents).forEach(function (k) { self._finishEnt(self.ents[k]); });
    this.ents = {};
    this.order = [];
    (Array.isArray(list) ? list : []).forEach(function (o) {
      if (!o || o.id == null) return;
      var e = self._mkEnt(o);
      self.ents[e.id] = e; self.order.push(e);
    });
    this._safeRender();
  };
  P.addEntity = function (o) {
    if (!o || o.id == null) return;
    if (this.ents[String(o.id)]) this.removeEntity(o.id);
    var e = this._mkEnt(o);
    this.ents[e.id] = e; this.order.push(e);
  };
  P.updateEntity = function (id, props) {
    var e = this.ents[String(id)];
    if (!e || !props) return;
    if ((props.x != null && (props.x | 0) !== e.x) || (props.y != null && (props.y | 0) !== e.y)) { if (e.mv && e.mv.fin) e.mv.fin(); }
    if (props.x != null) e.x = props.x | 0;
    if (props.y != null) e.y = props.y | 0;
    if (props.dir != null) e.dir = normDir(props.dir);
    if (props.hidden != null) e.hidden = !!props.hidden;
    if (props.img !== undefined) e.img = props.img;
    if (props.size != null && +props.size > 0) e.size = +props.size;
    if (props.kind != null) e.kind = props.kind;
    if (props.look !== undefined || props.kind != null) { if (props.look !== undefined) e.look = props.look; this._sheetFor(e); }
    this._safeRender();
  };
  P.removeEntity = function (id) {
    var e = this.ents[String(id)];
    if (!e) return;
    this._finishEnt(e);
    delete this.ents[e.id];
    var i = this.order.indexOf(e); if (i >= 0) this.order.splice(i, 1);
  };
  P.follow = function (id) { this.followId = id == null ? null : String(id); };
  P.faceEntity = function (id, dir) { var e = this.ents[String(id)]; if (e && DIRS[dir]) e.dir = dir; };

  P.moveEntity = function (id, dir, opts) {
    var self = this, e = this.ents[String(id)];
    if (!e || !DIRS[dir]) return Promise.resolve();
    if (e.mv && e.mv.fin) e.mv.fin();
    var ms = clamp(+(opts && opts.ms) || 170, 30, 3000);
    var fx = e.x * T, fy = e.y * T;
    e.dir = dir; e.x += DIRS[dir][0]; e.y += DIRS[dir][1];
    e.leg = 1 - e.leg;
    var mv = { fx: fx, fy: fy, t0: now(), ms: ms, leg: e.leg, fin: null };
    e.mv = mv;
    var p = this._anim(ms, function () {
      if (e.mv === mv) e.mv = null;
      // 수풀에 들어서면 그 칸이 바스락
      var M = self.map;
      if (M && e.x >= 0 && e.y >= 0 && e.x < M.w && e.y < M.h && M.chars[e.y * M.w + e.x] === ',') M.rustle[e.y * M.w + e.x] = now();
    });
    mv.fin = this.pend[this.pend.length - 1];
    return p;
  };
  P.bump = function (id, dir) {
    var e = this.ents[String(id)];
    if (!e) return Promise.resolve();
    if (DIRS[dir]) e.dir = dir;
    if (e.bp && e.bp.fin) e.bp.fin();
    var bp = { t0: now(), ms: 120, dir: e.dir, fin: null };
    e.bp = bp;
    var p = this._anim(120, function () { if (e.bp === bp) e.bp = null; });
    bp.fin = this.pend[this.pend.length - 1];
    return p;
  };
  P.emote = function (id, kind) {
    var e = this.ents[String(id)];
    if (!e) return Promise.resolve();
    if (e.emo && e.emo.fin) e.emo.fin();
    var k = EMO[kind] ? kind : '…'; // 모르는 종류는 '…'
    var ms = k === '!' ? 700 : 900;
    var emo = { t0: now(), ms: ms, kind: k, fin: null };
    e.emo = emo;
    var p = this._anim(ms, function () { if (e.emo === emo) e.emo = null; });
    emo.fin = this.pend[this.pend.length - 1];
    return p;
  };

  P.transition = function (kind) {
    var self = this;
    if (this.fx && this.fx.fin) this.fx.fin();
    var ms = kind === 'battle' ? 900 : (kind === 'fadeOut' || kind === 'fadeIn') ? 300 : 0;
    if (!ms) return Promise.resolve();
    var fx = { kind: kind, t0: now(), ms: ms, from: this.cover, fin: null };
    this.fx = fx;
    var p = this._anim(ms, function () {
      if (self.fx === fx) self.fx = null;
      self.cover = kind === 'fadeIn' ? 0 : 1;
      self._safeRender();
    });
    fx.fin = this.pend[this.pend.length - 1];
    return p;
  };

  /* 좌표 변환 */
  P._entHead = function (e) {
    var t = now();
    this._entPos(e, t);
    if (e.kind === 'mon') return { x: e.rx + 8, y: e.ry + 15 - Math.round(e.size * T * ((root.Sprites && Sprites.ART_TOP) || 0.86)) };
    if (e.kind === 'item') return { x: e.rx + 8, y: e.ry + 3 };
    if (e.kind === 'cat') return { x: e.rx + 8, y: e.ry + 3 };
    return { x: e.rx + 8, y: e.ry - HEAD_UP + 1 };
  };
  P.screenOf = function (id) {
    var e = this.ents[String(id)];
    this._updateCam();
    var lx, ly;
    if (e) { var h = this._entHead(e); lx = h.x; ly = h.y; } else { lx = this.cam.x + this.vw / 2; ly = this.cam.y + this.vh / 2; }
    return { x: ((lx - this.cam.x) * this.S + this.offX) / this.dpr, y: ((ly - this.cam.y) * this.S + this.offY) / this.dpr };
  };
  P.tileAtScreen = function (px, py) {
    this._updateCam();
    var lx = ((+px || 0) * this.dpr - this.offX) / this.S + this.cam.x;
    var ly = ((+py || 0) * this.dpr - this.offY) / this.S + this.cam.y;
    return { x: Math.floor(lx / T), y: Math.floor(ly / T) };
  };

  P.setPaused = function (b) {
    this.paused = !!b;
    if (this.paused) { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; } }
    else { this.lastT = 0; this._kick(); }
  };
  P.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.timers.forEach(function (id) { clearTimeout(id); });
    this.timers = [];
    var p = this.pend.slice(); this.pend = [];
    p.forEach(function (f) { try { f(); } catch (e) { /* 무시 */ } });
    if (this._ro) { try { this._ro.disconnect(); } catch (e) { /* 무시 */ } }
    root.removeEventListener('resize', this._onResize);
    root.removeEventListener('orientationchange', this._onResize);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
    this.map = null; this.ents = {}; this.order = [];
  };

  /* ───────────── 그리기 ───────────── */
  P._entPos = function (e, t) {
    var bx = e.x * T, by = e.y * T, fr = 0;
    if (e.mv) {
      var k = clamp((t - e.mv.t0) / e.mv.ms, 0, 1);
      bx = e.mv.fx + (bx - e.mv.fx) * k; by = e.mv.fy + (by - e.mv.fy) * k;
      fr = k < 0.5 ? (e.mv.leg ? 1 : 2) : 0;
    }
    if (e.bp) {
      var kb = clamp((t - e.bp.t0) / e.bp.ms, 0, 1), d = DIRS[e.bp.dir] || [0, 0], off = Math.sin(kb * Math.PI) * 2;
      bx += d[0] * off; by += d[1] * off;
      fr = kb < 0.5 ? 1 : 0;
    }
    e.rx = Math.round(bx); e.ry = Math.round(by); e.fr = fr;
  };
  P._target = function () {
    var e = this.followId != null ? this.ents[this.followId] : null;
    if (!e) for (var i = 0; i < this.order.length; i++) if (this.order[i].kind === 'player') { e = this.order[i]; break; }
    if (!e) e = this.ents.player || null;
    return e;
  };
  P._updateCam = function () {
    var M = this.map, vw = this.vw, vh = this.vh;
    if (!M) { this.cam.x = 0; this.cam.y = 0; return; }
    var mw = M.w * T, mh = M.h * T, e = this._target(), cx, cy;
    if (e) { this._entPos(e, now()); cx = e.rx + 8; cy = e.ry + 6; } else { cx = mw / 2; cy = mh / 2; }
    var x = Math.round(cx - vw / 2), y = Math.round(cy - vh / 2);
    x = mw <= vw ? -Math.floor((vw - mw) / 2) : clamp(x, 0, mw - vw);
    y = mh <= vh ? -Math.floor((vh - mh) / 2) : clamp(y, 0, mh - vh);
    this.cam.x = x; this.cam.y = y;
  };
  P._safeRender = function () { try { this._render(); } catch (e) { if (!this._warned) { this._warned = true; if (root.console) console.warn('[Field] render', e); } } };

  function sortEnt(a, b) { return (a.ry - b.ry) || (a.kind === 'item' ? -1 : 0) - (b.kind === 'item' ? -1 : 0) || (a.rx - b.rx); }

  P._render = function () {
    var ctx = this.ctx, vw = this.vw, vh = this.vh, M = this.map, t = now();
    if (!ctx || this.disposed) return;
    var dt = this.lastT ? clamp((t - this.lastT) / 1000, 0, 0.05) : 0;
    this.lastT = t;
    var want = 1;
    for (var wi = 0; wi < this.order.length; wi++) if (this.order[wi].kind === 'mon' && !this.order[wi].hidden) { want = this.S; break; }
    if (want !== this.R || this.cv.width !== this.vw * want) this._applyRes();
    var R = this.R;
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!M) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh); this._drawFx(ctx, t); return; }
    var i, e;
    for (i = 0; i < this.order.length; i++) this._entPos(this.order[i], t);
    this._updateCam();
    var cx = this.cam.x, cy = this.cam.y, mw = M.w * T, mh = M.h * T, th = M.th;
    if (cx < 0 || cy < 0 || cx + vw > mw || cy + vh > mh) { ctx.fillStyle = css(th.void); ctx.fillRect(0, 0, vw, vh); }
    blitClip(ctx, M.base, cx, cy, vw, vh, mw, mh);

    // 보이는 칸 애니메이션
    var tx0 = Math.max(0, Math.floor(cx / T)), ty0 = Math.max(0, Math.floor(cy / T));
    var tx1 = Math.min(M.w - 1, Math.floor((cx + vw - 1) / T)), ty1 = Math.min(M.h - 1, Math.floor((cy + vh - 1) / T));
    var grass = grassTiles(th), flw = flowerTiles(th), x, y;
    var gtick = Math.floor(t / 420), wtick = Math.floor(t / 140);
    for (y = ty0; y <= ty1; y++) {
      for (x = tx0; x <= tx1; x++) {
        var idx = y * M.w + x, a = M.anim[idx];
        if (!a) continue;
        var sx = x * T - cx, sy = y * T - cy, ph = M.phase[idx];
        if (a === 1) {
          var gf = this._grassFrame(M, idx, t, gtick);
          if (gf) ctx.drawImage(grass.full[gf], sx, sy);
        } else if (a === 2) {
          if (((gtick + (ph & 3)) & 3) === 0) ctx.drawImage(flw[hash(x, y, 8) % 3][1], sx, sy);
        } else if (a === 3) {
          var wp = (wtick + ph) % 24;
          if (wp < 12) { ctx.fillStyle = css(th.waterL); ctx.fillRect(sx + 3 + (wp >> 1), sy + 5 + (ph & 3) * 2, 3, 1); }
          var wq = (wtick + (ph >> 3)) % 32;
          if (wq < 3) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx + 4 + (ph % 8), sy + 4 + ((ph >> 4) % 8), 1, 1); }
        } else if (a === 4) {
          var lp = (Math.sin(t / 380 + ph) + 1) * 0.5;
          ctx.globalAlpha = 0.25 + lp * 0.35;
          ctx.fillStyle = '#ffd34d'; ctx.fillRect(sx + 3 + (ph % 7), sy + 4 + ((ph >> 3) % 7), 3, 2);
          ctx.globalAlpha = 1;
          var bq = (Math.floor(t / 160) + ph) % 20;
          if (bq < 4) { ctx.fillStyle = bq < 3 ? '#ffb030' : '#fff0a0'; var bxx = sx + 2 + ((ph >> 2) % 11), byy = sy + 3 + (ph % 10); ctx.fillRect(bxx, byy, bq < 2 ? 1 : 2, bq < 2 ? 1 : 2); }
        }
      }
    }

    // 엔티티(y 정렬)
    var list = this._sorted || (this._sorted = []);
    list.length = 0;
    for (i = 0; i < this.order.length; i++) if (!this.order[i].hidden) list.push(this.order[i]);
    list.sort(sortEnt);
    for (i = 0; i < list.length; i++) this._drawEnt(ctx, list[i], t, cx, cy, M, grass, gtick);

    // 위로 걸치는 층(나무 수관·지붕)
    blitClip(ctx, M.over, cx, cy, vw, vh, mw, mh);

    // 입자
    this._drawAmb(ctx, t, dt, cx, cy);
    // 색 보정
    if (th.grade) { ctx.fillStyle = th.grade; ctx.fillRect(0, 0, vw, vh); }
    // 말풍선
    for (i = 0; i < list.length; i++) { e = list[i]; if (e.emo) this._drawEmote(ctx, e, t, cx, cy); }
    this._drawFx(ctx, t);
  };

  function blitClip(ctx, img, cx, cy, vw, vh, mw, mh) {
    var sx = cx, sy = cy, dx = 0, dy = 0, w = vw, h = vh;
    if (sx < 0) { dx = -sx; w += sx; sx = 0; }
    if (sy < 0) { dy = -sy; h += sy; sy = 0; }
    if (sx + w > mw) w = mw - sx;
    if (sy + h > mh) h = mh - sy;
    if (w > 0 && h > 0) ctx.drawImage(img, sx, sy, w, h, dx, dy, w, h);
  }

  P._grassFrame = function (M, idx, t, gtick) {
    var rs = M.rustle[idx];
    if (rs) { if (t - rs < 260) return 3; delete M.rustle[idx]; }
    var ph = M.phase[idx], k = (gtick + (ph & 7)) & 7;
    return k === 0 ? 1 : k === 1 ? 2 : 0;
  };

  P._drawEnt = function (ctx, e, t, cx, cy, M, grass, gtick) {
    var sx = e.rx - cx, sy = e.ry - cy;
    if (sx < -48 || sy < -64 || sx > this.vw + 48 || sy > this.vh + 48) return;
    var footTy = Math.floor((e.ry + 15) / T);
    var inGrass = false, gx0 = Math.floor(e.rx / T), gx1 = Math.floor((e.rx + 15) / T);
    if (footTy >= 0 && footTy < M.h) {
      for (var gx = gx0; gx <= gx1; gx++) if (gx >= 0 && gx < M.w && M.chars[footTy * M.w + gx] === ',') inGrass = true;
    }
    if (e.kind === 'item') {
      if (!inGrass) ctx.drawImage(shadowCanvas(10), sx + 3, sy + 12);
      ctx.drawImage(ballCanvas(), sx + 1, sy + 1);
      var sp = (t / 1300 + (e.x * 0.37 + e.y * 0.61)) % 1;
      if (sp < 0.22) {
        var sk = sp < 0.07 ? 1 : sp < 0.15 ? 2 : 1, spx = sx + 12, spy = sy + 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(spx, spy - sk, 1, sk * 2 + 1); ctx.fillRect(spx - sk, spy, sk * 2 + 1, 1);
        if (sk === 2) { ctx.fillStyle = '#fff4a0'; ctx.fillRect(spx, spy, 1, 1); }
      }
    } else if (e.kind === 'mon') {
      var R = this.R || 1, hPx = Math.max(8, Math.round(e.size * T)), hDev = hPx * R;
      var rec = e.img ? monImage(e.img, hDev) : { state: 'fail' };
      var sc = rec.state === 'ok' ? rec.scaled[hDev] : null;
      var foot = hPx * ((root.Sprites && Sprites.FOOT) || 0.031);
      // 숨쉬듯 천천히 오르내림(장치 픽셀 단위로 맞춰 흔들림 없이)
      var bobm = Math.round((Math.sin((t - e.born) / 520) + 1) * 0.6 * R) / R;
      var sw = Math.max(10, Math.round(hPx * 0.55) & ~1);
      ctx.drawImage(shadowCanvas(sw), sx + 8 - (sw >> 1), sy + 12);
      if (sc) {
        var im = e.dir === 'right' ? sc.f : sc.n, iw = im.width / R, ih = im.height / R;
        var ix = Math.round((sx + 8 - iw / 2) * R) / R, iy = Math.round((sy + 16 + foot - ih - bobm) * R) / R;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(im, ix, iy, iw, ih);
        ctx.imageSmoothingEnabled = false;
      } else if (rec.state === 'fail' || !e.img) {
        var ph = monPlaceholder(hPx);
        ctx.drawImage(ph, sx + 8 - Math.round(ph.width / 2), sy + 16 - hPx - Math.round(bobm));
      }
    } else if (e.sheet) {
      var row = e.kind === 'cat' ? DIR_ROW[e.dir] * 16 : DIR_ROW[e.dir] * SPR_H;
      if (e.kind === 'cat') {
        if (!inGrass) ctx.drawImage(shadowCanvas(10), sx + 3, sy + 12);
        ctx.drawImage(e.sheet, e.fr * 16, row, 16, 16, sx, sy + (e.fr ? -1 : 0), 16, 16);
      } else {
        if (!inGrass) ctx.drawImage(shadowCanvas(12), sx + 2, sy + 12);
        ctx.drawImage(e.sheet, e.fr * 16, row, 16, SPR_H, sx, sy - SPR_UP - 1 + (e.fr ? -1 : 0), 16, SPR_H);
      }
    }
    // 수풀 앞판: 발이 있는 칸이 수풀이면 하반신을 덮는다
    if (inGrass) {
      for (gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gx >= M.w) continue;
        var gi = footTy * M.w + gx;
        if (M.chars[gi] !== ',') continue;
        ctx.drawImage(grass.front[this._grassFrame(M, gi, t, gtick)], gx * T - cx, footTy * T - cy);
      }
    }
  };

  P._drawEmote = function (ctx, e, t, cx, cy) {
    var em = e.emo, k = (t - em.t0) / em.ms;
    if (k >= 1) return;
    var h = this._entHead(e), img = emoteCanvas(em.kind);
    var pop = 0, el = t - em.t0;
    if (el < 60) pop = 3; else if (el < 120) pop = -2; else if (el < 170) pop = 1;
    if (em.kind === '♪') pop += Math.round(Math.sin(el / 120));
    ctx.drawImage(img, h.x - cx - 8, h.y - cy - 16 - pop);
  };

  P._initAmb = function (kind) {
    var cfg = AMB[kind];
    if (!cfg) { this.amb = null; return; }
    var n = cfg.n, a = new Float32Array(n * 4), r = rng(hash(kind.length, n, 99));
    for (var i = 0; i < n; i++) { a[i * 4] = r() * (this.vw + 16); a[i * 4 + 1] = r() * (this.vh + 16); a[i * 4 + 2] = r() * TAU; a[i * 4 + 3] = 0.6 + r() * 0.8; }
    this.amb = { cfg: cfg, a: a, n: n, cols: cfg.cols.map(css) };
    this.lastCam.x = this.cam.x; this.lastCam.y = this.cam.y;
  };
  P._drawAmb = function (ctx, t, dt, cx, cy) {
    var A = this.amb;
    if (!A) return;
    var c = A.cfg, a = A.a, W = this.vw + 16, H = this.vh + 16;
    var dcx = cx - this.lastCam.x, dcy = cy - this.lastCam.y;
    if (Math.abs(dcx) > 64 || Math.abs(dcy) > 64) { dcx = 0; dcy = 0; }
    this.lastCam.x = cx; this.lastCam.y = cy;
    for (var i = 0; i < A.n; i++) {
      var o = i * 4, sp = a[o + 3], ph = a[o + 2];
      var sway = c.sway ? Math.sin(t / 800 + ph) * c.sway : 0;
      a[o] += ((c.vx || 0) * sp + sway) * dt - dcx;
      a[o + 1] += (c.vy || 0) * sp * dt - dcy;
      if (a[o] < 0) a[o] += W; else if (a[o] >= W) a[o] -= W;
      if (a[o + 1] < 0) a[o + 1] += H; else if (a[o + 1] >= H) a[o + 1] -= H;
      var px = Math.round(a[o]) - 8, py = Math.round(a[o + 1]) - 8;
      if (c.twinkle) { var tw = Math.sin(t / 600 + ph * 3); if (tw < 0.2) continue; }
      if (c.flicker && ((t / 90 + ph * 7) | 0) % 5 === 0) continue;
      ctx.fillStyle = A.cols[i % A.cols.length];
      if (c.streak) { ctx.globalAlpha = 0.35; ctx.fillRect(px, py, 6 + (i % 3) * 2, 1); ctx.globalAlpha = 1; }
      else if (c.sz === 2) { var fl = ((t / 250 + ph) | 0) % 2; ctx.fillRect(px, py, fl ? 2 : 1, fl ? 1 : 2); }
      else ctx.fillRect(px, py, 1, 1);
    }
  };

  P._spiralOrder = function () {
    var bs = 8, cols = Math.ceil(this.vw / bs), rows = Math.ceil(this.vh / bs);
    if (this._spiral && this._spiral.cols === cols && this._spiral.rows === rows) return this._spiral;
    var order = new Int32Array(cols * rows), n = 0, l = 0, r = cols - 1, tp = 0, b = rows - 1, x;
    while (l <= r && tp <= b) {
      for (x = l; x <= r; x++) order[n++] = tp * cols + x;
      tp++;
      for (x = tp; x <= b; x++) order[n++] = x * cols + r;
      r--;
      if (tp <= b) { for (x = r; x >= l; x--) order[n++] = b * cols + x; b--; }
      if (l <= r) { for (x = b; x >= tp; x--) order[n++] = x * cols + l; l++; }
    }
    this._spiral = { cols: cols, rows: rows, order: order, n: n, bs: bs };
    return this._spiral;
  };
  P._drawFx = function (ctx, t) {
    var fx = this.fx, vw = this.vw, vh = this.vh;
    if (!fx) {
      if (this.cover > 0) { ctx.fillStyle = 'rgba(0,0,0,' + this.cover + ')'; ctx.fillRect(0, 0, vw, vh); }
      return;
    }
    var k = clamp((t - fx.t0) / fx.ms, 0, 1);
    if (fx.kind === 'fadeOut' || fx.kind === 'fadeIn') {
      var to = fx.kind === 'fadeIn' ? 0 : 1, a = fx.from + (to - fx.from) * k;
      a = Math.round(a * 6) / 6; // 도트 게임처럼 계단식 페이드
      if (a > 0) { ctx.fillStyle = 'rgba(0,0,0,' + a + ')'; ctx.fillRect(0, 0, vw, vh); }
      return;
    }
    // battle: 번쩍임 3번 → 바깥에서 안쪽으로 감기는 나선 블록 → 검정
    var el = t - fx.t0;
    if (el < 330) {
      var ph = el % 110;
      ctx.fillStyle = ph < 55 ? 'rgba(255,255,255,0.82)' : 'rgba(10,10,20,0.6)';
      ctx.fillRect(0, 0, vw, vh);
      return;
    }
    var sp = this._spiralOrder(), q = clamp((el - 330) / 520, 0, 1), cnt = Math.floor(q * sp.n), bs = sp.bs;
    ctx.fillStyle = '#000';
    for (var i = 0; i < cnt; i++) { var id = sp.order[i]; ctx.fillRect((id % sp.cols) * bs, ((id / sp.cols) | 0) * bs, bs, bs); }
    if (cnt < sp.n) {
      var hd = sp.order[cnt];
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((hd % sp.cols) * bs, ((hd / sp.cols) | 0) * bs, bs, bs);
      for (var j = 1; j < 4 && cnt - j >= 0; j++) { var tl = sp.order[cnt - j]; ctx.fillStyle = j === 1 ? '#e8384a' : '#5a1a2a'; ctx.fillRect((tl % sp.cols) * bs, ((tl / sp.cols) | 0) * bs, bs, bs); }
    }
    if (q >= 1) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, vw, vh); }
  };

  function create(hostEl) {
    if (!hostEl || !hostEl.appendChild) hostEl = document.body;
    return new FieldView(hostEl);
  }

  root.Field = { create: create, THEMES: Object.keys(THEME_SRC), TILE: T };
})(typeof window !== 'undefined' ? window : globalThis);
