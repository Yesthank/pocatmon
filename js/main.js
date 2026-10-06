/* 포캣몬 배틀 — 화면 흐름 · 배틀 이벤트 재생 · 컷신 (T4)
   전역 PData / PEngine / Sprites / Sfx / Stage 를 쓴다. 모듈 아님.
   테스트용: document.body.dataset.screen = title|select|preview|battle|cutscene|result|ending|gameover
            ?fast → UI 지연·타자 속도 단축, ?seed=N → 고정 난수, ?2d → 2D 무대 강제 */
(function () {
  'use strict';
  var D = window.PData, E = window.PEngine, M = D.MONSTERS, MV = D.MOVES, TY = D.TYPES;

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

  var ROSTER = ['naru', 'seol', 'ssaga', 'metal', 'black'];
  var STAT_MAX = 130;

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
  function enemyLevel(i) { return D.TUNING.startLevel + i + (i === 3 ? 2 : 0); }
  function powerLabel(mv) {
    if (mv.kind === 'heal') return '회복';
    if (mv.kind === 'shield') return '보호막';
    return '위력 ' + mv.power + (mv.hits ? ' ×' + mv.hits[0] + '~' + mv.hits[1] : '');
  }
  var ICON = {
    sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'
  };

  /* ───────── 상태 ───────── */
  var S = {
    gen: 0, screen: null, run: null, b: null, st: null, locked: true, disp: null, sel: 'naru',
    field: { player: null, enemy: null, enemyDown: false }, skip: null, inflight: null
  };
  var ABORT = { abort: true }, SKIP = { skip: true };
  function guard(g) { if (g !== S.gen) throw ABORT; }
  function swallow(e) { if (e !== ABORT && e !== SKIP) throw e; }

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
        '<div id="msgbox" class="msgbox"><p id="msgtext" class="msgtext"></p><span class="msg-arrow">▼</span></div>' +
        '<div id="moves" class="moves"></div>' +
      '</div>' +
      '<div id="overlay" class="overlay"></div>' +
    '</div>' +
    '<div class="hud">' +
      '<div class="hud-btns">' +
        '<button id="btn-mute" class="icon-btn" type="button" aria-label="소리 켜기/끄기"></button>' +
        '<button id="btn-menu" class="icon-btn" type="button" aria-label="메뉴">' + ICON.menu + '</button>' +
      '</div>' +
      '<div id="stagepill" class="stagepill"></div>' +
    '</div>' +
    '<div id="menu" class="menu" aria-hidden="true"><div class="menu-card">' +
      '<div class="menu-title">메뉴</div>' +
      '<button type="button" class="btn btn-primary" data-act="menu-close">계속하기</button>' +
      '<button type="button" class="btn btn-ghost" data-act="menu-mute"></button>' +
      '<button type="button" class="btn btn-ghost" data-act="menu-title">타이틀로 <small>(기록은 남아요)</small></button>' +
    '</div></div>';

  var host = $('screen'), battleEl = $('battle'), arena = $('arena'), overlay = $('overlay');
  var msgBox = $('msgbox'), msgText = $('msgtext'), movesEl = $('moves'), bubblesEl = $('bubbles'), narrEl = $('narr');
  var menuEl = $('menu'), coverEl = $('cover');

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
    else if (a === 'menu-title') { Sfx.play('cancel'); openMenu(false); goTitle(); }
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
        MS.autoT = setTimeout(fin, o.auto != null ? o.auto : T(1150));
      }
      MS.finishType = function () { clearTimeout(MS.timer); msgText.textContent = full; after(); };
      if (FAST || !full) { MS.finishType(); return; }
      MS.typing = true;
      (function tick() {
        i++;
        msgText.textContent = full.slice(0, i);
        if (i >= full.length) { MS.finishType(); return; }
        MS.timer = setTimeout(tick, 24);
      })();
    });
  }
  function clearMsg() { clearTimeout(MS.timer); clearTimeout(MS.autoT); MS.typing = false; MS.finishType = null; MS.advance = null; msgText.textContent = ''; msgBox.classList.remove('ready'); }

  /* ───────── 말풍선 · 내레이션 ───────── */
  function clearBubbles() { bubblesEl.innerHTML = ''; }
  function bubble(side, text, dur) {
    var st = S.st;
    var old = bubblesEl.querySelector('.bubble[data-side="' + side + '"]');
    if (old) old.remove();
    var el = document.createElement('div');
    var who = side === 'player' ? S.field.player : S.field.enemy;
    el.className = 'bubble bubble-' + side + (who === 'black' ? ' dark' : '');
    el.dataset.side = side;
    el.textContent = text;
    bubblesEl.appendChild(el);
    var W = arena.clientWidth, H = arena.clientHeight;
    var p = { x: W / 2, y: H / 3 };
    try { p = st.screenPos(side) || p; } catch (e) { /* 기본 위치 */ }
    var w = el.offsetWidth, h = el.offsetHeight;
    var minTop = 10;
    var left = Math.max(8, Math.min(W - w - 8, p.x - w / 2));
    var top = Math.max(minTop, Math.min(H - h - 8, p.y - h - 16));
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
  function mkDisp(f) { return { hp: f.hp, max: f.maxHp, shield: f.shield > 0, frozen: !!f.frozen, atk: f.stages.atk, def: f.stages.def, shown: f.hp }; }
  function plateHTML(side, f) {
    var boss = side === 'enemy' && S.run && S.run.stage === 3;
    return '<div class="pl-top">' +
        (boss ? '<span class="pl-boss">BOSS</span>' : '') +
        '<span class="pl-name">' + esc(f.name) + '</span>' +
        (f.shiny ? '<span class="pl-shiny" title="이로치">✦</span>' : '') +
        '<span class="pl-lv">Lv.' + f.displayLevel + '</span>' +
      '</div>' +
      '<div class="pl-mid"><span class="pl-types">' + chips(f.types) + '</span><span class="pl-status" data-status></span></div>' +
      '<div class="hpbar"><span class="hp-tag">HP</span><span class="hp-track"><span class="hp-fill" data-fill></span></span></div>' +
      (side === 'player' ? '<div class="hp-num"><b data-hpnow>' + f.hp + '</b> / ' + f.maxHp + '</div>' : '');
  }
  function renderPlates() {
    $('plate-enemy').innerHTML = plateHTML('enemy', S.b.e);
    $('plate-player').innerHTML = plateHTML('player', S.b.p);
    ['player', 'enemy'].forEach(function (s) { setHp(s, S.disp[s].hp, true); renderStatus(s); });
  }
  function showPlate(side, on) { $('plate-' + side).classList.toggle('show', on !== false); }
  function setHp(side, hp, instant) {
    var d = S.disp[side], plate = $('plate-' + side);
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
  function renderStatus(side) {
    var d = S.disp[side], out = '';
    if (d.shield) out += '<span class="st st-shield">🛡</span>';
    if (d.frozen) out += '<span class="st st-ice">❄</span>';
    [['atk', '공'], ['def', '방']].forEach(function (k) {
      var v = d[k[0]];
      if (v) out += '<span class="st ' + (v > 0 ? 'st-up' : 'st-down') + '">' + k[1] + (v > 0 ? '↑' : '↓') + (Math.abs(v) > 1 ? Math.abs(v) : '') + '</span>';
    });
    var el = $('plate-' + side).querySelector('[data-status]');
    if (el) el.innerHTML = out;
  }
  function syncDisp() {
    [['player', S.b.p], ['enemy', S.b.e]].forEach(function (x) {
      var d = S.disp[x[0]], f = x[1];
      d.shield = f.shield > 0; d.frozen = !!f.frozen; d.atk = f.stages.atk; d.def = f.stages.def;
      if (d.hp !== f.hp) setHp(x[0], f.hp);
      renderStatus(x[0]);
    });
  }

  /* ───────── 기술 버튼 ───────── */
  function renderMoves() {
    var b = S.b;
    movesEl.innerHTML = b.p.moves.map(function (id) {
      var mv = MV[id], hint = '';
      if (mv.kind === 'atk') {
        var eff = E.effectiveness(mv.type, b.e.types);
        if (eff > 1) hint = '<span class="mv-hint good">효과 굉장!</span>';
        else if (eff < 1) hint = '<span class="mv-hint bad">효과 별로</span>';
      }
      return '<button type="button" class="move-btn" data-move="' + id + '" style="--tc:' + TY[mv.type].color + '" disabled>' +
        '<span class="mv-row"><span class="mv-type">' + esc(TY[mv.type].name) + '</span>' + (mv.priority ? '<span class="mv-pri">선공</span>' : '') + hint + '</span>' +
        '<span class="mv-name">' + esc(mv.name) + '</span>' +
        '<span class="mv-pow">' + powerLabel(mv) + (mv.kind === 'atk' && mv.acc < 100 ? ' · 명중 ' + mv.acc : '') + '</span>' +
      '</button>';
    }).join('');
  }
  function lock(on) {
    S.locked = on;
    battleEl.classList.toggle('locked', on);
    var bs = movesEl.querySelectorAll('.move-btn');
    for (var i = 0; i < bs.length; i++) bs[i].disabled = on;
  }
  movesEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.move-btn');
    if (!btn || btn.disabled) return;
    e.stopPropagation();
    onMove(btn.dataset.move);
  });
  battleEl.addEventListener('click', function (e) {
    if (e.target.closest('button') || e.target.closest('.overlay')) return;
    if (S.screen === 'cutscene') { if (S.skip) S.skip.fire(); return; }
    if (S.screen === 'battle') advanceMsg();
  });

  function stagePill() {
    var pill = $('stagepill');
    if (!S.run) { pill.innerHTML = ''; return; }
    var dots = '';
    for (var i = 0; i < 4; i++) dots += '<i class="' + (i < S.run.stage ? 'done' : i === S.run.stage ? 'cur' : '') + (i === 3 ? ' boss' : '') + '"></i>';
    pill.innerHTML = '<span>' + (S.run.stage === 3 ? '최종전' : 'STAGE ' + (S.run.stage + 1)) + '</span>' + dots;
  }

  /* ───────── 화면: 타이틀 ───────── */
  function goTitle() {
    newGen();
    S.run = null; S.b = null;
    showBattle(false);
    mark('title');
    var saved = store.loadRun();
    var unlocked = store.isUnlocked();
    var cast = ['seol', 'metal', 'naru', 'ssaga'];
    if (unlocked) cast.splice(1, 0, 'black');
    var contSub = saved ? (esc(M[saved.starter].name) + ' · ' + (saved.stage === 3 ? '최종 보스전' : (saved.stage + 1) + '번째 판')) : '';
    host.innerHTML =
      '<section class="scr title-scr">' +
        '<div class="title-bg"></div><div class="title-shade"></div><div class="title-rays"></div>' +
        '<div class="logo-wrap">' +
          '<div class="logo-kicker">POCATMON BATTLE</div>' +
          '<h1 class="logo" data-text="포캣몬">포캣몬</h1>' +
          '<div class="logo-ribbon"><span>배 틀</span></div>' +
          '<p class="tagline">고양이 포켓몬과 수호자의 4연전</p>' +
        '</div>' +
        '<div class="cast cast-' + cast.length + '"><div class="cast-inner"><div class="cast-floor"></div>' + cast.map(function (id, i) {
          return '<div class="cast-m cast-' + id + '" style="--i:' + i + '">' + img(id, 'cast-img') + '</div>';
        }).join('') + '</div></div>' +
        '<div class="title-actions">' +
          (saved ? '<button type="button" class="btn btn-primary btn-big" data-act="continue"><span class="btn-main">이어하기</span><span class="btn-sub">' + contSub + '</span></button>' : '') +
          '<button type="button" class="btn ' + (saved ? 'btn-ghost' : 'btn-primary btn-big') + '" data-act="new"><span class="btn-main">새로 시작</span>' + (saved ? '<span class="btn-sub">저장된 판은 지워져요</span>' : '') + '</button>' +
        '</div>' +
        '<div class="title-foot">' + (unlocked ? '✦ 블랙 메탈가디언몬 해금됨' : '네 판을 내리 이기면 클리어!') + '</div>' +
      '</section>';
  }

  /* ───────── 화면: 몬스터 선택 ───────── */
  function goSelect() {
    newGen();
    S.run = null;
    showBattle(false);
    mark('select');
    renderSelect();
  }
  function statRow(label, v) {
    return '<div class="stat"><span class="stat-l">' + label + '</span><span class="stat-bar"><i style="width:' + Math.round(v / STAT_MAX * 100) + '%"></i></span><span class="stat-v">' + v + '</span></div>';
  }
  function renderSelect() {
    var unlocked = store.isUnlocked();
    var id = S.sel, m = M[id], locked = id === 'black' && !unlocked;
    var hero;
    if (locked) {
      hero = '<div class="hero locked" style="--tc:#ff2440">' +
        '<div class="hero-art"><div class="hero-bg" style="background-image:url(assets/bg/dark.jpg)"></div>' + img(id, 'hero-img sil') + '<div class="hero-q">?</div></div>' +
        '<div class="hero-info"><div class="hero-name">???</div>' +
        '<p class="hero-blurb">🔒 한 번 클리어하면 해금</p>' +
        '<p class="hero-hint">어떤 몬스터로든 네 판을 모두 이기면 이 자리에 누군가 나타납니다.</p></div></div>';
    } else {
      hero = '<div class="hero" style="--tc:' + mainColor(id) + '">' +
        '<div class="hero-art"><div class="hero-bg" style="background-image:url(assets/bg/' + m.bg + '.jpg)"></div>' + img(id, 'hero-img') + '</div>' +
        '<div class="hero-info">' +
          '<div class="hero-head"><span class="hero-name">' + esc(m.name) + '</span><span class="hero-types">' + chips(m.types) + '</span></div>' +
          '<div class="stats">' + statRow('HP', m.base.hp) + statRow('공격', m.base.atk) + statRow('방어', m.base.def) + statRow('스피드', m.base.spd) + '</div>' +
          '<p class="hero-blurb">' + esc(m.blurb) + '</p>' +
          '<div class="hero-moves">' + m.moves.map(function (mid) {
            var mv = MV[mid];
            return '<span class="hm" style="--tc:' + TY[mv.type].color + '"><b>' + esc(mv.name) + '</b><small>' + powerLabel(mv) + '</small></span>';
          }).join('') + '</div>' +
        '</div></div>';
    }
    host.innerHTML =
      '<section class="scr select-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="title" aria-label="타이틀로">‹</button>' +
          '<div><h2>파트너 선택</h2><p>4연전을 함께할 포캣몬을 골라 주세요</p></div></header>' +
        '<div class="hero-wrap" id="hero-wrap">' + hero + '</div>' +
        '<div class="thumbs">' + ROSTER.map(function (rid) {
          var lk = rid === 'black' && !unlocked;
          return '<button type="button" class="thumb' + (rid === id ? ' on' : '') + (lk ? ' lk' : '') + '" data-pick="' + rid + '" style="--tc:' + (lk ? '#3a3f55' : mainColor(rid)) + '" aria-label="' + (lk ? '잠김' : esc(M[rid].name)) + '">' +
            img(rid, 'thumb-img' + (lk ? ' sil' : '')) + (lk ? '<span class="thumb-lock">🔒</span>' : '') + '</button>';
        }).join('') + '</div>' +
        '<div class="select-cta">' +
          (locked ? '<button type="button" class="btn btn-big btn-disabled" disabled><span class="btn-main">🔒 한 번 클리어하면 해금</span></button>'
            : '<button type="button" class="btn btn-primary btn-big" data-act="go"><span class="btn-main">이 몬스터로 출발!</span></button>') +
        '</div>' +
      '</section>';
    bindSwipe($('hero-wrap'));
  }
  function bindSwipe(el) {
    if (!el) return;
    var x0 = null, y0 = 0;
    el.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; });
    el.addEventListener('pointerup', function (e) {
      if (x0 == null) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        var i = ROSTER.indexOf(S.sel);
        S.sel = ROSTER[(i + (dx < 0 ? 1 : ROSTER.length - 1)) % ROSTER.length];
        Sfx.play('tap');
        renderSelect();
      }
    });
    el.addEventListener('pointercancel', function () { x0 = null; });
  }

  /* ───────── 화면: 도전 순서 미리보기 ───────── */
  function goPreview(run) {
    newGen();
    S.run = run;
    showBattle(false);
    mark('preview');
    var me = M[run.starter];
    host.innerHTML =
      '<section class="scr preview-scr">' +
        '<header class="scr-head"><button type="button" class="back-btn" data-act="select" aria-label="다시 고르기">‹</button>' +
          '<div><h2>도전 순서</h2><p>네 판을 내리 이기면 클리어! 이기면 체력 회복 + 레벨 업</p></div></header>' +
        '<ol class="ladder">' + run.order.map(function (id, i) {
          var boss = i === 3, m = M[id];
          return '<li class="rung' + (boss ? ' boss' : '') + '" style="--tc:' + (boss ? '#ff2440' : mainColor(id)) + ';--i:' + i + '">' +
            '<span class="rung-no">' + (boss ? '★' : i + 1) + '</span>' +
            '<span class="rung-face">' + img(id, 'rung-img' + (boss ? ' sil' : '')) + (boss ? '<span class="rung-q">?</span>' : '') + '</span>' +
            '<span class="rung-info"><span class="rung-kicker">' + (boss ? '최종 보스' : 'STAGE ' + (i + 1)) + '</span>' +
              '<b class="rung-name">' + (boss ? '???' : esc(m.name)) + '</b>' +
              '<span class="rung-meta">' + (boss ? '<span class="chip chip-q">???</span>' : chips(m.types)) + '<span class="rung-lv">Lv.' + enemyLevel(i) + '</span></span></span>' +
          '</li>';
        }).join('') + '</ol>' +
        '<div class="me-card" style="--tc:' + mainColor(run.starter) + '">' + img(run.starter, 'me-img') +
          '<div><span class="me-kicker">나의 파트너</span><b>' + esc(me.name) + '</b><span class="me-meta">' + chips(me.types) + '<span class="rung-lv">Lv.' + run.level + '</span></span></div></div>' +
        '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" data-act="start"><span class="btn-main">배틀 시작!</span></button></div>' +
      '</section>';
  }

  /* ───────── 화면 버튼 위임 ───────── */
  host.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act],[data-pick]');
    if (!b || b.disabled) return;
    if (b.dataset.pick) {
      if (S.sel !== b.dataset.pick) { S.sel = b.dataset.pick; Sfx.play('tap'); renderSelect(); }
      return;
    }
    var a = b.dataset.act;
    if (a === 'new') { Sfx.play('tap'); store.clearRun(); goSelect(); }
    else if (a === 'continue') {
      var r = store.loadRun();
      Sfx.play('tap');
      if (r) startBattle(r); else goTitle();
    }
    else if (a === 'title') { Sfx.play('cancel'); goTitle(); }
    else if (a === 'select') { Sfx.play('cancel'); goSelect(); }
    else if (a === 'go') {
      if (S.sel === 'black' && !store.isUnlocked()) return;
      Sfx.play('tap');
      goPreview(E.createRun(S.sel, rng));
    }
    else if (a === 'start') { Sfx.play('tap'); startBattle(S.run); }
  });
  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var a = b.dataset.act;
    if (a === 'next') { Sfx.play('tap'); startBattle(S.run); }
    else if (a === 'retry') { Sfx.play('tap'); goSelect(); }
    else if (a === 'title') { Sfx.play('cancel'); goTitle(); }
  });

  /* ───────── 배틀 시작 ───────── */
  function startBattle(run) {
    var g = newGen();
    S.run = run;
    store.saveRun(run);                  // 각 판 시작 시 저장 (최종전은 컷신 전에 저장 → 이어하기 시 컷신부터)
    var st = ensureStage();
    overlay.className = 'overlay'; overlay.innerHTML = '';
    showPlate('player', false); showPlate('enemy', false);
    clearMsg(); lock(true);
    showBattle(true);
    stagePill();
    var cs = E.cutsceneBefore(run);
    (async function () {
      var fromCut = false;
      if (cs) { await playCutscene(cs, g); fromCut = true; }
      guard(g);
      await battleIntro(g, fromCut);
    })().catch(swallow);
    return st;
  }

  async function battleIntro(g, fromCut) {
    var st = S.st, run = S.run;
    var b = S.b = E.createBattle(run);
    S.disp = { player: mkDisp(b.p), enemy: mkDisp(b.e) };
    renderPlates(); renderMoves(); lock(true);
    mark('battle');
    var eid = b.e.id, pid = b.p.id, em = M[eid];
    if (!fromCut) {
      st.clearFighter('player'); st.clearFighter('enemy');
      S.field.player = null; S.field.enemy = null;
    }
    await st.setBackground(em.bg); guard(g);
    await st.setFighter('enemy', eid, { shiny: b.e.shiny }); guard(g);
    S.field.enemy = eid; S.field.enemyDown = false;
    if (!fromCut) { await st.enter('enemy'); guard(g); }
    coverEl.classList.remove('on');
    showPlate('enemy');
    if (b.e.shiny) {
      var tag = $('shinytag');
      tag.classList.remove('show'); void tag.offsetWidth; tag.classList.add('show');
      Sfx.play('shiny');
      setTimeout(function () { tag.classList.remove('show'); }, T(2200) + 400);
    }
    var intro = run.stage === 3 ? '최종 보스 ' + E.josa(em.name, '이/가') + ' 앞을 가로막았다!'
      : (b.e.shiny ? '✦ 이로치 ' : '') + E.josa(em.name, '이/가') + ' 승부를 걸어왔다!';
    await say(intro); guard(g);
    await bubble('enemy', pick(em.lines.intro), 1700); guard(g);
    if (!fromCut || S.field.player !== pid) {
      say('가랏, ' + b.p.name + '!', { hold: false });
      await st.setFighter('player', pid, {}); guard(g);
      S.field.player = pid;
      await st.enter('player'); guard(g);
      await sleep(T(250)); guard(g);
    }
    showPlate('player');
    prompt();
  }

  function prompt() {
    say(E.josa(S.b.p.name, '은/는') + ' 무엇을 할까?', { hold: false });
    lock(false);
  }

  async function onMove(moveId) {
    if (S.locked || !S.b || S.b.over || S.screen !== 'battle') return;
    lock(true);
    Sfx.play('tap');
    var g = S.gen;
    try {
      var eMove = E.chooseEnemyMove(S.b, rng);
      var evs = E.resolveTurn(S.b, moveId, eMove, rng);
      var winner = await playEvents(evs, g);
      guard(g);
      syncDisp();
      if (winner) await finishBattle(winner, g);
      else prompt();
    } catch (e) { swallow(e); }
  }

  /* ───────── 이벤트 재생 ───────── */
  async function playEvents(evs, g) {
    var st = S.st, winner = null;
    for (var i = 0; i < evs.length; i++) {
      var ev = evs[i];
      guard(g);
      var d = ev.side ? S.disp[ev.side] : null;
      switch (ev.t) {
        case 'use': {
          var mv = MV[ev.move];
          await say(ev.text, { auto: T(380), arrow: false });
          guard(g);
          if (mv.kind === 'atk') await st.attack(ev.side, ev.fx);
          break;
        }
        case 'line':
          await bubble(ev.side, ev.text, 1500);
          break;
        case 'hit': {
          Sfx.play(ev.recoil ? 'hit' : ev.crit ? 'crit' : ev.eff > 1 ? 'super' : ev.eff < 1 ? 'weak' : 'hit');
          var hp = st.hit(ev.side, { crit: !!ev.crit, eff: ev.eff });
          setHp(ev.side, ev.hp);
          await hp;
          guard(g);
          if (ev.text) await say(ev.text);
          break;
        }
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
        case 'shield':
          if (ev.on) Sfx.play('shield');
          d.shield = !!ev.on; renderStatus(ev.side);
          await Promise.all([st.shield(ev.side, !!ev.on), say(ev.text)]);
          break;
        case 'freeze':
          Sfx.play('freeze');
          d.frozen = true; renderStatus(ev.side);
          await Promise.all([st.freeze(ev.side, true), say(ev.text)]);
          break;
        case 'thaw':
          d.frozen = false; renderStatus(ev.side);
          await Promise.all([st.freeze(ev.side, false), say(ev.text)]);
          break;
        case 'stat':
          if (ev.stat === 'cure') { if (d.atk < 0) d.atk = 0; if (d.def < 0) d.def = 0; }
          else d[ev.stat] = Math.max(-3, Math.min(3, d[ev.stat] + ev.delta));
          renderStatus(ev.side);
          Sfx.play(ev.delta >= 0 ? 'levelup' : 'weak');
          await Promise.all([st.statFx(ev.side, ev.delta >= 0), say(ev.text)]);
          break;
        case 'faint':
          Sfx.play('faint');
          await st.faint(ev.side);
          if (ev.side === 'enemy') S.field.enemyDown = true;
          if (ev.side === 'player') S.field.player = null;
          guard(g);
          await say(ev.text);
          break;
        case 'end':
          winner = ev.winner;
          break;
        default:
          if (ev.text) await say(ev.text);
      }
    }
    return winner;
  }

  /* ───────── 승패 처리 ───────── */
  async function finishBattle(winner, g) {
    var run = S.run, b = S.b;
    lock(true);
    if (winner === 'player') {
      Sfx.play('win');
      await bubble('player', pick(M[b.p.id].lines.win), 1500); guard(g);
      var stageNo = run.stage;
      var res = E.winBattle(run);
      if (res === 'next') {
        store.saveRun(run);
        showResult(stageNo);
      } else {
        store.clearRun();
        var first = !store.isUnlocked();
        store.unlock();
        goEnding(first);
      }
    } else {
      Sfx.play('lose');
      store.clearRun();
      await sleep(T(500)); guard(g);
      showGameover(b.e.id);
    }
  }

  function showResult(stageNo) {
    var run = S.run, nextId = run.order[run.stage], boss = run.stage === 3;
    mark('result');
    Sfx.play('levelup');
    overlay.className = 'overlay on';
    overlay.innerHTML =
      '<div class="card result-card" style="--tc:' + mainColor(run.starter) + '">' +
        '<div class="card-rays"></div>' +
        '<div class="card-kicker">STAGE ' + (stageNo + 1) + ' CLEAR</div>' +
        '<h2 class="card-title win">승리!</h2>' +
        '<div class="card-hero">' + img(run.starter, 'card-img') + '</div>' +
        '<div class="lvup"><span class="lv-old">Lv.' + (run.level - 1) + '</span><span class="lv-arrow">▶</span><span class="lv-new">Lv.' + run.level + '</span></div>' +
        '<p class="card-text">레벨 업! 체력이 모두 회복되었다.</p>' +
        '<div class="next-up' + (boss ? ' boss' : '') + '"><span class="next-l">다음 상대</span>' +
          '<span class="next-face">' + img(nextId, 'next-img' + (boss ? ' sil' : '')) + '</span>' +
          '<b>' + (boss ? '최종 보스 ???' : esc(M[nextId].name)) + '</b></div>' +
        '<button type="button" class="btn btn-primary btn-big" data-act="next"><span class="btn-main">' + (boss ? '최종 보스에게 도전!' : '다음 배틀 →') + '</span></button>' +
      '</div>';
  }

  function showGameover(enemyId) {
    var run = S.run;
    mark('gameover');
    overlay.className = 'overlay on dim-red';
    overlay.innerHTML =
      '<div class="card over-card">' +
        '<div class="card-kicker red">GAME OVER</div>' +
        '<h2 class="card-title lose">패배…</h2>' +
        '<div class="card-hero">' + img(run.starter, 'card-img gray') + '</div>' +
        '<p class="card-text">' + (run.stage === 3 ? '최종 보스' : (run.stage + 1) + '번째 판') + '에서 ' + esc(M[enemyId].name) + '에게 쓰러졌다.<br>이번 도전 기록은 사라졌어요.</p>' +
        '<button type="button" class="btn btn-primary btn-big" data-act="retry"><span class="btn-main">처음부터</span></button>' +
        '<button type="button" class="btn btn-ghost" data-act="title"><span class="btn-main">타이틀로</span></button>' +
      '</div>';
  }

  /* ───────── 화면: 엔딩 ───────── */
  function goEnding(firstClear) {
    var run = S.run;
    newGen();
    showBattle(false);
    mark('ending');
    Sfx.play('levelup');
    var m = M[run.starter];
    var conf = '';
    for (var i = 0; i < 28; i++) {
      conf += '<i style="--x:' + Math.round(rng() * 100) + '%;--d:' + (rng() * 2.4).toFixed(2) + 's;--c:' +
        ['#ffd34d', '#ff5a7a', '#5ad1ff', '#8cff9e', '#ffffff'][i % 5] + ';--r:' + Math.round(rng() * 360) + 'deg"></i>';
    }
    host.innerHTML =
      '<section class="scr ending-scr" style="--tc:' + mainColor(run.starter) + '">' +
        '<div class="title-bg end-bg" style="background-image:url(assets/bg/' + m.bg + '.jpg)"></div><div class="title-shade"></div>' +
        '<div class="confetti">' + conf + '</div>' +
        '<div class="end-body">' +
          '<div class="card-kicker">ALL CLEAR</div>' +
          '<h1 class="end-title">클리어!</h1>' +
          '<div class="end-hero"><div class="end-halo"></div>' + img(run.starter, 'end-img') + '</div>' +
          '<p class="end-line">“' + esc(pick(m.lines.win)) + '”</p>' +
          '<div class="beaten">' + run.order.map(function (id) { return '<span class="beat">' + img(id, 'beat-img') + '<i>✓</i></span>'; }).join('') + '</div>' +
          (firstClear ? '<div class="unlock"><div class="unlock-face">' + img('black', 'unlock-img') + '</div><div><span class="unlock-k">NEW!</span><b>블랙 메탈가디언몬 해금!</b><span>이제 파트너로 고를 수 있어요.</span></div></div>' : '') +
          '<p class="end-sub">' + esc(m.name) + ' · 네 판 모두 승리 · Lv.' + run.level + ' 달성</p>' +
        '</div>' +
        '<div class="select-cta"><button type="button" class="btn btn-primary btn-big" data-act="title"><span class="btn-main">타이틀로</span></button></div>' +
      '</section>';
  }

  /* ───────── 컷신 ───────── */
  function makeSkip() {
    var c = { done: false };
    c.p = new Promise(function (r) { c.fire = function () { if (!c.done) { c.done = true; r(); } }; });
    return c;
  }
  async function playCutscene(kind, g) {
    var st = S.st, run = S.run, lines = D.CUTSCENES[kind] || [];
    var sk = S.skip = makeSkip();
    mark('cutscene');
    showPlate('player', false); showPlate('enemy', false);
    clearMsg();
    function sideOf(who) { return who === run.starter ? 'player' : 'enemy'; }
    function step(p) {
      S.inflight = Promise.resolve(p);
      return Promise.race([S.inflight, sk.p]).then(function () { guard(g); if (sk.done) throw SKIP; });
    }
    function say2(l, dur) {
      if (!l) return Promise.resolve();
      return l.who === 'fx' ? narrate(l.text, dur) : bubble(sideOf(l.who), l.text, dur);
    }
    function ensurePlayer() {
      if (S.field.player === run.starter) return Promise.resolve();
      return st.setFighter('player', run.starter, {}).then(function () { S.field.player = run.starter; });
    }
    // 직전 판에서 남은 보호막·얼음 표시를 지운다(승리한 턴에는 엔진이 보호막 해제 이벤트를 내지 않음)
    ['player', 'enemy'].forEach(function (s) { st.shield(s, false); st.freeze(s, false); st.aura(s, null); });
    await sleep(60);                          // 무대 크기 변경 반영
    guard(g);
    try {
      if (kind === 'corrupt') {
        var down = S.field.enemy === 'metal' && S.field.enemyDown;
        await step(Promise.all([st.setBackground('dark'), ensurePlayer(), down ? null : st.setFighter('enemy', 'metal', {})]));
        S.field.enemy = 'metal';
        Sfx.play('rumble');
        await step(Promise.all([say2(lines[0], 1500), down ? null : st.faint('enemy')]));
        S.field.enemyDown = true;
        st.flash('#ff2440');
        Sfx.play('transform');
        await step(Promise.all([say2(lines[1], 1700), st.transform('enemy', 'black', {})]));
        S.field.enemy = 'black'; S.field.enemyDown = false;
        for (var i = 2; i < lines.length; i++) await step(say2(lines[i], 1350));
      } else if (kind === 'shadow') {
        st.clearFighter('enemy'); S.field.enemy = null;
        await step(Promise.all([st.setBackground('dark'), ensurePlayer()]));
        await step(say2(lines[0], 1400));
        Sfx.play('rumble');
        setTimeout(function () { if (!sk.done && g === S.gen) Sfx.play('transform'); }, 1600);
        await step(Promise.all([say2(lines[1], 1900), st.shadowRise()]));
        S.field.enemy = 'black'; S.field.enemyDown = false;
        for (var j = 2; j < lines.length; j++) await step(say2(lines[j], 1500));
      } else {   // face: 산 정상에서 과거의 나와 대치
        await step(Promise.all([st.setBackground('metal'), ensurePlayer(), st.setFighter('enemy', 'metal', {})]));
        S.field.enemy = 'metal'; S.field.enemyDown = false;
        await step(st.enter('enemy'));
        st.aura('enemy', '#ffd76a'); st.aura('player', '#ff2440');
        for (var k = 0; k < lines.length; k++) await step(say2(lines[k], 1300));
      }
    } catch (e) {
      if (e !== SKIP) throw e;
      // 건너뛰기: 화면을 잠깐 덮고 진행 중이던 연출이 끝나길(최대 1.5초) 기다린 뒤 최종 상태로 맞춘다
      coverEl.classList.add('on');
      clearBubbles(); narrEl.classList.remove('show');
      await S.inflight;                       // Stage 연출은 자체 제한시간(최대 9초) 안에 반드시 끝난다
      guard(g);
    }
    S.skip = null;
    clearBubbles();
    narrEl.classList.remove('show');
    st.aura('enemy', null); st.aura('player', null);
    var bossId = run.order[3];
    if (S.field.enemy !== bossId || sk.done) {
      await st.setFighter('enemy', bossId, {}); guard(g);
      S.field.enemy = bossId; S.field.enemyDown = false;
    }
    if (S.field.player !== run.starter) { await ensurePlayer(); guard(g); }
  }

  /* ───────── 시작 ───────── */
  window.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('#app')) e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });   // iOS 핀치 확대 방지
  goTitle();
})();
