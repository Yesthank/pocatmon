// 스프라이트 1~N개를 원본 크기로 나란히 렌더. 사용: node tools/sprite-shot.js naru metal [--shiny]
'use strict';
const path = require('path');
const fs = require('fs');
const S = require('../js/sprites.js');
const { launch } = require('./browser');

(async () => {
  const args = process.argv.slice(2);
  const shiny = args.includes('--shiny');
  const ids = args.filter((a) => !a.startsWith('--'));
  const imgs = ids.map((id) => '<img src="' + S.spriteURL(id, { shiny }) + '">').join('');
  const html = '<body style="margin:0;background:#5a6f8f;display:flex">' + imgs + '</body>';
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 512 * ids.length, height: 512 } });
  await page.setContent(html);
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
  const out = path.join(__dirname, 'out');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'sprite_' + ids.join('_') + (shiny ? '_shiny' : '') + '.png');
  await page.screenshot({ path: file });
  await browser.close();
  console.log(file);
})().catch((e) => { console.error(e); process.exit(1); });
