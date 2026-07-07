// 에셋추출기 build/gen-icon.mjs — icon.svg → icon.ico (exe/작업표시줄, 멀티 해상도).
//   의존성은 루트(C:\pro 1.2\node_modules)의 @resvg/resvg-js·png-to-ico를 상위 탐색으로 재사용.
//   재실행: node build/gen-icon.mjs (에셋추출기 폴더에서)
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('./icon.svg', import.meta.url));
const render = (size) =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng());

writeFileSync(new URL('./icon.ico', import.meta.url), await pngToIco([256, 128, 64, 48, 32, 16].map(render)));
writeFileSync(new URL('./drag.png', import.meta.url), render(32));   // 드래그 아웃 커서 아이콘(startDrag용)
console.log('icons generated: build/icon.ico + build/drag.png');
