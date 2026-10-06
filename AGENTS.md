# 포캣몬 배틀

오리지널 몬스터 5종(나루냥·설냥이·싸가지냥·메탈가디언몬·블랙 메탈가디언몬)으로 휴대폰 세로 화면에서 5~10분 즐기는 **일회성 1인용 턴제 4연전 웹 게임**이다. 빌드 없는 정적 HTML/JS(three.js r128 + 2D 대체)로 만들었고, GitHub Pages(`https://yesthank.github.io/pocatmon/`)로 공개 배포한다. 서버·계정·온라인 기능은 없고, 유지보수는 가끔 하는 정도를 상정한다.

## 프로젝트 구조
```
battle/
├── CLAUDE.md / AGENTS.md      → 이 안내(두 파일 내용 동일)
├── index.html                 → 진입점, 스크립트 7개를 순서대로 로드
├── js/
│   └── AGENTS.md              → 게임 런타임(데이터·엔진·그림·효과음·경기장·화면)의 경계와 불변식
├── tools/
│   └── AGENTS.md              → 서버·헤드리스 스모크·밸런스 시뮬레이션·그림 확인 도구
├── test/engine.test.js        → 엔진 테스트
├── assets/                    → bg/ 배경 5장, mon/ 캐릭터 일러스트(webp)
├── vendor/three.min.js        → three.js r128 UMD (수정 금지)
└── docs/
    ├── architecture.md        → 스크립트 구성, 기술 버튼 한 번의 흐름, 3D/2D 경계
    ├── business-rules.md      → 상성·턴 처리·런·이어하기·이로치 규칙
    ├── security.md            → 저장 데이터, 공개 범위, 배포 자격 증명
    ├── standards.md           → 검증 게이트, 구조·데이터·커밋 규칙
    ├── engineering-notes.md   → 함정(file:// 2D, PowerShell 한글 깨짐, 헤드리스 WebGL, 2img 키아웃)
    ├── operations.md          → 설치·실행·검증·배포 명령
    ├── contracts.md           → localStorage 키·런 기록 형식, 공개 주소·URL 플래그
    ├── balance.md             → 시뮬레이션 결과(npm run sim이 덮어씀)
    └── tracking/
        ├── status.md          → 완료·검증 상태, 남은 일
        ├── findings.md        → 지금 못 고친 문제
        └── decisions/         → 그림 방식, three r128, 패배 시 처음부터
```

## 반드시 지킬 것
- 배포(push) 전 `npm test`, `npm run sim`(클리어율 35~95%), `npm run smoke`(콘솔 오류 0, 가로 넘침 0) 세 개가 모두 종료 코드 0이어야 한다. `main`에 push하면 곧바로 공개된다.
- 패배하면 런 전체를 처음부터 한다(사용자 결정). "그 판부터 재도전"으로 바꾸지 않는다.
- `engine.js`·`data.js`는 DOM을 모르는 순수 로직으로 유지한다. 화면은 엔진 이벤트만 재생한다.
- 실행 중 외부 네트워크 금지(CDN·웹폰트·API), 상대 경로만 쓴다. three는 r128 UMD 고정이다.
- 상위 폴더의 원본 시트 이미지와 GitHub 토큰은 절대 커밋하지 않는다.

## 작업 전에 읽을 것
- 항상: `docs/standards.md`, `docs/engineering-notes.md`, 손댈 폴더의 `AGENTS.md`.
- 기술·수치·상성을 바꾸기 전: `docs/business-rules.md`(효과 종류는 고정, 수치만 조정) → 바꾼 뒤 `npm run sim`.
- 캐릭터 그림을 바꾸기 전: `docs/engineering-notes.md`의 2img 키아웃·배치 절차와 `Sprites.FOOT/ART_TOP` 연동.
- 저장 형식(런 기록)을 건드리기 전: `docs/contracts.md`(버전 `v`를 올리는 규칙).
- 연출(Stage) 메서드를 추가하기 전: 3D와 2D 두 구현에 같은 이름으로 넣고, 반드시 resolve하는 Promise를 돌려준다.

## 문제가 생기면
- **바로 사용자에게 알릴 것:** 공개 사이트가 안 열리거나 검은 화면이 될 때, 3D·2D 둘 다에서 입력 잠금이 풀리지 않아 진행이 멈출 때, 저장소에 원본 이미지나 토큰이 커밋되었을 때, 클리어율이 범위를 벗어난 채 배포되었을 때.
- 그 밖의 문제는 `docs/tracking/findings.md`에 기록한다. 조건, 증상, 영향 범위, 지금 못 고치는 이유를 함께 적는다.
