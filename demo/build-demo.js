// demo/build-demo.js
// 전체 파이프라인 시각 증명: 샘플 로그 + 실제 charx → convertText → 완성 카드 HTML.
// 스프라이트는 data URL로 임베드, 프로필은 charx iconx 사용, 속마음은 스마트 모드.
// 실행: node demo/build-demo.js  → demo/demo-card.html (브라우저로 열기)
'use strict';
const fs = require('fs');
const path = require('path');
const { parseCharx, buildImageMappings, assetDataUrl } = require('../core/card/charx.js');
const { convertText } = require('../core/convert/convertText.js');

const ROOT = path.join(__dirname, '..');
const parsed = parseCharx(fs.readFileSync(path.join(ROOT, '캐릭터파일', 'CharX File.charx')));
const charName = (parsed.name && String(parsed.name).trim()) || '타루마에마루';

// 사용할 스프라이트 + 아이콘만 data URL 생성
const usedTags = ['tarumaemaru.happy.webp', 'tarumaemaru.curious.webp', 'hotarumaru.smile.webp'];
const mappings = buildImageMappings(parsed, { onlyTags: usedTags });
const iconAsset = parsed.assets.find((a) => a.name === 'iconx');
const iconUrl = iconAsset ? assetDataUrl(iconAsset) : '';

// 이미지 태그는 "독립 문단"이어야 통과(Pro1 동작: <div 시작 문단은 그대로 패스)
const log = [
  '{{img::tarumaemaru.happy.webp}}',
  '타루마에마루가 활짝 웃으며 다가왔다. “어서 와! 기다리고 있었어.” 그녀의 목소리엔 진심이 담겨 있었다.',
  '‘오늘은 왠지 좋은 일이 생길 것 같아.’ 그녀는 속으로 그렇게 생각했다.',
  '{{img::tarumaemaru.curious.webp}}',
  '“그런데… 뭔가 고민이 있는 표정이네?” 그녀가 고개를 살짝 갸웃했다.',
].join('\n\n');

const settings = {
  box: { showInnerBox: false, outerBoxColor: '#ffffff', innerBoxColor: '#fdf6f0', shadowIntensity: 10, useBoxBorder: false, boxBorderColor: '#e9c9b3', boxBorderThickness: 2 },
  profile: {
    showProfile: true, showProfileImage: true, showBotName: true, showTags: true, showDivider: true,
    botName: charName, botNameColor: '#8a5a44', frameStyle: '동그라미', width: 96, height: 96,
    imageUrl: iconUrl, showProfileBorder: true, profileBorderColor: '#e9c9b3', showProfileShadow: true,
  },
  divider: { style: '그라데이션', thickness: 2, outerColor: '#e9c9b3', innerColor: '#ffffff', solidColor: null },
  text: {
    useTextIndent: true, textIndent: 20, useTextSize: true, textSize: 15,
    dialogColor: '#8a5a44', dialogBold: true, dialogNewline: true,
    innerThoughtsColor: '#b08968', innerThoughtsBold: false, narrationColor: '#5b4636',
    usePadding: true, removeAsterisk: true, convertEllipsis: true, smartFormat: true,
  },
  tags: [
    { text: charName, color: '#f3e3d3', textColor: '#8a5a44', style: '기본', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
    { text: '감정표현', color: '#e9c9b3', textColor: '#8a5a44', style: '투명 배경', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
    { text: 'RisuAI', color: '#d98e73', textColor: '#ffffff', style: '그라데이션', borderRadius: 20, fontSize: 0.85, padding: { top: 0.2, right: 0.8, bottom: 0.2, left: 0.8 } },
  ],
  assetImage: { imageSize: 80, imageMargin: 10, useImageBorder: false, imageBorderColor: '#000000', useImageShadow: true },
  darkMode: false, cardTextColor: '#5b4636',
};

// 변형 B: 완전히 다른 설정 — 같은 엔진이 다른 룩을 내는지 증명 + 미검증 분기 시각확인
//  (내부박스 ON, 직사각형 프로필, 단색 구분선, 이미지 45%+테두리, 파란 테마)
const variant = process.argv[2] === 'b';
if (variant) {
  settings.box = { showInnerBox: true, outerBoxColor: '#eaf2fb', innerBoxColor: '#ffffff', shadowIntensity: 18, useBoxBorder: true, boxBorderColor: '#9cc3e8', boxBorderThickness: 2 };
  Object.assign(settings.profile, { frameStyle: '직사각형', width: 120, height: 120, botNameColor: '#2b6cb0', profileBorderColor: '#9cc3e8' });
  settings.divider = { style: '단색', thickness: 3, outerColor: '#9cc3e8', innerColor: '#ffffff', solidColor: '#9cc3e8' };
  Object.assign(settings.text, { dialogColor: '#2b6cb0', innerThoughtsColor: '#5a7fa8', narrationColor: '#3a4654', textSize: 14 });
  settings.tags = [
    { text: charName, color: '#dbeafe', textColor: '#2b6cb0', style: '기본', borderRadius: 6, fontSize: 0.8, padding: { top: 0.2, right: 0.7, bottom: 0.2, left: 0.7 } },
    { text: '블루테마', color: '#2b6cb0', textColor: '#ffffff', style: '그라데이션', borderRadius: 6, fontSize: 0.8, padding: { top: 0.2, right: 0.7, bottom: 0.2, left: 0.7 } },
  ];
  settings.assetImage = { imageSize: 45, imageMargin: 14, useImageBorder: true, imageBorderColor: '#9cc3e8', useImageShadow: true };
  settings.cardTextColor = '#3a4654';
}
const outName = variant ? 'demo-card-b' : 'demo-card';

const card = convertText(log, settings, mappings);

// 브라우저로 열어볼 수 있게 최소 문서로 감싸기 (배경만 추가, 카드 자체는 자기완결 인라인 CSS)
const doc = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>로그 제조기 Pro 2 — 데모 카드</title></head>
<body style="margin:0;padding:24px;background:${variant ? '#dde7f0' : '#e7ddd4'};">
${card}
</body></html>`;

fs.writeFileSync(path.join(__dirname, outName + '.html'), doc, 'utf8');

// 요약 출력
const imgCount = (card.match(/<img /g) || []).length;
const dataUrlCount = (card.match(/src="data:image/g) || []).length;
console.log('캐릭터:', charName);
console.log('카드 길이:', card.length, 'chars');
console.log('<img> 개수:', imgCount, '(프로필 1 + 스프라이트 2 예상)');
console.log('data: 임베드 이미지:', dataUrlCount);
console.log('스마트 속마음 span 포함:', card.includes('#b08968') ? '예' : '아니오');
console.log('→ demo/' + outName + '.html 생성 완료 (브라우저로 열어보세요)');
