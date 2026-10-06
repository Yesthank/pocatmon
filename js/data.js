/* 포캣몬 데이터 — 수치는 모두 조정 가능한 기본값(밸런스 결과: docs/balance.md) */
(function (root) {
  'use strict';

  var TYPES = {
    water: { name: '물', color: '#2f8ff0' },
    ice: { name: '얼음', color: '#4cc3e8' },
    steel: { name: '강철', color: '#8592ab' },
    dark: { name: '악', color: '#8b2f6b' },
    normal: { name: '노말', color: '#9a8f7e' }
  };

  // 공격 타입 → 방어 타입 배율 (없는 조합은 ×1)
  var CHART = {
    water: { steel: 2, water: 0.5 },
    ice: { water: 2, ice: 0.5 },
    steel: { ice: 2, dark: 2, steel: 0.5 },
    dark: { ice: 2, dark: 0.5 },
    normal: {}
  };

  // kind: atk | heal | shield
  var MOVES = {
    watergun: { name: '물대포', type: 'water', kind: 'atk', power: 45, acc: 100, priority: 1, fx: 'water', desc: '꼬리에 맺힌 물방울을 고압으로 발사한다. 상대보다 먼저 공격한다.' },
    splash: { name: '물놀이', type: 'water', kind: 'atk', power: 35, acc: 100, fx: 'water', defDown: 1, desc: '상대를 흠뻑 적셔 방어를 떨어뜨린다.' },
    hydropump: { name: '하이드로펌프', type: 'water', kind: 'atk', power: 90, acc: 80, fx: 'water', special: true, desc: '엄청난 기세로 물줄기를 쏘아 공격한다.' },
    bubbleheal: { name: '물방울 치유', type: 'water', kind: 'heal', heal: 0.35, fx: 'heal', desc: '맑은 물방울로 체력을 35% 회복한다.' },

    snowball: { name: '얼음뭉치', type: 'ice', kind: 'atk', power: 55, acc: 100, fx: 'ice', desc: '얼음 덩어리를 만들어 던진다.' },
    blizzard: { name: '눈보라', type: 'ice', kind: 'atk', power: 65, acc: 85, fx: 'ice', freeze: 0.2, desc: '강한 눈보라를 일으킨다. 20% 확률로 상대를 얼린다.' },
    iceshield: { name: '얼음보호막', type: 'ice', kind: 'shield', fx: 'shield', desc: '얼음으로 몸을 감싸 2턴 동안 받는 피해를 줄인다.' },
    freezebeam: { name: '프리즈빔', type: 'ice', kind: 'atk', power: 80, acc: 90, fx: 'ice', freeze: 0.35, special: true, desc: '차가운 빔을 쏜다. 35% 확률로 상대를 얼린다.' },

    wallhop: { name: '담 넘기', type: 'dark', kind: 'atk', power: 40, acc: 100, priority: 1, fx: 'dark', desc: '남의 집 담을 넘어 기습한다. 상대보다 먼저 공격한다.' },
    trashdig: { name: '쓰레기 뒤지기', type: 'normal', kind: 'heal', heal: 0.3, atkUp: 1, fx: 'heal', desc: '쓰레기봉투를 뒤져 체력을 30% 회복하고, 공격이 오른다.' },
    nyanpunch: { name: '냥펀치', type: 'dark', kind: 'atk', power: 55, acc: 100, fx: 'dark', flinch: 0.2, desc: '발톱으로 할퀸다. 20% 확률로 상대를 풀죽게 한다.' },
    betray: { name: '배신하기', type: 'normal', kind: 'atk', power: 75, acc: 90, fx: 'normal', atkDown: 1, special: true, desc: '밥만 얻어먹고 배신한다. 상대의 공격을 떨어뜨린다.' },

    metalimpact: { name: '메탈 임팩트', type: 'steel', kind: 'atk', power: 70, acc: 95, fx: 'steel', special: true, desc: '강력한 금속의 힘으로 들이받는다.' },
    guardianshield: { name: '가디언 실드', type: 'steel', kind: 'shield', fx: 'shield', desc: '방패를 펼쳐 2턴 동안 받는 피해를 줄인다.' },
    speedattack: { name: '스피드 어택', type: 'steel', kind: 'atk', power: 22, acc: 100, priority: 1, hits: [2, 3], fx: 'steel', desc: '날카로운 스피드로 2~3회 연속 공격한다. 상대보다 먼저 공격한다.' },
    kindguard: { name: '다정한 수호자', type: 'steel', kind: 'heal', heal: 0.35, cure: true, fx: 'heal', desc: '체력을 35% 회복하고, 떨어진 능력을 원래대로 되돌린다.' },

    darkslash: { name: '다크 메탈 슬래시', type: 'dark', kind: 'atk', power: 60, acc: 100, highCrit: true, fx: 'dark', desc: '검게 물든 발톱으로 벤다. 급소에 잘 맞는다.' },
    blackshield: { name: '블랙 가디언 실드', type: 'dark', kind: 'shield', fx: 'shield', desc: '어둠의 방어막으로 2턴 동안 받는 피해를 줄인다.' },
    darkspeed: { name: '다크니스 스피드', type: 'dark', kind: 'atk', power: 25, acc: 100, priority: 1, hits: [2, 3], fx: 'dark', desc: '어둠의 힘을 두르고 2~3회 돌진한다. 상대보다 먼저 공격한다.' },
    deathimpact: { name: '데스 임팩트', type: 'steel', kind: 'atk', power: 100, acc: 85, recoil: 0.25, fx: 'steel', special: true, desc: '모든 힘을 실어 일격을 날린다. 준 피해의 25%를 반동으로 받는다.' }
  };

  var MONSTERS = {
    naru: {
      name: '나루냥', types: ['water'], cat: true, height: 0.4, bg: 'sea',
      base: { hp: 118, atk: 60, def: 72, spd: 88 },
      moves: ['watergun', 'splash', 'hydropump', 'bubbleheal'],
      blurb: '물가를 좋아하는 고양이 포켓몬이다. 꼬리에 맺힌 물방울로 장난치기를 좋아한다.',
      lines: {
        intro: ['물놀이 하자냥~!', '반짝반짝, 물방울 발사 준비 완료다냥!'],
        special: ['물방울 가득 담아서… 발사다냥!'],
        faint: ['으냥… 물에 빠졌다냥…'],
        win: ['헤헤, 깨끗해졌다냥!']
      }
    },
    seol: {
      name: '설냥이', types: ['ice'], cat: true, height: 0.5, bg: 'ice',
      base: { hp: 115, atk: 60, def: 72, spd: 84 },
      moves: ['snowball', 'blizzard', 'iceshield', 'freezebeam'],
      blurb: '차가운 눈송이를 품은 순백의 고양이 포켓몬이다. 겨울의 요정처럼 아름답다.',
      lines: {
        intro: ['차가운 눈송이를 품고 왔어.', '눈길에서도 나는 자유로워.'],
        special: ['얼어붙어라… 프리즈빔!'],
        faint: ['눈이… 녹아버렸어…'],
        win: ['겨울의 요정이 이겼어.']
      }
    },
    ssaga: {
      name: '싸가지냥', types: ['dark', 'normal'], cat: true, height: 0.4, bg: 'alley',
      base: { hp: 100, atk: 52, def: 58, spd: 90 },
      moves: ['wallhop', 'trashdig', 'nyanpunch', 'betray'],
      blurb: '남의 집 담을 넘나드는 인성 쓰레기 길고양이 포켓몬이다. 밥을 줘도 은혜를 모른다.',
      lines: {
        intro: ['뭐? 너 또 보는거야? 짜증나…', '밥은 주지마… 그냥 내꺼야…'],
        special: ['귀엽지 않다. 무섭지도 않다. 그냥… 패고 싶다.'],
        faint: ['…다음엔 담 넘어 도망간다.'],
        win: ['흥. 밥이나 내놔.']
      }
    },
    metal: {
      name: '메탈가디언몬', types: ['steel'], cat: false, height: 1.2, bg: 'metal',
      base: { hp: 146, atk: 58, def: 78, spd: 64 },
      moves: ['metalimpact', 'guardianshield', 'speedattack', 'kindguard'],
      blurb: '의리와 예절을 중시하는 강인한 금속의 신념, 그것이 바로 메탈가디언몬이다. 약자에게 다정하고 강자에게 엄격하다.',
      lines: {
        intro: ['약한 건 내가 지킨다. 강한 놈은 내가 막는다.'],
        special: ['의리는 나의 힘이다!'],
        faint: ['지키고 싶은 것이… 있었는데…'],
        win: ['지키고 싶은 것이 있다면, 나는 반드시 그 곁에 선다.']
      }
    },
    black: {
      name: '블랙 메탈가디언몬', types: ['dark', 'steel'], cat: false, height: 1.2, bg: 'dark',
      base: { hp: 116, atk: 64, def: 84, spd: 74 },
      moves: ['darkslash', 'blackshield', 'darkspeed', 'deathimpact'],
      blurb: '어둠의 힘에 물들어 흑화한 메탈가디언몬이다. 의리와 정의는 강자에게만 존재한다고 믿는다.',
      lines: {
        intro: ['정의…? 그게 뭐지? 그저 강한 놈이 살아남는 거지.'],
        special: ['약한 것들은, 더 이상 지킬 가치가 없어.'],
        faint: ['…이 세상은… 강한 자만이…'],
        win: ['강해져라. 그게 너의 선택이다.']
      }
    }
  };

  // 컷신 대본 (who: 'metal' | 'black' | 'player')
  var CUTSCENES = {
    corrupt: [
      { who: 'metal', text: '…약한 것들을… 지켜왔는데…' },
      { who: 'fx', text: '붉은 달이 떠오른다…' },
      { who: 'black', text: '…약한 것들은, 더 이상 지킬 가치가 없어.' },
      { who: 'black', text: '이 세상은 강한 자만이 살아남는 거야.' }
    ],
    shadow: [
      { who: 'metal', text: '…? 내 그림자가… 움직인다?' },
      { who: 'fx', text: '그림자가 붉은 어둠을 머금고 일어선다…' },
      { who: 'black', text: '정의…? 그게 뭐지? 그저 강한 놈이 살아남는 거지.' }
    ],
    face: [
      { who: 'metal', text: '약한 건 내가 지킨다. 강한 놈은 내가 막는다.' },
      { who: 'black', text: '…과거의 나인가. 그 의리, 여기서 끝내주지.' },
      { who: 'metal', text: '의리는 나의 힘이다. 너를 되찾겠다!' }
    ]
  };

  var TUNING = {
    dmgScale: 0.30,      // 피해 = (위력 × 공/방 × dmgScale + 2) × 배율
    stab: 1.5,
    crit: 1 / 16, highCrit: 1 / 4, critMult: 1.5,
    levelGrowth: 1.15,   // 레벨 1당 능력치 배율
    startLevel: 5,
    enemyMult: [0.90, 0.95, 0.95, 1.15],
    shinyRate: 0.1,
    shieldTurns: 2, shieldMult: 0.5,
    stageMax: 3
  };

  var api = { TYPES: TYPES, CHART: CHART, MOVES: MOVES, MONSTERS: MONSTERS, CUTSCENES: CUTSCENES, TUNING: TUNING, CATS: ['naru', 'seol', 'ssaga'] };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PData = api;
})(typeof window !== 'undefined' ? window : globalThis);
