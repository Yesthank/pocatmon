/* 포캣몬 배틀 — 화면 흐름 · 배틀 이벤트 재생 · 컷신
   전역 PData / PEngine / Sprites / Sfx / Stage 를 쓴다. 모듈 아님.
   테스트용: document.body.dataset.screen = title|starter|field|map|party|bag|dex|battle|cutscene|result|evolve|ending
            ?fast → UI 지연·타자 속도 단축, ?seed=N → 고정 난수, ?2d → 2D 무대 강제 */
(function () {
  'use strict';
  var D = window.PData, E = window.PEngine, M = D.MONSTERS, MV = D.MOVES, TY = D.TYPES, TU = D.TUNING, IT = D.ITEMS;
  var PM = window.PMaps, PW = window.PWorld;

  /* ───────── 설정 ───────── */
  var Q = (function () {
    try { return new URLSearchParams(location.search); } catch (e) { return { has: function () { return false; }, get: function () { return null; } }; }
  })();
  var FAST = Q.has('fast');
  function T(n) { return FAST ? Math.round(n * 0.12) : n; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var seed = parseInt(Q.get('seed'), 10);
  var rng = isFinite(seed) ? mulberry32(seed) : Math.random;

  var ls = null;
  try { ls = window.localStorage; } catch (e) { ls = null; }
  var store;
  try { store = E.createStore(ls); } catch (e) { store = E.createStore(null); }

  var STAT_MAX = 130;
  var STAT_LABEL = [['hp', 'HP'], ['atk', '공격'], ['def', '방어'], ['spa', '특공'], ['spd', '특방'], ['spe', '스피드']];
  var CAT_LABEL = { phys: '물리', spec: '특수', status: '변화' };

  /* ───────── 유틸 ───────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function sleep(n) { return new Promise(function (r) { setTimeout(r, n); }); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  var sprCache = {};
  function spr(id, shiny) {
    var k = id + (shiny ? '*' : '');
    if (sprCache[k] == null) {
      try { sprCache[k] = Sprites.spriteURL(id, { shiny: !!shiny }); } catch (e) { sprCache[k] = ''; }
    }
    return sprCache[k];
  }
  function img(id, cls, shiny) { return '<img class="' + (cls || '') + '" src="' + spr(id, shiny) + '" alt="" draggable="false">'; }
  function chips(types) {
    return types.map(function (t) { return '<span class="chip" style="--tc:' + TY[t].color + '">' + esc(TY[t].name) + '</span>'; }).join('');
  }
  function mainColor(id) { return TY[M[id].types[0]].color; }
  function areaOf(id) { return E.areaById(id); }
  function bgURL(key) { return 'assets/bg/' + key + '.jpg'; }
  function expPct(lv, exp) {
    if (lv >= TU.maxLevel) return 100;
    var a = E.expForLevel(lv), b = E.expForLevel(lv + 1);
    return Math.max(0, Math.min(100, (exp - a) / (b - a) * 100));
  }
  function hpBar(hp, max, cls) {
    var p = max ? hp / max : 0;
    return '<span class="hp-track ' + (cls || '') + '"><span class="hp-fill' + (p < 0.2 ? ' low' : p < 0.5 ? ' mid' : '') + '" style="width:' + (p * 100).toFixed(1) + '%"></span></span>';
  }
  function statusChip(kind) {
    if (!kind) return '';
    var s = D.STATUS[kind];
    return '<span class="stchip" style="--tc:' + s.color + '">' + esc(s.short) + '</span>';
  }
  var ICON = {
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="2"/></svg>',
    party: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.8" fill="var(--bg)" stroke="currentColor" stroke-width="2"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14l-1.2 11H6.2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9 9V7a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    field: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20l6-9 4 5 3-3 5 7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="17" cy="6" r="2.4" fill="currentColor"/></svg>',
    dex: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 17h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  // 타입 문양(흰색 단색, 24×24) — 기술 패널 엠블럼용
  var TYPE_GLYPH = {
    normal: '<path fill="#fff" d="M12 2.2l2.7 7.1 7.1 2.7-7.1 2.7L12 21.8l-2.7-7.1L2.2 12l7.1-2.7z"/>',
    fire: '<path fill="#fff" d="M12 2c1 4 5.5 6 5.5 11.5a5.5 5.5 0 0 1-11 0c0-3 1.8-4.3 2.2-6.5 1.2 1.1 2 2.4 2 4.2 1.3-2.6 1.6-5.8 1.3-9.2z"/>',
    water: '<path fill="#fff" d="M12 2.5c-3.6 5-6.6 8.7-6.6 12.1A6.6 6.6 0 0 0 18.6 14.6c0-3.4-3-7.1-6.6-12.1z"/><path fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1.6" stroke-linecap="round" d="M8.9 14.8a3.3 3.3 0 0 0 2.6 3"/>',
    electric: '<path fill="#fff" d="M13.5 2L4.5 13.5h6l-1.5 8.5 9.5-12h-6.2z"/>',
    grass: '<path fill="#fff" d="M20 3.5C10.5 3.5 4 8.5 4 16c0 2 .8 4.5.8 4.5s2-6.3 9.2-9.7c-5 3.9-7 7.2-7.7 9.2C15 20 20.5 13.5 20 3.5z"/>',
    ice: '<g stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="M9.5 3.8 12 6.2l2.5-2.4M9.5 20.2 12 17.8l2.5 2.4M3.6 10.3l3.3.9-.8 3.3M20.4 10.3l-3.3.9.8 3.3"/></g>',
    fighting: '<path fill="#fff" d="M6.5 10V8.2a1.9 1.9 0 0 1 3.8 0V7a1.9 1.9 0 0 1 3.8 0v1.2a1.9 1.9 0 0 1 3.8 0V15a6.5 6.5 0 0 1-6.5 6.5h-.6A5.3 5.3 0 0 1 5.5 16.2V12a1.6 1.6 0 0 1 1-2z"/>',
    poison: '<path fill="#fff" d="M12 3a6.3 6.3 0 0 1 6.3 6.3c0 2.8-1.9 4-2.3 6.2H8c-.4-2.2-2.3-3.4-2.3-6.2A6.3 6.3 0 0 1 12 3zM8.6 17h6.8v3.6H8.6z"/><circle cx="9.7" cy="9.6" r="1.5" fill="rgba(0,0,0,.35)"/><circle cx="14.3" cy="9.6" r="1.5" fill="rgba(0,0,0,.35)"/>',
    ground: '<path fill="#fff" d="M2 19l6.5-9.5 4 5.5 3-3.5L22 19z"/><path fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" d="M3 21.5h18"/>',
    flying: '<path fill="#fff" d="M2.5 14.5c5.5.3 9.6-2.7 11.6-9 1.2 3.8.2 7.1-1.9 9.3 3.2.2 6.4-.9 9.3-3.8-2 6.2-7.2 9.5-13.5 9.5-2.4 0-4.4-2.2-5.5-6z"/>',
    psychic: '<path fill="#fff" fill-rule="evenodd" d="M12 5.5c5.6 0 10 6.5 10 6.5s-4.4 6.5-10 6.5S2 12 2 12s4.4-6.5 10-6.5zm0 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"/>',
    bug: '<path fill="#fff" d="M12 6.5c3 0 5.2 2.6 5.2 5.8v2.4A5.2 5.2 0 0 1 12 19.9a5.2 5.2 0 0 1-5.2-5.2v-2.4c0-3.2 2.2-5.8 5.2-5.8z"/><path fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" d="M9.5 6.8 7.6 3.2M14.5 6.8l1.9-3.6M6.8 12H3.5M17.2 12h3.3M7 16.5l-2.8 1.8M17 16.5l2.8 1.8"/><path stroke="rgba(0,0,0,.3)" stroke-width="1.4" d="M12 8v11.5"/>',
    rock: '<path fill="#fff" d="M7.5 3.5h8.5l5 6.5-3 10.5H7l-4-8.5z"/><path fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1.4" d="M7.5 3.5 10 11l6-7.5M10 11l-7 1.5M10 11l7.5 9.5"/>',
    ghost: '<path fill="#fff" fill-rule="evenodd" d="M12 2.8a7.2 7.2 0 0 1 7.2 7.2v10.5l-2.4-2-2.4 2-2.4-2-2.4 2-2.4-2-2.4 2V10A7.2 7.2 0 0 1 12 2.8zM9.3 8.6a1.6 2 0 1 0 0 4 1.6 2 0 0 0 0-4zm5.4 0a1.6 2 0 1 0 0 4 1.6 2 0 0 0 0-4z"/>',
    dragon: '<path fill="#fff" d="M3.5 20.5c1.8-8.5 6.4-14.6 17-17-3 3.1-4.1 6.2-4 9.4 1.8-1.1 3.2-1 4.2-.1-4 .9-6.5 3.8-8.4 7.7z"/>',
    dark: '<g stroke="#fff" stroke-width="2.6" stroke-linecap="round" fill="none"><path d="M6.5 3.5c2.8 4.3 2.8 11.5-.6 17M12 2.8c3 4.8 3 13-.3 18.6M17.6 3.5c2.8 4.3 2.6 11.5-.8 17"/></g>',
    steel: '<path fill="#fff" fill-rule="evenodd" d="M12 2l8.7 5v10L12 22l-8.7-5V7zm0 6.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/>',
    fairy: '<path fill="#fff" d="M12 21s-8.2-5-8.2-11.2a4.6 4.6 0 0 1 8.2-2.9 4.6 4.6 0 0 1 8.2 2.9C20.2 16 12 21 12 21z"/>'
  };
  function glyph(type) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (TYPE_GLYPH[type] || TYPE_GLYPH.normal) + '</svg>'; }

  /* ───────── 상태 ───────── */
  var S = {
    gen: 0, screen: null, save: null, b: null, st: null, locked: true, disp: null,
    sel: 'naru', area: null, mode: 'root', partySel: null, dexSel: null, swapFrom: null, newConfirm: false,
    field: { player: null, enemy: null, enemyDown: false }, skip: null, inflight: null, lastBack: 'map',
    // 필드: W(맵 판정 객체) · st(플레이어 위치) · F(렌더러) · busy(이동·대화 중) · held(누르고 있는 방향) · tok(흐름 토큰)
    ow: { W: null, mapId: null, st: null, F: null, busy: false, held: null, tok: 0, steps: 0 },
    battleDone: null, bagSel: null, cmdItem: null, menuFrom: 'field'
  };
  var ABORT = { abort: true }, SKIP = { skip: true };
  function guard(g) { if (g !== S.gen) throw ABORT; }
  function swallow(e) { if (e !== ABORT && e !== SKIP) throw e; }
  function persist() { if (S.save) store.save(S.save); }

  /* ───────── 뼈대 ───────── */
  var app = $('app');
  app.innerHTML =
    '<div id="screen" class="screen-host"></div>' +
    '<div id="field" class="fieldv">' +
      '<div id="fcanvas" class="fcanvas"></div>' +
      '<div class="fhud"><span id="floc" class="floc"></span><span id="fmoney" class="fmoney"></span></div>' +
      '<div id="fbubbles" class="fbubbles"></div>' +
      '<div class="fpad" id="fpad">' +
        '<button type="button" class="fdir up" data-dir="up" aria-label="위">▲</button>' +
        '<button type="button" class="fdir left" data-dir="left" aria-label="왼쪽">◀</button>' +
        '<button type="button" class="fdir right" data-dir="right" aria-label="오른쪽">▶</button>' +
        '<button type="button" class="fdir down" data-dir="down" aria-label="아래">▼</button>' +
      '</div>' +
      '<button type="button" id="fA" class="fA" aria-label="조사하기">A</button>' +
      '<div id="fmsg" class="fmsg"><b id="fwho" class="fwho"></b><p id="ftext" class="ftext"></p><span class="msg-arrow">▼</span><div id="fchoice" class="fchoice"></div></div>' +
      '<div id="fcover" class="fcover"></div>' +
    '</div>' +
    '<div id="battle" class="battle">' +
      '<div id="arena" class="arena">' +
        '<div class="arena-ui">' +
          '<div class="cine-bar cine-top"></div><div class="cine-bar cine-bottom"></div>' +
          '<div id="plate-enemy" class="plate plate-enemy"></div>' +
          '<div id="plate-player" class="plate plate-player"></div>' +
          '<div id="shinytag" class="shinytag">✦ 이로치!</div>' +
          '<div id="bubbles" class="bubbles"></div>' +
          '<div id="narr" class="narr"></div>' +
          '<div class="cine-skip">탭하여 건너뛰기 ▸▸</div>' +
          '<div id="cover" class="cover"></div>' +
        '</div>' +
      '</div>' +
      '<div class="panel">' +
        '<div id="msgbox" class="msgbox"><p id="msgtext" class="msgtext"></p><span class="msg-arrow">▼</span>' +
          '<button id="cmd-back" class="cmd-back" type="button" aria-label="뒤로">‹ 뒤로</button></div>' +
        '<div id="moves" class="moves"></div>' +
      '</div>' +
      '<div id="overlay" class="overlay"></div>' +
    '</div>' +
    '<div class="hud">' +
      '<div class="hud-btns">' +
        '<button id="btn-mute" class="icon-btn" type="button" aria-label="소리 켜기/끄기"></button>' +
        '<button id="btn-menu" class="icon-btn" type="button" aria-label="메뉴">' + ICON.menu + '</button>' +
      '</div>' +
    '</div>' +
    '<div id="toast" class="toast"></div>' +
    '<div id="menu" class="menu" aria-hidden="true"><div class="menu-card" id="menu-card"></div></div>' +
    '<div id="sheet" class="sheet" aria-hidden="true"></div>';

  var host = $('screen'), battleEl = $('battle'), arena = $('arena'), overlay = $('overlay');
  var msgBox = $('msgbox'), msgText = $('msgtext'), movesEl = $('moves'), bubblesEl = $('bubbles'), narrEl = $('narr');
  var menuEl = $('menu'), coverEl = $('cover'), backBtn = $('cmd-back'), toastEl = $('toast');
  var fieldEl = $('field'), fcanvas = $('fcanvas'), fmsg = $('fmsg'), fwho = $('fwho'), ftext = $('ftext'), fchoice = $('fchoice');
  var sheetEl = $('sheet'), fcover = $('fcover'), fbubbles = $('fbubbles');

  function mark(name) {
    S.screen = name;
    document.body.dataset.screen = name;
  }
  function showLayer(name) { // 'host' | 'battle' | 'field'
    battleEl.classList.toggle('on', name === 'battle');
    fieldEl.classList.toggle('on', name === 'field');
    host.classList.toggle('on', name === 'host');
    if (S.st) { try { S.st.setPaused(name !== 'battle'); } catch (e) { /* 무시 */ } }
    if (S.ow.F) { try { S.ow.F.setPaused(name !== 'field'); } catch (e) { /* 무시 */ } }
  }
  function showBattle(on) { showLayer(on ? 'battle' : 'host'); }
  function ensureStage() {
    if (S.st) return S.st;
    S.st = Stage.create(arena, { force2d: Q.has('2d') });
    document.body.dataset.stageMode = S.st.mode;
    return S.st;
  }
  // 새 연출 메서드가 없는 무대에서도 멈추지 않게
  function stc(name) {
    var st = S.st, args = Array.prototype.slice.call(arguments, 1);
    try { if (st && typeof st[name] === 'function') return Promise.resolve(st[name].apply(st, args)); } catch (e) { /* 무시 */ }
    return Promise.resolve();
  }
  var toastT = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ───────── 소리·메뉴 ───────── */
  function syncMute() {
    $('btn-mute').innerHTML = Sfx.muted ? ICON.mute : ICON.sound;
    $('btn-mute').classList.toggle('is-muted', Sfx.muted);
    var mb = menuEl.querySelector('[data-act="menu-mute"]');
    if (mb) mb.textContent = Sfx.muted ? '소리 켜기' : '소리 끄기';
  }
  function menuHTML() {
    var mute = '<button type="button" class="btn btn-ghost" data-act="menu-mute">' + (Sfx.muted ? '소리 켜기' : '소리 끄기') + '</button>';
    if (S.screen === 'battle') {
      return '<div class="menu-title">메뉴</div>' +
        '<button type="button" class="btn btn-primary" data-act="menu-close">계속하기</button>' + mute +
        '<button type="button" class="btn btn-ghost" data-act="menu-quit">배틀 그만두기 <small>(이번 배틀은 없던 일로)</small></button>';
    }
    return '<div class="menu-title">메뉴</div>' +
      '<div class="menu-grid">' +
        '<button type="button" class="mtile" data-act="m-party">' + ICON.party + '<span>파티</span></button>' +
        '<button type="button" class="mtile" data-act="m-bag">' + ICON.bag + '<span>가방</span></button>' +
        '<button type="button" class="mtile" data-act="m-dex">' + ICON.dex + '<span>도감</span></button>' +
        '<button type="button" class="mtile" data-act="m-map">' + ICON.map + '<span>지도</span></button>' +
      '</div>' +
      '<p class="menu-save">자동 저장됨 · ' + S.save.money.toLocaleString() + '원</p>' +
      '<button type="button" class="btn btn-primary" data-act="menu-close">계속하기</button>' + mute +
      '<button type="button" class="btn btn-ghost" data-act="menu-title">타이틀로</button>';
  }
  function toggleMute() { Sfx.setMuted(!Sfx.muted); syncMute(); if (!Sfx.muted) Sfx.play('tap'); }
  function openMenu(on) {
    if (on) $('menu-card').innerHTML = menuHTML();
    menuEl.classList.toggle('on', !!on); menuEl.setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  $('btn-mute').addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
  $('btn-menu').addEventListener('click', function (e) {
    e.stopPropagation();
    if (S.screen === 'field' && (S.ow.busy || fmsg.classList.contains('on'))) return;
    Sfx.play('tap'); openMenu(true);
  });
  menuEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) { if (e.target === menuEl) openMenu(false); return; }
    var a = b.dataset.act;
    if (a === 'menu-close') { Sfx.play('tap'); openMenu(false); }
    else if (a === 'menu-mute') toggleMute();
    else if (a === 'menu-quit') {
      Sfx.play('cancel'); openMenu(false);
      if (!S.b || S.b.over) return;
      // 배틀 중 바뀐 상태(체력·PP·경험치·가방)는 버리고 마지막 저장으로 되돌린다
      S.save = store.load() || S.save;
      finishBattleFlow({ result: 'quit' });
    }
    else if (a === 'menu-title') { Sfx.play('cancel'); openMenu(false); goTitle(); }
    else if (a === 'm-party') { Sfx.play('tap'); openMenu(false); goParty(); }
    else if (a === 'm-bag') { Sfx.play('tap'); openMenu(false); goBag(); }
    else if (a === 'm-dex') { Sfx.play('tap'); openMenu(false); goDex(); }
    else if (a === 'm-map') { Sfx.play('tap'); openMenu(false); goMap(); }
  });
  syncMute();

  /* ───────── 흐름 중단 ───────── */
  function newGen() {
    S.gen++;
    if (S.skip) S.skip.fire();
    msgFinish(true);
    clearBubbles();
    narrEl.classList.remove('show');
    coverEl.classList.remove('on');
    openMenu(false);
    return S.gen;
  }

  /* ───────── 메시지 창 (타자 효과 + 탭/대기로 넘김) ───────── */
  var MS = { typing: false, timer: null, autoT: null, finishType: null, advance: null };
  function msgFinish(all) {
    if (MS.typing && MS.finishType) MS.finishType();
    if (all && MS.advance) MS.advance();
  }
  function advanceMsg() {
    if (MS.typing && MS.finishType) MS.finishType();
    else if (MS.advance) MS.advance();
  }
  function say(text, o) {
    o = o || {};
    return new Promise(function (resolve) {
      clearTimeout(MS.timer); clearTimeout(MS.autoT);
      MS.advance = null;
      msgBox.classList.remove('ready');
      var full = String(text || ''), i = 0;
      msgText.textContent = '';
      function after() {
        MS.typing = false; MS.finishType = null;
        if (o.hold === false) { resolve(); return; }
        var settled = false;
        if (o.arrow !== false) msgBox.classList.add('ready');
        function fin() {
          if (settled) return;
          settled = true;
          clearTimeout(MS.autoT);
          if (MS.advance === fin) MS.advance = null;
          msgBox.classList.remove('ready');
          resolve();
        }
        MS.advance = fin;
        MS.autoT = setTimeout(fin, o.auto != null ? o.auto : T(1100));
      }
      MS.finishType = function () { clearTimeout(MS.timer); msgText.textContent = full; after(); };
      if (FAST || !full) { MS.finishType(); return; }
      MS.typing = true;
      (function tick() {
        i++;
        msgText.textContent = full.slice(0, i);
        if (i >= full.length) { MS.finishType(); return; }
        MS.timer = setTimeout(tick, 22);
      })();
    });
  }
  function clearMsg() { clearTimeout(MS.timer); clearTimeout(MS.autoT); MS.typing = false; MS.finishType = null; MS.advance = null; msgText.textContent = ''; msgBox.classList.remove('ready'); }

  /* ───────── 말풍선 · 내레이션 ───────── */
  function clearBubbles() { bubblesEl.innerHTML = ''; }
  function bubble(side, text, dur, trainer) {
    var st = S.st;
    var old = bubblesEl.querySelector('.bubble[data-side="' + side + '"]');
    if (old) old.remove();
    var el = document.createElement('div');
    var who = side === 'player' ? S.field.player : S.field.enemy;
    el.className = 'bubble bubble-' + side + (who === 'black' ? ' dark' : '') + (trainer ? ' trainer' : '');
    el.dataset.side = side;
    if (trainer) { var nm = document.createElement('b'); nm.textContent = trainer; el.appendChild(nm); }
    el.appendChild(document.createTextNode(text));
    bubblesEl.appendChild(el);
    var W = arena.clientWidth, H = arena.clientHeight;
    var p = { x: W / 2, y: H / 3 };
    try { p = st.screenPos(side) || p; } catch (e) { /* 기본 위치 */ }
    if (trainer) p = { x: W * 0.62, y: H * 0.42 };
    var w = el.offsetWidth, h = el.offsetHeight;
    var left = Math.max(8, Math.min(W - w - 8, p.x - w / 2));
    var top = Math.max(10, Math.min(H - h - 8, p.y - h - 16));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.setProperty('--tx', Math.round(Math.max(18, Math.min(w - 18, p.x - left))) + 'px');
    requestAnimationFrame(function () { el.classList.add('show'); });
    return sleep(T(dur || 1500)).then(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.remove(); }, 260);
    });
  }
  function narrate(text, dur) {
    narrEl.textContent = text;
    narrEl.classList.add('show');
    return sleep(T(dur || 1600)).then(function () { narrEl.classList.remove('show'); });
  }

  /* ───────── HP 판 ───────── */
  function freshStages() { return { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }; }
  function mkDisp(ev) {
    return { uid: ev.uid, id: ev.id, lv: ev.lv, exp: ev.exp, hp: ev.hp, max: ev.maxHp, shown: ev.hp, shiny: ev.shiny,
      status: ev.status, cnf: false, screen: S.disp && ev.side && S.disp[ev.side] ? S.disp[ev.side].screen : false, stages: freshStages() };
  }
  function partyDots(side) {
    if (!S.b || (side === 'enemy' && S.b.kind !== 'trainer')) return '';
    var party = side === 'enemy' ? S.b.e.party : S.b.p.party;
    var d = S.disp[side], out = '';
    party.forEach(function (m) {
      var down = m.uid === d.uid ? d.hp <= 0 : (S.downUids && S.downUids[side + m.uid]) || false;
      out += '<i class="' + (down ? 'down' : '') + '"></i>';
    });
    return '<span class="pl-dots">' + out + '</span>';
  }
  function plateHTML(side) {
    var d = S.disp[side], m = M[d.id];
    var boss = side === 'enemy' && S.b && S.b.final;
    return '<div class="pl-top">' +
        (boss ? '<span class="pl-boss">BOSS</span>' : '') +
        '<span class="pl-name">' + esc(m.name) + '</span>' +
        (d.shiny ? '<span class="pl-shiny" title="이로치">✦</span>' : '') +
        '<span class="pl-lv" data-lv>Lv.' + d.lv + '</span>' +
      '</div>' +
      '<div class="pl-mid"><span class="pl-types">' + chips(m.types) + '</span><span class="pl-status" data-status></span></div>' +
      '<div class="hpbar"><span class="hp-tag">HP</span><span class="hp-track"><span class="hp-fill" data-fill></span></span></div>' +
      (side === 'player'
        ? '<div class="pl-bot">' + partyDots('player') + '<div class="hp-num"><b data-hpnow>' + d.hp + '</b> / <span data-hpmax>' + d.max + '</span></div></div>' +
          '<div class="expbar"><span class="exp-tag">EXP</span><span class="exp-track"><span class="exp-fill" data-exp></span></span></div>'
        : partyDots('enemy'));
  }
  function renderPlate(side) {
    $('plate-' + side).innerHTML = plateHTML(side);
    setHp(side, S.disp[side].hp, true);
    renderStatus(side);
    if (side === 'player') setExp(true);
  }
  function showPlate(side, on) { $('plate-' + side).classList.toggle('show', on !== false); }
  function setHp(side, hp, instant, max) {
    var d = S.disp[side], plate = $('plate-' + side);
    if (!d) return;
    if (max) d.max = max;
    d.hp = Math.max(0, hp);
    var pct = d.max ? d.hp / d.max : 0;
    var fill = plate.querySelector('[data-fill]');
    if (fill) {
      if (instant) fill.style.transition = 'none';
      fill.style.width = (pct * 100).toFixed(1) + '%';
      fill.classList.toggle('mid', pct < 0.5 && pct >= 0.2);
      fill.classList.toggle('low', pct < 0.2);
      if (instant) { void fill.offsetWidth; fill.style.transition = ''; }
    }
    var mx = plate.querySelector('[data-hpmax]');
    if (mx) mx.textContent = d.max;
    var num = plate.querySelector('[data-hpnow]');
    if (num) {
      var from = d.shown, to = d.hp, t0 = performance.now(), dur = instant || FAST ? 0 : 520;
      d.shown = to;
      if (!dur) { num.textContent = to; return; }
      (function step() {
        var k = Math.min(1, (performance.now() - t0) / dur);
        num.textContent = Math.round(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step);
      })();
    }
  }
  function setExp(instant) {
    var d = S.disp.player, el = $('plate-player').querySelector('[data-exp]');
    if (!d || !el) return;
    if (instant) el.style.transition = 'none';
    el.style.width = expPct(d.lv, d.exp).toFixed(1) + '%';
    if (instant) { void el.offsetWidth; el.style.transition = ''; }
    var lv = $('plate-player').querySelector('[data-lv]');
    if (lv) lv.textContent = 'Lv.' + d.lv;
  }
  var STG = [['atk', '공'], ['def', '방'], ['spa', '특공'], ['spd', '특방'], ['spe', '스'], ['acc', '명중'], ['eva', '회피']];
  function renderStatus(side) {
    var d = S.disp[side], out = '';
    if (!d) return;
    out += statusChip(d.status);
    if (d.cnf) out += '<span class="st st-cnf">혼란</span>';
    if (d.screen) out += '<span class="st st-shield">🛡</span>';
    STG.forEach(function (k) {
      var v = d.stages[k[0]];
      if (v) out += '<span class="st ' + (v > 0 ? 'st-up' : 'st-down') + '">' + k[1] + (v > 0 ? '↑' : '↓') + (Math.abs(v) > 1 ? Math.abs(v) : '') + '</span>';
    });
    var el = $('plate-' + side).querySelector('[data-status]');
    if (el) el.innerHTML = out;
  }

  /* ───────── 명령 패널 ───────── */
  function cmdHTML() {
    var wild = S.b.kind === 'wild';
    function c(act, label, sub, color, icon, dis) {
      return '<button type="button" class="move-btn cmd-btn" data-cmd="' + act + '" style="--tc:' + color + '"' + (dis ? ' data-off="1"' : '') + ' disabled>' +
        '<span class="mv-in"><span class="mv-emb">' + icon + '</span><span class="mv-name">' + label + '</span>' +
        '<span class="mv-bot"><span class="mv-sub">' + sub + '</span></span></span></button>';
    }
    var ball = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 11.2a8.8 8.8 0 0 1 17.6 0z" fill="#ff5a5a"/><path d="M3.2 12.8a8.8 8.8 0 0 0 17.6 0z" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#fff" stroke="#1a1f3a" stroke-width="1.8"/></svg>';
    var run = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 4.5a2 2 0 1 1 0 .01M9 21l2.5-6 2.5 2v4.5M7 11l3-3.5h4l2.5 3.5 3 1M10.5 7.5 9 13l3.5 2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return c('fight', '싸운다', '기술 고르기', '#e8542c', glyph('fighting'), false) +
      c('party', '포캣몬', '교체하기', '#3fa63c', ICON.party.replace('var(--bg)', '#3fa63c').replace(/currentColor/g, '#fff'), false) +
      c('bag', '가방', wild ? '도구 · 포캣볼' : '도구 쓰기', '#d8343e', ball, false) +
      c('run', '도망친다', wild ? '배틀에서 벗어나기' : '트레이너전 불가', '#6a7598', run, !wild);
  }
  function moveHTML() {
    var me = E.active(S.b, 'p'), foe = E.active(S.b, 'e'), ft = M[foe.id].types;
    return me.moves.map(function (m, i) {
      var mv = MV[m.id], tags = '';
      if (mv.cat !== 'status') {
        var eff = E.effectiveness(mv.type, ft);
        if (eff === 0) tags += '<span class="mv-eff bad">효과 없음</span>';
        else if (eff > 1) tags += '<span class="mv-eff good">효과 굉장!</span>';
        else if (eff < 1) tags += '<span class="mv-eff bad">효과 별로</span>';
      }
      if (mv.priority) tags += '<span class="mv-pri">⚡선공</span>';
      var sub = CAT_LABEL[mv.cat] + ' · ' + (mv.acc == null ? '필중' : '명중 ' + mv.acc);
      var stat = mv.cat === 'status' ? '<b>—</b>' : '<b>' + mv.power + (mv.hits ? '<small>×' + (typeof mv.hits === 'number' ? mv.hits : mv.hits[0] + '~' + mv.hits[1]) + '</small>' : '') + '</b><i>위력</i>';
      return '<button type="button" class="move-btn' + (mv.ult ? ' sp' : '') + '" data-slot="' + i + '" style="--tc:' + TY[mv.type].color + '"' + (m.pp <= 0 ? ' data-off="1"' : '') + ' disabled>' +
        '<span class="mv-in">' +
          '<span class="mv-emb">' + glyph(mv.type) + '</span>' +
          '<span class="mv-name">' + esc(mv.name) + '</span>' +
          '<span class="mv-bot"><span class="mv-sub">' + sub + '</span><span class="mv-stat">' + stat + '</span></span>' +
        '</span>' +
        '<span class="mv-pp' + (m.pp <= 0 ? ' out' : m.pp <= mv.pp / 4 ? ' low' : '') + '">PP ' + m.pp + '/' + mv.pp + '</span>' +
        (tags ? '<span class="mv-tags">' + tags + '</span>' : '') +
        (mv.ult ? '<span class="mv-sp">필살</span>' : '') +
      '</button>';
    }).join('');
  }
  function partyPickHTML(forced, forItem) {
    return '<div class="pick-list">' + S.b.p.party.map(function (m, i) {
      var cur = i === S.b.p.active && !forced, dead = m.hp <= 0, mx = E.maxHp(m);
      var off = forItem ? !!E.itemBlock(m, IT[S.cmdItem]) : (cur || dead);
      if (forItem) cur = false;
      return '<button type="button" class="pick-row' + (cur ? ' cur' : '') + (dead ? ' dead' : '') + '" data-pick-slot="' + i + '"' + (off ? ' data-off="1"' : '') + ' disabled>' +
        img(m.id, 'pick-img', m.shiny) +
        '<span class="pick-info"><span class="pick-top"><b>' + esc(M[m.id].name) + '</b>' + statusChip(m.status) + '<span class="pick-lv">Lv.' + m.lv + '</span></span>' +
        '<span class="pick-hp">' + hpBar(m.hp, mx) + '<span class="pick-num">' + m.hp + '/' + mx + '</span></span></span>' +
        (cur ? '<span class="pick-tag">배틀 중</span>' : dead ? '<span class="pick-tag">기절</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }
  function bagPickHTML() {
    var wild = S.b.kind === 'wild', bag = S.save.bag;
    var ids = Object.keys(IT).filter(function (id) { return IT[id].battle && bag[id] > 0 && (IT[id].kind !== 'ball' || wild); });
    if (!ids.length) return '<p class="pick-empty">쓸 수 있는 도구가 없다.</p>';
    return '<div class="pick-list bag-list">' + ids.map(function (id) {
      return '<button type="button" class="pick-row item-row" data-item="' + id + '" disabled>' + itemIcon(id) +
        '<span class="pick-info"><span class="pick-top"><b>' + esc(IT[id].name) + '</b><span class="pick-lv">×' + bag[id] + '</span></span>' +
        '<span class="item-desc">' + esc(IT[id].desc) + '</span></span></button>';
    }).join('') + '</div>';
  }
  function renderCmd(mode) {
    S.mode = mode;
    battleEl.dataset.cmd = mode;
    movesEl.className = 'moves mode-' + mode;
    movesEl.innerHTML = mode === 'root' ? cmdHTML() : mode === 'fight' ? moveHTML() : mode === 'bag' ? bagPickHTML() : partyPickHTML(mode === 'forced', mode === 'itemTarget');
    backBtn.classList.toggle('on', mode === 'fight' || mode === 'party' || mode === 'bag' || mode === 'itemTarget');
  }
  function lock(on) {
    S.locked = on;
    battleEl.classList.toggle('locked', on);
    var bs = movesEl.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].disabled = on || bs[i].dataset.off === '1';
    backBtn.disabled = on;
  }
  movesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || btn.disabled || S.locked) return;
    e.stopPropagation();
    if (btn.dataset.cmd) {
      var c = btn.dataset.cmd;
      Sfx.play('tap');
      if (c === 'fight') {
        if (!E.hasUsableMove(E.active(S.b, 'p'))) { onAction({ t: 'move', slot: -1 }); return; }
        renderCmd('fight'); lock(false);
        say('어떤 기술을 쓸까?', { hold: false });
      } else if (c === 'party') {
        renderCmd('party'); lock(false);
        say('누구와 교체할까?', { hold: false });
      } else if (c === 'bag') {
        renderCmd('bag'); lock(false);
        say('어떤 도구를 쓸까?', { hold: false });
      } else if (c === 'run') onAction({ t: 'run' });
    } else if (btn.dataset.item) {
      var iid = btn.dataset.item;
      Sfx.play('tap');
      if (IT[iid].kind === 'ball') onAction({ t: 'ball', item: iid });
      else { S.cmdItem = iid; renderCmd('itemTarget'); lock(false); say('누구에게 ' + E.josa(IT[iid].name, '을/를') + ' 쓸까?', { hold: false }); }
    } else if (btn.dataset.slot != null) {
      onAction({ t: 'move', slot: +btn.dataset.slot });
    } else if (btn.dataset.pickSlot != null) {
      var idx = +btn.dataset.pickSlot;
      if (S.mode === 'forced') onForced(idx);
      else if (S.mode === 'itemTarget') onAction({ t: 'item', item: S.cmdItem, target: idx });
      else onAction({ t: 'switch', to: idx });
    }
  });
  backBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (S.locked || backBtn.disabled) return;
    Sfx.play('cancel');
    prompt();
  });
  battleEl.addEventListener('click', function (e) {
    if (e.target.closest('button') || e.target.closest('.overlay')) return;
    if (S.screen === 'cutscene') { if (S.skip) S.skip.fire(); return; }
    if (S.screen === 'battle') advanceMsg();
  });

  /* ───────── 공통 화면 조각 ───────── */
  function tabbar(cur) {
    function t(id, label, icon) { return '<button type="button" class="tab' + (cur === id ? ' on' : '') + '" data-act="tab-' + id + '">' + icon + '<span>' + label + '</span></button>'; }
    return '<nav class="tabbar tabbar5">' + t('field', '필드', ICON.field) + t('party', '파티', ICON.party) + t('bag', '가방', ICON.bag) + t('dex', '도감', ICON.dex) + t('map', '지도', ICON.map) + '</nav>';
  }
  function dexCount() {
    var c = 0, s = 0;
    D.DEX.forEach(function (id) { if (S.save.dex.caught[id]) c++; if (S.save.dex.seen[id]) s++; });
    return { caught: c, seen: s };
  }
  function gymAreas() { return D.AREAS.filter(function (a) { return a.gym; }); }
  function partyStrip() {
    return '<div class="pstrip">' + S.save.party.map(function (m) {
      var mx = E.maxHp(m);
      return '<div class="pmini' + (m.hp <= 0 ? ' dead' : '') + '" style="--tc:' + mainColor(m.id) + '">' + img(m.id, 'pmini-img', m.shiny) +
        '<span class="pmini-info"><b>' + esc(M[m.id].name) + '</b><span class="pmini-lv">Lv.' + m.lv + statusChip(m.status) + '</span>' + hpBar(m.hp, mx, 'thin') + '</span></div>';
    }).join('') + '</div>';
  }
  function needsHeal() { return S.save.party.some(function (m) { return m.hp < E.maxHp(m) || m.status || m.moves.some(function (x) { return x.pp < MV[x.id].pp; }); }); }
  function heal() {
    E.healParty(S.save); persist();
    Sfx.play('heal');
    toast('포캣몬들이 모두 건강해졌다!');
  }

  /* ───────── 화면: 타이틀 ───────── */
  function goTitle() {
    newGen();
    S.b = null; S.newConfirm = false;
    showBattle(false);
    mark('title');
    S.save = store.load();
    var saved = S.save;
    var cast = ['flare', 'naru', 'seol', 'ssaga', 'zap'];
    var sub = saved ? (gymAreas().filter(function (a) { return E.hasBadge(saved, a.id); }).length + '/' + gymAreas().length + ' 배지 · 도감 ' + dexCount().caught + '/' + D.DEX.length) : '';
    host.innerHTML =
      '<section class="scr title-scr">' +
        '<div class="title-bg"></div><div class="title-shade"></div><div class="title-rays"></div>' +
        '<div class="logo-wrap">' +
          '<div class="logo-kicker">POCATMON</div>' +
          '<h1 class="logo" data-text="포캣몬">포캣몬</h1>' +
          '<div class="logo-ribbon"><span>모 험</span></div>' +
          '<p class="tagline">마을과 수풀을 누비며 고양이 포캣몬을 모으고, 6명의 관장과 정상의 수호자에게 도전하자</p>' +
        '</div>' +
        '<div class="cast cast-5 cast-cats"><div class="cast-inner"><div class="cast-floor"></div>' + cast.map(function (id, i) {
          return '<div class="cast-m cast-' + id + '" style="--i:' + i + '">' + img(id, 'cast-img') + '</div>';
        }).join('') + '</div></div>' +
        '<div class="title-actions">' +
          (saved ? '<button type="button" class="btn btn-primary btn-big" data-act="continue"><span class="btn-main">이어하기</span><span class="btn-sub">' + sub + '</span></button>' : '') +
          '<button type="button" class="btn ' + (saved ? 'btn-ghost' : 'btn-primary btn-big') + '" data-act="new"><span class="btn-main">새로 시작</span>' + (saved ? '<span class="btn-sub" data-newsub>지금까지의 기록은 지워져요</span>' : '') + '</button>' +
        '</div>' +
        '<div class="title-foot">' + (saved && saved.cleared ? '✦ 정상의 수호자를 이겼어요 · 붉은 달 폐허가 열려 있어요' : '십자 버튼으로 걷고, A 버튼으로 말을 걸어요') + '</div>' +
      '</section>';
  }

  /* ───────── 화면: 스타터 선택 ───────── */
  function goStarter() {
    newGen();
    showBattle(false);
    mark('starter');
    if (D.STARTERS.indexOf(S.sel) < 0) S.sel = D.STARTERS[0];
    renderStarter();
  }
  function statRow(label, v) {
    return '<div class="stat"><span class="stat-l">' + label + '</span><span class="stat-bar"><i style="width:' + Math.round(Math.min(1, v / STAT_MAX) * 100) + '%"></i></span><span class="stat-v">' + v + '</span></div>';
  }
  function learnList(id) {
    return '<div class="hero-moves">' + M[id].learn.map(function (l) {
      var mv = MV[l[0]];
      return '<span class="hm" style="--tc:' + TY[mv.type].color + '"><b>' + esc(mv.name) + '</b><small>' + (mv.cat === 'status' ? '변화' : '위력 ' + mv.power) + (l[1] > 1 ? ' · Lv.' + l[1] : '') + '</small></span>';
    }).join('') + '</div>';
  }
  function renderStarter() {
    var id = S.sel, m = M[id];
    host.innerHTML =
      '<section class="scr select-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="title" aria-label="타이틀로">‹</button>' +
          '<div><h2>첫 파트너</h2><p>함께 모험을 떠날 첫 포캣몬을 골라 주세요</p></div></header>' +
        '<div class="hero-wrap" id="hero-wrap"><div class="hero" style="--tc:' + mainColor(id) + '">' +
          '<div class="hero-art"><div class="hero-bg" style="background-image:url(' + bgURL(m.bg) + ')"></div>' + img(id, 'hero-img') + '</div>' +
          '<div class="hero-info">' +
            '<div class="hero-head"><span class="hero-name">' + esc(m.name) + '</span><span class="hero-types">' + chips(m.types) + '</span></div>' +
            '<div class="stats stats6">' + STAT_LABEL.map(function (s) { return statRow(s[1], m.base[s[0]]); }).join('') + '</div>' +
            '<p class="hero-blurb">' + esc(m.blurb) + '</p>' + learnList(id) +
          '</div></div></div>' +
        '<div class="thumbs thumbs-3">' + D.STARTERS.map(function (rid) {
          return '<button type="button" class="thumb' + (rid === id ? ' on' : '') + '" data-pick="' + rid + '" style="--tc:' + mainColor(rid) + '" aria-label="' + esc(M[rid].name) + '">' + img(rid, 'thumb-img') + '</button>';
        }).join('') + '</div>' +
        '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" data-act="go"><span class="btn-main">이 친구와 출발!</span></button></div>' +
      '</section>';
    bindSwipe($('hero-wrap'));
  }
  function bindSwipe(el) {
    if (!el) return;
    var x0 = null, y0 = 0;
    el.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', function (e) {
      if (x0 == null) return;
      var dx = e.clientX - x0, dy = e.clientY - y0, R = D.STARTERS;
      x0 = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        var i = R.indexOf(S.sel);
        S.sel = R[(i + (dx < 0 ? 1 : R.length - 1)) % R.length];
        Sfx.play('tap');
        renderStarter();
      }
    });
    el.addEventListener('pointercancel', function () { x0 = null; });
  }

  /* ───────── 화면: 지도(날아가기·부탁) ───────── */
  function goMap() {
    newGen();
    showBattle(false);
    mark('map');
    var save = S.save, dc = dexCount(), gyms = gymAreas();
    var badges = gyms.map(function (a) {
      var got = E.hasBadge(save, a.id);
      return '<span class="badge' + (got ? ' got' : '') + (a.final ? ' final' : '') + '" title="' + esc(a.gym.badge) + '">' + (got ? '★' : '') + '</span>';
    }).join('');
    var order = ['home', 'forest', 'coast', 'volcano', 'glacier', 'alley', 'temple', 'summit', 'ruins'];
    var fly = PW.flyTargets(save);
    var cards = order.map(function (id, i) {
      var m = PM.MAPS[id], here = S.ow.mapId === id, can = fly.indexOf(id) >= 0 && !here, seen = !!save.visited[id];
      if (id === 'ruins' && !seen) return '';
      var bg = THEME_BG[m.theme] || 'forest';
      return '<button type="button" class="acard' + (seen ? '' : ' locked') + '" data-fly="' + id + '"' + (can ? '' : ' disabled') + '>' +
        '<span class="ac-bg" style="background-image:url(' + bgURL(bg) + ')"></span>' +
        '<span class="ac-body"><span class="ac-no">' + (id === 'home' ? 'START' : id === 'summit' ? 'FINAL' : id === 'ruins' ? 'EXTRA' : 'AREA ' + i) + '</span>' +
          '<b class="ac-name">' + (seen ? esc(m.name) : '???') + '</b>' +
          '<span class="ac-meta">' + (m.area && E.areaById(m.area).lv ? '<span class="ac-lv">야생 Lv.' + E.areaById(m.area).lv[0] + '~' + E.areaById(m.area).lv[1] + '</span>' : '') + '</span></span>' +
        (here ? '<span class="ac-state cur">현재 위치</span>' : can ? '<span class="ac-state ok">날아가기</span>' : seen ? '' : '<span class="ac-state lk">미방문</span>') +
      '</button>';
    }).join('');
    var quests = QUESTS.filter(function (q) { return save.visited[q.map]; }).map(function (q) {
      var done = PW.evalCond(save, q.done);
      return '<div class="quest' + (done ? ' done' : '') + '"><b>' + (done ? '✔ ' : '◇ ') + esc(q.title) + '</b><span>' + esc(PM.MAPS[q.map].name) + ' · ' + esc(q.desc) + '</span></div>';
    }).join('') || '<p class="empty-note">아직 받은 부탁이 없어요. 마을 사람들에게 말을 걸어 보세요.</p>';
    host.innerHTML =
      '<section class="scr map-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-field" aria-label="필드로">‹</button>' +
          '<div><h2>지도</h2><p>배지 ' + save.badges.length + '/' + gyms.length + ' · 도감 ' + dc.caught + '/' + D.DEX.length + ' · ' + save.money.toLocaleString() + '원</p></div></header>' +
        '<div class="badges">' + badges + '</div>' +
        '<div class="sec-t">날아가기 <small>들른 마을의 포캣몬 센터 앞으로</small></div>' +
        '<div class="areas">' + cards + '</div>' +
        '<div class="sec-t">부탁</div><div class="quests">' + quests + '</div>' +
        tabbar('map') +
      '</section>';
  }

  /* ───────── 화면: 파티·보관함 ───────── */
  function goParty() {
    newGen();
    S.b = null;
    showBattle(false);
    mark('party');
    if (!S.partySel || !findMon(S.partySel)) S.partySel = { where: 'party', uid: S.save.party[0].uid };
    renderParty();
  }
  function findMon(sel) {
    if (!sel) return null;
    var list = sel.where === 'party' ? S.save.party : S.save.box;
    for (var i = 0; i < list.length; i++) if (list[i].uid === sel.uid) return { mon: list[i], idx: i, where: sel.where };
    return null;
  }
  function monDetail(f) {
    var m = f.mon, sp = M[m.id], st = E.calcStats(m), mx = st.hp;
    return '<div class="mdetail" style="--tc:' + mainColor(m.id) + '">' +
      '<div class="md-art"><div class="hero-bg" style="background-image:url(' + bgURL(sp.bg) + ')"></div>' + img(m.id, 'md-img', m.shiny) + (m.shiny ? '<span class="md-shiny">✦ 이로치</span>' : '') + '</div>' +
      '<div class="md-info">' +
        '<div class="hero-head"><span class="hero-name">' + esc(sp.name) + '</span><span class="md-lv">Lv.' + m.lv + '</span></div>' +
        '<div class="md-row">' + chips(sp.types) + statusChip(m.status) + '</div>' +
        '<div class="md-hp">' + hpBar(m.hp, mx) + '<span>' + m.hp + '/' + mx + '</span></div>' +
        '<div class="md-exp"><span class="exp-track"><span class="exp-fill" style="width:' + expPct(m.lv, m.exp).toFixed(1) + '%"></span></span><span>다음 레벨까지 ' + Math.max(0, E.expForLevel(m.lv + 1) - m.exp) + '</span></div>' +
        '<div class="stats stats6 compact">' + STAT_LABEL.slice(1).map(function (s) { return statRow(s[1], st[s[0]]); }).join('') + '</div>' +
      '</div>' +
      '<div class="md-moves">' + m.moves.map(function (x) {
        var mv = MV[x.id];
        return '<div class="mdm" style="--tc:' + TY[mv.type].color + '"><span class="mdm-emb">' + glyph(mv.type) + '</span><span class="mdm-body"><b>' + esc(mv.name) + '</b><small>' +
          CAT_LABEL[mv.cat] + (mv.cat === 'status' ? '' : ' · 위력 ' + mv.power) + ' · ' + (mv.acc == null ? '필중' : '명중 ' + mv.acc) + '</small><span class="mdm-desc">' + esc(mv.desc) + '</span></span><span class="mdm-pp">' + x.pp + '/' + mv.pp + '</span></div>';
      }).join('') +
      (function () {
        var next = sp.learn.filter(function (l) { return l[1] > m.lv; })[0];
        return next ? '<div class="md-next">Lv.' + next[1] + '에 ' + esc(MV[next[0]].name) + ' 습득</div>' : '';
      })() +
      '</div></div>';
  }
  function renderParty() {
    var save = S.save, f = findMon(S.partySel), swap = S.swapFrom;
    var slots = '';
    for (var i = 0; i < TU.partyMax; i++) {
      var m = save.party[i];
      if (!m) { slots += '<div class="pslot empty">빈 자리</div>'; continue; }
      var on = f && f.where === 'party' && f.mon.uid === m.uid, mx = E.maxHp(m);
      slots += '<button type="button" class="pslot' + (on ? ' on' : '') + (swap ? ' swap' : '') + (m.hp <= 0 ? ' dead' : '') + '" data-psel="party:' + m.uid + '" style="--tc:' + mainColor(m.id) + '">' +
        (i === 0 ? '<span class="lead">선두</span>' : '') + img(m.id, 'pslot-img', m.shiny) +
        '<b>' + esc(M[m.id].name) + '</b><span class="pslot-lv">Lv.' + m.lv + statusChip(m.status) + '</span>' + hpBar(m.hp, mx, 'thin') + '</button>';
    }
    var box = save.box.length ? save.box.map(function (m) {
      var on = f && f.where === 'box' && f.mon.uid === m.uid;
      return '<button type="button" class="bslot' + (on ? ' on' : '') + '" data-psel="box:' + m.uid + '" style="--tc:' + mainColor(m.id) + '">' + img(m.id, 'bslot-img', m.shiny) + '<i>Lv.' + m.lv + '</i></button>';
    }).join('') : '<p class="empty-note">아직 보관함에 포캣몬이 없어요. 파티가 가득 찬 상태에서 잡으면 이곳으로 와요.</p>';
    var actions = '';
    if (swap) {
      actions = '<p class="swap-note">' + esc(M[findMon(swap).mon.id].name) + '와 바꿀 파티 포캣몬을 눌러 주세요</p><button type="button" class="btn btn-ghost" data-act="swap-cancel"><span class="btn-main">취소</span></button>';
    } else if (f && f.where === 'party') {
      actions = (f.idx > 0 ? '<button type="button" class="btn btn-ghost" data-act="lead"><span class="btn-main">선두로 세우기</span></button>' : '') +
        (save.party.length > 1 ? '<button type="button" class="btn btn-ghost" data-act="tobox"><span class="btn-main">보관함에 맡기기</span></button>' : '');
    } else if (f && f.where === 'box') {
      actions = save.party.length < TU.partyMax
        ? '<button type="button" class="btn btn-primary" data-act="toparty"><span class="btn-main">파티에 넣기</span></button>'
        : '<button type="button" class="btn btn-primary" data-act="swap"><span class="btn-main">파티 포캣몬과 바꾸기</span></button>';
    }
    host.innerHTML =
      '<section class="scr party-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-field" aria-label="필드로">‹</button>' +
          '<div><h2>파티 · 보관함</h2><p>파티는 최대 ' + TU.partyMax + '마리 · 싸우지 않은 파티원도 경험치를 절반 받아요</p></div></header>' +
        '<div class="pslots">' + slots + '</div>' +
        (f ? monDetail(f) : '') +
        '<div class="pactions">' + actions + '</div>' +
        '<div class="sec-t">보관함 <small>' + save.box.length + '마리</small></div>' +
        '<div class="box-grid">' + box + '</div>' +
        tabbar('party') +
      '</section>';
  }

  /* ───────── 화면: 도감 ───────── */
  function goDex() {
    newGen();
    S.b = null;
    showBattle(false);
    mark('dex');
    renderDex();
  }
  function renderDex() {
    var save = S.save, dc = dexCount(), sel = S.dexSel;
    var detail = '';
    if (sel && save.dex.caught[sel]) {
      var m = M[sel];
      detail = '<div class="dex-detail" style="--tc:' + mainColor(sel) + '">' + img(sel, 'dd-img') +
        '<div><div class="hero-head"><span class="hero-name">' + esc(m.name) + '</span><span class="hero-types">' + chips(m.types) + '</span></div>' +
        '<p class="hero-blurb">' + esc(m.blurb) + '</p>' + learnList(sel) + '</div></div>';
    } else if (sel && save.dex.seen[sel]) {
      detail = '<div class="dex-detail seen">' + img(sel, 'dd-img sil') + '<div><div class="hero-name">' + esc(M[sel].name) + '</div><p class="hero-blurb">만난 적은 있지만 아직 잡지 못했어요.</p></div></div>';
    }
    host.innerHTML =
      '<section class="scr dex-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-field" aria-label="필드로">‹</button>' +
          '<div><h2>포캣몬 도감</h2><p>잡은 수 ' + dc.caught + ' · 만난 수 ' + dc.seen + ' / ' + D.DEX.length + '</p></div></header>' +
        detail +
        '<div class="dex-grid">' + D.DEX.map(function (id, i) {
          var c = save.dex.caught[id], s = save.dex.seen[id];
          return '<button type="button" class="dcell' + (c ? ' caught' : s ? ' seen' : '') + (sel === id ? ' on' : '') + '" data-dex="' + id + '" style="--tc:' + (c ? mainColor(id) : '#2a3256') + '">' +
            '<span class="dno">No.' + String(i + 1).padStart(3, '0') + '</span>' +
            (c || s ? img(id, 'dcell-img' + (c ? '' : ' sil')) : '<span class="dq">?</span>') +
            '<b>' + (c || s ? esc(M[id].name) : '???') + '</b></button>';
        }).join('') + '</div>' +
        tabbar('dex') +
      '</section>';
  }

  /* ───────── 화면 버튼 위임 ───────── */
  host.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act],[data-pick],[data-fly],[data-psel],[data-dex],[data-bag],[data-use]');
    if (!b || b.disabled) return;
    if (b.dataset.pick) {
      if (S.sel !== b.dataset.pick) { S.sel = b.dataset.pick; Sfx.play('tap'); renderStarter(); }
      return;
    }
    if (b.dataset.fly) { Sfx.play('tap'); flyTo(b.dataset.fly); return; }
    if (b.dataset.bag) { Sfx.play('tap'); S.bagSel = b.dataset.bag; renderBag(); return; }
    if (b.dataset.use != null) { useBagItem(+b.dataset.use); return; }
    if (b.dataset.dex) { Sfx.play('tap'); S.dexSel = b.dataset.dex; renderDex(); return; }
    if (b.dataset.psel) {
      var parts = b.dataset.psel.split(':'), sel = { where: parts[0], uid: +parts[1] };
      Sfx.play('tap');
      if (S.swapFrom && sel.where === 'party') {
        var from = findMon(S.swapFrom), to = findMon(sel);
        if (from && to) { E.swapPartyBox(S.save, to.idx, from.idx); persist(); S.partySel = { where: 'party', uid: from.mon.uid }; }
        S.swapFrom = null;
      } else S.partySel = sel;
      renderParty();
      return;
    }
    var a = b.dataset.act, f;
    if (a === 'new') {
      if (S.save && !S.newConfirm) {
        S.newConfirm = true; Sfx.play('cancel');
        var ns = host.querySelector('[data-newsub]');
        if (ns) ns.textContent = '한 번 더 누르면 기존 기록이 지워져요!';
        b.classList.add('warn');
        return;
      }
      Sfx.play('tap'); goStarter();
    }
    else if (a === 'continue') { Sfx.play('tap'); S.save = store.load(); if (S.save) startField(); else goTitle(); }
    else if (a === 'title') { Sfx.play('cancel'); goTitle(); }
    else if (a === 'go') {
      Sfx.play('tap');
      store.clear();
      S.save = E.newGame(S.sel, rng); S.partySel = null; S.dexSel = null; S.swapFrom = null;
      var hs = PM.MAPS.home.start;
      S.save.pos = { map: 'home', x: hs.x, y: hs.y, dir: hs.dir };
      S.save.respawn = PW.centerFront('home');
      persist();
      startField();
    }
    else if (a === 'tab-map') { Sfx.play('tap'); goMap(); }
    else if (a === 'tab-field') { Sfx.play('tap'); backToField(); }
    else if (a === 'tab-bag') { Sfx.play('tap'); goBag(); }
    else if (a === 'end-continue') { Sfx.play('tap'); finishBattleFlow(S.endOut || { result: 'win' }); }
    else if (a === 'tab-party') { Sfx.play('tap'); goParty(); }
    else if (a === 'tab-dex') { Sfx.play('tap'); goDex(); }
    else if (a === 'lead') { f = findMon(S.partySel); if (f) { E.makeLead(S.save, f.idx); persist(); Sfx.play('tap'); renderParty(); } }
    else if (a === 'tobox') { f = findMon(S.partySel); if (f && E.moveToBox(S.save, f.idx)) { persist(); S.partySel = { where: 'box', uid: f.mon.uid }; Sfx.play('tap'); renderParty(); } }
    else if (a === 'toparty') { f = findMon(S.partySel); if (f && E.moveToParty(S.save, f.idx)) { persist(); S.partySel = { where: 'party', uid: f.mon.uid }; Sfx.play('tap'); renderParty(); } }
    else if (a === 'swap') { Sfx.play('tap'); S.swapFrom = S.partySel; renderParty(); }
    else if (a === 'swap-cancel') { Sfx.play('cancel'); S.swapFrom = null; renderParty(); }
  });
  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.dataset.act;
    Sfx.play('tap');
    overlay.className = 'overlay'; overlay.innerHTML = '';
    if (a === 'continue') finishBattleFlow(S.endOut || { result: 'win' });
  });

  /* ───────── 배틀 시작 ───────── */
  // 배틀을 열고, 결과 카드(와 진화)까지 끝나면 resolve 하는 Promise 를 돌려준다
  function runBattle(b, bgKey) {
    var done = new Promise(function (r) { S.battleDone = r; });
    var g = newGen();
    S.b = b; S.downUids = {}; S.endOut = null;
    // 센터에 들르지 않아 이미 기절한 채로 시작하는 파티원도 점으로 표시
    b.p.party.forEach(function (m) { if (m.hp <= 0) S.downUids['player' + m.uid] = true; });
    S.disp = { player: null, enemy: null };
    var st = ensureStage();
    overlay.className = 'overlay'; overlay.innerHTML = '';
    showPlate('player', false); showPlate('enemy', false);
    clearMsg(); lock(true);
    movesEl.innerHTML = ''; backBtn.classList.remove('on');
    showBattle(true);
    mark('battle');
    (async function () {
      st.clearFighter('player'); st.clearFighter('enemy');
      stc('clearBall');
      ['player', 'enemy'].forEach(function (s) { stc('shield', s, false); stc('statusTint', s, null); stc('aura', s, null); });
      S.field.player = null; S.field.enemy = null; S.field.enemyDown = false;
      await st.setBackground(bgKey); guard(g);
      await playEvents(E.beginBattle(b), g); guard(g);
      prompt();
    })().catch(swallow);
    return done;
  }
  // 배틀 흐름을 닫고 기다리던 쪽(필드 스크립트)에 결과를 넘긴다
  function finishBattleFlow(out) {
    overlay.className = 'overlay'; overlay.innerHTML = '';
    var r = S.battleDone;
    S.battleDone = null;
    if (r) r(out || { result: 'quit' });
  }

  function prompt() {
    if (!S.b || S.b.over) return;
    renderCmd('root');
    say(E.josa(M[E.active(S.b, 'p').id].name, '은/는') + ' 무엇을 할까?', { hold: false });
    lock(false);
  }

  async function onAction(act) {
    if (S.locked || !S.b || S.b.over || S.screen !== 'battle') return;
    lock(true);
    if (act.t !== 'move' || act.slot < 0) Sfx.play('tap');
    var g = S.gen;
    try {
      var evs = E.resolveTurn(S.b, act, E.chooseEnemyAction(S.b, rng), rng);
      await playEvents(evs, g);
      guard(g);
      await afterTurn(g);
    } catch (e) { swallow(e); }
  }
  async function afterTurn(g) {
    var b = S.b;
    if (b.over) { await endBattle(g); return; }
    if (b.needSwitch) {
      renderCmd('forced');
      lock(false);
      say('다음 포캣몬을 골라 주세요!', { hold: false });
      return;
    }
    prompt();
  }
  async function onForced(idx) {
    if (S.locked || !S.b || !S.b.needSwitch) return;
    lock(true);
    Sfx.play('tap');
    var g = S.gen;
    try {
      await playEvents(E.forceSwitch(S.b, idx), g);
      guard(g);
      await afterTurn(g);
    } catch (e) { swallow(e); }
  }

  /* ───────── 이벤트 재생 ───────── */
  async function playEvents(evs, g) {
    var st = S.st;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      guard(g);
      var d = ev.side ? S.disp[ev.side] : null;
      switch (ev.t) {
        case 'switchIn': {
          var side = ev.side;
          S.disp[side] = mkDisp(ev);
          if (side === 'enemy' && S.field.enemy === ev.id && !S.field.enemyDown) {
            // 컷신에서 이미 무대에 선 몬스터 — 그 편 보호막만 다시 씌운다
            if (S.disp[side].screen) stc('shield', side, true);
          } else {
            if (ev.text) say(ev.text, { hold: false });
            await st.setFighter(side, ev.id, { shiny: ev.shiny }); guard(g);
            S.field[side] = ev.id;
            if (side === 'enemy') S.field.enemyDown = false;
            stc('statusTint', side, ev.status || null);
            await st.enter(side); guard(g);
            // 보호막은 그 편의 상태라 교체해도 남는다 — 연출만 새 몬스터에게 다시 씌운다
            if (S.disp[side].screen) stc('shield', side, true);
          }
          renderPlate(side); showPlate(side);
          if (side === 'enemy' && ev.shiny) {
            var tag = $('shinytag');
            tag.classList.remove('show'); void tag.offsetWidth; tag.classList.add('show');
            Sfx.play('shiny');
            setTimeout(function () { tag.classList.remove('show'); }, T(2200) + 400);
          }
          if (ev.text) await say(ev.text, { auto: T(700) });
          if (side === 'enemy' && S.b.kind === 'wild') await bubble('enemy', pick(M[ev.id].lines.intro), 1300);
          break;
        }
        case 'switchOut':
          await say(ev.text, { auto: T(500) }); guard(g);
          await stc('recall', ev.side);
          showPlate(ev.side, false);
          S.field[ev.side] = null;
          break;
        case 'use': {
          var mv = MV[ev.move];
          await say(ev.text, { auto: T(380), arrow: false });
          guard(g);
          if (mv.cat !== 'status') await st.attack(ev.side, ev.fx);
          break;
        }
        case 'line':
          if (ev.trainer) await bubble('enemy', ev.text, 1700, S.b && S.b.trainer ? S.b.trainer.name : '');
          else await bubble(ev.side, ev.text, 1500);
          break;
        case 'hit': {
          Sfx.play(ev.recoil || ev.selfHit ? 'hit' : ev.crit ? 'crit' : ev.eff > 1 ? 'super' : ev.eff < 1 ? 'weak' : 'hit');
          var hp = st.hit(ev.side, { crit: !!ev.crit, eff: ev.eff, fx: ev.fx });
          setHp(ev.side, ev.hp);
          await hp;
          guard(g);
          if (ev.text) await say(ev.text);
          break;
        }
        case 'residual':
          Sfx.play('weak');
          stc('status', ev.side, ev.kind);
          setHp(ev.side, ev.hp);
          await say(ev.text);
          break;
        case 'miss':
          Sfx.play('weak');
          await Promise.all([st.miss(ev.side), say(ev.text)]);
          break;
        case 'item':
          Sfx.play('tap');
          await say(ev.text, { auto: T(700) });
          break;
        case 'money':
          Sfx.play('levelup');
          await say(ev.text);
          break;
        case 'heal':
          Sfx.play('heal');
          if (ev.bench && S.downUids) {
            var bm = S.b.p.party.filter(function (m) { return m.hp > 0; });
            bm.forEach(function (m) { delete S.downUids['player' + m.uid]; });
            if (S.disp.player) renderPlate('player');
          }
          if (!ev.side) { await say(ev.text); break; }
          var hl = st.heal(ev.side);
          await sleep(T(250));
          guard(g);
          setHp(ev.side, ev.hp);
          await Promise.all([hl, say(ev.text)]);
          break;
        case 'screen':
          if (ev.on) Sfx.play('shield');
          if (d) { d.screen = !!ev.on; renderStatus(ev.side); }
          await Promise.all([st.shield(ev.side, !!ev.on), say(ev.text)]);
          break;
        case 'status':
          if (ev.tick) {
            await Promise.all([stc('status', ev.side, ev.kind), say(ev.text)]);
            break;
          }
          Sfx.play(ev.kind === 'frz' ? 'freeze' : 'weak');
          if (d) {
            if (ev.kind === 'cnf') d.cnf = true; else d.status = ev.kind;
            renderStatus(ev.side);
          }
          if (ev.kind !== 'cnf') stc('statusTint', ev.side, ev.kind);
          await Promise.all([stc('status', ev.side, ev.kind), say(ev.text)]);
          break;
        case 'cure':
          if (d) {
            if (ev.kind === 'cnf') d.cnf = false; else d.status = null;
            renderStatus(ev.side);
          }
          if (ev.side && ev.kind === 'frz') stc('status', ev.side, 'thaw');
          if (ev.side && ev.kind !== 'cnf') stc('statusTint', ev.side, null);
          if (ev.kind === 'all') Sfx.play('heal');
          await say(ev.text);
          break;
        case 'flinch':
          await say(ev.text);
          break;
        case 'stat':
          if (d) {
            if (ev.stat === 'cure') Object.keys(d.stages).forEach(function (k) { if (d.stages[k] < 0) d.stages[k] = 0; });
            else d.stages[ev.stat] = Math.max(-6, Math.min(6, d.stages[ev.stat] + ev.delta));
            renderStatus(ev.side);
          }
          Sfx.play(ev.delta >= 0 ? 'levelup' : 'weak');
          await Promise.all([st.statFx(ev.side, ev.delta >= 0), say(ev.text)]);
          break;
        case 'faint':
          Sfx.play('faint');
          if (d) { d.hp = 0; S.downUids[ev.side + d.uid] = true; }
          await st.faint(ev.side);
          if (ev.side === 'enemy') S.field.enemyDown = true;
          if (ev.side === 'player') S.field.player = null;
          stc('statusTint', ev.side, null);
          guard(g);
          await say(ev.text);
          showPlate(ev.side, false);
          break;
        case 'ball': {
          Sfx.play('tap');
          say(ev.text, { hold: false });
          showPlate('enemy', false);
          await stc('throwBall', ev.shakes, ev.caught); guard(g);
          if (ev.caught) Sfx.play('win');
          else showPlate('enemy', true);
          break;
        }
        case 'run':
          if (ev.ok) Sfx.play('cancel');
          await say(ev.text);
          break;
        case 'exp':
          if (S.disp.player && S.disp.player.uid === ev.uid) { S.disp.player.exp += ev.amount; setExp(); }
          await say(ev.text, { auto: T(800) });
          break;
        case 'levelUp':
          Sfx.play('levelup');
          if (S.disp.player && S.disp.player.uid === ev.uid) {
            var pd = S.disp.player;
            pd.lv = ev.lv; setExp(true);
            setHp('player', ev.hp, false, ev.maxHp);
            st.statFx('player', true);
          }
          await say(ev.text);
          break;
        case 'learn':
          Sfx.play('shiny');
          await say(ev.text);
          break;
        case 'cutscene':
          await playCorrupt(g);
          break;
        case 'needSwitch':
        case 'end':
          break;
        default:
          if (ev.text) await say(ev.text);
      }
    }
  }

  /* ───────── 배틀 끝 ───────── */
  async function endBattle(g) {
    var b = S.b;
    openMenu(false);
    lock(true);
    renderCmd('root'); lock(true);
    var out = E.finishBattle(S.save, b);
    out.result = b.result;
    S.endOut = out;
    persist();
    if (b.result === 'ran') { await sleep(T(300)); guard(g); finishBattleFlow(out); return; }
    if (b.result === 'win' && b.final) {
      Sfx.play('win');
      await sleep(T(600)); guard(g);
      goEnding(out.cleared);
      return;
    }
    if (b.result === 'win' || b.result === 'caught') {
      var me = E.active(b, 'p');
      if (me && me.hp > 0 && b.result === 'win') { Sfx.play('win'); await bubble('player', pick(M[me.id].lines.win), 1300); guard(g); }
    } else {
      Sfx.play('lose');
      await sleep(T(500)); guard(g);
    }
    showResult(b, out);
  }
  function resultParty() {
    return '<div class="res-party">' + S.save.party.map(function (m) {
      return '<span class="rp' + (m.hp <= 0 ? ' dead' : '') + '">' + img(m.id, 'rp-img', m.shiny) + '<b>Lv.' + m.lv + '</b>' + hpBar(m.hp, E.maxHp(m), 'thin') + '</span>';
    }).join('') + '</div>';
  }
  function showResult(b, out) {
    mark('result');
    var html = '', cont = '<button type="button" class="btn btn-primary btn-big" data-act="continue"><span class="btn-main">계속</span></button>';
    if (b.result === 'caught') {
      var c = b.caught;
      Sfx.play('levelup');
      html = '<div class="card result-card" style="--tc:' + mainColor(c.id) + '"><div class="card-rays"></div>' +
        '<div class="card-kicker">GOTCHA!</div><h2 class="card-title win">포획 성공!</h2>' +
        '<div class="card-hero">' + img(c.id, 'card-img', c.shiny) + '</div>' +
        '<p class="card-text"><b>' + (c.shiny ? '✦ 이로치 ' : '') + esc(M[c.id].name) + '</b> Lv.' + c.lv + '<br>' +
          (out.caughtTo === 'party' ? '파티에 들어왔어요!' : '파티가 가득 차서 보관함으로 보냈어요. 메뉴 → 파티에서 바꿀 수 있어요.') + '</p>' + cont + '</div>';
    } else if (b.result === 'win' && b.kind === 'trainer') {
      Sfx.play('levelup');
      var gymA = out.badge ? E.areaById(out.badge) : null;
      html = '<div class="card result-card"><div class="card-rays"></div>' +
        '<div class="card-kicker">' + esc(b.trainer.name) + ' 승리</div><h2 class="card-title win">' + (gymA ? esc(gymA.gym.badge) + '!' : '승리!') + '</h2>' +
        (gymA ? '<div class="badge-big">★</div>' : '') + resultParty() +
        '<p class="card-text">' + (out.prize ? '상금 <b>' + out.prize.toLocaleString() + '원</b>' : '') + (gymA ? '<br>다음 지역으로 가는 길이 열렸어요!' : '') + '</p>' + cont + '</div>';
    } else if (b.result === 'win') {
      html = '<div class="card result-card mini"><div class="card-kicker">WILD BATTLE</div><h2 class="card-title win">승리!</h2>' + resultParty() + cont + '</div>';
    } else {
      html = '<div class="card over-card"><div class="card-kicker red">WHITE OUT</div><h2 class="card-title lose">눈앞이 캄캄해졌다…</h2>' +
        '<p class="card-text">' + (S.canLose ? '포캣몬들이 기운을 차렸다.' : '서둘러 포캣몬 센터로 돌아왔다.<br>포캣몬들이 모두 회복했어요. 잡은 포캣몬·배지·돈은 그대로예요.') + '</p>' +
        resultParty() + cont + '</div>';
    }
    overlay.className = 'overlay on' + (b.result === 'lose' ? ' dim-red' : '');
    overlay.innerHTML = html;
  }

  /* ───────── 화면: 엔딩 ───────── */
  function goEnding(firstClear) {
    newGen();
    showBattle(false);
    mark('ending');
    Sfx.play('levelup');
    var lead = S.save.party[0], m = M[lead.id];
    var conf = '';
    for (var i = 0; i < 28; i++) {
      conf += '<i style="--x:' + Math.round(rng() * 100) + '%;--d:' + (rng() * 2.4).toFixed(2) + 's;--c:' +
        ['#ffd34d', '#ff5a7a', '#5ad1ff', '#8cff9e', '#ffffff'][i % 5] + ';--r:' + Math.round(rng() * 360) + 'deg"></i>';
    }
    host.innerHTML =
      '<section class="scr ending-scr" style="--tc:' + mainColor(lead.id) + '">' +
        '<div class="title-bg end-bg" style="background-image:url(' + bgURL('metal') + ')"></div><div class="title-shade"></div>' +
        '<div class="confetti">' + conf + '</div>' +
        '<div class="end-body">' +
          '<div class="card-kicker">CHAMPION</div>' +
          '<h1 class="end-title">클리어!</h1>' +
          '<div class="end-hero"><div class="end-halo"></div>' + img(lead.id, 'end-img', lead.shiny) + '</div>' +
          '<p class="end-line">“' + esc(pick(m.lines.win)) + '”</p>' +
          '<div class="beaten">' + S.save.party.map(function (p) { return '<span class="beat">' + img(p.id, 'beat-img', p.shiny) + '<i>Lv.' + p.lv + '</i></span>'; }).join('') + '</div>' +
          (firstClear ? '<div class="unlock"><div class="unlock-face">' + img('black', 'unlock-img') + '</div><div><span class="unlock-k">NEW!</span><b>붉은 달 폐허가 열렸다!</b><span>메탈가디언몬과 블랙 메탈가디언몬을 잡을 수 있어요.</span></div></div>' : '') +
          '<p class="end-sub">배지 ' + S.save.badges.length + '개 · 도감 ' + dexCount().caught + '/' + D.DEX.length + '</p>' +
        '</div>' +
        '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" data-act="end-continue"><span class="btn-main">계속</span></button></div>' +
      '</section>';
  }

  /* ───────── 컷신: 최종전 흑화 ───────── */
  function makeSkip() {
    var c = { done: false };
    c.p = new Promise(function (r) { c.fire = function () { if (!c.done) { c.done = true; r(); } }; });
    return c;
  }
  async function playCorrupt(g) {
    var st = S.st, lines = D.CUTSCENES.corrupt;
    var sk = S.skip = makeSkip();
    mark('cutscene');
    showPlate('player', false); showPlate('enemy', false);
    clearMsg();
    function step(p) {
      S.inflight = Promise.resolve(p);
      return Promise.race([S.inflight, sk.p]).then(function () { guard(g); if (sk.done) throw SKIP; });
    }
    function say2(l, dur) {
      if (!l) return Promise.resolve();
      return l.who === 'fx' ? narrate(l.text, dur) : bubble('enemy', l.text, dur);
    }
    ['player', 'enemy'].forEach(function (s) { stc('shield', s, false); stc('statusTint', s, null); stc('aura', s, null); });
    await sleep(60);
    guard(g);
    try {
      var down = S.field.enemyDown;
      if (down || S.field.enemy !== 'metal') await step(st.setFighter('enemy', 'metal', {}));
      S.field.enemy = 'metal';
      await step(st.setBackground('dark'));
      Sfx.play('rumble');
      await step(say2(lines[0], 1500));
      st.flash('#ff2440');
      Sfx.play('transform');
      await step(Promise.all([say2(lines[1], 1700), st.transform('enemy', 'black', {})]));
      S.field.enemy = 'black'; S.field.enemyDown = false;
      for (var i = 2; i < lines.length; i++) await step(say2(lines[i], 1350));
    } catch (e) {
      if (e !== SKIP) throw e;
      coverEl.classList.add('on');
      clearBubbles(); narrEl.classList.remove('show');
      await S.inflight;
      guard(g);
    }
    S.skip = null;
    clearBubbles();
    narrEl.classList.remove('show');
    if (S.field.enemy !== 'black' || sk.done) {
      await st.setBackground('dark'); guard(g);
      await st.setFighter('enemy', 'black', {}); guard(g);
      S.field.enemy = 'black'; S.field.enemyDown = false;
    }
    coverEl.classList.remove('on');
    mark('battle');
    // 컷신 시작 때 지운 연출(보호막·상태 색)을 엔진 상태대로 되살린다
    ['player', 'enemy'].forEach(function (s) {
      var d = S.disp[s];
      if (!d || d.hp <= 0) return;
      if (d.screen) stc('shield', s, true);
      if (d.status) stc('statusTint', s, d.status);
    });
    if (S.disp.player && S.disp.player.hp > 0) showPlate('player');
  }

  /* ═════════ 필드 (탑뷰 맵) ═════════ */
  var THEME_BG = { town: 'forest', forest: 'forest', coast: 'sea', volcano: 'volcano', glacier: 'ice', alley: 'alley', temple: 'temple', summit: 'metal', ruins: 'dark' };
  var QUESTS = [
    { map: 'forest', title: '방울 목걸이 찾기', desc: '소녀의 고양이 방울을 남쪽 수풀에서 찾아 주자.', done: { flag: 'bell_done' } },
    { map: 'coast', title: '날개냥 보여주기', desc: '낚시꾼에게 잡은 날개냥을 보여 주자.', done: { flag: 'fisher_done' } },
    { map: 'volcano', title: '화산 결정', desc: '연구원에게 붉게 빛나는 결정을 가져다주자.', done: { flag: 'crystal_done' } },
    { map: 'glacier', title: '도감 12종', desc: '포캣몬 12종을 잡아 조수에게 보여 주자.', done: { flag: 'assist_done' } },
    { map: 'alley', title: '싸가지냥 보여주기', desc: '골목 할아버지에게 싸가지냥을 보여 주자.', done: { flag: 'owner_done' } },
    { map: 'temple', title: '도감 24종', desc: '포캣몬 24종을 잡아 장로에게 보여 주자.', done: { flag: 'elder_done' } },
    { map: 'home', title: '도감 완성', desc: '38종을 모두 잡아 캣박사에게 보여 주자.', done: { dexCaught: 38 } }
  ];
  var ITEM_COLOR = { ball: '#e8384a', heal: '#3fa63c', cure: '#8ad05a', revive: '#e8b818', repel: '#9a6ad8', candy: '#ff7aa8', key: '#8592ab' };
  function itemIcon(id) {
    var it = IT[id], c = id === 'silverball' ? '#b8c2d8' : id === 'goldball' ? '#e8b818' : ITEM_COLOR[it.kind] || '#888';
    var inner = it.kind === 'ball'
      ? '<path d="M3.2 11.2a8.8 8.8 0 0 1 17.6 0z" fill="' + c + '"/><path d="M3.2 12.8a8.8 8.8 0 0 0 17.6 0z" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#fff" stroke="#1a1f3a" stroke-width="1.8"/>'
      : it.kind === 'heal' ? '<rect x="6" y="5" width="12" height="15" rx="3" fill="' + c + '"/><path d="M12 9v7M8.5 12.5h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
      : it.kind === 'cure' ? '<path d="M12 3c4 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2-6 6-10z" fill="' + c + '"/>'
      : it.kind === 'revive' ? '<path d="M12 2l2.6 6.4 6.9.4-5.3 4.4 1.7 6.7L12 16.2 6.1 19.9l1.7-6.7L2.5 8.8l6.9-.4z" fill="' + c + '"/>'
      : it.kind === 'repel' ? '<rect x="8" y="7" width="8" height="13" rx="2" fill="' + c + '"/><rect x="9.5" y="3" width="5" height="4" rx="1" fill="#ddd"/>'
      : it.kind === 'candy' ? '<circle cx="12" cy="12" r="5" fill="' + c + '"/><path d="M7 12l-4-3v6zM17 12l4-3v6z" fill="' + c + '"/>'
      : '<circle cx="12" cy="12" r="6" fill="' + c + '"/>';
    return '<span class="item-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg></span>';
  }
  function bgForMap() { var m = S.ow.W && S.ow.W.def; return (m && m.area && E.areaById(m.area) && E.areaById(m.area).bg) || THEME_BG[m && m.theme] || 'forest'; }

  function ensureField() {
    if (!S.ow.F) {
      S.ow.F = Field.create(fcanvas);
      document.body.dataset.fieldMode = S.ow.F.mode || 'canvas';
    }
    return S.ow.F;
  }
  function fc(name) { // 렌더러 메서드를 안전하게 부른다 (없거나 실패해도 멈추지 않게)
    var F = S.ow.F, args = Array.prototype.slice.call(arguments, 1);
    try { if (F && typeof F[name] === 'function') return Promise.resolve(F[name].apply(F, args)); } catch (e) { /* 무시 */ }
    return Promise.resolve();
  }
  function entitiesFor(W) {
    var st = S.ow.st;
    var list = [{ id: 'player', x: st.x, y: st.y, dir: st.dir, look: 'player', kind: 'player' }];
    PW.npcsOf(W, S.save).forEach(function (n) {
      if (n.kind === 'mon') list.push({ id: n.id, x: n.x, y: n.y, dir: n.dir, kind: 'mon', img: spr(n.mon), size: n.size || 2 });
      else list.push({ id: n.id, x: n.x, y: n.y, dir: n.dir, look: n.look || 'kid', kind: 'npc' });
    });
    PW.itemsOf(W, S.save).forEach(function (it) { list.push({ id: 'item:' + it.id, x: it.x, y: it.y, dir: 'down', kind: 'item' }); });
    return list;
  }
  function refreshEntities() { if (S.ow.F && S.ow.W) S.ow.F.setEntities(entitiesFor(S.ow.W)); }
  function updateHud() {
    if (!S.ow.W) return;
    $('floc').textContent = S.ow.W.def.name;
    $('fmoney').textContent = S.save.money.toLocaleString() + '원';
  }
  function savePos() {
    var st = S.ow.st;
    S.save.pos = { map: S.ow.mapId, x: st.x, y: st.y, dir: st.dir };
  }

  async function enterMap(id, x, y, dir) {
    var F = ensureField();
    var W = PW.loadMap(id);
    if (PW.occupant(W, S.save, x, y)) {
      var nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(function (d) { return PW.walkable(W, S.save, x + d[0], y + d[1]); })[0];
      if (nb) { x += nb[0]; y += nb[1]; }
    }
    S.ow.W = W; S.ow.mapId = id; S.ow.st = { x: x, y: y, dir: dir || 'down', grass: 0 };
    S.save.visited[id] = 1;
    savePos();
    if (!S.save.respawn) S.save.respawn = PW.centerFront('home');
    persist();
    await fc('loadMap', W.def);
    refreshEntities();
    updateHud();
    var loc = $('floc');
    loc.classList.remove('flash'); void loc.offsetWidth; loc.classList.add('flash');
  }
  // 맵 진입 이벤트 — 화면이 밝아진 뒤에 부른다
  async function runEnterHooks() {
    var hooks = (S.ow.W && S.ow.W.def.onEnter) || [];
    for (var i = 0; i < hooks.length; i++) {
      if (PW.evalCond(S.save, hooks[i].if)) await runScript(PM.SCRIPTS[hooks[i].script], {});
    }
  }
  // 타이틀·새 게임에서 필드로
  async function startField() {
    newGen();
    S.ow.tok++;
    mark('field');
    showLayer('field');
    openMenu(false);
    S.ow.busy = true;
    var p = S.save.pos || S.save.respawn || { map: 'home', x: PM.MAPS.home.start.x, y: PM.MAPS.home.start.y, dir: 'down' };
    if (!PM.MAPS[p.map]) p = PW.centerFront('home');
    try {
      ensureField();
      await fc('transition', 'fadeOut');
      await enterMap(p.map, p.x, p.y, p.dir);
      await fc('transition', 'fadeIn');
      await runEnterHooks();
    } finally { S.ow.busy = false; }
  }
  // 메뉴 화면에서 필드로 돌아오기
  function backToField() {
    newGen();
    mark('field');
    showLayer('field');
    fc('resize');
    refreshEntities();
    updateHud();
  }
  async function flyTo(mapId) {
    var t = PW.centerFront(mapId);
    if (!t) return;
    newGen();
    mark('field');
    showLayer('field');
    S.ow.busy = true;
    try {
      await fc('transition', 'fadeOut');
      Sfx.play('transform');
      await enterMap(t.map, t.x, t.y, t.dir);
      await fc('transition', 'fadeIn');
      await runEnterHooks();
    } finally { S.ow.busy = false; }
  }

  /* ── 대화창 ── */
  var FM = { resolve: null, typing: false, finish: null, timer: null };
  function tpl(text) {
    var sn = M[S.save.starter] ? M[S.save.starter].name : '';
    return String(text)
      .replace('{starter}(이)가', E.josa(sn, '이/가'))
      .replace(/\{starter\}/g, sn)
      .replace(/\{dex\}/g, String(PW.dexCaught(S.save)))
      .replace(/\{money\}/g, S.save.money.toLocaleString());
  }
  function fsay(text, who) {
    return new Promise(function (resolve) {
      var full = tpl(text), i = 0;
      fwho.textContent = who || '';
      fwho.classList.toggle('on', !!who);
      fchoice.innerHTML = '';
      fmsg.classList.add('on');
      fmsg.classList.remove('ready');
      ftext.textContent = '';
      FM.resolve = null;
      function ready() { FM.typing = false; fmsg.classList.add('ready'); FM.resolve = function () { FM.resolve = null; fmsg.classList.remove('on', 'ready'); resolve(); }; }
      FM.finish = function () { clearTimeout(FM.timer); ftext.textContent = full; ready(); };
      if (FAST) { FM.finish(); return; }
      FM.typing = true;
      (function tick() {
        i++;
        ftext.textContent = full.slice(0, i);
        if (i >= full.length) { FM.finish(); return; }
        FM.timer = setTimeout(tick, 20);
      })();
    });
  }
  function fchoose(text, options, who) {
    return new Promise(function (resolve) {
      fwho.textContent = who || ''; fwho.classList.toggle('on', !!who);
      ftext.textContent = tpl(text);
      fmsg.classList.add('on'); fmsg.classList.remove('ready');
      FM.resolve = null; FM.typing = false;
      fchoice.innerHTML = options.map(function (o, i) { return '<button type="button" class="fopt" data-opt="' + i + '">' + esc(o) + '</button>'; }).join('');
      FM.choose = function (i) { FM.choose = null; fchoice.innerHTML = ''; fmsg.classList.remove('on'); resolve(i); };
    });
  }
  function advanceField() {
    if (FM.typing && FM.finish) { FM.finish(); return true; }
    if (FM.resolve) { Sfx.play('tap'); FM.resolve(); return true; }
    return false;
  }
  fmsg.addEventListener('click', function (e) {
    e.stopPropagation();
    var o = e.target.closest('[data-opt]');
    if (o && FM.choose) { Sfx.play('tap'); FM.choose(+o.dataset.opt); return; }
    advanceField();
  });
  function msgOpen() { return fmsg.classList.contains('on'); }

  /* ── 입력 ── */
  function bindPad() {
    var pad = $('fpad');
    function down(e) {
      var b = e.target.closest('[data-dir]');
      if (!b) return;
      e.preventDefault();
      if (msgOpen()) { advanceField(); return; }
      S.ow.held = b.dataset.dir;
      b.classList.add('on');
      walkLoop();
    }
    function up() { S.ow.held = null; pad.querySelectorAll('.on').forEach(function (x) { x.classList.remove('on'); }); }
    pad.addEventListener('pointerdown', down);
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('pointerleave', up);
    $('fA').addEventListener('click', function (e) { e.stopPropagation(); if (msgOpen()) { advanceField(); return; } pressA(); });
    fcanvas.addEventListener('click', function (e) {
      if (msgOpen()) { advanceField(); return; }
      if (S.ow.busy || !S.ow.F || typeof S.ow.F.tileAtScreen !== 'function') return;
      var r = fcanvas.getBoundingClientRect();
      var t = S.ow.F.tileAtScreen(e.clientX - r.left, e.clientY - r.top);
      if (t) walkTo(t.x, t.y);
    });
    var KEY = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    window.addEventListener('keydown', function (e) {
      if (S.screen !== 'field' || menuEl.classList.contains('on') || sheetEl.classList.contains('on')) return;
      if (KEY[e.key]) { e.preventDefault(); if (msgOpen()) return; S.ow.held = KEY[e.key]; walkLoop(); }
      else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { e.preventDefault(); if (!advanceField()) pressA(); }
    });
    window.addEventListener('keyup', function (e) { if (KEY[e.key] && S.ow.held === KEY[e.key]) S.ow.held = null; });
  }

  async function walkLoop() {
    if (S.ow.busy || S.screen !== 'field') return;
    S.ow.busy = true;
    var tok = S.ow.tok;
    try {
      while (S.ow.held && S.screen === 'field' && !msgOpen() && tok === S.ow.tok) {
        var r = await stepOnce(S.ow.held);
        if (r.stop) break;
      }
    } finally { if (tok === S.ow.tok) S.ow.busy = false; }
  }
  async function walkOnce(dir) {
    if (S.ow.busy) return null;
    S.ow.busy = true;
    try { return await stepOnce(dir); } finally { S.ow.busy = false; }
  }
  async function walkTo(tx, ty) {
    var W = S.ow.W, st = S.ow.st;
    var path = PW.findPath(W, S.save, st.x, st.y, tx, ty);
    if (!path) return;
    S.ow.busy = true;
    var tok = S.ow.tok, stopped = false;
    try {
      for (var i = 0; i < path.length && tok === S.ow.tok; i++) {
        var r = await stepOnce(path[i]);
        if (r.stop || r.kind !== 'move') { stopped = true; break; }
      }
      // 탭한 칸이 사람·표지판·도구·문이면 바라보고 조사
      if (!stopped && tok === S.ow.tok && Math.abs(st.x - tx) + Math.abs(st.y - ty) === 1) {
        var dir = tx > st.x ? 'right' : tx < st.x ? 'left' : ty > st.y ? 'down' : 'up';
        st.dir = dir; fc('faceEntity', 'player', dir);
        S.ow.busy = false;
        await pressA();
      }
    } finally { if (tok === S.ow.tok) S.ow.busy = false; }
  }

  // 한 걸음. 반환 { stop, kind }
  async function stepOnce(dir) {
    var W = S.ow.W, st = S.ow.st;
    var r = PW.step(W, S.save, st, dir, rng);
    fc('faceEntity', 'player', st.dir);
    if (r.kind === 'bump') { await fc('bump', 'player', dir); return { stop: !S.ow.held, kind: 'bump' }; }
    if (r.kind === 'deny') { Sfx.play('cancel'); await fc('bump', 'player', dir); await fsay(r.text); return { stop: true, kind: 'deny' }; }
    if (r.kind === 'door') { await doorAction(r.door); return { stop: true, kind: 'door' }; }
    if (r.kind === 'warp') {
      await fc('moveEntity', 'player', dir);
      await fc('transition', 'fadeOut');
      await enterMap(r.to, r.x, r.y, r.dir);
      await fc('transition', 'fadeIn');
      await runEnterHooks();
      return { stop: true, kind: 'warp' };
    }
    // move
    await fc('moveEntity', 'player', dir);
    savePos();
    if (++S.ow.steps % 8 === 0) persist();
    if (r.repelEnded) await fsay('향긋 스프레이의 효과가 다 떨어졌다.');
    if (r.trigger) { await runScript(PM.SCRIPTS[r.trigger], {}); return { stop: true, kind: 'move' }; }
    if (r.spotted && canFight()) { await trainerEncounter(r.spotted.npc, r.spotted); return { stop: true, kind: 'move' }; }
    if (r.encounter && canFight()) {
      var b = E.createWildBattle(S.save, r.encounter, rng);
      if (!PW.repelBlocks(S.save, b.e.party[0].lv)) { await doBattle(b, {}); return { stop: true, kind: 'move' }; }
    }
    return { stop: false, kind: 'move' };
  }

  async function pressA() {
    if (S.ow.busy || S.screen !== 'field' || !S.ow.W) return;
    S.ow.busy = true;
    try {
      var W = S.ow.W, st = S.ow.st, hit = PW.interact(W, S.save, st);
      if (!hit) return;
      if (hit.kind === 'npc') {
        var n = hit.npc;
        if (n.kind !== 'mon') { n.dir = PW.OPP[st.dir]; fc('faceEntity', n.id, n.dir); }
        if (n.trainer) await trainerEncounter(n, null);
        else await runScript(PM.SCRIPTS[n.script], { npc: n });
      } else if (hit.kind === 'sign') {
        await fsay(hit.sign.text);
      } else if (hit.kind === 'item') {
        Sfx.play('levelup');
        var text = PW.pickItem(S.save, hit.item);
        persist();
        fc('removeEntity', 'item:' + hit.item.id);
        await fsay(text);
        updateHud();
      } else if (hit.kind === 'door') {
        await doorAction(hit.door);
      }
    } finally { S.ow.busy = false; }
  }

  /* ── 문: 센터·상점·관장·연구소·집 ── */
  async function doorAction(door) {
    var bd = door.building, W = S.ow.W;
    if (bd.kind === 'center') {
      await fsay('어서 오세요! 포캣몬 센터예요. 포캣몬을 잠깐 맡아 드릴게요…', '간호사');
      E.healParty(S.save);
      S.save.respawn = PW.centerFront(S.ow.mapId);
      persist();
      Sfx.play('heal');
      await fsay('포캣몬들이 모두 건강해졌어요! 또 오세요!', '간호사');
    } else if (bd.kind === 'shop') {
      await fsay('어서 오세요! 필요한 게 있으신가요?', '점원');
      await openShop();
      await fsay('감사합니다! 또 오세요!', '점원');
    } else if (bd.kind === 'gym') {
      await gymFlow();
    } else if (bd.kind === 'lab') {
      await runScript(PM.SCRIPTS[bd.script || 'professor'], {});
    } else {
      await fsay(W.def.houseText || '문이 잠겨 있다. 아무도 없는 것 같다.');
    }
  }
  async function gymFlow() {
    var area = E.areaById(S.ow.W.def.area);
    if (!area || !area.gym) return;
    var tid = area.gym.trainer, t = D.TRAINERS[tid], who = t.cls + ' ' + t.name;
    if (!canFight()) { await noFighter(); return; }
    if (S.save.beaten[tid]) {
      await fsay(t.lines.after || t.lines.lose, who);
      var again = await fchoose('관장과 다시 겨뤄 볼까?', ['겨룬다', '그만둔다'], who);
      if (again !== 0) return;
    } else {
      await fsay(t.lines.intro, who);
    }
    var out = await doBattle(E.createGymBattle(S.save, area.id, rng), {});
    if (out.result === 'win' && out.badge) await fsay(area.gym.badge + '를 받았다! ' + (t.lines.after || ''), who);
  }

  /* ── 트레이너 ── 시야에 걸리면 ! → 다가와서 → 대사 → 배틀 */
  async function trainerEncounter(npc, sp) {
    var t = D.TRAINERS[npc.trainer], who = t.cls + ' ' + t.name, st = S.ow.st;
    if (S.save.beaten[npc.trainer]) { await fsay(t.lines.after || t.lines.lose, who); return; }
    if (!canFight()) { await noFighter(); return; }
    if (sp) {
      Sfx.play('shiny');
      await fc('emote', npc.id, '!');
      for (var i = 0; i < sp.steps; i++) {
        await fc('moveEntity', npc.id, npc.dir);
        var d = PW.DIRS[npc.dir];
        npc.x += d[0]; npc.y += d[1];
      }
      st.dir = PW.OPP[npc.dir];
      fc('faceEntity', 'player', st.dir);
    }
    await fsay(t.lines.intro, who);
    var bt = E.createTrainerBattle(S.save, npc.trainer, rng);
    await doBattle(bt, {});
  }

  /* ── 배틀 열기 → 진화 → 필드로 ── */
  function canFight() { return E.canExplore(S.save); }
  async function noFighter() { await fsay('싸울 수 있는 포캣몬이 없다! 포캣몬 센터에서 회복하자.'); }
  async function doBattle(b, opts) {
    opts = opts || {};
    var tok = S.ow.tok;
    S.canLose = !!opts.canLose;
    S.ow.held = null;
    document.querySelectorAll('#fpad .on').forEach(function (x) { x.classList.remove('on'); });
    Sfx.play('rumble');
    await fc('transition', 'battle');
    var out = await runBattle(b, bgForMap());
    if (tok !== S.ow.tok) return out;
    if (out.result !== 'quit' && out.evolutions && out.evolutions.length) await evolveScenes(out.evolutions);
    newGen();
    mark('field');
    showLayer('field');
    if (out.result === 'quit') {
      var p = S.save.pos;
      await enterMap(p.map, p.x, p.y, p.dir);
    } else if ((out.result === 'lose' && !opts.canLose) || (out.whiteout && out.result !== 'lose')) {
      var rp = S.save.respawn || PW.centerFront('home');
      await enterMap(rp.map, rp.x, rp.y, rp.dir);
    } else {
      refreshEntities();
    }
    persist();
    updateHud();
    await fc('transition', 'fadeIn');
    return out;
  }

  /* ── 스크립트 실행 ── */
  async function runScript(cmds, ctx) {
    if (!cmds) return 'ok';
    ctx = ctx || {};
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      if (c.say) await fsay(c.say, c.who);
      else if (c.if) {
        var r = await runScript(PW.evalCond(S.save, c.if) ? c.then : c.else, ctx);
        if (r === 'abort') return r;
      } else if (c.battle) {
        if (!canFight()) { await noFighter(); return 'abort'; }
        var out = await doBattle(E.createTrainerBattle(S.save, c.battle, rng, { gymArea: c.gym }), { canLose: c.canLose });
        // 져도 되는 배틀(인트로 라이벌)은 그만둬도 이야기가 이어진다
        if (!c.canLose && (out.result === 'quit' || out.result === 'lose')) return 'abort';
      } else if (c.choice) {
        var k = await fchoose(c.choice, ['예', '아니오'], c.who);
        var r2 = await runScript(k === 0 ? c.yes : c.no, ctx);
        if (r2 === 'abort') return r2;
      } else if (c.emote) {
        if (ctx.npc) await fc('emote', ctx.npc.id, c.emote);
      } else if (c.ending) {
        // 최종전 엔딩은 배틀 쪽에서 이미 보여 줬다
      } else {
        var text = PW.applyAction(S.save, c);
        persist();
        if (text) { Sfx.play(c.give ? 'levelup' : 'tap'); await fsay(text); }
      }
    }
    refreshEntities();
    updateHud();
    persist();
    return 'ok';
  }

  /* ── 상점 (아래에서 올라오는 시트) ── */
  function openShop() {
    return new Promise(function (resolve) {
      function render() {
        var ids = E.shopItems(S.save);
        sheetEl.innerHTML = '<div class="sheet-card">' +
          '<div class="sheet-head"><b>상점</b><span class="sheet-money">' + S.save.money.toLocaleString() + '원</span></div>' +
          '<div class="shop-list">' + ids.map(function (id) {
            var it = IT[id], have = S.save.bag[id] || 0;
            return '<div class="shop-row">' + itemIcon(id) +
              '<span class="shop-info"><b>' + esc(it.name) + '</b><small>' + esc(it.desc) + '</small><i>가방에 ' + have + '개</i></span>' +
              '<span class="shop-buy"><span class="shop-price">' + it.price.toLocaleString() + '원</span>' +
                '<button type="button" class="sbtn" data-buy="' + id + '" data-n="1"' + (S.save.money < it.price ? ' disabled' : '') + '>1개</button>' +
                '<button type="button" class="sbtn" data-buy="' + id + '" data-n="5"' + (S.save.money < it.price * 5 ? ' disabled' : '') + '>5개</button></span></div>';
          }).join('') + '</div>' +
          '<button type="button" class="btn btn-ghost" data-close="1"><span class="btn-main">나가기</span></button></div>';
      }
      function onClick(e) {
        var bb = e.target.closest('[data-buy]');
        if (bb && !bb.disabled) {
          var r = E.buy(S.save, bb.dataset.buy, +bb.dataset.n);
          Sfx.play(r.ok ? 'levelup' : 'cancel');
          toast(r.text);
          persist(); updateHud(); render();
          return;
        }
        if (e.target.closest('[data-close]') || e.target === sheetEl) {
          Sfx.play('cancel');
          sheetEl.removeEventListener('click', onClick);
          sheetEl.classList.remove('on'); sheetEl.setAttribute('aria-hidden', 'true');
          resolve();
        }
      }
      render();
      sheetEl.classList.add('on'); sheetEl.setAttribute('aria-hidden', 'false');
      sheetEl.addEventListener('click', onClick);
    });
  }

  /* ── 가방 화면 ── */
  function goBag() {
    newGen();
    showBattle(false);
    mark('bag');
    renderBag();
  }
  function renderBag() {
    var bag = S.save.bag, ids = Object.keys(IT).filter(function (id) { return bag[id] > 0; });
    if (S.bagSel && !(bag[S.bagSel] > 0)) S.bagSel = null;
    var sel = S.bagSel, it = sel ? IT[sel] : null, detail = '';
    if (it) {
      var needsTarget = ['heal', 'cure', 'revive', 'candy'].indexOf(it.kind) >= 0;
      detail = '<div class="bag-detail">' + itemIcon(sel) + '<div><b>' + esc(it.name) + '</b><p>' + esc(it.desc) + '</p></div></div>' +
        (needsTarget ? '<div class="sec-t">누구에게 쓸까?</div><div class="pslots">' + S.save.party.map(function (m, i) {
          var why = E.itemBlock(m, it), mx = E.maxHp(m);
          return '<button type="button" class="pslot" data-use="' + i + '" style="--tc:' + mainColor(m.id) + '"' + (why ? ' disabled' : '') + '>' + img(m.id, 'pslot-img', m.shiny) +
            '<b>' + esc(M[m.id].name) + '</b><span class="pslot-lv">Lv.' + m.lv + statusChip(m.status) + '</span>' + hpBar(m.hp, mx, 'thin') + '</button>';
        }).join('') + '</div>'
          : it.kind === 'repel' ? '<button type="button" class="btn btn-primary" data-use="-1"><span class="btn-main">뿌리기</span></button>'
          : '<p class="empty-note">' + (it.kind === 'ball' ? '포캣볼은 야생 배틀 중 가방에서 던질 수 있어요.' : '중요한 물건이에요. 필요한 사람에게 가져가 보세요.') + '</p>');
    }
    host.innerHTML =
      '<section class="scr bag-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-field" aria-label="필드로">‹</button>' +
          '<div><h2>가방</h2><p>' + S.save.money.toLocaleString() + '원' + (S.save.repel ? ' · 스프레이 ' + S.save.repel + '걸음 남음' : '') + '</p></div></header>' +
        detail +
        '<div class="bag-grid">' + (ids.length ? ids.map(function (id) {
          return '<button type="button" class="bag-cell' + (id === sel ? ' on' : '') + '" data-bag="' + id + '">' + itemIcon(id) + '<b>' + esc(IT[id].name) + '</b><i>×' + bag[id] + '</i></button>';
        }).join('') : '<p class="empty-note">가방이 비어 있어요.</p>') + '</div>' +
        tabbar('bag') +
      '</section>';
  }
  async function useBagItem(idx) {
    var r = E.useItem(S.save, S.bagSel, idx);
    Sfx.play(r.ok ? 'heal' : 'cancel');
    toast(r.text);
    if (r.ok) {
      persist();
      var ev = E.pendingEvolutions(S.save);
      if (ev.length && IT[S.bagSel] && IT[S.bagSel].kind === 'candy') { await evolveScenes(ev); goBag(); return; }
    }
    renderBag();
  }

  /* ── 진화 연출 ── */
  async function evolveScenes(list) {
    for (var i = 0; i < list.length; i++) {
      var mon = S.save.party[list[i]];
      if (!mon || !E.canEvolve(mon)) continue;
      await evolveOne(mon);
    }
  }
  function evolveOne(mon) {
    return new Promise(function (resolve) {
      newGen();
      showBattle(false);
      mark('evolve');
      var from = mon.id, to = M[from].evolve.to;
      host.innerHTML =
        '<section class="scr evo-scr" style="--tc:' + mainColor(from) + '">' +
          '<div class="evo-rays"></div>' +
          '<div class="evo-stage"><img class="evo-img evo-from" src="' + spr(from, mon.shiny) + '" alt=""><img class="evo-img evo-to" src="' + spr(to, mon.shiny) + '" alt=""></div>' +
          '<p class="evo-text" id="evo-text">어라…? ' + esc(M[from].name) + '의 모습이…!</p>' +
          '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" id="evo-ok" disabled><span class="btn-main">…</span></button></div>' +
        '</section>';
      var sec = host.querySelector('.evo-scr'), btn = $('evo-ok');
      Sfx.play('rumble');
      setTimeout(function () { sec.classList.add('glow'); Sfx.play('transform'); }, T(900));
      setTimeout(function () {
        E.evolveMon(S.save, mon);
        persist();
        sec.classList.add('done');
        Sfx.play('levelup');
        $('evo-text').textContent = '축하합니다! ' + E.josa(M[from].name, '은/는') + ' ' + M[to].name + '(으)로 진화했다!'.replace('(으)로', /[가-힣]/.test(M[to].name) && hasBatchimKo(M[to].name) ? '으로' : '로');
        btn.disabled = false; btn.querySelector('.btn-main').textContent = '좋아!';
      }, T(3200));
      btn.addEventListener('click', function () { Sfx.play('tap'); resolve(); });
    });
  }
  function hasBatchimKo(w) { var c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 && (c - 0xac00) % 28 !== 8; }

  bindPad();

  /* ───────── 시작 ───────── */
  window.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#app')) e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });   // iOS 핀치 확대 방지
  // 자동 점검용 창구 (게임 동작에는 쓰지 않는다)
  window.__pocatmon = { state: S, store: store, enterMap: function (id, x, y, dir) { S.ow.busy = true; enterMap(id, x, y, dir).then(function () { S.ow.busy = false; }); return true; },
    walk: function (dir) { walkOnce(dir); return true; }, pressA: function () { pressA(); return true; } };
  goTitle();
})();
