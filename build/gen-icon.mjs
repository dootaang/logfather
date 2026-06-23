// build/gen-icon.mjs — 아이콘 생성.
//   icon.svg(투명·불꽃만)    → build/icon.ico  (작업표시줄/exe/설치파일)
//   icon-bg.svg(배경+불꽃)   → web/icon-512.png, icon-192.png, apple-touch-icon.png (윈도우 창/PWA)
// 재실행: npm i -D @resvg/resvg-js png-to-ico  후  node build/gen-icon.mjs
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';

const load = (name) => readFileSync(new URL('./' + name, import.meta.url));
const render = (svg, size) =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng());

const fg = load('icon.svg');      // 투명 불꽃
const bg = load('icon-bg.svg');   // 배경 + 불꽃

// Windows .ico (투명, 멀티 해상도)
writeFileSync(new URL('./icon.ico', import.meta.url), await pngToIco([256, 128, 64, 48, 32, 16].map((s) => render(fg, s))));

// 윈도우 창/PWA (배경 버전)
writeFileSync(new URL('../web/icon-512.png', import.meta.url), render(bg, 512));
writeFileSync(new URL('../web/icon-192.png', import.meta.url), render(bg, 192));
writeFileSync(new URL('../web/apple-touch-icon.png', import.meta.url), render(bg, 180));

console.log('icons generated: build/icon.ico(투명) + web/icon-{512,192}.png·apple-touch(배경)');
