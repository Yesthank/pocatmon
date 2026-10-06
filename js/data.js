/* 포캣몬 데이터 — 수치는 모두 조정 가능한 기본값(밸런스 결과: docs/balance.md)
   전투 규칙은 실제 포켓몬(5세대 이후 공식, 6세대 이후 상성표)을 따른다. 특성·도구·날씨는 없다. */
(function (root) {
  'use strict';

  /* ── 타입 (현대 18타입) ── */
  var TYPES = {
    normal: { name: '노말', color: '#9a8f7e' },
    fire: { name: '불꽃', color: '#e8542c' },
    water: { name: '물', color: '#2f8ff0' },
    electric: { name: '전기', color: '#e8b818' },
    grass: { name: '풀', color: '#3fa63c' },
    ice: { name: '얼음', color: '#4cc3e8' },
    fighting: { name: '격투', color: '#e0761c' },
    poison: { name: '독', color: '#9341c9' },
    ground: { name: '땅', color: '#a8692c' },
    flying: { name: '비행', color: '#6fa8e8' },
    psychic: { name: '에스퍼', color: '#ec4c84' },
    bug: { name: '벌레', color: '#8fa21a' },
    rock: { name: '바위', color: '#a89a6a' },
    ghost: { name: '고스트', color: '#6a4a9a' },
    dragon: { name: '드래곤', color: '#5464dc' },
    dark: { name: '악', color: '#8b2f6b' },
    steel: { name: '강철', color: '#8592ab' },
    fairy: { name: '페어리', color: '#e46ad8' }
  };

  // 공격 타입 → 방어 타입 배율 (6세대 이후 상성표, 없는 조합은 ×1)
  var CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
  };

  // 상태이상
  var STATUS = {
    brn: { name: '화상', short: '화상', color: '#e8542c' },
    psn: { name: '독', short: '독', color: '#9341c9' },
    tox: { name: '맹독', short: '맹독', color: '#6a1f9a' },
    par: { name: '마비', short: '마비', color: '#d8a810' },
    slp: { name: '잠듦', short: '잠듦', color: '#7a8296' },
    frz: { name: '얼음', short: '얼음', color: '#4cc3e8' }
  };
  var STAT_NAMES = { atk: '공격', def: '방어', spa: '특수공격', spd: '특수방어', spe: '스피드', acc: '명중률', eva: '회피율' };

  /* ── 기술 ──
     cat: phys(물리) | spec(특수) | status(변화)
     acc: null이면 반드시 맞는다. pp: 최대 사용 횟수. priority: 우선도.
     부가효과: status/statusChance(%) · confuse(%) · flinch(%) · self{능력:단계}/selfChance · foe{능력:단계}/foeChance
              heal(최대 HP 비율) · drain(준 피해 비율) · recoil(준 피해 비율) · highCrit · hits([최소,최대] 또는 고정 수)
              screen(5턴 동안 받는 피해 절반) · breakScreen · cure(자기 능력 하락 해제) · powder(풀 타입 무효) · checkType(상성 무효 적용)
     ult: 필살기(대사 말풍선) */
  var MOVES = {
    // 나루냥 (물)
    watergun: { name: '물대포', type: 'water', cat: 'spec', power: 40, acc: 100, pp: 25, priority: 1, desc: '꼬리에 맺힌 물방울을 고압으로 발사한다. 상대보다 먼저 공격한다.' },
    splash: { name: '물놀이', type: 'water', cat: 'spec', power: 45, acc: 100, pp: 20, foe: { spd: -1 }, desc: '상대를 흠뻑 적셔 특수방어를 떨어뜨린다.' },
    hydropump: { name: '하이드로펌프', type: 'water', cat: 'spec', power: 110, acc: 80, pp: 5, ult: true, desc: '엄청난 기세로 물줄기를 쏘아 공격한다.' },
    bubbleheal: { name: '물방울 치유', type: 'water', cat: 'status', acc: null, pp: 10, heal: 0.5, desc: '맑은 물방울로 최대 체력의 절반을 회복한다.' },
    // 설냥이 (얼음)
    snowball: { name: '얼음뭉치', type: 'ice', cat: 'spec', power: 45, acc: 100, pp: 25, status: 'frz', statusChance: 10, desc: '얼음 덩어리를 만들어 던진다. 10% 확률로 얼린다.' },
    blizzard: { name: '눈보라', type: 'ice', cat: 'spec', power: 65, acc: 95, pp: 15, foe: { spe: -1 }, foeChance: 30, desc: '강한 눈보라를 일으킨다. 30% 확률로 스피드를 떨어뜨린다.' },
    iceshield: { name: '얼음보호막', type: 'ice', cat: 'status', acc: null, pp: 10, screen: true, desc: '얼음으로 몸을 감싸 5턴 동안 받는 피해를 절반으로 줄인다.' },
    freezebeam: { name: '프리즈빔', type: 'ice', cat: 'spec', power: 90, acc: 100, pp: 10, status: 'frz', statusChance: 10, ult: true, desc: '차가운 빔을 쏜다. 10% 확률로 상대를 얼린다.' },
    // 싸가지냥 (악·노말)
    wallhop: { name: '담 넘기', type: 'dark', cat: 'phys', power: 40, acc: 100, pp: 25, priority: 1, desc: '남의 집 담을 넘어 기습한다. 상대보다 먼저 공격한다.' },
    trashdig: { name: '쓰레기 뒤지기', type: 'normal', cat: 'status', acc: null, pp: 10, heal: 0.35, self: { atk: 1 }, desc: '쓰레기봉투를 뒤져 체력을 35% 회복하고, 공격이 오른다.' },
    nyanpunch: { name: '냥펀치', type: 'dark', cat: 'phys', power: 65, acc: 100, pp: 20, flinch: 20, desc: '발톱으로 할퀸다. 20% 확률로 상대를 풀죽게 한다.' },
    betray: { name: '배신하기', type: 'normal', cat: 'phys', power: 85, acc: 90, pp: 10, foe: { atk: -1 }, ult: true, desc: '밥만 얻어먹고 배신한다. 상대의 공격을 떨어뜨린다.' },
    // 메탈가디언몬 (강철)
    metalimpact: { name: '메탈 임팩트', type: 'steel', cat: 'phys', power: 90, acc: 95, pp: 10, ult: true, desc: '강력한 금속의 힘으로 들이받는다.' },
    guardianshield: { name: '가디언 실드', type: 'steel', cat: 'status', acc: null, pp: 10, screen: true, desc: '방패를 펼쳐 5턴 동안 받는 피해를 절반으로 줄인다.' },
    speedattack: { name: '스피드 어택', type: 'steel', cat: 'phys', power: 20, acc: 100, pp: 15, priority: 1, hits: [2, 5], desc: '날카로운 스피드로 2~5회 연속 공격한다. 상대보다 먼저 공격한다.' },
    kindguard: { name: '다정한 수호자', type: 'steel', cat: 'status', acc: null, pp: 10, heal: 0.5, cure: true, desc: '체력을 절반 회복하고, 떨어진 능력을 원래대로 되돌린다.' },
    // 블랙 메탈가디언몬 (악·강철)
    darkslash: { name: '다크 메탈 슬래시', type: 'dark', cat: 'phys', power: 75, acc: 100, pp: 15, highCrit: true, desc: '검게 물든 발톱으로 벤다. 급소에 잘 맞는다.' },
    blackshield: { name: '블랙 가디언 실드', type: 'dark', cat: 'status', acc: null, pp: 10, screen: true, desc: '어둠의 방어막으로 5턴 동안 받는 피해를 절반으로 줄인다.' },
    darkspeed: { name: '다크니스 스피드', type: 'dark', cat: 'phys', power: 20, acc: 100, pp: 15, priority: 1, hits: [2, 5], desc: '어둠의 힘을 두르고 2~5회 돌진한다. 상대보다 먼저 공격한다.' },
    deathimpact: { name: '데스 임팩트', type: 'steel', cat: 'phys', power: 120, acc: 85, pp: 5, recoil: 1 / 3, ult: true, desc: '모든 힘을 실어 일격을 날린다. 준 피해의 1/3을 반동으로 받는다.' },

    // 치즈냥 (노말)
    tackle: { name: '몸통박치기', type: 'normal', cat: 'phys', power: 40, acc: 100, pp: 35, desc: '통통한 몸으로 힘껏 부딪친다.' },
    tailwhip: { name: '꼬리흔들기', type: 'normal', cat: 'status', acc: 100, pp: 30, foe: { def: -1 }, desc: '꼬리를 귀엽게 흔들어 상대의 방어를 떨어뜨린다.' },
    catnap: { name: '낮잠', type: 'normal', cat: 'status', acc: null, pp: 10, heal: 0.5, desc: '햇볕 아래에서 잠깐 졸아 최대 체력의 절반을 회복한다.' },
    cheesetackle: { name: '치즈 태클', type: 'normal', cat: 'phys', power: 100, acc: 100, pp: 10, recoil: 0.25, ult: true, desc: '온몸을 던져 돌진한다. 준 피해의 1/4을 반동으로 받는다.' },
    // 화르냥 (불꽃)
    ember: { name: '불꽃세례', type: 'fire', cat: 'spec', power: 40, acc: 100, pp: 25, status: 'brn', statusChance: 10, desc: '작은 불꽃을 뿜는다. 10% 확률로 화상을 입힌다.' },
    willowisp: { name: '도깨비불', type: 'fire', cat: 'status', acc: 85, pp: 15, status: 'brn', desc: '으스스한 불꽃으로 상대를 화상 상태로 만든다.' },
    flamewheel: { name: '화염바퀴', type: 'fire', cat: 'phys', power: 60, acc: 100, pp: 25, status: 'brn', statusChance: 10, desc: '불꽃을 두르고 굴러 돌진한다. 10% 확률로 화상을 입힌다.' },
    flamethrower: { name: '화염방사', type: 'fire', cat: 'spec', power: 90, acc: 100, pp: 15, status: 'brn', statusChance: 10, ult: true, desc: '세찬 불꽃을 내뿜는다. 10% 확률로 화상을 입힌다.' },
    // 잎새냥 (풀)
    vinewhip: { name: '덩굴채찍', type: 'grass', cat: 'phys', power: 45, acc: 100, pp: 25, desc: '꼬리의 덩굴을 채찍처럼 휘두른다.' },
    sleeppowder: { name: '수면가루', type: 'grass', cat: 'status', acc: 75, pp: 15, status: 'slp', powder: true, desc: '졸음이 오는 가루를 뿌려 상대를 잠들게 한다.' },
    gigadrain: { name: '기가드레인', type: 'grass', cat: 'spec', power: 75, acc: 100, pp: 10, drain: 0.5, desc: '상대의 양분을 빨아들인다. 준 피해의 절반만큼 회복한다.' },
    leafblade: { name: '리프블레이드', type: 'grass', cat: 'phys', power: 90, acc: 100, pp: 15, highCrit: true, ult: true, desc: '잎사귀를 칼처럼 휘두른다. 급소에 잘 맞는다.' },
    // 찌릿냥 (전기)
    thundershock: { name: '전기쇼크', type: 'electric', cat: 'spec', power: 40, acc: 100, pp: 30, status: 'par', statusChance: 10, desc: '전기를 흘려 공격한다. 10% 확률로 마비시킨다.' },
    thunderwave: { name: '전기자석파', type: 'electric', cat: 'status', acc: 90, pp: 20, status: 'par', checkType: true, desc: '약한 전기를 흘려 상대를 마비시킨다.' },
    spark: { name: '스파크', type: 'electric', cat: 'phys', power: 65, acc: 100, pp: 20, status: 'par', statusChance: 30, desc: '전기를 두르고 부딪친다. 30% 확률로 마비시킨다.' },
    thunderbolt: { name: '10만볼트', type: 'electric', cat: 'spec', power: 90, acc: 100, pp: 15, status: 'par', statusChance: 10, ult: true, desc: '강한 전격을 날린다. 10% 확률로 마비시킨다.' },
    // 주먹냥 (격투)
    machpunch: { name: '마하펀치', type: 'fighting', cat: 'phys', power: 40, acc: 100, pp: 30, priority: 1, desc: '눈에 보이지 않는 속도로 주먹을 날린다. 상대보다 먼저 공격한다.' },
    bulkup: { name: '벌크업', type: 'fighting', cat: 'status', acc: null, pp: 20, self: { atk: 1, def: 1 }, desc: '근육을 부풀려 공격과 방어를 올린다.' },
    brickbreak: { name: '깨트리기', type: 'fighting', cat: 'phys', power: 75, acc: 100, pp: 15, breakScreen: true, desc: '손날로 내려친다. 상대의 보호막을 깨뜨린다.' },
    closecombat: { name: '인파이트', type: 'fighting', cat: 'phys', power: 120, acc: 100, pp: 5, self: { def: -1, spd: -1 }, ult: true, desc: '방어를 버리고 몸을 붙여 싸운다. 자신의 방어와 특수방어가 떨어진다.' },
    // 독냥이 (독)
    acid: { name: '애시드', type: 'poison', cat: 'spec', power: 40, acc: 100, pp: 30, foe: { spd: -1 }, foeChance: 10, desc: '산성 액체를 뿌린다. 10% 확률로 특수방어를 떨어뜨린다.' },
    toxic: { name: '맹독', type: 'poison', cat: 'status', acc: 90, pp: 10, status: 'tox', desc: '상대를 맹독 상태로 만든다. 턴이 지날수록 독 피해가 커진다.' },
    poisonjab: { name: '독찌르기', type: 'poison', cat: 'phys', power: 80, acc: 100, pp: 20, status: 'psn', statusChance: 30, desc: '독이 묻은 꼬리로 찌른다. 30% 확률로 독 상태로 만든다.' },
    sludgebomb: { name: '오물폭탄', type: 'poison', cat: 'spec', power: 90, acc: 100, pp: 10, status: 'psn', statusChance: 30, ult: true, desc: '오물 덩어리를 던진다. 30% 확률로 독 상태로 만든다.' },
    // 모래냥 (땅)
    sandattack: { name: '모래뿌리기', type: 'ground', cat: 'status', acc: 100, pp: 15, foe: { acc: -1 }, desc: '얼굴에 모래를 뿌려 명중률을 떨어뜨린다.' },
    mudshot: { name: '머드샷', type: 'ground', cat: 'spec', power: 55, acc: 95, pp: 15, foe: { spe: -1 }, desc: '진흙을 쏘아 맞힌다. 상대의 스피드를 떨어뜨린다.' },
    bonemerang: { name: '뼈다귀부메랑', type: 'ground', cat: 'phys', power: 50, acc: 90, pp: 10, hits: 2, desc: '뼈다귀를 던져 2번 맞힌다.' },
    earthquake: { name: '지진', type: 'ground', cat: 'phys', power: 100, acc: 100, pp: 10, ult: true, desc: '땅을 울려 큰 지진을 일으킨다.' },
    // 날개냥 (비행)
    gust: { name: '바람일으키기', type: 'flying', cat: 'spec', power: 40, acc: 100, pp: 35, desc: '날개로 세찬 바람을 일으킨다.' },
    wingattack: { name: '날개치기', type: 'flying', cat: 'phys', power: 60, acc: 100, pp: 35, desc: '커다란 날개를 펼쳐 내려친다.' },
    roost: { name: '날개쉬기', type: 'flying', cat: 'status', acc: null, pp: 10, heal: 0.5, desc: '날개를 접고 쉬어 최대 체력의 절반을 회복한다.' },
    bravebird: { name: '브레이브버드', type: 'flying', cat: 'phys', power: 120, acc: 100, pp: 15, recoil: 1 / 3, ult: true, desc: '날개를 접고 저공 돌진한다. 준 피해의 1/3을 반동으로 받는다.' },
    // 텔레냥 (에스퍼)
    confusion: { name: '염동력', type: 'psychic', cat: 'spec', power: 50, acc: 100, pp: 25, confuse: 10, desc: '염동력으로 공격한다. 10% 확률로 혼란에 빠뜨린다.' },
    calmmind: { name: '명상', type: 'psychic', cat: 'status', acc: null, pp: 20, self: { spa: 1, spd: 1 }, desc: '마음을 가라앉혀 특수공격과 특수방어를 올린다.' },
    hypnosis: { name: '최면술', type: 'psychic', cat: 'status', acc: 60, pp: 20, status: 'slp', desc: '최면을 걸어 상대를 잠들게 한다.' },
    psychic: { name: '사이코키네시스', type: 'psychic', cat: 'spec', power: 90, acc: 100, pp: 10, foe: { spd: -1 }, foeChance: 10, ult: true, desc: '강한 염동력을 보낸다. 10% 확률로 특수방어를 떨어뜨린다.' },
    // 나비냥 (벌레)
    bugbite: { name: '벌레먹음', type: 'bug', cat: 'phys', power: 60, acc: 100, pp: 20, desc: '작은 이빨로 콕 깨문다.' },
    stringshot: { name: '실뿜기', type: 'bug', cat: 'status', acc: 95, pp: 40, foe: { spe: -2 }, desc: '끈끈한 실을 감아 상대의 스피드를 크게 떨어뜨린다.' },
    quiverdance: { name: '나비춤', type: 'bug', cat: 'status', acc: null, pp: 20, self: { spa: 1, spd: 1, spe: 1 }, desc: '신비로운 춤으로 특수공격·특수방어·스피드를 올린다.' },
    bugbuzz: { name: '벌레의야단법석', type: 'bug', cat: 'spec', power: 90, acc: 100, pp: 10, foe: { spd: -1 }, foeChance: 10, ult: true, desc: '날갯짓으로 음파를 일으킨다. 10% 확률로 특수방어를 떨어뜨린다.' },
    // 바위냥 (바위)
    rockthrow: { name: '돌떨구기', type: 'rock', cat: 'phys', power: 50, acc: 90, pp: 15, desc: '작은 바위를 들어 던진다.' },
    rockpolish: { name: '바위굳히기', type: 'rock', cat: 'status', acc: null, pp: 15, self: { def: 2 }, desc: '몸을 바위처럼 굳혀 방어를 크게 올린다.' },
    rockslide: { name: '스톤샤워', type: 'rock', cat: 'phys', power: 75, acc: 90, pp: 10, flinch: 30, desc: '큰 바위를 떨어뜨린다. 30% 확률로 풀죽게 한다.' },
    stoneedge: { name: '스톤에지', type: 'rock', cat: 'phys', power: 100, acc: 80, pp: 5, highCrit: true, ult: true, desc: '날카로운 바위로 찌른다. 급소에 잘 맞는다.' },
    // 유령냥 (고스트)
    lick: { name: '핥기', type: 'ghost', cat: 'phys', power: 30, acc: 100, pp: 30, status: 'par', statusChance: 30, desc: '차가운 혀로 핥는다. 30% 확률로 마비시킨다.' },
    confuseray: { name: '이상한빛', type: 'ghost', cat: 'status', acc: 100, pp: 10, confuse: 100, desc: '이상한 빛을 보여 상대를 혼란에 빠뜨린다.' },
    shadowclaw: { name: '섀도클로', type: 'ghost', cat: 'phys', power: 70, acc: 100, pp: 15, highCrit: true, desc: '그림자 발톱으로 할퀸다. 급소에 잘 맞는다.' },
    shadowball: { name: '섀도볼', type: 'ghost', cat: 'spec', power: 80, acc: 100, pp: 15, foe: { spd: -1 }, foeChance: 20, ult: true, desc: '검은 그림자 덩어리를 던진다. 20% 확률로 특수방어를 떨어뜨린다.' },
    // 용냥이 (드래곤)
    dragonbreath: { name: '용의숨결', type: 'dragon', cat: 'spec', power: 60, acc: 100, pp: 20, status: 'par', statusChance: 30, desc: '용의 숨결을 내뿜는다. 30% 확률로 마비시킨다.' },
    dragondance: { name: '용의춤', type: 'dragon', cat: 'status', acc: null, pp: 20, self: { atk: 1, spe: 1 }, desc: '격렬한 춤으로 공격과 스피드를 올린다.' },
    dragonclaw: { name: '드래곤크루', type: 'dragon', cat: 'phys', power: 80, acc: 100, pp: 15, desc: '날카로운 발톱으로 크게 할퀸다.' },
    dracometeor: { name: '용성군', type: 'dragon', cat: 'spec', power: 130, acc: 90, pp: 5, self: { spa: -2 }, ult: true, desc: '하늘에서 유성을 떨어뜨린다. 자신의 특수공격이 크게 떨어진다.' },
    // 철갑냥 (강철)
    metalclaw: { name: '메탈크로', type: 'steel', cat: 'phys', power: 50, acc: 95, pp: 35, self: { atk: 1 }, selfChance: 10, desc: '강철 발톱으로 할퀸다. 10% 확률로 공격이 오른다.' },
    irondefense: { name: '철벽', type: 'steel', cat: 'status', acc: null, pp: 15, self: { def: 2 }, desc: '몸을 강철처럼 단단하게 만들어 방어를 크게 올린다.' },
    ironhead: { name: '아이언헤드', type: 'steel', cat: 'phys', power: 80, acc: 100, pp: 15, flinch: 30, desc: '강철 머리로 들이받는다. 30% 확률로 풀죽게 한다.' },
    flashcannon: { name: '러스터캐논', type: 'steel', cat: 'spec', power: 80, acc: 100, pp: 10, foe: { spd: -1 }, foeChance: 10, ult: true, desc: '몸의 빛을 모아 발사한다. 10% 확률로 특수방어를 떨어뜨린다.' },
    // 리본냥 (페어리)
    fairywind: { name: '요정의바람', type: 'fairy', cat: 'spec', power: 40, acc: 100, pp: 30, desc: '반짝이는 바람을 일으킨다.' },
    charm: { name: '애교부리기', type: 'fairy', cat: 'status', acc: 100, pp: 20, foe: { atk: -2 }, desc: '귀엽게 애교를 부려 상대의 공격을 크게 떨어뜨린다.' },
    drainkiss: { name: '드레인키스', type: 'fairy', cat: 'spec', power: 50, acc: 100, pp: 10, drain: 0.75, desc: '뽀뽀로 기운을 빨아들인다. 준 피해의 3/4만큼 회복한다.' },
    moonblast: { name: '문포스', type: 'fairy', cat: 'spec', power: 95, acc: 100, pp: 15, foe: { spa: -1 }, foeChance: 30, ult: true, desc: '달의 힘을 빌려 공격한다. 30% 확률로 특수공격을 떨어뜨린다.' },

    // 모든 기술의 PP가 바닥났을 때
    struggle: { name: '발버둥', type: 'none', cat: 'phys', power: 50, acc: null, pp: 0, struggle: true, desc: '쓸 수 있는 기술이 없어 발버둥친다. 최대 체력의 1/4을 반동으로 받는다.' }
  };

  /* ── 몬스터 ──
     base: 종족값(hp/atk/def/spa/spd/spe). learn: [기술, 배우는 레벨] — 최대 4개라 잊는 일이 없다.
     catchRate: 포획률(3~255). xp: 기초 경험치. height: 무대 크기(0~1.2). bg: 대표 배경. */
  var MONSTERS = {
    naru: {
      name: '나루냥', types: ['water'], cat: true, height: 0.4, bg: 'sea',
      base: { hp: 75, atk: 55, def: 65, spa: 90, spd: 70, spe: 95 }, catchRate: 45, xp: 70,
      learn: [['watergun', 1], ['splash', 1], ['bubbleheal', 8], ['hydropump', 16]],
      blurb: '물가를 좋아하는 고양이 포캣몬이다. 꼬리에 맺힌 물방울로 장난치기를 좋아한다.',
      lines: { intro: ['물놀이 하자냥~!'], special: ['물방울 가득 담아서… 발사다냥!'], faint: ['으냥… 물에 빠졌다냥…'], win: ['헤헤, 깨끗해졌다냥!'] }
    },
    seol: {
      name: '설냥이', types: ['ice'], cat: true, height: 0.5, bg: 'ice',
      base: { hp: 75, atk: 60, def: 75, spa: 90, spd: 80, spe: 80 }, catchRate: 45, xp: 70,
      learn: [['snowball', 1], ['iceshield', 1], ['blizzard', 8], ['freezebeam', 16]],
      blurb: '차가운 눈송이를 품은 순백의 고양이 포캣몬이다. 겨울의 요정처럼 아름답다.',
      lines: { intro: ['차가운 눈송이를 품고 왔어.'], special: ['얼어붙어라… 프리즈빔!'], faint: ['눈이… 녹아버렸어…'], win: ['겨울의 요정이 이겼어.'] }
    },
    ssaga: {
      name: '싸가지냥', types: ['dark', 'normal'], cat: true, height: 0.4, bg: 'alley',
      base: { hp: 70, atk: 95, def: 60, spa: 50, spd: 60, spe: 110 }, catchRate: 45, xp: 70,
      learn: [['wallhop', 1], ['nyanpunch', 1], ['trashdig', 8], ['betray', 16]],
      blurb: '남의 집 담을 넘나드는 인성 쓰레기 길고양이 포캣몬이다. 밥을 줘도 은혜를 모른다.',
      lines: { intro: ['뭐? 너 또 보는거야? 짜증나…'], special: ['귀엽지 않다. 무섭지도 않다. 그냥… 패고 싶다.'], faint: ['…다음엔 담 넘어 도망간다.'], win: ['흥. 밥이나 내놔.'] }
    },
    cheese: {
      name: '치즈냥', types: ['normal'], cat: true, height: 0.42, bg: 'forest',
      base: { hp: 90, atk: 80, def: 70, spa: 50, spd: 60, spe: 85 }, catchRate: 160, xp: 58,
      learn: [['tackle', 1], ['tailwhip', 1], ['catnap', 8], ['cheesetackle', 16]],
      blurb: '어디서나 볼 수 있는 동네 고양이 포캣몬이다. 평범하지만 누구에게나 사랑받는다.',
      lines: { intro: ['냐하~ 놀아줄 거야?'], special: ['온 힘을 다해서… 치즈 태클!'], faint: ['배고파서 졌다냥…'], win: ['간식 먹으러 가자냥!'] }
    },
    flare: {
      name: '화르냥', types: ['fire'], cat: true, height: 0.45, bg: 'volcano',
      base: { hp: 65, atk: 70, def: 60, spa: 100, spd: 65, spe: 95 }, catchRate: 120, xp: 64,
      learn: [['ember', 1], ['flamewheel', 1], ['willowisp', 8], ['flamethrower', 16]],
      blurb: '목 둘레의 갈기가 불꽃으로 타오르는 고양이 포캣몬이다. 화가 나면 꼬리 끝 불꽃이 커진다.',
      lines: { intro: ['내 불꽃, 받아낼 수 있겠어?'], special: ['전부 태워버린다냥!'], faint: ['불씨가… 꺼졌다…'], win: ['아직 뜨겁다고!'] }
    },
    leaf: {
      name: '잎새냥', types: ['grass'], cat: true, height: 0.42, bg: 'forest',
      base: { hp: 75, atk: 85, def: 75, spa: 70, spd: 75, spe: 75 }, catchRate: 140, xp: 62,
      learn: [['vinewhip', 1], ['sleeppowder', 1], ['gigadrain', 8], ['leafblade', 16]],
      blurb: '머리에 새싹이 돋아난 고양이 포캣몬이다. 햇볕을 쬐면 꼬리의 잎이 쑥쑥 자란다.',
      lines: { intro: ['햇살이 좋은 날이네.'], special: ['잎사귀 칼날, 간다!'], faint: ['시들어버렸어…'], win: ['광합성 완료!'] }
    },
    zap: {
      name: '찌릿냥', types: ['electric'], cat: true, height: 0.42, bg: 'sea',
      base: { hp: 60, atk: 60, def: 55, spa: 100, spd: 70, spe: 110 }, catchRate: 120, xp: 64,
      learn: [['thundershock', 1], ['thunderwave', 1], ['spark', 8], ['thunderbolt', 16]],
      blurb: '털을 비비면 번개가 튀는 고양이 포캣몬이다. 쓰다듬으면 찌릿하다.',
      lines: { intro: ['찌릿찌릿~ 준비 완료!'], special: ['10만 볼트, 풀충전이다냥!'], faint: ['방전됐다냥…'], win: ['짜릿했지?'] }
    },
    punch: {
      name: '주먹냥', types: ['fighting'], cat: true, height: 0.5, bg: 'ice',
      base: { hp: 80, atk: 105, def: 70, spa: 40, spd: 65, spe: 85 }, catchRate: 110, xp: 66,
      learn: [['machpunch', 1], ['bulkup', 1], ['brickbreak', 8], ['closecombat', 16]],
      blurb: '두 발로 서서 주먹을 단련하는 고양이 포캣몬이다. 매일 아침 눈밭에서 수련한다.',
      lines: { intro: ['한 판 붙자냥! 오스!'], special: ['전력을 다한다! 인파이트!'], faint: ['수련이… 부족했다…'], win: ['좋은 승부였다! 오스!'] }
    },
    venom: {
      name: '독냥이', types: ['poison'], cat: true, height: 0.42, bg: 'alley',
      base: { hp: 80, atk: 60, def: 75, spa: 85, spd: 80, spe: 70 }, catchRate: 120, xp: 64,
      learn: [['acid', 1], ['toxic', 1], ['poisonjab', 8], ['sludgebomb', 16]],
      blurb: '보랏빛 털에 독 반점이 있는 고양이 포캣몬이다. 꼬리 끝 주머니에 독을 모은다.',
      lines: { intro: ['후후… 만지면 아플 텐데?'], special: ['독 한 방울이면 충분해.'], faint: ['독이… 다 떨어졌어…'], win: ['조심하라고 했잖아?'] }
    },
    sand: {
      name: '모래냥', types: ['ground'], cat: true, height: 0.45, bg: 'volcano',
      base: { hp: 85, atk: 95, def: 85, spa: 45, spd: 60, spe: 70 }, catchRate: 120, xp: 64,
      learn: [['sandattack', 1], ['mudshot', 1], ['bonemerang', 8], ['earthquake', 16]],
      blurb: '삽처럼 넓은 앞발로 땅을 파는 고양이 포캣몬이다. 모래 속에서 낮잠을 잔다.',
      lines: { intro: ['땅 파다 나왔다냥.'], special: ['땅이 울린다! 지진!'], faint: ['모래 속으로… 숨을래…'], win: ['땅은 거짓말을 안 해.'] }
    },
    wing: {
      name: '날개냥', types: ['flying'], cat: true, height: 0.45, bg: 'sea',
      base: { hp: 70, atk: 90, def: 60, spa: 60, spd: 60, spe: 105 }, catchRate: 120, xp: 64,
      learn: [['gust', 1], ['wingattack', 1], ['roost', 8], ['bravebird', 16]],
      blurb: '커다란 깃털 날개를 가진 고양이 포캣몬이다. 바닷바람을 타고 하늘을 난다.',
      lines: { intro: ['하늘에서 보니 다 보인다냥!'], special: ['급강하! 브레이브버드!'], faint: ['날개가… 무거워…'], win: ['바람이 내 편이었어!'] }
    },
    psy: {
      name: '텔레냥', types: ['psychic'], cat: true, height: 0.45, bg: 'temple',
      base: { hp: 65, atk: 45, def: 60, spa: 110, spd: 90, spe: 90 }, catchRate: 90, xp: 68,
      learn: [['confusion', 1], ['calmmind', 1], ['hypnosis', 8], ['psychic', 16]],
      blurb: '이마의 보석으로 마음을 읽는 고양이 포캣몬이다. 두 갈래 꼬리가 늘 떠 있다.',
      lines: { intro: ['네 다음 수, 이미 보여.'], special: ['내 마음의 힘을 받아라.'], faint: ['미래가… 흐려졌어…'], win: ['예언대로네.'] }
    },
    moth: {
      name: '나비냥', types: ['bug'], cat: true, height: 0.45, bg: 'forest',
      base: { hp: 70, atk: 50, def: 60, spa: 95, spd: 85, spe: 95 }, catchRate: 150, xp: 60,
      learn: [['bugbite', 1], ['stringshot', 1], ['quiverdance', 8], ['bugbuzz', 16]],
      blurb: '등에 화려한 나비 날개가 돋아난 고양이 포캣몬이다. 꽃밭에서 춤추기를 좋아한다.',
      lines: { intro: ['팔랑팔랑~ 같이 춤출래?'], special: ['날갯짓으로 울려라!'], faint: ['날개가… 접혔어…'], win: ['꽃밭으로 돌아갈래~'] }
    },
    rock: {
      name: '바위냥', types: ['rock'], cat: true, height: 0.5, bg: 'volcano',
      base: { hp: 80, atk: 100, def: 110, spa: 40, spd: 60, spe: 50 }, catchRate: 110, xp: 66,
      learn: [['rockthrow', 1], ['rockpolish', 1], ['rockslide', 8], ['stoneedge', 16]],
      blurb: '등에 바위 갑옷을 두른 고양이 포캣몬이다. 무거워서 잘 움직이지 않는다.',
      lines: { intro: ['…쿵.'], special: ['바위처럼 단단하게… 찌른다!'], faint: ['…와르르.'], win: ['바위는 부서지지 않는다.'] }
    },
    ghost: {
      name: '유령냥', types: ['ghost'], cat: true, height: 0.45, bg: 'alley',
      base: { hp: 60, atk: 80, def: 60, spa: 95, spd: 80, spe: 90 }, catchRate: 90, xp: 68,
      learn: [['lick', 1], ['confuseray', 1], ['shadowclaw', 8], ['shadowball', 16]],
      blurb: '반투명한 몸을 가진 고양이 포캣몬이다. 밤이 되면 골목을 떠돌며 장난을 친다.',
      lines: { intro: ['우우~ 놀랐지?'], special: ['그림자 속으로 사라져라…'], faint: ['다시… 사라질 시간이야…'], win: ['헤헤, 무서웠지?'] }
    },
    dragon: {
      name: '용냥이', types: ['dragon'], cat: true, height: 0.55, bg: 'temple',
      base: { hp: 80, atk: 95, def: 75, spa: 85, spd: 70, spe: 80 }, catchRate: 45, xp: 78,
      learn: [['dragonbreath', 1], ['dragondance', 1], ['dragonclaw', 8], ['dracometeor', 16]],
      blurb: '작은 뿔과 날개를 가진 고양이 포캣몬이다. 옛 용의 피를 이었다는 전설이 있다.',
      lines: { intro: ['용의 후예를 얕보지 마라냥.'], special: ['하늘이여… 유성을 내려라!'], faint: ['용의 혼이… 잠든다…'], win: ['이게 용의 힘이다!'] }
    },
    iron: {
      name: '철갑냥', types: ['steel'], cat: true, height: 0.45, bg: 'ice',
      base: { hp: 75, atk: 90, def: 105, spa: 60, spd: 75, spe: 55 }, catchRate: 110, xp: 66,
      learn: [['metalclaw', 1], ['irondefense', 1], ['ironhead', 8], ['flashcannon', 16]],
      blurb: '은빛 강철 판으로 몸을 감싼 고양이 포캣몬이다. 걸을 때마다 철컥철컥 소리가 난다.',
      lines: { intro: ['철컥. 전투 준비 완료.'], special: ['빛을 모아… 발사!'], faint: ['녹슬어… 버렸어…'], win: ['강철은 꺾이지 않아.'] }
    },
    ribbon: {
      name: '리본냥', types: ['fairy'], cat: true, height: 0.42, bg: 'temple',
      base: { hp: 80, atk: 50, def: 70, spa: 90, spd: 100, spe: 70 }, catchRate: 100, xp: 66,
      learn: [['fairywind', 1], ['charm', 1], ['drainkiss', 8], ['moonblast', 16]],
      blurb: '귀에 리본을 단 솜사탕 같은 고양이 포캣몬이다. 반짝이는 가루를 흩뿌리며 다닌다.',
      lines: { intro: ['반짝반짝~ 안녕!'], special: ['달님, 힘을 빌려줘!'], faint: ['리본이… 풀렸어…'], win: ['역시 귀여운 게 최고야!'] }
    },
    metal: {
      name: '메탈가디언몬', types: ['steel'], cat: false, height: 1.2, bg: 'metal',
      base: { hp: 100, atk: 95, def: 110, spa: 70, spd: 90, spe: 75 }, catchRate: 10, xp: 200,
      learn: [['metalimpact', 1], ['guardianshield', 1], ['speedattack', 1], ['kindguard', 1]],
      blurb: '의리와 예절을 중시하는 강인한 금속의 신념, 그것이 바로 메탈가디언몬이다. 약자에게 다정하고 강자에게 엄격하다.',
      lines: { intro: ['약한 건 내가 지킨다. 강한 놈은 내가 막는다.'], special: ['의리는 나의 힘이다!'], faint: ['지키고 싶은 것이… 있었는데…'], win: ['지키고 싶은 것이 있다면, 나는 반드시 그 곁에 선다.'] }
    },
    black: {
      name: '블랙 메탈가디언몬', types: ['dark', 'steel'], cat: false, height: 1.2, bg: 'dark',
      base: { hp: 100, atk: 105, def: 95, spa: 80, spd: 80, spe: 90 }, catchRate: 6, xp: 220,
      learn: [['darkslash', 1], ['blackshield', 1], ['darkspeed', 1], ['deathimpact', 1]],
      blurb: '어둠의 힘에 물들어 흑화한 메탈가디언몬이다. 의리와 정의는 강자에게만 존재한다고 믿는다.',
      lines: { intro: ['정의…? 그게 뭐지? 그저 강한 놈이 살아남는 거지.'], special: ['약한 것들은, 더 이상 지킬 가치가 없어.'], faint: ['…이 세상은… 강한 자만이…'], win: ['강해져라. 그게 너의 선택이다.'] }
    }
  };

  // 도감 순서
  var DEX = ['naru', 'seol', 'ssaga', 'cheese', 'leaf', 'moth', 'zap', 'wing', 'flare', 'sand', 'rock', 'punch', 'iron', 'venom', 'ghost', 'psy', 'ribbon', 'dragon', 'metal', 'black'];
  var STARTERS = ['naru', 'seol', 'ssaga'];

  /* ── 지역 ──
     wild: [종, 출현 가중치]. lv: 야생 레벨 범위. gym: 관장 팀(순서대로 나온다).
     지역은 앞 지역 배지를 얻으면 열린다. final: 챔피언전(메탈가디언몬 → 흑화 → 블랙). post: 클리어 후 열림. */
  var AREAS = [
    { id: 'forest', name: '햇살 풀숲', bg: 'forest', lv: [3, 6],
      wild: [['cheese', 4], ['leaf', 3], ['moth', 3]],
      gym: { name: '풀숲 관장 초롱', badge: '새싹 배지', team: [['moth', 9], ['cheese', 9], ['leaf', 11]],
        lines: { intro: '풀숲의 친구들은 만만하지 않아!', lose: '와, 대단하다! 새싹 배지를 줄게.' } } },
    { id: 'coast', name: '반짝 해안', bg: 'sea', lv: [8, 12],
      wild: [['zap', 4], ['wing', 4], ['naru', 1]],
      gym: { name: '해안 관장 파랑', badge: '물결 배지', team: [['wing', 14], ['naru', 14], ['zap', 16]],
        lines: { intro: '파도와 번개, 둘 다 막을 수 있어?', lose: '시원하게 졌네! 물결 배지야.' } } },
    { id: 'volcano', name: '화산 기슭', bg: 'volcano', lv: [13, 17],
      wild: [['flare', 4], ['sand', 4], ['rock', 3]],
      gym: { name: '화산 관장 불꽃', badge: '용암 배지', team: [['rock', 19], ['sand', 19], ['flare', 21]],
        lines: { intro: '뜨거운 승부를 보여주마!', lose: '네 열정이 더 뜨거웠다. 용암 배지다.' } } },
    { id: 'glacier', name: '얼음 빙하', bg: 'ice', lv: [18, 22],
      wild: [['punch', 4], ['iron', 4], ['seol', 1]],
      gym: { name: '빙하 관장 서리', badge: '서리 배지', team: [['iron', 24], ['punch', 24], ['seol', 26]],
        lines: { intro: '얼음보다 단단한 의지를 보여줘.', lose: '…녹아버렸어. 서리 배지를 가져가.' } } },
    { id: 'alley', name: '어둠 골목', bg: 'alley', lv: [23, 27],
      wild: [['venom', 4], ['ghost', 4], ['ssaga', 1]],
      gym: { name: '골목 관장 그늘', badge: '그늘 배지', team: [['venom', 29], ['ghost', 29], ['ssaga', 31]],
        lines: { intro: '골목에선 골목의 규칙을 따라야지.', lose: '쳇… 인정한다. 그늘 배지다.' } } },
    { id: 'temple', name: '별빛 신전', bg: 'temple', lv: [28, 32],
      wild: [['psy', 4], ['ribbon', 4], ['dragon', 1]],
      gym: { name: '신전 관장 별님', badge: '별빛 배지', team: [['psy', 34], ['ribbon', 34], ['dragon', 36]],
        lines: { intro: '별들이 너를 시험하겠대.', lose: '별들이 너를 인정했어. 별빛 배지야.' } } },
    { id: 'summit', name: '수호자의 정상', bg: 'metal', final: true,
      gym: { name: '정상의 수호자', badge: '수호자의 증표', team: [['metal', 38], ['black', 40]],
        lines: { intro: '여기까지 왔구나. 마지막 시험이다.', lose: '…강해졌구나. 이제 네가 지킬 차례다.' } } },
    { id: 'ruins', name: '붉은 달 폐허', bg: 'dark', lv: [40, 45], post: true,
      wild: [['metal', 1], ['black', 1]] }
  ];

  // 컷신 대본 (who: 'metal' | 'black' | 'fx')
  var CUTSCENES = {
    corrupt: [
      { who: 'metal', text: '…약한 것들을… 지켜왔는데…' },
      { who: 'fx', text: '붉은 달이 떠오른다…' },
      { who: 'black', text: '…약한 것들은, 더 이상 지킬 가치가 없어.' },
      { who: 'black', text: '이 세상은 강한 자만이 살아남는 거야.' }
    ]
  };

  var TUNING = {
    stab: 1.5,
    critRate: 1 / 24, highCritRate: 1 / 8, critMult: 1.5,
    screenTurns: 5, screenMult: 0.5,
    stageMax: 6,
    burnFrac: 1 / 16, poisonFrac: 1 / 8, toxicStep: 1 / 16,
    parSkip: 0.25, parSpeed: 0.5, thawRate: 0.2, sleepTurns: [1, 3], confuseTurns: [2, 5], confuseHit: 1 / 3,
    multiHit: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]],
    struggleRecoil: 0.25,
    expMult: 3.0,          // 경험치 배율 (원작보다 빠르게 — 모바일 짧은 플레이)
    expShare: 0.5,         // 싸우지 않은 파티 몬스터가 받는 경험치 비율
    trainerExp: 1.5,
    ballBonus: 1.5,        // 포캣볼 보정
    shinyRate: 1 / 20,
    partyMax: 3,
    startLevel: 5,
    maxLevel: 60
  };

  var api = {
    TYPES: TYPES, CHART: CHART, STATUS: STATUS, STAT_NAMES: STAT_NAMES, MOVES: MOVES, MONSTERS: MONSTERS,
    DEX: DEX, STARTERS: STARTERS, AREAS: AREAS, CUTSCENES: CUTSCENES, TUNING: TUNING
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PData = api;
})(typeof window !== 'undefined' ? window : globalThis);
