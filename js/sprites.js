/* 포캣몬 SVG 스프라이트 — 512×512, 투명 배경, 발이 바닥 중앙(≈y490)에 닿는 구도 */
(function (root) {
  'use strict';

  var PAL = {
    naru: {
      normal: { fur: '#a9dcff', fur2: '#62b4f2', shade: '#3c8fd8', belly: '#f6fcff', line: '#1b4a82', eye1: '#0a3a8c', eye2: '#5cc6ff', pupil: '#07214f', inner: '#e3f4ff', w1: '#d9f3ff', w2: '#2f97ee', blush: '#ff9ec0', nose: '#ff86ad', mark: '#2f86e0' },
      shiny: { fur: '#c3bddf', fur2: '#968fc2', shade: '#6f679f', belly: '#f6f4fd', line: '#372f68', eye1: '#3a1f86', eye2: '#b494ff', pupil: '#1c0f45', inner: '#efeaff', w1: '#efe4ff', w2: '#9b6ff0', blush: '#ff9ec0', nose: '#ff86ad', mark: '#8a62e8' }
    },
    seol: {
      normal: { fur: '#ffffff', fur2: '#dbe8f6', shade: '#b4c9e2', belly: '#ffffff', line: '#46679a', eye1: '#123f96', eye2: '#6cc4ff', pupil: '#0b2050', c1: '#f0fbff', c2: '#8fd0ff', c3: '#3f8fe0', blush: '#ffb3c9', nose: '#ff9db8' },
      shiny: { fur: '#7c8092', fur2: '#5d6172', shade: '#454858', belly: '#9a9eb0', line: '#25273a', eye1: '#3b2a8a', eye2: '#b9a0ff', pupil: '#160f3d', c1: '#f4ecff', c2: '#c2a6ff', c3: '#7a52e0', blush: '#ffb3c9', nose: '#ff9db8' }
    },
    ssaga: {
      normal: { fur: '#34343e', fur2: '#4b4b58', shade: '#1d1d24', belly: '#f3f1ee', line: '#0e0e12', eye1: '#ffe14d', eye2: '#e89a00', pupil: '#1a1000', tail1: '#8a8a96', tail2: '#3a3a44', nose: '#e88a9a' },
      shiny: { fur: '#d9b98a', fur2: '#ead2ab', shade: '#a77f4c', belly: '#fffaf0', line: '#4a3115', eye1: '#ffe14d', eye2: '#e89a00', pupil: '#1a1000', tail1: '#f2dfbd', tail2: '#b88752', nose: '#e88a9a' }
    },
    metal: {
      normal: { fur: '#6f7fa0', fur2: '#4a5776', furL: '#eef2f8', a1: '#f7f9fc', a2: '#a7b5cb', a3: '#5c6a85', trim: '#2b5bb0', line: '#18202f', s1: '#e8323d', s2: '#8c121b', g1: '#ffe590', g2: '#cf9416', eye: '#ffd43a', glow: null },
      shiny: { fur: '#3a3a44', fur2: '#222228', furL: '#7d7f8c', a1: '#4b4b55', a2: '#18181d', a3: '#0d0d10', trim: '#e3b22c', line: '#0a0a0c', s1: '#e8323d', s2: '#8c121b', g1: '#ffe590', g2: '#cf9416', eye: '#ffd43a', glow: null }
    },
    black: {
      normal: { fur: '#2d2e38', fur2: '#17181e', furL: '#5d606e', a1: '#575a66', a2: '#16171c', a3: '#08080b', trim: '#d01c2c', line: '#030305', s1: '#c8141f', s2: '#4e060b', g1: '#ff5560', g2: '#7a0a12', eye: '#ff2a36', glow: '#ff1f30' },
      shiny: { fur: '#2d2e38', fur2: '#17181e', furL: '#5d606e', a1: '#575a66', a2: '#16171c', a3: '#08080b', trim: '#9b38f0', line: '#030305', s1: '#7b23c9', s2: '#2c0750', g1: '#d79bff', g2: '#5a1596', eye: '#c45bff', glow: '#a63bff' }
    }
  };

  function wrap(inner, defs) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
      '<defs>' + defs + '</defs>' + inner + '</svg>';
  }
  function lg(id, a, b, x1, y1, x2, y2) {
    return '<linearGradient id="' + id + '" x1="' + (x1 || 0) + '" y1="' + (y1 || 0) + '" x2="' + (x2 == null ? 0 : x2) + '" y2="' + (y2 == null ? 1 : y2) + '">' +
      '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>';
  }
  function rg(id, a, b, cx, cy, r) {
    return '<radialGradient id="' + id + '" cx="' + (cx || 0.5) + '" cy="' + (cy || 0.4) + '" r="' + (r || 0.65) + '">' +
      '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></radialGradient>';
  }
  // 좌우 대칭 path: x → 512-x
  function mirror(d) {
    return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, function (_, x, y) {
      return (512 - parseFloat(x)) + ' ' + y;
    });
  }
  function both(d, attrs) {
    return '<path d="' + d + '" ' + attrs + '/><path d="' + mirror(d) + '" ' + attrs + '/>';
  }

  /* ───────────── 고양이 공통 ───────────── */
  var HEAD = 'M160 206 C156 150 200 116 256 116 C312 116 356 150 352 206 C358 213 368 220 372 232 C360 233 355 237 352 244 C342 284 304 306 256 306 C208 306 170 284 160 244 C157 237 152 233 140 232 C144 220 154 213 160 206 Z';
  var BODY = 'M206 296 C176 334 166 404 176 474 Q256 490 336 474 C346 404 336 334 306 296 Z';
  var LEG_L = 'M214 352 C210 396 208 440 211 462 Q212 480 232 480 L240 480 Q256 480 255 462 C256 440 254 396 250 352 Z';
  var LEG_SIDES = 'M214 368 C210 404 208 440 211 462 M255 462 C256 440 254 404 251 368';

  function catEyes(p, opt) {
    var s = '';
    [[214, 1], [298, -1]].forEach(function (e) {
      var cx = e[0], d = e[1];
      if (opt && opt.grumpy) {
        s += '<ellipse cx="' + cx + '" cy="216" rx="24" ry="22" fill="url(#gEye)" stroke="' + p.line + '" stroke-width="3.5"/>';
        s += '<ellipse cx="' + (cx + 2 * d) + '" cy="220" rx="5" ry="14" fill="' + p.pupil + '"/>';
        s += '<circle cx="' + (cx - 8 * d) + '" cy="222" r="4" fill="#fff" opacity=".9"/>';
        // 반쯤 감긴 눈꺼풀(안쪽이 더 내려감)
        var outer = cx - 28 * d, inner = cx + 28 * d;
        s += '<path d="M' + outer + ' 186 L' + inner + ' 186 L' + inner + ' 214 L' + outer + ' 204 Z" fill="' + p.fur + '"/>';
        s += '<path d="M' + (cx - 25 * d) + ' 205 L' + (cx + 25 * d) + ' 214" stroke="' + p.line + '" stroke-width="6" stroke-linecap="round"/>';
        s += '<path d="M' + (cx - 26 * d) + ' 186 L' + (cx + 22 * d) + ' 198" stroke="' + p.line + '" stroke-width="5" stroke-linecap="round" opacity=".85"/>';
      } else {
        s += '<ellipse cx="' + cx + '" cy="214" rx="25" ry="31" fill="url(#gEye)" stroke="' + p.line + '" stroke-width="3.5"/>';
        s += '<ellipse cx="' + (cx + 2 * d) + '" cy="221" rx="12" ry="17" fill="' + p.pupil + '"/>';
        s += '<ellipse cx="' + cx + '" cy="236" rx="15" ry="6" fill="#fff" opacity=".18"/>';
        s += '<circle cx="' + (cx - 8) + '" cy="201" r="8.5" fill="#fff"/>';
        s += '<circle cx="' + (cx + 9) + '" cy="229" r="4" fill="#fff" opacity=".9"/>';
        s += '<path d="M' + (cx - 27) + ' 200 Q' + cx + ' 174 ' + (cx + 27) + ' 196" stroke="' + p.line + '" stroke-width="5.5" fill="none" stroke-linecap="round"/>';
        s += '<path d="M' + (cx + 24 * d) + ' 196 l' + (8 * d) + ' -7" stroke="' + p.line + '" stroke-width="4" stroke-linecap="round"/>';
      }
    });
    return s;
  }
  function catWhiskers(p) {
    var a = 'stroke="' + p.line + '" stroke-width="2.2" stroke-linecap="round" opacity=".55" fill="none"';
    return both('M178 246 Q156 240 132 238', a) + both('M178 254 Q156 256 134 262', a);
  }
  function catLegs(p, pawFill) {
    var s = both(LEG_L, 'fill="url(#gFur)"');
    s += both(LEG_SIDES, 'fill="none" stroke="' + p.line + '" stroke-width="5" stroke-linecap="round"');
    s += both('M220 372 C218 400 217 430 218 452', 'fill="none" stroke="#fff" stroke-width="4" opacity=".35" stroke-linecap="round"');
    var pf = 'fill="' + (pawFill || p.fur) + '" stroke="' + p.line + '" stroke-width="5"';
    s += both('M208 462 Q208 484 233 484 Q258 484 258 462 Q246 452 233 452 Q218 452 208 462 Z', pf);
    var t = 'stroke="' + p.line + '" stroke-width="3" stroke-linecap="round" opacity=".7"';
    s += both('M226 470 L226 482', t) + both('M240 470 L240 482', t);
    return s;
  }
  function catHaunch(p) {
    var a = 'fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5"';
    return both('M150 448 C146 410 176 392 206 400 C228 408 236 440 226 470 Q206 486 176 482 C158 478 152 466 150 448 Z', a);
  }

  /* ───────────── 나루냥 ───────────── */
  function naru(p) {
    var defs = lg('gFur', p.fur, p.fur2) + lg('gEye', p.eye1, p.eye2) +
      lg('gW', p.w1, p.w2, 0, 0, 1, 1) + rg('gBub', '#ffffff', p.w2, 0.35, 0.3, 0.8) +
      lg('gHead', p.fur, p.fur2, 0, 0.1, 0, 1.2);
    var bub = function (x, y, r) {
      return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#gBub)" opacity=".85" stroke="' + p.w2 + '" stroke-width="2"/>' +
        '<circle cx="' + (x - r * 0.35) + '" cy="' + (y - r * 0.35) + '" r="' + (r * 0.28) + '" fill="#fff"/>';
    };
    var s = '';
    // 물방울 꼬리(뒤)
    s += '<path d="M318 452 C392 452 446 408 444 344 C442 292 398 262 360 280 C330 294 334 336 362 340 C384 343 392 318 378 306" fill="none" stroke="' + p.line + '" stroke-width="40" stroke-linecap="round" opacity=".9"/>';
    s += '<path d="M318 452 C392 452 446 408 444 344 C442 292 398 262 360 280 C330 294 334 336 362 340 C384 343 392 318 378 306" fill="none" stroke="url(#gW)" stroke-width="30" stroke-linecap="round"/>';
    s += '<path d="M340 446 C400 440 432 400 430 346" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".7"/>';
    s += bub(452, 262, 15) + bub(470, 304, 9) + bub(414, 232, 10) + bub(440, 210, 6);
    s += catHaunch(p);
    s += '<path d="' + BODY + '" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5"/>';
    s += '<path d="M228 318 C214 360 216 420 224 474 L288 474 C296 420 298 360 284 318 Z" fill="' + p.belly + '"/>';
    // 몸 무늬
    s += '<path d="M180 420 C190 404 214 404 222 420 C214 436 192 438 180 420 Z" fill="' + p.shade + '" opacity=".55"/>';
    s += '<path d="M316 330 C328 322 340 336 334 350 C322 352 312 344 316 330 Z" fill="' + p.shade + '" opacity=".5"/>';
    s += catLegs(p, p.belly);
    // 가슴 털
    s += '<path d="M206 292 L222 326 L234 306 L246 334 L256 308 L266 334 L278 306 L290 326 L306 292 Z" fill="' + p.belly + '" stroke="' + p.line + '" stroke-width="4" stroke-linejoin="round"/>';
    // 귀
    var ear = 'M168 178 L160 62 Q164 50 176 58 L242 128 Z';
    s += both(ear, 'fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"');
    s += both('M178 162 L174 84 L226 134 Z', 'fill="' + p.inner + '"');
    s += both('M170 60 Q190 92 206 106', 'stroke="#fff" stroke-width="5" fill="none" opacity=".6" stroke-linecap="round"');
    // 머리
    s += '<path d="' + HEAD + '" fill="url(#gHead)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '<path d="M190 150 C210 128 240 122 262 124" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".8"/>';
    s += '<path d="M194 252 C198 228 232 222 256 238 C280 222 314 228 318 252 C316 286 288 304 256 304 C224 304 196 286 194 252 Z" fill="' + p.belly + '"/>';
    s += both('M152 228 L172 236 L160 246', 'fill="' + p.belly + '" stroke="none"');
    // 이마 물방울
    s += '<path d="M256 136 C264 150 272 160 272 170 A16 16 0 0 1 240 170 C240 160 248 150 256 136 Z" fill="url(#gW)" stroke="' + p.line + '" stroke-width="3"/>';
    s += '<ellipse cx="251" cy="166" rx="4" ry="6" fill="#fff" opacity=".9"/>';
    s += catEyes(p);
    s += both('M180 252 m-14 0 a14 7 0 1 0 28 0 a14 7 0 1 0 -28 0', 'fill="' + p.blush + '" opacity=".45"');
    s += '<path d="M248 248 L264 248 L256 257 Z" fill="' + p.nose + '" stroke="' + p.line + '" stroke-width="2" stroke-linejoin="round"/>';
    s += '<path d="M242 262 Q249 271 256 262 Q263 271 270 262" stroke="' + p.line + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    s += catWhiskers(p);
    // 떠 있는 물방울
    s += bub(96, 180, 13) + bub(70, 236, 8) + bub(120, 120, 7) + bub(392, 120, 9);
    return wrap(s, defs);
  }

  /* ───────────── 설냥이 ───────────── */
  function crystal(p, pts, facet) {
    return '<path d="' + pts + '" fill="url(#gC)" stroke="' + p.line + '" stroke-width="4" stroke-linejoin="round"/>' +
      (facet ? '<path d="' + facet + '" stroke="#fff" stroke-width="3" fill="none" opacity=".85" stroke-linecap="round"/>' : '');
  }
  function seol(p) {
    var defs = lg('gFur', p.fur, p.fur2) + lg('gEye', p.eye1, p.eye2) + lg('gC', p.c1, p.c3, 0, 0, 1, 1) +
      lg('gHead', p.fur, p.fur2, 0, 0.3, 0, 1) + rg('gSpark', '#ffffff', 'rgba(255,255,255,0)', 0.5, 0.5, 0.5);
    var s = '';
    // 꼬리: 풍성한 털 + 결정
    s += '<path d="M316 456 C380 462 430 430 436 372 C440 330 420 292 394 270 C404 300 400 330 384 340 C394 312 380 290 362 280 C372 320 356 360 330 380 Z" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    s += crystal(p, 'M392 282 L404 182 L436 250 L420 300 Z', 'M404 186 L414 290');
    s += crystal(p, 'M418 300 L470 220 L462 300 L432 330 Z', 'M468 226 L446 310');
    s += crystal(p, 'M372 288 L360 214 L392 262 Z', 'M362 220 L380 274');
    s += crystal(p, 'M430 366 L476 336 L456 392 Z', 'M472 340 L446 380');
    s += catHaunch(p);
    s += '<path d="' + BODY + '" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5"/>';
    s += '<path d="M190 380 C196 410 196 440 186 466" stroke="' + p.shade + '" stroke-width="5" fill="none" opacity=".5" stroke-linecap="round"/>';
    s += catLegs(p);
    // 발목 결정
    s += crystal(p, 'M212 420 L200 388 L222 404 Z') + crystal(p, 'M300 420 L312 388 L290 404 Z');
    // 귀(결정 귀)
    s += both('M168 178 L156 58 Q160 48 172 56 L242 128 Z', 'fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"');
    s += both('M176 160 L168 72 L222 126 Z', 'fill="url(#gC)" stroke="' + p.line + '" stroke-width="3" stroke-linejoin="round"');
    s += both('M170 78 L190 150', 'stroke="#fff" stroke-width="3" opacity=".9" stroke-linecap="round"');
    s += both('M150 130 L132 96 L158 112 Z', 'fill="url(#gC)" stroke="' + p.line + '" stroke-width="3" stroke-linejoin="round"');
    // 머리(털 많은 볼)
    s += '<path d="M160 206 C156 150 200 116 256 116 C312 116 356 150 352 206 L376 214 L358 226 L382 240 L354 246 C342 284 304 306 256 306 C208 306 170 284 158 246 L130 240 L154 226 L136 214 Z" fill="url(#gHead)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '<path d="M196 146 C214 128 238 122 258 124" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>';
    s += '<circle cx="232" cy="158" r="5" fill="' + p.c2 + '" opacity=".6"/>';
    // 이마 다이아
    s += crystal(p, 'M256 132 L272 156 L256 184 L240 156 Z', 'M256 136 L262 156');
    s += catEyes(p);
    s += both('M180 252 m-14 0 a14 7 0 1 0 28 0 a14 7 0 1 0 -28 0', 'fill="' + p.blush + '" opacity=".45"');
    s += '<path d="M249 248 L263 248 L256 256 Z" fill="' + p.nose + '"/>';
    s += '<path d="M244 262 Q250 269 256 262 Q262 269 268 262" stroke="' + p.line + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    s += catWhiskers(p);
    // 가슴 결정 목도리
    var col = '';
    [[196, 296, -38], [222, 308, -18], [256, 314, 0], [290, 308, 18], [316, 296, 38]].forEach(function (c) {
      col += '<g transform="translate(' + c[0] + ' ' + c[1] + ') rotate(' + c[2] + ')">' +
        crystal(p, 'M0 -14 L13 8 L0 34 L-13 8 Z', 'M0 -10 L4 8') + '</g>';
    });
    s += col;
    // 반짝임
    var sp = function (x, y, r) { return '<path d="M' + x + ' ' + (y - r) + ' L' + (x + r * 0.25) + ' ' + (y - r * 0.25) + ' L' + (x + r) + ' ' + y + ' L' + (x + r * 0.25) + ' ' + (y + r * 0.25) + ' L' + x + ' ' + (y + r) + ' L' + (x - r * 0.25) + ' ' + (y + r * 0.25) + ' L' + (x - r) + ' ' + y + ' L' + (x - r * 0.25) + ' ' + (y - r * 0.25) + ' Z" fill="#fff" stroke="' + p.c2 + '" stroke-width="1.5"/>'; };
    s += sp(96, 150, 14) + sp(74, 214, 8) + sp(430, 140, 10) + sp(120, 92, 6);
    return wrap(s, defs);
  }

  /* ───────────── 싸가지냥 ───────────── */
  function ssaga(p) {
    var defs = lg('gFur', p.fur2, p.fur) + lg('gEye', p.eye1, p.eye2) + lg('gHead', p.fur2, p.fur, 0, 0, 0, 1) +
      lg('gTail', p.tail1, p.tail2, 0, 0, 1, 0);
    var s = '';
    // 줄무늬 꼬리(위로 삐딱하게)
    var tail = 'M320 452 C380 456 410 420 404 360 C400 316 420 280 448 262';
    s += '<path d="' + tail + '" fill="none" stroke="' + p.line + '" stroke-width="40" stroke-linecap="round"/>';
    s += '<path d="' + tail + '" fill="none" stroke="url(#gTail)" stroke-width="30" stroke-linecap="round"/>';
    s += '<path d="' + tail + '" fill="none" stroke="' + p.tail2 + '" stroke-width="30" stroke-dasharray="12 16" stroke-linecap="butt" opacity=".9"/>';
    s += '<path d="M436 252 L452 238 L452 260 L470 252 L458 270 Z" fill="' + p.tail2 + '" stroke="' + p.line + '" stroke-width="4" stroke-linejoin="round"/>';
    s += catHaunch(p);
    s += '<path d="' + BODY + '" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5"/>';
    // 턱시도 가슴
    s += '<path d="M222 300 C208 350 214 420 226 474 L286 474 C298 420 304 350 290 300 Z" fill="' + p.belly + '"/>';
    s += catLegs(p, p.belly);
    s += both('M212 440 L254 440', 'stroke="' + p.belly + '" stroke-width="0"');
    // 귀 (오른쪽 귀는 찢어짐)
    s += '<path d="M168 178 L156 64 Q160 52 172 60 L242 128 Z" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '<path d="M344 178 L350 106 L334 112 L346 84 L342 64 Q338 54 328 62 L270 128 Z" fill="url(#gFur)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    s += '<path d="M178 160 L172 88 L222 132 Z" fill="#d98c9c" opacity=".8"/>';
    s += '<path d="M334 160 L338 96 L290 132 Z" fill="#d98c9c" opacity=".8"/>';
    // 머리
    s += '<path d="' + HEAD + '" fill="url(#gHead)" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    // 헝클어진 정수리 털
    s += '<path d="M214 128 L222 96 L236 120 L250 86 L260 118 L276 92 L282 122 L300 104 L298 132 Z" fill="' + p.fur + '" stroke="' + p.line + '" stroke-width="5" stroke-linejoin="round"/>';
    // 흰 주둥이 + 이마 줄
    s += '<path d="M252 128 L246 176 L256 196 L266 176 L260 128 Z" fill="' + p.belly + '" opacity=".95"/>';
    s += '<path d="M200 252 C204 226 236 220 256 236 C276 220 308 226 312 252 C312 286 284 304 256 304 C228 304 200 286 200 252 Z" fill="' + p.belly + '"/>';
    s += catEyes(p, { grumpy: true });
    // 찌푸린 눈썹
    s += both('M190 176 L236 190', 'stroke="' + p.belly + '" stroke-width="4" stroke-linecap="round" opacity=".7"');
    s += '<path d="M249 248 L263 248 L256 256 Z" fill="' + p.nose + '" stroke="' + p.line + '" stroke-width="2"/>';
    // 짜증난 입 + 송곳니
    s += '<path d="M236 274 Q256 262 278 272" stroke="' + p.line + '" stroke-width="4" fill="none" stroke-linecap="round"/>';
    s += '<path d="M266 268 L270 280 L274 270 Z" fill="#fff" stroke="' + p.line + '" stroke-width="2" stroke-linejoin="round"/>';
    s += '<path d="M256 256 L256 266" stroke="' + p.line + '" stroke-width="3"/>';
    s += catWhiskers(p);
    // 짜증 표시
    s += '<g transform="translate(372 120)" stroke="#ff4b4b" stroke-width="6" stroke-linecap="round" fill="none">' +
      '<path d="M-14 -4 Q-4 -4 -4 -14"/><path d="M4 -14 Q4 -4 14 -4"/><path d="M14 4 Q4 4 4 14"/><path d="M-4 14 Q-4 4 -14 4"/></g>';
    return wrap(s, defs);
  }

  /* ───────────── 메탈가디언몬 / 블랙 ───────────── */
  function wolf(p, dark) {
    var defs = lg('gFur', p.fur, p.fur2) + lg('gA', p.a1, p.a2, 0, 0, 0.4, 1) + lg('gA2', p.a2, p.a3, 0, 0, 0, 1) +
      lg('gS', p.s1, p.s2, 0, 0, 1, 1) + rg('gG', p.g1, p.g2, 0.4, 0.35, 0.7) + lg('gFurL', p.furL, p.fur, 0, 0, 0, 1) +
      (p.glow ? '<filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
        rg('gAura', p.glow, 'rgba(0,0,0,0)', 0.5, 0.6, 0.55) : '');
    var L = p.line, sw = 'stroke="' + L + '" stroke-width="5" stroke-linejoin="round"';
    var s = '';
    if (dark) s += '<ellipse cx="256" cy="330" rx="250" ry="200" fill="url(#gAura)" opacity=".45"/>';
    // 스카프 꼬리(왼쪽으로 펄럭)
    var scarf = dark ?
      'M206 250 C160 240 120 262 84 236 L96 258 L60 262 L82 282 L40 292 C90 322 150 302 196 290 Z' :
      'M206 250 C160 236 116 262 74 232 C92 270 70 288 44 288 C88 326 150 306 196 290 Z';
    s += '<path d="' + scarf + '" fill="url(#gS)" ' + sw + '/>';
    s += '<path d="M190 268 C150 274 116 282 84 278" stroke="' + p.s2 + '" stroke-width="4" fill="none" opacity=".7"/>';
    // 금속 꼬리
    s += '<path d="M350 432 C420 430 470 376 462 300 C458 270 440 256 424 262 C446 316 424 380 344 396 Z" fill="url(#gA)" ' + sw + '/>';
    s += '<path d="M372 420 L384 392 M404 404 L408 374 M430 380 L426 350 M446 346 L436 322" stroke="' + L + '" stroke-width="4"/>';
    s += '<path d="M440 300 C452 330 444 360 424 384" stroke="#fff" stroke-width="5" fill="none" opacity="' + (dark ? '.25' : '.7') + '" stroke-linecap="round"/>';
    if (dark) s += '<path d="M430 270 L462 236 L454 282 Z M452 322 L494 302 L466 344 Z M440 378 L478 380 L446 404 Z" fill="url(#gA2)" ' + sw + '/>';
    // 뒷다리(장갑)
    s += both('M116 448 C112 396 150 372 196 380 C226 388 236 430 226 476 Q190 492 146 486 C124 480 116 466 116 448 Z', 'fill="url(#gA)" ' + sw);
    s += both('M136 430 C150 404 180 398 204 408', 'stroke="' + p.trim + '" stroke-width="7" fill="none" stroke-linecap="round"');
    // 몸통
    s += '<path d="M178 246 C150 300 150 390 170 452 L342 452 C362 390 362 300 334 246 Z" fill="url(#gFur)" ' + sw + '/>';
    // 배·가슴 흰털(다리 사이)
    s += '<path d="M222 340 C214 380 218 420 226 452 L286 452 C294 420 298 380 290 340 Z" fill="url(#gFurL)"/>';
    s += '<path d="M226 360 L236 392 L246 372 L256 404 L266 372 L276 392 L286 360" fill="none" stroke="' + p.fur2 + '" stroke-width="3" opacity=".5" stroke-linejoin="round"/>';
    // 앞다리(건틀릿) — 어깨에서 내려와 가슴 양옆
    var leg = 'M164 296 C156 350 154 410 160 456 L218 456 C224 410 226 350 222 300 Z';
    s += both(leg, 'fill="url(#gA)" ' + sw);
    s += both('M160 360 C176 366 204 366 222 360', 'stroke="' + p.trim + '" stroke-width="8" fill="none" stroke-linecap="round"');
    s += both('M158 410 C176 414 204 414 222 410', 'stroke="' + L + '" stroke-width="4" fill="none"');
    s += both('M172 316 C168 350 166 390 168 430', 'stroke="#fff" stroke-width="5" fill="none" opacity="' + (dark ? '.25' : '.75') + '" stroke-linecap="round"');
    // 흉갑(위쪽 가슴)
    s += '<path d="M206 262 L306 262 L314 312 C306 344 282 364 256 374 C230 364 206 344 198 312 Z" fill="url(#gA)" ' + sw + '/>';
    s += '<path d="M214 272 L298 272 L304 310 C296 336 276 352 256 360 C236 352 216 336 208 310 Z" fill="none" stroke="' + p.trim + '" stroke-width="5"/>';
    s += '<path d="M218 284 C226 280 240 279 248 280" stroke="#fff" stroke-width="5" fill="none" opacity="' + (dark ? '.3' : '.9') + '" stroke-linecap="round"/>';
    // 엠블럼
    s += '<circle cx="256" cy="312" r="27" fill="url(#gG)" ' + sw + '/>';
    s += '<path d="M256 294 L272 301 L270 319 C266 327 261 330 256 332 C251 330 246 327 242 319 L240 301 Z" fill="' + (dark ? p.a3 : p.trim) + '" stroke="' + L + '" stroke-width="3"/>';
    s += '<path d="M256 301 L262 312 L256 325 L250 312 Z" fill="' + p.g1 + '"/>';
    // 앞발 + 발톱
    s += both('M146 452 Q140 494 190 496 Q236 494 232 452 Z', 'fill="url(#gFur)" ' + sw);
    s += both('M166 470 L166 490 M190 472 L190 494 M212 470 L212 490', 'stroke="' + L + '" stroke-width="3" opacity=".6"');
    var claw = 'fill="' + (dark ? '#d9dbe2' : '#ffffff') + '" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"';
    s += both('M154 482 L144 508 L168 492 Z', claw) + both('M178 488 L174 511 L194 494 Z', claw) + both('M202 488 L206 511 L218 492 Z', claw);
    // 견갑(어깨 장갑)
    s += both('M140 286 C136 248 176 230 214 248 L218 302 C192 316 160 314 144 302 Z', 'fill="url(#gA)" ' + sw);
    s += both('M150 290 C152 264 178 252 206 262', 'stroke="' + p.trim + '" stroke-width="7" fill="none" stroke-linecap="round"');
    s += both('M166 296 m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0', 'fill="' + p.g1 + '" stroke="' + L + '" stroke-width="2"');
    if (dark) s += both('M150 262 L126 206 L174 246 Z', 'fill="url(#gA2)" ' + sw) + both('M186 244 L182 200 L204 240 Z', 'fill="url(#gA2)" ' + sw);
    // 목 스카프
    s += '<path d="M190 236 Q256 276 322 236 L330 266 Q256 312 182 266 Z" fill="url(#gS)" ' + sw + '/>';
    s += '<path d="M206 262 Q256 290 306 262" stroke="' + p.s2 + '" stroke-width="4" fill="none" opacity=".8"/>';
    s += '<path d="M186 252 L172 236 L200 240 Z" fill="url(#gS)" ' + sw + '/>';
    // 머리 (조금 크게)
    s += '<g transform="translate(256 200) scale(1.13) translate(-256 -200)">';
    var head = 'M194 156 L166 54 L226 112 Q256 102 286 112 L346 54 L318 156 C334 176 338 202 326 220 L302 246 Q256 270 210 246 L186 220 C174 202 178 176 194 156 Z';
    s += '<path d="' + head + '" fill="url(#gFur)" ' + sw + '/>';
    s += both('M182 82 L196 140 L214 118 Z', 'fill="' + p.fur2 + '" stroke="' + L + '" stroke-width="3"');
    // 볼 털
    s += both('M186 220 L160 230 L178 206 L156 204 L182 186', 'fill="url(#gFur)" ' + sw);
    // 주둥이
    s += '<path d="M220 194 Q256 182 292 194 L288 236 Q256 262 224 236 Z" fill="url(#gFurL)" stroke="' + L + '" stroke-width="4" stroke-linejoin="round"/>';
    s += '<path d="M242 220 L270 220 Q268 236 256 238 Q244 236 242 220 Z" fill="' + L + '"/>';
    s += '<ellipse cx="250" cy="224" rx="5" ry="3" fill="#fff" opacity=".6"/>';
    if (dark) {
      // 으르렁: 벌린 입 + 송곳니
      s += '<path d="M228 244 Q256 266 284 244 L280 258 Q256 276 232 258 Z" fill="#3a0006" stroke="' + L + '" stroke-width="3"/>';
      s += '<path d="M234 246 L238 262 L244 249 Z M278 246 L274 262 L268 249 Z" fill="#fff" stroke="' + L + '" stroke-width="2"/>';
    } else {
      s += '<path d="M256 238 L256 248 M240 248 Q256 256 272 248" stroke="' + L + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>';
    }
    // 투구
    s += '<path d="M214 126 L256 110 L298 126 L292 168 L256 180 L220 168 Z" fill="url(#gA)" ' + sw + '/>';
    s += '<path d="M256 116 L256 176" stroke="' + p.trim + '" stroke-width="7"/>';
    s += '<path d="M256 140 L266 152 L256 166 L246 152 Z" fill="url(#gG)" stroke="' + L + '" stroke-width="2.5"/>';
    if (dark) s += '<path d="M222 132 L206 86 L236 124 Z M290 132 L306 86 L276 124 Z" fill="url(#gA2)" ' + sw + '/>';
    // 눈(날카로움)
    var eyeFill = p.eye;
    var eyeAttr = 'fill="' + eyeFill + '" stroke="' + L + '" stroke-width="3.5" stroke-linejoin="round"' + (p.glow ? ' filter="url(#fGlow)"' : '');
    s += both('M200 182 L240 194 L236 206 L206 198 Z', eyeAttr);
    s += both('M222 192 L228 194 L226 203 L220 201 Z', 'fill="' + (dark ? '#2a0004' : '#1a1200') + '"');
    s += both('M194 172 L242 186', 'stroke="' + L + '" stroke-width="6" stroke-linecap="round"');
    if (dark) s += '<path d="M256 110 L250 96 M256 180 L262 196" stroke="' + p.glow + '" stroke-width="3.5" fill="none" stroke-linecap="round" filter="url(#fGlow)"/>';
    s += '</g>';
    if (dark) {
      // 붉은 발광 균열
      var crack = 'stroke="' + p.glow + '" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#fGlow)"';
      s += '<path d="M218 288 L230 304 L222 324 L238 342" ' + crack + '/>';
      s += '<path d="M296 286 L284 304 L292 324 L278 346" ' + crack + '/>';
      s += both('M176 326 L190 356 L180 382 L194 420', crack);
      s += both('M130 420 L150 436 L144 458', crack);
      s += both('M160 262 L176 280 L170 296', crack);
      s += '<path d="M256 380 L250 400 L260 420 L254 440" ' + crack + '/>';
      s += '<circle cx="256" cy="312" r="31" fill="none" stroke="' + p.glow + '" stroke-width="3" opacity=".8" filter="url(#fGlow)"/>';
    }
    return wrap(s, defs);
  }

  var DRAW = { naru: naru, seol: seol, ssaga: ssaga, metal: function (p) { return wolf(p, false); }, black: function (p) { return wolf(p, true); } };

  function sprite(id, opt) {
    var pal = PAL[id][(opt && opt.shiny) ? 'shiny' : 'normal'];
    return DRAW[id](pal);
  }
  function spriteURL(id, opt) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sprite(id, opt));
  }

  var api = { sprite: sprite, spriteURL: spriteURL, PAL: PAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sprites = api;
})(typeof window !== 'undefined' ? window : globalThis);
