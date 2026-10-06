/* 포캣몬 효과음 — Web Audio 코드 합성(파일 없음). 배경음악 없음.
   전역: Sfx.play(name), Sfx.setMuted(bool), Sfx.muted
   이름: tap hit crit super weak heal shield freeze faint win lose levelup transform (+ shiny, cancel, rumble)
   AudioContext는 첫 탭(pointerdown)에서 만들고 resume 한다. Web Audio가 없어도 절대 예외를 던지지 않는다. */
(function (root) {
  'use strict';
  var MUTE_KEY = 'pocatmon.muted';
  var ctx = null, master = null, noiseBuf = null;

  function readMuted() {
    try { return root.localStorage && root.localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }

  function ensure() {
    if (ctx) return ctx;
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      var comp = ctx.createDynamicsCompressor ? ctx.createDynamicsCompressor() : null;
      if (comp) { master.connect(comp); comp.connect(ctx.destination); } else master.connect(ctx.destination);
      var len = Math.floor(ctx.sampleRate * 1.2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }

  function unlock() {
    try {
      var c = ensure();
      // iOS는 전화·앱 전환 뒤 'interrupted' 상태로 남기도 한다
      if (c && c.state !== 'running' && c.state !== 'closed' && c.resume) c.resume().catch(function () {});
    } catch (e) { /* 무시 */ }
  }
  try {
    ['pointerdown', 'touchend', 'keydown'].forEach(function (t) {
      root.addEventListener(t, unlock, { passive: true, capture: true });
    });
    if (root.document) root.document.addEventListener('visibilitychange', function () { if (!root.document.hidden && ctx) unlock(); });
  } catch (e) { /* 무시 */ }

  /* ── 합성 원소 ── */
  // 음 하나: f0 → f1 (지수 미끄럼), 짧은 엔벨로프
  function tone(o) {
    var t = ctx.currentTime + (o.at || 0), dur = o.dur || 0.1;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    var v = o.vol == null ? 0.5 : o.vol, atk = o.atk || 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  // 잡음: 필터로 색을 입힌 짧은 폭발음
  function noise(o) {
    var t = ctx.currentTime + (o.at || 0), dur = o.dur || 0.12;
    var src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.ff || 1800, t);
    if (o.ff1) f.frequency.exponentialRampToValueAtTime(o.ff1, t + dur);
    f.Q.value = o.q || 0.8;
    var v = o.vol == null ? 0.5 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.atk || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }
  function arp(notes, step, o) {
    notes.forEach(function (f, i) {
      tone({ f: f, dur: o.dur || step * 1.6, type: o.type || 'square', vol: o.vol || 0.18, at: (o.at || 0) + i * step });
    });
  }

  var N = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, G4: 392, A4: 440, E4: 329.63, C4: 261.63, Eb4: 311.13, D4: 293.66, Bb3: 233.08 };

  var SOUNDS = {
    tap: function () { tone({ f: 1250, f1: 1650, dur: 0.05, type: 'triangle', vol: 0.18 }); },
    cancel: function () { tone({ f: 700, f1: 420, dur: 0.07, type: 'triangle', vol: 0.16 }); },
    hit: function () {
      noise({ dur: 0.14, ff: 2200, ff1: 500, vol: 0.55 });
      tone({ f: 170, f1: 55, dur: 0.14, type: 'sine', vol: 0.6 });
    },
    crit: function () {
      noise({ dur: 0.2, ff: 4200, ff1: 600, vol: 0.6 });
      tone({ f: 260, f1: 60, dur: 0.2, type: 'triangle', vol: 0.6 });
      tone({ f: 1800, f1: 900, dur: 0.08, type: 'square', vol: 0.12, at: 0.01 });
    },
    super: function () {
      noise({ dur: 0.24, ff: 3600, ff1: 300, vol: 0.65 });
      tone({ f: 320, f1: 50, dur: 0.26, type: 'sawtooth', vol: 0.32 });
      tone({ f: 120, f1: 40, dur: 0.3, type: 'sine', vol: 0.7 });
      noise({ dur: 0.12, ff: 1400, vol: 0.35, at: 0.09 });
    },
    weak: function () {
      noise({ dur: 0.1, ff: 600, vol: 0.35 });
      tone({ f: 120, f1: 80, dur: 0.1, type: 'sine', vol: 0.35 });
    },
    heal: function () {
      arp([N.C5, N.E5, N.G5, N.C6, N.E6], 0.07, { type: 'sine', vol: 0.22, dur: 0.22 });
      tone({ f: N.G6, dur: 0.35, type: 'triangle', vol: 0.08, at: 0.32 });
    },
    shield: function () {
      tone({ f: 380, f1: 980, dur: 0.28, type: 'triangle', vol: 0.3 });
      tone({ f: 760, f1: 1960, dur: 0.28, type: 'sine', vol: 0.12, at: 0.03 });
      noise({ dur: 0.3, filter: 'bandpass', ff: 3000, ff1: 6000, q: 4, vol: 0.12 });
    },
    freeze: function () {
      noise({ dur: 0.4, filter: 'highpass', ff: 5000, vol: 0.25 });
      [2093, 2637, 3136, 2349].forEach(function (f, i) { tone({ f: f, dur: 0.18, type: 'sine', vol: 0.12, at: i * 0.05 }); });
    },
    faint: function () {
      tone({ f: 620, f1: 70, dur: 0.7, type: 'square', vol: 0.13 });
      tone({ f: 310, f1: 40, dur: 0.75, type: 'triangle', vol: 0.3 });
      noise({ dur: 0.25, ff: 700, vol: 0.3, at: 0.5 });
    },
    win: function () {
      arp([N.G4, N.C5, N.E5, N.G5], 0.1, { type: 'square', vol: 0.14, dur: 0.14 });
      [N.C5, N.E5, N.G5, N.C6].forEach(function (f) { tone({ f: f, dur: 0.6, type: 'triangle', vol: 0.12, at: 0.42, atk: 0.02 }); });
    },
    lose: function () {
      arp([N.G4, N.Eb4, N.C4], 0.22, { type: 'triangle', vol: 0.25, dur: 0.3 });
      tone({ f: N.Bb3, f1: 110, dur: 0.8, type: 'sine', vol: 0.3, at: 0.66 });
    },
    levelup: function () {
      arp([N.C5, N.E5, N.G5, N.C6, N.G5, N.C6], 0.065, { type: 'square', vol: 0.12, dur: 0.1 });
      tone({ f: N.E6, dur: 0.4, type: 'triangle', vol: 0.12, at: 0.4 });
    },
    shiny: function () {
      [N.E6, N.G6, 2093, 2637].forEach(function (f, i) { tone({ f: f, dur: 0.16, type: 'sine', vol: 0.12, at: i * 0.06 }); });
    },
    rumble: function () {
      noise({ dur: 1.0, ff: 260, vol: 0.5, atk: 0.3 });
      tone({ f: 55, f1: 38, dur: 1.0, type: 'sawtooth', vol: 0.12, atk: 0.3 });
    },
    transform: function () {
      noise({ dur: 1.3, ff: 300, ff1: 2400, vol: 0.45, atk: 0.4 });
      tone({ f: 60, f1: 30, dur: 1.4, type: 'sawtooth', vol: 0.16, atk: 0.3 });
      tone({ f: 90, f1: 720, dur: 1.2, type: 'square', vol: 0.06, atk: 0.4 });
      noise({ dur: 0.5, ff: 5000, ff1: 300, vol: 0.6, at: 1.25 });
      tone({ f: 140, f1: 40, dur: 0.6, type: 'sine', vol: 0.7, at: 1.25 });
    }
  };

  var Sfx = {
    muted: readMuted(),
    play: function (name) {
      if (Sfx.muted) return;
      try {
        var fn = SOUNDS[name];
        if (!fn || !ensure()) return;
        if (ctx.state === 'suspended') return;   // 첫 탭 전에는 소리 없음
        fn();
      } catch (e) { /* 소리는 실패해도 게임은 계속 */ }
    },
    setMuted: function (b) {
      Sfx.muted = !!b;
      try { if (root.localStorage) root.localStorage.setItem(MUTE_KEY, Sfx.muted ? '1' : '0'); } catch (e) { /* 이번 방문만 */ }
    },
    names: Object.keys(SOUNDS)
  };
  root.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
