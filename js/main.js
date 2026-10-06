/* 포캣몬 배틀 — 화면 흐름 · 배틀 이벤트 재생 · 컷신
   전역 PData / PEngine / Sprites / Sfx / Stage 를 쓴다. 모듈 아님.
   테스트용: document.body.dataset.screen = title|starter|map|area|party|dex|battle|cutscene|result|ending
            ?fast → UI 지연·타자 속도 단축, ?seed=N → 고정 난수, ?2d → 2D 무대 강제 */
(function () {
  'use strict';
  var D = window.PData, E = window.PEngine, M = D.MONSTERS, MV = D.MOVES, TY = D.TYPES, TU = D.TUNING;

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
    field: { player: null, enemy: null, enemyDown: false }, skip: null, inflight: null, lastBack: 'map'
  };
  var ABORT = { abort: true }, SKIP = { skip: true };
  function guard(g) { if (g !== S.gen) throw ABORT; }
  function swallow(e) { if (e !== ABORT && e !== SKIP) throw e; }
  function persist() { if (S.save) store.save(S.save); }

  /* ───────── 뼈대 ───────── */
  var app = $('app');
  app.innerHTML =
    '<div id="screen" class="screen-host"></div>' +
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
    '<div id="menu" class="menu" aria-hidden="true"><div class="menu-card">' +
      '<div class="menu-title">메뉴</div>' +
      '<button type="button" class="btn btn-primary" data-act="menu-close">계속하기</button>' +
      '<button type="button" class="btn btn-ghost" data-act="menu-mute"></button>' +
      '<button type="button" class="btn btn-ghost" data-act="menu-quit">배틀 그만두기 <small>(이번 배틀은 없던 일로)</small></button>' +
    '</div></div>';

  var host = $('screen'), battleEl = $('battle'), arena = $('arena'), overlay = $('overlay');
  var msgBox = $('msgbox'), msgText = $('msgtext'), movesEl = $('moves'), bubblesEl = $('bubbles'), narrEl = $('narr');
  var menuEl = $('menu'), coverEl = $('cover'), backBtn = $('cmd-back'), toastEl = $('toast');

  function mark(name) {
    S.screen = name;
    document.body.dataset.screen = name;
  }
  function showBattle(on) {
    battleEl.classList.toggle('on', !!on);
    host.classList.toggle('on', !on);
    if (S.st) { try { S.st.setPaused(!on); } catch (e) { /* 무시 */ } }
  }
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
  function toggleMute() { Sfx.setMuted(!Sfx.muted); syncMute(); if (!Sfx.muted) Sfx.play('tap'); }
  function openMenu(on) { menuEl.classList.toggle('on', !!on); menuEl.setAttribute('aria-hidden', on ? 'false' : 'true'); }
  $('btn-mute').addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });
  $('btn-menu').addEventListener('click', function (e) { e.stopPropagation(); Sfx.play('tap'); openMenu(true); });
  menuEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) { if (e.target === menuEl) openMenu(false); return; }
    var a = b.dataset.act;
    if (a === 'menu-close') { Sfx.play('tap'); openMenu(false); }
    else if (a === 'menu-mute') toggleMute();
    else if (a === 'menu-quit') {
      Sfx.play('cancel'); openMenu(false);
      // 배틀 중 바뀐 상태(체력·PP·경험치)는 버리고 마지막 저장으로 되돌린다
      S.save = store.load() || S.save;
      goArea(S.area || 'forest');
    }
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
      c('ball', '포캣볼', wild ? '잡기' : '트레이너전 불가', '#d8343e', ball, !wild) +
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
  function partyPickHTML(forced) {
    return '<div class="pick-list">' + S.b.p.party.map(function (m, i) {
      var cur = i === S.b.p.active && !forced, dead = m.hp <= 0, mx = E.maxHp(m);
      return '<button type="button" class="pick-row' + (cur ? ' cur' : '') + (dead ? ' dead' : '') + '" data-pick-slot="' + i + '"' + (cur || dead ? ' data-off="1"' : '') + ' disabled>' +
        img(m.id, 'pick-img', m.shiny) +
        '<span class="pick-info"><span class="pick-top"><b>' + esc(M[m.id].name) + '</b>' + statusChip(m.status) + '<span class="pick-lv">Lv.' + m.lv + '</span></span>' +
        '<span class="pick-hp">' + hpBar(m.hp, mx) + '<span class="pick-num">' + m.hp + '/' + mx + '</span></span></span>' +
        (cur ? '<span class="pick-tag">배틀 중</span>' : dead ? '<span class="pick-tag">기절</span>' : '') +
      '</button>';
    }).join('') + '</div>';
  }
  function renderCmd(mode) {
    S.mode = mode;
    battleEl.dataset.cmd = mode;
    movesEl.className = 'moves mode-' + mode;
    movesEl.innerHTML = mode === 'root' ? cmdHTML() : mode === 'fight' ? moveHTML() : partyPickHTML(mode === 'forced');
    backBtn.classList.toggle('on', mode === 'fight' || mode === 'party');
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
      } else if (c === 'ball') onAction({ t: 'ball' });
      else if (c === 'run') onAction({ t: 'run' });
    } else if (btn.dataset.slot != null) {
      onAction({ t: 'move', slot: +btn.dataset.slot });
    } else if (btn.dataset.pickSlot != null) {
      var idx = +btn.dataset.pickSlot;
      if (S.mode === 'forced') onForced(idx);
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
    return '<nav class="tabbar">' + t('map', '지도', ICON.map) + t('party', '파티', ICON.party) + t('dex', '도감', ICON.dex) + '</nav>';
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
          '<p class="tagline">고양이 포캣몬 18종을 모으고, 6명의 관장과 정상의 수호자에게 도전하자</p>' +
        '</div>' +
        '<div class="cast cast-5 cast-cats"><div class="cast-inner"><div class="cast-floor"></div>' + cast.map(function (id, i) {
          return '<div class="cast-m cast-' + id + '" style="--i:' + i + '">' + img(id, 'cast-img') + '</div>';
        }).join('') + '</div></div>' +
        '<div class="title-actions">' +
          (saved ? '<button type="button" class="btn btn-primary btn-big" data-act="continue"><span class="btn-main">이어하기</span><span class="btn-sub">' + sub + '</span></button>' : '') +
          '<button type="button" class="btn ' + (saved ? 'btn-ghost' : 'btn-primary btn-big') + '" data-act="new"><span class="btn-main">새로 시작</span>' + (saved ? '<span class="btn-sub" data-newsub>지금까지의 기록은 지워져요</span>' : '') + '</button>' +
        '</div>' +
        '<div class="title-foot">' + (saved && saved.cleared ? '✦ 정상의 수호자를 이겼어요 · 붉은 달 폐허가 열려 있어요' : '야생 포캣몬을 잡아 최대 3마리로 파티를 꾸려요') + '</div>' +
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

  /* ───────── 화면: 지도 ───────── */
  function goMap() {
    newGen();
    S.b = null;
    showBattle(false);
    mark('map');
    S.lastBack = 'map';
    var save = S.save, dc = dexCount(), gyms = gymAreas();
    var badges = gyms.map(function (a) {
      var got = E.hasBadge(save, a.id);
      return '<span class="badge' + (got ? ' got' : '') + (a.final ? ' final' : '') + '" title="' + esc(a.gym.badge) + '">' + (got ? '★' : '') + '</span>';
    }).join('');
    var cards = D.AREAS.map(function (a, i) {
      var open = E.areaOpen(save, a.id), got = a.gym && E.hasBadge(save, a.id);
      if (a.post && !open) return '';
      var types = [];
      (a.wild || []).forEach(function (w) { M[w[0]].types.forEach(function (t) { if (types.indexOf(t) < 0) types.push(t); }); });
      var state = !open ? '<span class="ac-state lk">🔒 ' + esc(D.AREAS[i - 1].gym.badge) + ' 필요</span>'
        : got ? '<span class="ac-state ok">★ ' + esc(a.gym.badge) + '</span>'
        : a.post ? '<span class="ac-state post">클리어 보상</span>'
        : '<span class="ac-state cur">도전 중</span>';
      return '<button type="button" class="acard' + (open ? '' : ' locked') + (a.final ? ' final' : '') + '" data-area="' + a.id + '"' + (open ? '' : ' disabled') + '>' +
        '<span class="ac-bg" style="background-image:url(' + bgURL(a.bg) + ')"></span>' +
        '<span class="ac-body"><span class="ac-no">' + (a.final ? 'FINAL' : a.post ? 'EXTRA' : 'AREA ' + (i + 1)) + '</span>' +
          '<b class="ac-name">' + esc(a.name) + '</b>' +
          '<span class="ac-meta">' + (a.lv ? '<span class="ac-lv">Lv.' + a.lv[0] + '~' + a.lv[1] + '</span>' : '<span class="ac-lv">관장 Lv.' + a.gym.team[0][1] + '~</span>') +
            (open ? chips(types) : '') + '</span>' +
        '</span>' + state + '</button>';
    }).join('');
    host.innerHTML =
      '<section class="scr map-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="title" aria-label="타이틀로">‹</button>' +
          '<div><h2>포캣몬 지도</h2><p>배지 ' + save.badges.length + '/' + gyms.length + ' · 도감 ' + dc.caught + '/' + D.DEX.length + '</p></div></header>' +
        '<div class="badges">' + badges + '</div>' +
        (needsHeal() ? '<button type="button" class="btn btn-ghost center-btn" data-act="heal"><span class="btn-main">＋ 포캣몬 센터에서 회복</span></button>' : '') +
        '<div class="areas">' + cards + '</div>' +
        tabbar('map') +
      '</section>';
  }

  /* ───────── 화면: 지역 ───────── */
  function goArea(id) {
    newGen();
    S.b = null;
    S.area = id;
    showBattle(false);
    mark('area');
    var a = areaOf(id), save = S.save;
    var wild = (a.wild || []).map(function (w) {
      var sid = w[0], caught = save.dex.caught[sid], seen = save.dex.seen[sid];
      return '<span class="wmon' + (caught ? ' caught' : seen ? ' seen' : ' unseen') + '" style="--tc:' + mainColor(sid) + '">' +
        img(sid, 'wmon-img' + (caught ? '' : ' sil')) + (caught || seen ? '' : '<span class="wmon-q">?</span>') +
        '<b>' + (caught || seen ? esc(M[sid].name) : '???') + '</b>' + (caught ? '<i>✔</i>' : '') + '</span>';
    }).join('');
    var gym = a.gym, got = gym && E.hasBadge(save, a.id);
    var team = gym ? gym.team.map(function (t) {
      var seen = save.dex.seen[t[0]] && !(a.final && t[0] === 'black' && !got);
      return '<span class="gmon">' + img(t[0], 'gmon-img' + (seen ? '' : ' sil')) + '<i>Lv.' + t[1] + '</i></span>';
    }).join('') : '';
    var canGo = E.canExplore(save);
    host.innerHTML =
      '<section class="scr area-scr">' +
        '<div class="area-hero" style="background-image:url(' + bgURL(a.bg) + ')"></div>' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-map" aria-label="지도로">‹</button>' +
          '<div><h2>' + esc(a.name) + '</h2><p>' + (a.lv ? '야생 Lv.' + a.lv[0] + '~' + a.lv[1] : '마지막 시험') + (got ? ' · ★ ' + esc(gym.badge) : '') + '</p></div></header>' +
        (a.wild ? '<div class="sec-t">이 지역의 포캣몬</div><div class="wild-row">' + wild + '</div>' : '') +
        '<div class="sec-t">나의 파티</div>' + partyStrip() +
        '<div class="area-actions">' +
          (a.wild ? '<button type="button" class="btn btn-primary btn-big" data-act="explore"' + (canGo ? '' : ' disabled') + '><span class="btn-main">수풀 탐색</span><span class="btn-sub">' + (canGo ? '야생 포캣몬과 배틀 · 포획' : '싸울 수 있는 포캣몬이 없어요') + '</span></button>' : '') +
          (gym ? '<button type="button" class="btn ' + (a.wild ? 'btn-ghost' : 'btn-primary btn-big') + ' gym-btn" data-act="gym"' + (canGo ? '' : ' disabled') + '>' +
            '<span class="btn-main">' + (got ? '재도전: ' : '') + esc(gym.name) + '</span><span class="gym-team">' + team + '</span></button>' : '') +
          '<button type="button" class="btn btn-ghost" data-act="heal"' + (needsHeal() ? '' : ' disabled') + '><span class="btn-main">＋ 포캣몬 센터에서 회복</span></button>' +
        '</div>' +
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
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-map" aria-label="지도로">‹</button>' +
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
        '<header class="scr-head"><button type="button" class="back-btn" data-act="tab-map" aria-label="지도로">‹</button>' +
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
    var b = e.target.closest('[data-act],[data-pick],[data-area],[data-psel],[data-dex]');
    if (!b || b.disabled) return;
    if (b.dataset.pick) {
      if (S.sel !== b.dataset.pick) { S.sel = b.dataset.pick; Sfx.play('tap'); renderStarter(); }
      return;
    }
    if (b.dataset.area) { Sfx.play('tap'); goArea(b.dataset.area); return; }
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
    else if (a === 'continue') { Sfx.play('tap'); S.save = store.load(); if (S.save) goMap(); else goTitle(); }
    else if (a === 'title') { Sfx.play('cancel'); goTitle(); }
    else if (a === 'go') {
      Sfx.play('tap');
      store.clear();
      S.save = E.newGame(S.sel, rng); S.partySel = null; S.dexSel = null; S.swapFrom = null;
      persist();
      goArea(D.AREAS[0].id);
      toast(M[S.sel].name + '와 함께 모험을 시작했다!');
    }
    else if (a === 'tab-map') { Sfx.play('tap'); goMap(); }
    else if (a === 'tab-party') { Sfx.play('tap'); goParty(); }
    else if (a === 'tab-dex') { Sfx.play('tap'); goDex(); }
    else if (a === 'heal') { heal(); if (S.screen === 'area') goArea(S.area); else goMap(); }
    else if (a === 'explore') { Sfx.play('tap'); startWild(S.area); }
    else if (a === 'gym') { Sfx.play('tap'); startGym(S.area); }
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
    if (a === 'again') startWild(S.area);
    else if (a === 'area') goArea(S.area);
    else if (a === 'map') goMap();
    else if (a === 'party') goParty();
  });

  /* ───────── 배틀 시작 ───────── */
  function startWild(areaId) {
    if (!E.canExplore(S.save)) { toast('싸울 수 있는 포캣몬이 없어요. 센터에서 회복해 주세요!'); goArea(areaId); return; }
    runBattle(E.createWildBattle(S.save, areaId, rng), areaOf(areaId));
  }
  function startGym(areaId) {
    if (!E.canExplore(S.save)) { toast('싸울 수 있는 포캣몬이 없어요. 센터에서 회복해 주세요!'); goArea(areaId); return; }
    runBattle(E.createGymBattle(S.save, areaId, rng), areaOf(areaId));
  }
  function runBattle(b, area) {
    var g = newGen();
    S.b = b; S.area = area.id; S.downUids = {};
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
      await st.setBackground(area.bg); guard(g);
      await playEvents(E.beginBattle(b), g); guard(g);
      prompt();
    })().catch(swallow);
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
        case 'heal':
          Sfx.play('heal');
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
          if (ev.kind === 'frz') stc('status', ev.side, 'thaw');
          if (ev.kind !== 'cnf') stc('statusTint', ev.side, null);
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
    var b = S.b, area = areaOf(S.area);
    lock(true);
    renderCmd('root'); lock(true);
    var out = E.finishBattle(S.save, b);
    persist();
    if (b.result === 'ran') { await sleep(T(300)); guard(g); goArea(S.area); toast('무사히 도망쳤다!'); return; }
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
    showResult(b, out, area);
  }
  function resultParty() {
    return '<div class="res-party">' + S.save.party.map(function (m) {
      return '<span class="rp' + (m.hp <= 0 ? ' dead' : '') + '">' + img(m.id, 'rp-img', m.shiny) + '<b>Lv.' + m.lv + '</b>' + hpBar(m.hp, E.maxHp(m), 'thin') + '</span>';
    }).join('') + '</div>';
  }
  function showResult(b, out, area) {
    mark('result');
    var html = '', canGo = E.canExplore(S.save), wildBtns =
      (area.wild ? '<button type="button" class="btn btn-primary btn-big" data-act="again"' + (canGo ? '' : ' disabled') + '><span class="btn-main">계속 탐색</span></button>' : '') +
      '<button type="button" class="btn btn-ghost" data-act="area"><span class="btn-main">' + esc(E.josa(area.name, '으로/로')) + ' 돌아가기</span></button>';
    if (b.result === 'caught') {
      var c = b.caught;
      Sfx.play('levelup');
      html = '<div class="card result-card" style="--tc:' + mainColor(c.id) + '"><div class="card-rays"></div>' +
        '<div class="card-kicker">GOTCHA!</div><h2 class="card-title win">포획 성공!</h2>' +
        '<div class="card-hero">' + img(c.id, 'card-img', c.shiny) + '</div>' +
        '<p class="card-text"><b>' + (c.shiny ? '✦ 이로치 ' : '') + esc(M[c.id].name) + '</b> Lv.' + c.lv + '<br>' +
          (out.caughtTo === 'party' ? '파티에 들어왔어요!' : '파티가 가득 차서 보관함으로 보냈어요.') + '</p>' +
        wildBtns + (out.caughtTo === 'box' ? '<button type="button" class="btn btn-ghost" data-act="party"><span class="btn-main">파티 정리하기</span></button>' : '') + '</div>';
    } else if (b.result === 'win' && b.kind === 'trainer') {
      Sfx.play('levelup');
      var gotNew = !!out.badge, nextA = D.AREAS[E.areaIndex(area.id) + 1];
      html = '<div class="card result-card"><div class="card-rays"></div>' +
        '<div class="card-kicker">' + esc(area.gym.name) + ' 승리</div><h2 class="card-title win">' + (gotNew ? esc(area.gym.badge) + '!' : '승리!') + '</h2>' +
        (gotNew ? '<div class="badge-big">★</div>' : '') + resultParty() +
        '<p class="card-text">' + (gotNew && nextA && !nextA.post ? '새 지역 <b>' + esc(nextA.name) + '</b>이(가) 열렸어요!' : '관장과의 재대결에서 이겼어요.') + '</p>' +
        '<button type="button" class="btn btn-primary btn-big" data-act="map"><span class="btn-main">지도로</span></button></div>';
    } else if (b.result === 'win') {
      html = '<div class="card result-card mini"><div class="card-kicker">WILD BATTLE</div><h2 class="card-title win">승리!</h2>' + resultParty() + wildBtns + '</div>';
    } else {
      html = '<div class="card over-card"><div class="card-kicker red">WHITE OUT</div><h2 class="card-title lose">눈앞이 캄캄해졌다…</h2>' +
        '<p class="card-text">서둘러 포캣몬 센터로 돌아왔다.<br>포캣몬들이 모두 회복했어요. 잡은 포캣몬과 배지는 그대로예요.</p>' +
        resultParty() +
        '<button type="button" class="btn btn-primary btn-big" data-act="area"><span class="btn-main">다시 도전하기</span></button>' +
        '<button type="button" class="btn btn-ghost" data-act="party"><span class="btn-main">파티 정리하기</span></button></div>';
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
        '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" data-act="tab-map"><span class="btn-main">지도로</span></button></div>' +
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

  /* ───────── 시작 ───────── */
  window.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#app')) e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });   // iOS 핀치 확대 방지
  // 자동 점검용 창구 (게임 동작에는 쓰지 않는다)
  window.__pocatmon = { state: S, store: store };
  goTitle();
})();
