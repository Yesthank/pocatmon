// 타입별 기술 연출 확인용 접촉 인화지. 사용:
//   node tools/stage-fx-shot.js [--side=player|enemy] [--bg=forest] [--types=fire,water] [--p=naru] [--e=seol] [--2d]
// 결과: tools/out/fx_<type>.png (공격 직전·명중·직후 3장), tools/out/fx_sheet[_enemy].png (명중 순간 18장 모음),
//       tools/out/fx_status.png (상태이상 1회 연출), tools/out/fx_ball.png (포획 볼 단계별)
// 프레임은 페이지 안에서 정해진 시각에 렌더를 한 번 돌리고 WebGL 캔버스를 바로 읽어 얻는다(시간 오차 없음).
// 화면 전체 섬광(DOM 오버레이)은 캔버스 밖이라 찍히지 않는다.
// --2d: 2D 대체 무대를 화면 캡처로 찍는다(시각 오차 수십 ms). 파일 이름에 _2d가 붙는다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch } = require('./browser');

const OUT = path.join(__dirname, 'out');
const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SIDE = arg('side', 'player');
const TWO_D = process.argv.includes('--2d');
const SUF = (SIDE === 'enemy' ? '_enemy' : '') + (TWO_D ? '_2d' : '');
const CLIP = { x: 0, y: 0, width: 390, height: 500 };
const BG = arg('bg', 'forest');
const ALL = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const TYPES = arg('types', '') ? arg('types', '').split(',') : ALL;
// 명중(impact) 시각(ms) — js/stage3d.js 의 TYPEFX 와 attack() 계산을 따른다
const HIT = { normal: 170, dark: 170, steel: 170, fighting: 160, flying: 210, fire: 400, water: 420, ice: 420, grass: 540, electric: 260,
  poison: 500, ghost: 480, dragon: 360, bug: 500, fairy: 460, psychic: 340, ground: 260, rock: 460 };

// steps: [[메서드, ...인자], ...] 를 차례로 실행 ('sleep' 은 ms 대기)
async function frames3d(page, steps, times, settle) {
  return page.evaluate(async ({ steps, times, settle }) => {
    const st = window.__stage, cv = document.querySelector('#arena canvas');
    const out = [], t0 = performance.now();
    const p = steps.reduce((pr, s) => pr.then(() => (s[0] === 'sleep' ? new Promise((r) => setTimeout(r, s[1])) : st[s[0]].apply(st, s.slice(1)))), Promise.resolve());
    for (const t of times) {
      const dt = t - (performance.now() - t0);
      if (dt > 0) await new Promise((r) => setTimeout(r, dt));
      st._update(true);
      out.push(cv.toDataURL('image/jpeg', 0.88));
    }
    await p;
    await new Promise((r) => setTimeout(r, settle || 400));
    return out;
  }, { steps, times, settle });
}

// 2D: 연출을 시작해 두고 정해진 시각마다 화면을 찍는다
async function frames2d(page, steps, times, settle) {
  await page.evaluate((steps) => {
    const st = window.__stage;
    window.__p = steps.reduce((pr, s) => pr.then(() => (s[0] === 'sleep' ? new Promise((r) => setTimeout(r, s[1])) : st[s[0]].apply(st, s.slice(1)))), Promise.resolve());
  }, steps);
  const t0 = Date.now(), out = [];
  for (const t of times) {
    const dt = t - (Date.now() - t0);
    if (dt > 0) await page.waitForTimeout(dt);
    const buf = await page.screenshot({ clip: CLIP, type: 'jpeg', quality: 85 });
    out.push('data:image/jpeg;base64,' + buf.toString('base64'));
  }
  await page.evaluate(() => window.__p);
  await page.waitForTimeout(settle || 400);
  return out;
}

async function sheet(browser, file, cells, cols, w, h) {
  const ctx = await browser.newContext({ viewport: { width: cols * w, height: 400 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const html = '<body style="margin:0;background:#111;font:bold 13px sans-serif;color:#fff">' +
    '<div style="display:grid;grid-template-columns:repeat(' + cols + ',' + w + 'px)">' +
    cells.map((c) => '<div style="position:relative;width:' + w + 'px;height:' + h + 'px;overflow:hidden">' +
      '<img src="' + c.src + '" style="width:' + w + 'px;height:' + h + 'px;display:block">' +
      '<div style="position:absolute;left:4px;top:3px;text-shadow:0 0 3px #000,0 0 3px #000">' + c.label + '</div></div>').join('') +
    '</div></body>';
  await page.setContent(html);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete));
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  await ctx.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const frames = TWO_D ? frames2d : frames3d;
  await page.goto(base + '/tools/stage-test.html?still&' + (TWO_D ? '2d&' : '') + 'bg=' + BG + '&p=' + arg('p', 'naru') + '&e=' + arg('e', 'seol'));
  await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
  const mode = await page.evaluate(() => window.__stage.mode);
  if (mode !== (TWO_D ? '2d' : '3d')) { console.error('모드가 다름: ' + mode); process.exit(1); }
  await page.waitForTimeout(500);

  const tgt = SIDE === 'player' ? 'enemy' : 'player';
  const sheetCells = [];
  for (const t of TYPES) {
    const h = HIT[t] || 300;
    const times = [Math.max(60, h - 140), h + 70, h + 230];
    const imgs = await frames(page, [['attack', SIDE, t], ['hit', tgt, { fx: t }]], times, 500);
    await sheet(browser, 'fx_' + t + SUF + '.png',
      imgs.map((src, i) => ({ src, label: t + ' ' + ['before', 'impact', 'after'][i] + ' ' + times[i] + 'ms' })), 3, 390, 500);
    sheetCells.push({ src: imgs[1], label: t });
    console.log('fx', t, 'ok');
  }
  await sheet(browser, 'fx_sheet' + SUF + '.png', sheetCells, 6, 260, 333);

  // 상태이상 1회 연출 + 지속 표시
  const stCells = [];
  for (const k of ['brn', 'psn', 'tox', 'par', 'slp', 'cnf', 'frz']) {
    const imgs = await frames(page, [['status', 'enemy', k]], [260], 300);
    stCells.push({ src: imgs[0], label: 'status ' + k });
    await page.evaluate(() => window.__stage.statusTint('enemy', null));
    await page.waitForTimeout(250);
  }
  for (const k of ['brn', 'psn', 'tox', 'par', 'slp']) {
    const imgs = await frames(page, [['statusTint', 'enemy', k], ['sleep', 900]], [880], 50);
    stCells.push({ src: imgs[0], label: 'tint ' + k });
  }
  await page.evaluate(() => window.__stage.statusTint('enemy', null));
  // 교체 연출
  const rc = await frames(page, [['recall', 'enemy']], [150, 330], 200);
  rc.forEach((src, i) => stCells.push({ src, label: 'recall ' + ['150', '330'][i] + 'ms' }));
  await page.evaluate(() => window.__stage.setFighter('enemy', 'seol').then(() => window.__stage.enter('enemy')));
  await page.waitForTimeout(900);
  await sheet(browser, 'fx_status' + SUF + '.png', stCells, 5, 260, 333);

  // 포획 볼: 성공(3번 흔들림) / 실패(1번)
  const bt = [300, 700, 1200, 1700, 4300];
  const b1 = await frames(page, [['throwBall', 3, true]], bt, 300);
  await page.evaluate(() => window.__stage.clearBall());
  await page.waitForTimeout(300);
  const ft = [1300, 2450, 2650];
  const b2 = await frames(page, [['throwBall', 1, false]], ft, 600);
  await sheet(browser, 'fx_ball' + SUF + '.png', b1.map((src, i) => ({ src, label: 'caught ' + bt[i] + 'ms' }))
    .concat(b2.map((src, i) => ({ src, label: 'escape ' + ft[i] + 'ms' }))), 4, 260, 333);

  await browser.close();
  server.close();
  const real = errors.filter((e) => !/status of 404/.test(e));
  console.log(JSON.stringify({ mode, side: SIDE, bg: BG, types: TYPES.length, errors: real }, null, 2));
  process.exit(real.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
