// 무대(3D/2D) 스크린샷 + 오류 게이트. 사용: node tools/stage-shot.js [추가쿼리] [이름접미사]
//   예) node tools/stage-shot.js "bg=sea&p=metal&e=seol&still" sea
// 3D 실행과 ?2d 실행을 모두 돌려 tools/out/stage_{3d,2d}[ _접미사].png 와 중간 공격 프레임을 저장한다.
'use strict';
const path = require('path');
const fs = require('fs');
const { start } = require('./serve');
const { launch, phonePage } = require('./browser');

const extra = process.argv[2] || '';
const suffix = process.argv[3] ? '_' + process.argv[3] : '';
const OUT = path.join(__dirname, 'out');
const CLIP = { x: 0, y: 0, width: 390, height: 500 };

async function run(browser, base, force2d) {
  const { ctx, page, errors } = await phonePage(browser);
  const qs = [force2d ? '2d' : '', extra].filter(Boolean).join('&');
  const tag = force2d ? '2d' : '3d';
  const res = { done: false, mode: null, mid: false };
  try {
    await page.goto(base + '/tools/stage-test.html' + (qs ? '?' + qs : ''));
    const midWait = page.waitForFunction(() => window.__mid === true || window.__done === true, null, { timeout: 30000 })
      .then(async () => {
        if (await page.evaluate(() => window.__mid === true)) {
          await page.screenshot({ path: path.join(OUT, 'stage_' + tag + '_mid' + suffix + '.png'), clip: CLIP });
          res.mid = true;
        }
      });
    await midWait;
    await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
    res.done = true;
    res.mode = await page.evaluate(() => window.__stage && window.__stage.mode);
    res.pos = await page.evaluate(() => ({ player: window.__stage.screenPos('player'), enemy: window.__stage.screenPos('enemy') }));
    await page.screenshot({ path: path.join(OUT, 'stage_' + tag + suffix + '.png'), clip: CLIP });
  } catch (e) {
    errors.push('runner: ' + String(e && e.message || e).split('\n')[0]);
    res.mode = await page.evaluate(() => window.__stage && window.__stage.mode).catch(() => null);
    await page.screenshot({ path: path.join(OUT, 'stage_' + tag + '_fail' + suffix + '.png'), clip: CLIP }).catch(() => {});
  }
  res.errors = errors;
  await ctx.close();
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await start(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await launch();
  const r3 = await run(browser, base, false);
  const r2 = await run(browser, base, true);
  await browser.close();
  server.close();
  const summary = {
    mode3d: r3.mode, mode2d: r2.mode,
    done3d: r3.done, done2d: r2.done, mid3d: r3.mid, mid2d: r2.mid,
    pos3d: r3.pos, pos2d: r2.pos,
    errors: r3.errors.map((e) => '[3d] ' + e).concat(r2.errors.map((e) => '[2d] ' + e))
  };
  console.log(JSON.stringify(summary, null, 2));
  if (r3.mode !== '3d') console.log('NOTE: 3D 실행이 3d 모드가 아님 (WebGL 사용 불가로 2D 대체되었을 수 있음)');
  const ok = r3.done && r2.done && r2.mode === '2d' && summary.errors.length === 0;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
