/* 포캣몬 필드 맵 — 타일·건물·NPC·이벤트 데이터 (DOM 없음)
   타일 한 칸 = 한 걸음. 좌표는 (x, y), 왼쪽 위가 (0, 0). 방향은 'up' | 'down' | 'left' | 'right'.
   모든 행은 길이가 같아야 하고, 건물 자리는 '#'로 채운다(건물 정보는 buildings 에 따로 둔다). */
(function (root) {
  'use strict';

  /* ── 타일 범례 ──
     walk: 걸을 수 있음, grass: 수풀(야생 조우), water: 물, deco: 렌더러 힌트 */
  var LEGEND = {
    '.': { name: 'ground', walk: true },            // 테마 바닥(풀밭·눈밭·모래·돌바닥 등은 테마가 정한다)
    ',': { name: 'tallgrass', walk: true, grass: true },
    '=': { name: 'path', walk: true },               // 흙길
    'p': { name: 'paved', walk: true },              // 포장 광장
    'F': { name: 'flowers', walk: true },
    's': { name: 'sand', walk: true },
    'n': { name: 'snow', walk: true },
    'i': { name: 'ice', walk: true },
    'b': { name: 'bridge', walk: true },
    'T': { name: 'tree', walk: false },
    'B': { name: 'bush', walk: false },              // 낮은 덤불·울타리 나무
    'f': { name: 'fence', walk: false },
    'r': { name: 'rock', walk: false },
    'c': { name: 'cliff', walk: false },
    'W': { name: 'wall', walk: false },              // 벽돌·석벽
    '~': { name: 'water', walk: false, water: true },
    'L': { name: 'lava', walk: false },
    'S': { name: 'sign', walk: false },              // 표지판 — signs[] 에 글이 있다
    '#': { name: 'building', walk: false }           // buildings[] 가 차지하는 칸
  };

  /* ── 건물 ── 크기 고정, 문은 맨 아랫줄 가운데(x + ⌊w/2⌋, y + h − 1). 문에 부딪히면 그 건물의 기능이 실행된다. */
  var BUILDINGS = {
    center: { w: 4, h: 3, label: '센터' },     // 포캣몬 센터(회복)
    shop: { w: 4, h: 3, label: '상점' },
    gym: { w: 5, h: 4, label: '관장' },
    lab: { w: 5, h: 3, label: '연구소' },
    house: { w: 3, h: 3, label: '' }
  };
  function doorOf(bd) { var B = BUILDINGS[bd.kind]; return { x: bd.x + Math.floor(B.w / 2), y: bd.y + B.h - 1 }; }

  /* ── 사람 모양 ── 렌더러가 코드로 그리는 도트 캐릭터의 색·머리 모양
     hair: 'short' | 'long' | 'spiky' | 'bun' | 'twin' | 'cap' | 'bald' | 'hood' */
  var LOOKS = {
    player: { skin: '#f6d2b0', hair: 'cap', hairColor: '#3a2a20', hat: '#e8384a', shirt: '#2f6fd8', pants: '#2a3048', shoes: '#c03040' },
    rival: { skin: '#f6d2b0', hair: 'spiky', hairColor: '#7a3fb0', shirt: '#2a2a33', pants: '#4a4f66', shoes: '#222', accent: '#e8b818' },
    professor: { skin: '#f0c8a0', hair: 'short', hairColor: '#d8d8d8', shirt: '#f4f4f4', pants: '#5a5f78', shoes: '#333', coat: true },
    nurse: { skin: '#f8d8bc', hair: 'bun', hairColor: '#e86a9a', shirt: '#fff0f6', pants: '#ffffff', shoes: '#e86a9a', hat: '#ffffff' },
    clerk: { skin: '#eac09a', hair: 'short', hairColor: '#2a2a30', shirt: '#3a7ad8', pants: '#2a3048', shoes: '#333', apron: '#3a7ad8' },
    kid: { skin: '#f6d2b0', hair: 'short', hairColor: '#5a3a20', shirt: '#f0a020', pants: '#3a6ad8', shoes: '#fff' },
    girl: { skin: '#f6d2b0', hair: 'twin', hairColor: '#c05a20', shirt: '#ff7aa8', pants: '#5a3a8a', shoes: '#fff' },
    elder: { skin: '#e8c0a0', hair: 'bald', hairColor: '#cfcfcf', shirt: '#7a5a3a', pants: '#4a3a2a', shoes: '#2a2a2a' },
    hiker: { skin: '#d8a880', hair: 'cap', hairColor: '#4a2a10', hat: '#6a8a3a', shirt: '#a86a2a', pants: '#5a4a2a', shoes: '#3a2a1a' },
    swimmer: { skin: '#e0b090', hair: 'short', hairColor: '#e8c050', shirt: '#2ab0d8', pants: '#2ab0d8', shoes: '#e0b090' },
    punk: { skin: '#f0c8a0', hair: 'spiky', hairColor: '#e83a5a', shirt: '#1a1a22', pants: '#3a3a4a', shoes: '#111' },
    mystic: { skin: '#e8d0f0', hair: 'hood', hairColor: '#5a3a9a', shirt: '#5a3a9a', pants: '#3a2a6a', shoes: '#2a1a4a' },
    cloak: { skin: '#d0b0b0', hair: 'hood', hairColor: '#8a0f2a', shirt: '#8a0f2a', pants: '#3a0a14', shoes: '#1a0a0a' },
    // 관장
    leaderForest: { skin: '#f6d2b0', hair: 'long', hairColor: '#3a8a3a', shirt: '#8ad05a', pants: '#3a5a2a', shoes: '#5a3a1a' },
    leaderCoast: { skin: '#e8b890', hair: 'short', hairColor: '#2a6ad8', shirt: '#ffffff', pants: '#2a6ad8', shoes: '#ffd34d' },
    leaderVolcano: { skin: '#d89a70', hair: 'spiky', hairColor: '#e8542c', shirt: '#3a1a10', pants: '#5a2a1a', shoes: '#111' },
    leaderGlacier: { skin: '#fde8dc', hair: 'long', hairColor: '#cfefff', shirt: '#4cc3e8', pants: '#ffffff', shoes: '#4cc3e8' },
    leaderAlley: { skin: '#e8c0a0', hair: 'hood', hairColor: '#2a2a33', shirt: '#2a2a33', pants: '#1a1a22', shoes: '#9341c9' },
    leaderTemple: { skin: '#f6e0d0', hair: 'long', hairColor: '#f0e0ff', shirt: '#6a4ac0', pants: '#e46ad8', shoes: '#ffd34d' }
  };

  /* ── 맵 ──
     theme: 렌더러 색 테마(town | forest | coast | volcano | glacier | alley | temple | summit | ruins)
     area: 수풀 조우·관장에 쓰는 PData.AREAS id (없으면 수풀 없음)
     warps: 칸을 밟으면 다른 맵으로. to: 맵 id, tx/ty: 도착 칸, dir: 도착 후 바라보는 방향
     npcs: id(맵 안에서 유일), x, y, dir, look(LOOKS 키), script(PMaps.SCRIPTS 키) 또는 trainer(PData.TRAINERS 키), sight(트레이너 시야 칸 수)
     signs: x, y, text / items: id(전역 유일, 주운 표식), x, y, item, n */
  var MAPS = {
    home: {
      name: '고양이 마을', theme: 'town', area: null,
      tiles: [
        'TTTTTTTTT===TTTTTTTT',
        'TFF.....S.==......FT',
        'T.......====.......T',
        'T.####......=.####.T',
        'T.####......=.####.T',
        'T.####......=.####.T',
        'T...==......=...=..T',
        'T....=======p===...T',
        'T.F..=.pppppppp=.F.T',
        'T....=.pppppppp=...T',
        'T.#####ppppp...###.T',
        'T.#####ppppp...###.T',
        'T.#####ppppp...###.T',
        'T.....=ppppp.......T',
        'T..ff.=.......ff...T',
        'T.FFf.=..S....fFF..T',
        'TTTTTTTTTTTTTTTTTTTT'
      ],
      buildings: [
        { kind: 'center', x: 2, y: 3 },
        { kind: 'shop', x: 14, y: 3 },
        { kind: 'lab', x: 2, y: 10, script: 'professor' },
        { kind: 'house', x: 15, y: 10 }
      ],
      warps: [
        { x: 9, y: 0, to: 'forest', tx: 10, ty: 38, dir: 'up' },
        { x: 10, y: 0, to: 'forest', tx: 10, ty: 38, dir: 'up' },
        { x: 11, y: 0, to: 'forest', tx: 11, ty: 38, dir: 'up' }
      ],
      npcs: [
        { id: 'prof', x: 5, y: 13, dir: 'down', look: 'professor', script: 'professor' },
        { id: 'rival', x: 7, y: 13, dir: 'left', look: 'rival', script: 'home_kid', hideIf: { flag: 'intro' } },
        { id: 'mom', x: 18, y: 13, dir: 'left', look: 'elder', script: 'home_elder' },
        { id: 'kid', x: 11, y: 8, dir: 'right', look: 'kid', script: 'home_kid' }
      ],
      signs: [
        { x: 8, y: 1, text: '북쪽: 햇살 풀숲\n수풀에는 야생 포캣몬이 숨어 있다.' },
        { x: 9, y: 15, text: '고양이 마을\n모든 모험이 시작되는 곳.' }
      ],
      items: [
        { id: 'home_ball', x: 1, y: 2, item: 'ball', n: 2 }
      ],
      start: { x: 9, y: 9, dir: 'down' },
      onEnter: [{ if: { notFlag: 'intro' }, script: 'intro' }],
      houseText: '할머니가 차려 둔 따뜻한 밥 냄새가 난다.'
    }
  };

  /* ── 지역 맵 공통: 위쪽 마을(관장·상점·센터·집) + 아래쪽 길목 ── */
  function townRows(o) {
    // o: { road: '==' | 'pp', deco: 'F' }
    var R = o.road || '==', F = o.deco || 'F';
    return [
      'TTTTTTTTTT' + R + 'TTTTTTTTTT',
      'T.' + F + '......S' + R + '.......' + F + '.T',
      'T.........' + R + '.........T',
      'T.#####...' + R + '...####..T',
      'T.#####...' + R + '...####..T',
      'T.#####...' + R + '...####..T',
      'T.#####...' + R + '.........T',
      'T...=======p===...' + F + '..T',
      'T.........pp.........T',
      'T...####..pp...###...T',
      'T...####..pp...###...T',
      'T...####..pp...###...T',
      'T.....=====pp........T',
      'T.' + F + '.......' + R + '......' + F + '..T',
      'TTTTTTTT..' + R + '..TTTTTTTT'
    ];
  }
  var TOWN_BUILDINGS = [
    { kind: 'gym', x: 2, y: 3 }, { kind: 'shop', x: 15, y: 3 },
    { kind: 'center', x: 4, y: 9 }, { kind: 'house', x: 15, y: 9 }
  ];
  function areaMap(o) {
    var road = o.road || '==';
    var m = {
      name: o.name, theme: o.theme, area: o.area,
      tiles: townRows(o).concat(o.route).concat(['TTTTTTTTTT' + road + 'TTTTTTTTTT']),
      buildings: TOWN_BUILDINGS.map(function (b) { return { kind: b.kind, x: b.x, y: b.y }; }),
      warps: [
        { x: 10, y: 0, to: o.next, tx: o.nextAt[0], ty: o.nextAt[1], dir: 'up', if: { badge: o.area }, deny: o.deny },
        { x: 11, y: 0, to: o.next, tx: o.nextAt[0] + 1, ty: o.nextAt[1], dir: 'up', if: { badge: o.area }, deny: o.deny },
        { x: 10, y: 39, to: o.prev, tx: o.prevAt[0], ty: o.prevAt[1], dir: 'down' },
        { x: 11, y: 39, to: o.prev, tx: o.prevAt[0] + 1, ty: o.prevAt[1], dir: 'down' }
      ],
      npcs: o.npcs, signs: o.signs, items: o.items, houseText: o.houseText
    };
    return m;
  }

  MAPS.forest = areaMap({
    name: '햇살 풀숲', theme: 'forest', area: 'forest', prev: 'home', prevAt: [10, 1], next: 'coast', nextAt: [10, 38],
    deny: '북쪽 길은 새싹 배지가 있어야 지나갈 수 있다.',
    route: [
      'T,,,,.....==.....,,,,T',
      'T,,,,.....==.....,,,,T',
      'T,,,,..T..==..T..,,,,T',
      'T.....TT..==..TT.....T',
      'T.........==.........T',
      'TTT.,,,,,,,,,,,,,,.TTT',
      'TTT.,,,,,,,,,,,,,,.TTT',
      'T...,,,,,,,,,,,,,,...T',
      'T.........==.........T',
      'T..S......==....rr...T',
      'T,,,,,,...==...,,,,,,T',
      'T,,,,,,...==...,,,,,,T',
      'T,,,,,,...==...,,,,,,T',
      'T.........==.........T',
      'TTTTT.....==.....TTTTT',
      'T.....,,,,==,,,,.....T',
      'T.....,,,,==,,,,.....T',
      'T..F..,,,,==,,,,..F..T',
      'T.........==.........T',
      'T~~~~.....bb.....~~~~T',
      'T~~~~.....bb.....~~~~T',
      'T.........==.........T',
      'T.........==.........T',
      'T.........==.........T'
    ],
    npcs: [
      { id: 'f_girl', x: 13, y: 8, dir: 'down', look: 'girl', script: 'forest_girl' },
      { id: 'f_old', x: 8, y: 6, dir: 'down', look: 'elder', script: 'forest_old' },
      { id: 'f_t1', x: 7, y: 19, dir: 'right', look: 'kid', trainer: 't_forest_1', sight: 3 },
      { id: 'f_t2', x: 14, y: 23, dir: 'left', look: 'girl', trainer: 't_forest_2', sight: 3 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 반짝 해안\n새싹 배지가 있어야 지나갈 수 있다.' },
      { x: 3, y: 24, text: '수풀 주의!\n걸을 때마다 야생 포캣몬이 튀어나올 수 있다.' }
    ],
    items: [
      { id: 'forest_bell', x: 20, y: 27, item: 'bell', n: 1 },
      { id: 'forest_snack', x: 2, y: 33, item: 'snack', n: 2 },
      { id: 'forest_ball', x: 19, y: 36, item: 'ball', n: 3 }
    ],
    houseText: '창밖으로 나비냥이 날아다니는 게 보인다.'
  });

  MAPS.coast = areaMap({
    name: '반짝 해안', theme: 'coast', area: 'coast', prev: 'forest', prevAt: [10, 1], next: 'volcano', nextAt: [10, 38],
    deny: '북쪽 길은 물결 배지가 있어야 지나갈 수 있다.',
    route: [
      'T~~~......==......~~~T',
      'T~~,,,....==....,,,~~T',
      'T~,,,,....==....,,,,~T',
      'T~,,,,....==....,,,,~T',
      'T.........==.........T',
      'T..rr.....==.....rr..T',
      'T~~~~~~~~~bb~~~~~~~~~T',
      'T~~~~~~~~~bb~~~~~~~~~T',
      'T.........==.........T',
      'T,,,,,,,..==..,,,,,,,T',
      'T,,,,,,,..==..,,,,,,,T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T.........==.........T',
      'T..S......==.....F...T',
      'T~~~~.....==.....~~~~T',
      'T~~~~.,,,,==,,,,.~~~~T',
      'T~~~~.,,,,==,,,,.~~~~T',
      'T.....,,,,==,,,,.....T',
      'T.........==.........T',
      'T..rr.....==.....rr..T',
      'T.........==.........T',
      'T,,,,.....==.....,,,,T',
      'T,,,,.....==.....,,,,T',
      'T.........==.........T'
    ],
    npcs: [
      { id: 'c_fisher', x: 8, y: 8, dir: 'down', look: 'hiker', script: 'coast_fisher' },
      { id: 'c_kid', x: 14, y: 12, dir: 'left', look: 'kid', script: 'coast_kid' },
      { id: 'c_rival', x: 12, y: 15, dir: 'left', look: 'rival', trainer: 'rival_2', sight: 2, hideIf: { beaten: 'rival_2' } },
      { id: 'c_t1', x: 6, y: 19, dir: 'right', look: 'swimmer', trainer: 't_coast_1', sight: 4 },
      { id: 'c_t2', x: 16, y: 33, dir: 'left', look: 'hiker', trainer: 't_coast_2', sight: 5 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 화산 기슭\n물결 배지가 있어야 지나갈 수 있다.' },
      { x: 3, y: 28, text: '반짝 해안\n파도 소리와 함께 찌릿냥의 전기가 튄다.' }
    ],
    items: [
      { id: 'coast_tuna', x: 1, y: 37, item: 'tuna', n: 1 },
      { id: 'coast_silver', x: 20, y: 24, item: 'silverball', n: 2 }
    ],
    houseText: '선반에 커다란 조개껍데기가 놓여 있다.'
  });

  MAPS.volcano = areaMap({
    name: '화산 기슭', theme: 'volcano', area: 'volcano', prev: 'coast', prevAt: [10, 1], next: 'glacier', nextAt: [10, 38],
    deny: '북쪽 길은 용암 배지가 있어야 지나갈 수 있다.',
    route: [
      'TLLL......==......LLLT',
      'TLL,,,....==....,,,LLT',
      'TL,,,,..r.==.r..,,,,LT',
      'T.........==.........T',
      'Trr.......==.......rrT',
      'T.,,,,,,,,==,,,,,,,,.T',
      'T.,,,,,,,,==,,,,,,,,.T',
      'T...LLL...==...LLL...T',
      'T...LLL...==...LLL...T',
      'T..S......==.........T',
      'T,,,,,,...==...,,,,,,T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T,,,,,,...==...,,,,,,T',
      'T.........==.........T',
      'TrrrrT....==....TrrrrT',
      'T.....,,,,==,,,,.....T',
      'T..L..,,,,==,,,,..L..T',
      'T.....,,,,==,,,,.....T',
      'T.........==.........T',
      'TLLLL.....bb.....LLLLT',
      'TLLLL.....bb.....LLLLT',
      'T.........==.........T',
      'T..r......==......r..T',
      'T.........==.........T'
    ],
    npcs: [
      { id: 'v_res', x: 8, y: 8, dir: 'down', look: 'professor', script: 'volcano_researcher' },
      { id: 'v_cloak', x: 19, y: 13, dir: 'left', look: 'cloak', script: 'volcano_cloak', hideIf: { flag: 'cloak1' } },
      { id: 'v_t1', x: 8, y: 18, dir: 'right', look: 'hiker', trainer: 't_volcano_1', sight: 2 },
      { id: 'v_t2', x: 13, y: 33, dir: 'left', look: 'punk', trainer: 't_volcano_2', sight: 3 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 얼음 빙하\n용암 배지가 있어야 지나갈 수 있다.' },
      { x: 3, y: 24, text: '화산 기슭\n용암에 가까이 가지 마시오.' }
    ],
    items: [
      { id: 'volcano_crystal', x: 20, y: 26, item: 'crystal', n: 1 },
      { id: 'volcano_catnip', x: 1, y: 30, item: 'catnip', n: 2 }
    ],
    houseText: '방 안이 후끈하다. 화르냥 인형이 놓여 있다.'
  });

  MAPS.glacier = areaMap({
    name: '얼음 빙하', theme: 'glacier', area: 'glacier', prev: 'volcano', prevAt: [10, 1], next: 'alley', nextAt: [10, 38],
    deny: '북쪽 길은 서리 배지가 있어야 지나갈 수 있다.',
    route: [
      'TTT.......==.......TTT',
      'T,,,,.....==.....,,,,T',
      'T,,,,.iii.==.iii.,,,,T',
      'T.....iii.==.iii.....T',
      'T.........==.........T',
      'TT..,,,,,,==,,,,,,..TT',
      'TT..,,,,,,==,,,,,,..TT',
      'T..rr.....==.....rr..T',
      'T.........==.........T',
      'T..S......==.........T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T.........==.........T',
      'TTTT......==......TTTT',
      'T.....,,,,==,,,,.....T',
      'T.....,,,,==,,,,.....T',
      'T..i......==......i..T',
      'T.........==.........T',
      'T~~~~~....bb....~~~~~T',
      'T.........==.........T',
      'T,,,,.....==.....,,,,T',
      'T,,,,.....==.....,,,,T',
      'T.........==.........T',
      'T.........==.........T'
    ],
    npcs: [
      { id: 'g_assist', x: 8, y: 8, dir: 'down', look: 'professor', script: 'glacier_assist' },
      { id: 'g_hint', x: 14, y: 12, dir: 'left', look: 'girl', script: 'glacier_hint' },
      { id: 'g_rival', x: 12, y: 15, dir: 'left', look: 'rival', trainer: 'rival_3', sight: 2, hideIf: { beaten: 'rival_3' } },
      { id: 'g_t1', x: 7, y: 19, dir: 'right', look: 'girl', trainer: 't_glacier_1', sight: 3 },
      { id: 'g_t2', x: 14, y: 32, dir: 'left', look: 'hiker', trainer: 't_glacier_2', sight: 3 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 어둠 골목\n서리 배지가 있어야 지나갈 수 있다.' },
      { x: 3, y: 24, text: '얼음 빙하\n발밑을 조심하시오.' }
    ],
    items: [
      { id: 'glacier_salmon', x: 1, y: 36, item: 'salmon', n: 1 },
      { id: 'glacier_candy', x: 20, y: 35, item: 'candy', n: 1 }
    ],
    houseText: '난로 앞에서 설냥이가 졸고 있다.'
  });

  MAPS.alley = areaMap({
    name: '어둠 골목', theme: 'alley', area: 'alley', prev: 'glacier', prevAt: [10, 1], next: 'temple', nextAt: [10, 38],
    deny: '북쪽 길은 그늘 배지가 있어야 지나갈 수 있다.',
    route: [
      'TWWW......==......WWWT',
      'TW,,,.....==.....,,,WT',
      'TW,,,..W..==..W..,,,WT',
      'T.....WW..==..WW.....T',
      'T.........==.........T',
      'TWW.,,,,,,==,,,,,,.WWT',
      'TWW.,,,,,,==,,,,,,.WWT',
      'T...,,,,,,,,,,,,,,...T',
      'T.........==.........T',
      'T..S......==....ff...T',
      'T,,,,,,...==...,,,,,,T',
      'T,,,,,,...==...,,,,,,T',
      'T,,,,,,...==...,,,,,,T',
      'T.........==.........T',
      'TWWWW.....==.....WWWWT',
      'T.....,,,,==,,,,.....T',
      'T..f..,,,,==,,,,..f..T',
      'T.....,,,,==,,,,.....T',
      'T.........==.........T',
      'T.........==.........T',
      'TWWWW.....==.....WWWWT',
      'T.........==.........T',
      'T.........==.........T',
      'T.........==.........T'
    ],
    npcs: [
      { id: 'a_owner', x: 8, y: 8, dir: 'down', look: 'elder', script: 'alley_owner' },
      { id: 'a_cloak', x: 19, y: 13, dir: 'left', look: 'cloak', script: 'alley_cloak', hideIf: { flag: 'cloak2' } },
      { id: 'a_t1', x: 7, y: 19, dir: 'right', look: 'punk', trainer: 't_alley_1', sight: 3 },
      { id: 'a_t2', x: 14, y: 33, dir: 'left', look: 'mystic', trainer: 't_alley_2', sight: 3 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 별빛 신전\n그늘 배지가 있어야 지나갈 수 있다.' },
      { x: 3, y: 24, text: '어둠 골목\n밤에는 유령냥이 떠돈다는 소문이 있다.' }
    ],
    items: [
      { id: 'alley_matatabi', x: 20, y: 26, item: 'matatabi', n: 1 },
      { id: 'alley_feast', x: 1, y: 37, item: 'feast', n: 1 }
    ],
    houseText: '벽에 낡은 길고양이 사진이 잔뜩 붙어 있다.'
  });

  MAPS.temple = areaMap({
    name: '별빛 신전', theme: 'temple', area: 'temple', road: 'pp', prev: 'alley', prevAt: [10, 1], next: 'summit', nextAt: [10, 21],
    deny: '정상으로 가는 길은 별빛 배지가 있어야 열린다.',
    route: [
      'Tr.r......pp......r.rT',
      'T,,,,.....pp.....,,,,T',
      'T,,,,..r..pp..r..,,,,T',
      'T.........pp.........T',
      'T..F......pp......F..T',
      'Tr..,,,,,,pp,,,,,,..rT',
      'Tr..,,,,,,pp,,,,,,..rT',
      'T...,,,,,,,,,,,,,,...T',
      'T.........pp.........T',
      'T..S......pp....r....T',
      'T,,,,,,...pp...,,,,,,T',
      'T,,,,,,...pp...,,,,,,T',
      'T.........pp.........T',
      'Tr.r......pp......r.rT',
      'T~~~~.....bb.....~~~~T',
      'T~~~~.....bb.....~~~~T',
      'T.....,,,,pp,,,,.....T',
      'T.....,,,,pp,,,,.....T',
      'T.........pp.........T',
      'T..r......pp......r..T',
      'T,,,,.....pp.....,,,,T',
      'T,,,,.....pp.....,,,,T',
      'T.........pp.........T',
      'T.........pp.........T'
    ],
    npcs: [
      { id: 't_elder', x: 8, y: 8, dir: 'down', look: 'elder', script: 'temple_elder' },
      { id: 't_rival', x: 12, y: 15, dir: 'left', look: 'rival', trainer: 'rival_4', sight: 2, hideIf: { beaten: 'rival_4' } },
      { id: 't_t1', x: 7, y: 18, dir: 'right', look: 'elder', trainer: 't_temple_1', sight: 3 },
      { id: 't_t2', x: 14, y: 33, dir: 'left', look: 'mystic', trainer: 't_temple_2', sight: 3 }
    ],
    signs: [
      { x: 9, y: 1, text: '북쪽: 수호자의 정상\n별빛 배지가 있어야 열린다.' },
      { x: 3, y: 24, text: '별빛 신전\n옛 수호자를 기리는 곳.' }
    ],
    items: [
      { id: 'temple_gold', x: 20, y: 36, item: 'goldball', n: 2 },
      { id: 'temple_salmon', x: 1, y: 22, item: 'salmon', n: 2 }
    ],
    houseText: '향 냄새가 은은하게 퍼진다.'
  });

  MAPS.summit = {
    name: '수호자의 정상', theme: 'summit', area: null,
    tiles: [
      'TTTTTTTTTTpppTTTTTTTTT',
      'Tcccccccc.ppp.cccccccT',
      'Tc........p........rcT',
      'Tc.r.....ppp.......rcT',
      'Tc.......ppp........cT',
      'Tc.......ppp........cT',
      'Tccccc...ppp...ccccccT',
      'T........ppp.........T',
      'T..rr....ppp....rr...T',
      'T........ppp.........T',
      'Tccccccc.ppp.ccccccccT',
      'T........ppp.........T',
      'T.r......ppp......r..T',
      'T........ppp.........T',
      'T...####.ppp.........T',
      'T...####.ppp.........T',
      'T...####.ppp.........T',
      'T........ppp.........T',
      'Tcccccc..ppp..cccccccT',
      'T........ppp.........T',
      'T..r.....ppp.....r...T',
      'T........ppp.........T',
      'TTTTTTTTTpppTTTTTTTTTT'
    ],
    buildings: [{ kind: 'center', x: 4, y: 14 }],
    warps: [
      { x: 10, y: 0, to: 'ruins', tx: 10, ty: 11, dir: 'up', if: { cleared: true }, deny: '붉은 안개가 짙어 앞이 보이지 않는다…' },
      { x: 11, y: 0, to: 'ruins', tx: 11, ty: 11, dir: 'up', if: { cleared: true }, deny: '붉은 안개가 짙어 앞이 보이지 않는다…' },
      { x: 12, y: 0, to: 'ruins', tx: 11, ty: 11, dir: 'up', if: { cleared: true }, deny: '붉은 안개가 짙어 앞이 보이지 않는다…' },
      { x: 9, y: 22, to: 'temple', tx: 10, ty: 1, dir: 'down' },
      { x: 10, y: 22, to: 'temple', tx: 10, ty: 1, dir: 'down' },
      { x: 11, y: 22, to: 'temple', tx: 11, ty: 1, dir: 'down' }
    ],
    npcs: [
      { id: 's_guardian', x: 10, y: 2, dir: 'down', kind: 'mon', mon: 'metal', size: 2.4, script: 'guardian' },
      { id: 's_t1', x: 8, y: 12, dir: 'right', look: 'hiker', trainer: 't_summit_1', sight: 2 }
    ],
    signs: [],
    items: []
  };

  MAPS.ruins = {
    name: '붉은 달 폐허', theme: 'ruins', area: 'ruins',
    tiles: [
      'TTTTTTTTTTTTTTTTTTTTTT',
      'T,,,,,,..rr..,,,,,,,,T',
      'T,,,,,,........,,,,,,T',
      'T,,..r...,,,,...r..,,T',
      'T,,......,,,,......,,T',
      'T....LL..........LL..T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T,,,,,,,,,,,,,,,,,,,,T',
      'T...r.....pp.....r...T',
      'T,,,,,....pp....,,,,,T',
      'T,,,,,....pp....,,,,,T',
      'T.........pp.........T',
      'TTTTTTTTTTppTTTTTTTTTT'
    ],
    buildings: [],
    warps: [
      { x: 10, y: 12, to: 'summit', tx: 10, ty: 1, dir: 'down' },
      { x: 11, y: 12, to: 'summit', tx: 11, ty: 1, dir: 'down' }
    ],
    npcs: [
      { id: 'r_rival', x: 7, y: 11, dir: 'right', look: 'rival', script: 'ruins_rival' }
    ],
    signs: [],
    items: [{ id: 'ruins_candy', x: 20, y: 1, item: 'candy', n: 2 }]
  };

  /* ── 스크립트 ──
     명령: { say, who } · { if: 조건, then: [...], else: [...] } · { flag } · { give, n } · { take, n } · { money }
           · { heal } · { battle: 트레이너 id, gym: 지역 id, canLose } · { choice: 질문, yes: [...], no: [...] }
           · { emote: '!' } · { ending: true }
     문장 안의 {starter} {dex} {money} 는 화면이 바꿔 넣는다. */
  var SCRIPTS = {
    intro: [
      { who: '캣박사', say: '오, 일어났구나! 오늘부터 {starter}(이)가 너의 파트너란다.' },
      { who: '캣박사', say: '포캣몬은 수풀에서 만날 수 있어. 약하게 만든 뒤 포캣볼을 던지면 친구가 되지.' },
      { who: '하루', say: '박사님! 저도 파트너 받았어요! …야, 우리 첫 승부 해 보자!' },
      { battle: 'rival_1', canLose: true },
      { who: '하루', say: '좋아, 앞으로 계속 겨뤄 보자고! 난 먼저 간다!' },
      { who: '캣박사', say: '좋은 승부였어. 이 포캣볼을 가져가렴.' },
      { give: 'ball', n: 5 },
      { who: '캣박사', say: '북쪽 햇살 풀숲에 관장 초롱이 있단다. 배지 6개를 모으면 정상의 수호자를 만날 수 있지.' },
      { flag: 'intro' }
    ],
    professor: [
      { who: '캣박사', say: '도감은 잘 채우고 있니? 지금 {dex}종을 잡았구나!' },
      { if: { dexCaught: 38 }, then: [{ who: '캣박사', say: '대단해! 도감을 완성했구나. 너야말로 진짜 포캣몬 박사다!' }],
        else: [{ who: '캣박사', say: '진화하면 도감에 새로 등록돼. 레벨을 올려 보렴.' }] }
    ],
    home_elder: [{ who: '할머니', say: '모험 떠나기 전에 센터에 들르렴. 회복은 언제나 공짜란다.' }],
    home_kid: [{ who: '꼬마', say: '파티에는 3마리까지만 데리고 다닐 수 있대! 나머지는 보관함으로 간대.' }],

    forest_girl: [
      { if: { flag: 'bell_done' }, then: [{ who: '소녀', say: '방울 찾아줘서 고마워! 우리 고양이가 정말 좋아해.' }],
        else: [{ if: { item: 'bell' }, then: [
          { who: '소녀', say: '어? 그거 우리 고양이 방울이야! 찾아줬구나, 고마워!' },
          { take: 'bell' }, { give: 'ball', n: 5 }, { give: 'catnip', n: 2 }, { flag: 'bell_done' }
        ], else: [{ who: '소녀', say: '우리 고양이 방울 목걸이를 잃어버렸어… 남쪽 수풀 어딘가에 있을 텐데.' }] }] }
    ],
    forest_old: [{ who: '할아버지', say: '관장 초롱은 벌레·노말·풀 포캣몬을 쓰지. 불꽃이나 비행, 얼음 기술이 잘 통한다네.' }],
    coast_fisher: [
      { if: { flag: 'fisher_done' }, then: [{ who: '낚시꾼', say: '날개냥은 언제 봐도 멋지단 말이야.' }],
        else: [{ if: { caught: 'wing' }, then: [
          { who: '낚시꾼', say: '오오, 날개냥을 잡았구나! 정말 멋져. 이 참치 통조림을 주마.' },
          { give: 'tuna', n: 2 }, { flag: 'fisher_done' }
        ], else: [{ who: '낚시꾼', say: '날개냥을 잡아서 보여주면 좋은 걸 주지. 해안 수풀에 산다네.' }] }] }
    ],
    coast_kid: [{ who: '꼬마', say: '실버볼은 포캣볼보다 잘 잡혀! 배지가 있으면 상점에서 팔아.' }],
    volcano_researcher: [
      { if: { flag: 'crystal_done' }, then: [{ who: '연구원', say: '그 결정 덕분에 연구가 술술 풀리고 있어!' }],
        else: [{ if: { item: 'crystal' }, then: [
          { who: '연구원', say: '그건 화산 결정! 붉은 달의 기운이 깃들어 있어… 연구에 쓰게 해 주렴. 답례로 이걸 줄게.' },
          { take: 'crystal' }, { give: 'candy', n: 2 }, { flag: 'crystal_done' }
        ], else: [{ who: '연구원', say: '화산 어딘가에 붉게 빛나는 결정이 있다던데… 찾으면 가져다주겠니?' }] }] }
    ],
    volcano_cloak: [
      { emote: '…' },
      { who: '붉은 망토', say: '…붉은 달이 차오르고 있다. 정상의 수호자라 해도 언제까지 버틸 수 있을까.' },
      { flag: 'cloak1' }
    ],
    glacier_assist: [
      { if: { flag: 'assist_done' }, then: [{ who: '조수', say: '박사님께도 네 이야기를 전해 뒀어!' }],
        else: [{ if: { dexCaught: 12 }, then: [
          { who: '조수', say: '벌써 12종이나 잡았구나! 박사님 대신 이걸 줄게.' },
          { give: 'goldball', n: 3 }, { flag: 'assist_done' }
        ], else: [{ who: '조수', say: '도감에 12종을 잡아 등록하면 선물을 줄게. 지금은 {dex}종이네.' }] }] }
    ],
    glacier_hint: [{ who: '스키어', say: '강철 타입은 불꽃·격투·땅 기술에 약해. 정상의 수호자도 강철이라던데?' }],
    alley_owner: [
      { if: { flag: 'owner_done' }, then: [{ who: '할아버지', say: '그 녀석, 말은 안 들어도 정은 많은 녀석이야.' }],
        else: [{ if: { caught: 'ssaga' }, then: [
          { who: '할아버지', say: '오, 싸가지냥이로구나! 예전에 내가 밥을 주던 녀석이랑 닮았어. 이걸 받게나.' },
          { give: 'matatabi', n: 2 }, { flag: 'owner_done' }
        ], else: [{ who: '할아버지', say: '이 골목에는 싸가지냥이 살아. 밥만 먹고 도망가지. 잡으면 보여주게나.' }] }] }
    ],
    alley_cloak: [
      { emote: '…' },
      { who: '붉은 망토', say: '수호자가 지켜 온 약한 것들… 정말 지킬 가치가 있었을까?' },
      { who: '붉은 망토', say: '정상에 가면 알게 되겠지. 붉은 달 아래에서.' },
      { flag: 'cloak2' }
    ],
    temple_elder: [
      { who: '장로', say: '아주 옛날, 은빛 늑대 메탈가디언몬이 이 땅의 약한 포캣몬들을 지켰단다.' },
      { who: '장로', say: '하지만 붉은 달이 뜨는 밤이면 그 마음에 그림자가 드리운다고 하지…' },
      { if: { flag: 'elder_done' }, then: [],
        else: [{ if: { dexCaught: 24 }, then: [
          { who: '장로', say: '24종이나 되는 포캣몬과 마음을 나눴구나. 이 사탕을 가져가거라.' },
          { give: 'candy', n: 3 }, { flag: 'elder_done' }
        ], else: [{ who: '장로', say: '포캣몬 24종과 마음을 나누면 다시 오거라. 지금은 {dex}종이구나.' }] }] }
    ],
    guardian: [
      { if: { cleared: true }, then: [
        { who: '메탈가디언몬', say: '…고맙다. 덕분에 나를 되찾았다.' },
        { who: '메탈가디언몬', say: '북쪽 폐허에는 아직 붉은 달의 기운이 남아 있다. 강해진 너라면 괜찮겠지.' }
      ], else: [
        { who: '메탈가디언몬', say: '약한 건 내가 지킨다. 강한 놈은 내가 막는다.' },
        { choice: '정상의 수호자에게 도전할까?', yes: [{ battle: 'gym_summit', gym: 'summit' }, { ending: true }],
          no: [{ who: '메탈가디언몬', say: '준비가 되면 다시 오너라.' }] }
      ] }
    ],
    ruins_rival: [
      { who: '하루', say: '여기가 붉은 달 폐허구나. 메탈가디언몬도 블랙 메탈가디언몬도 여기서 만날 수 있대!' },
      { who: '하루', say: '도감을 다 채우면 나한테도 꼭 보여줘. 그때 다시 승부하자!' }
    ]
  };

  var api = { LEGEND: LEGEND, BUILDINGS: BUILDINGS, LOOKS: LOOKS, MAPS: MAPS, SCRIPTS: SCRIPTS, doorOf: doorOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PMaps = api;
})(typeof window !== 'undefined' ? window : globalThis);
