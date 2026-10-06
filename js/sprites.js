/* 포캣몬 캐릭터 일러스트 — assets/mon/*.webp (2img 생성 → 크로마키 → 768×768, 투명 배경)
   구도: 정사각 캔버스, 발끝이 바닥 중앙(아래 여백 3.1%), 그림 높이 약 92%.
   이로치는 고양이 3종만 있다(게임에서 이로치는 고양이 상대에게만 나온다). */
(function (root) {
  'use strict';

  var SHINY = { naru: true, seol: true, ssaga: true };

  // 이 스크립트 위치(js/) 기준으로 assets/ 경로를 정한다 — tools/ 하위 페이지에서도 동작
  var base = 'assets/mon/';
  try {
    var cur = typeof document !== 'undefined' && (document.currentScript ||
      Array.prototype.slice.call(document.getElementsByTagName('script')).filter(function (s) { return /js\/sprites\.js/.test(s.src); })[0]);
    if (cur && cur.src) base = cur.src.replace(/js\/sprites\.js.*$/, 'assets/mon/');
  } catch (e) { /* 기본 상대 경로 사용 */ }

  function spriteURL(id, opt) {
    var shiny = !!(opt && opt.shiny) && SHINY[id];
    return base + id + (shiny ? '_shiny' : '') + '.webp';
  }

  var api = { spriteURL: spriteURL, FOOT: 0.031, ART_TOP: 0.86, hasShiny: function (id) { return !!SHINY[id]; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sprites = api;
})(typeof window !== 'undefined' ? window : globalThis);
