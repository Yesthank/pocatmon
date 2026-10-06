# 외부 계약

외부 API는 없다. 외부에 대해 지켜야 하는 약속은 **이미 플레이한 사람의 브라우저에 남아 있는 저장값**과 **공개 주소** 두 가지다.

## 브라우저 저장소 키 (localStorage)
| 키 | 값 | 쓰는 때 | 지우는 때 |
|---|---|---|---|
| `pocatmon.save` | JSON 저장 데이터(아래, `v: 2`) | 새 게임, 배틀 종료, 센터 회복, 파티 정리 | 새로 시작 |
| `pocatmon.muted` | `"1"` / `"0"` | 음소거 토글 | 지우지 않음 |
| `pocatmon.run`, `pocatmon.unlocked.black` | v1(4연전) 기록 | 더 이상 쓰지 않음 | 새 저장 시 `pocatmon.run`을 지움. 읽지 않으므로 남아 있어도 무해 |

저장 데이터 형식(`v: 2`):
```json
{ "v": 2, "starter": "naru", "nextUid": 4, "area": "forest", "badges": ["forest"], "cleared": false,
  "dex": { "seen": { "naru": 1, "cheese": 1 }, "caught": { "naru": 1, "cheese": 1 } },
  "party": [ { "uid": 1, "id": "naru", "lv": 12, "exp": 1730, "iv": { "hp": 20, "atk": 3, "def": 31, "spa": 17, "spd": 9, "spe": 25 },
               "hp": 38, "status": null, "slp": 0, "moves": [ { "id": "watergun", "pp": 24 } ], "shiny": false } ],
  "box": [] }
```
- `party`는 1~3마리, `box`는 개수 제한이 없다. 몬스터 `id`는 `PData.MONSTERS`의 키이고, 기술 `id`는 `PData.MOVES`의 키다(발버둥 제외).
- `status`는 `null | brn | psn | tox | par | slp | frz` 중 하나다. `hp`는 0 이상 최대 HP 이하, `pp`는 0 이상 그 기술의 최대 PP 이하다.
- `badges`의 원소는 `PData.AREAS`의 `id`다. 최종전 배지(`summit`)를 얻으면 `cleared`가 `true`가 된다.
- `PEngine.isValidSave`가 위 조건을 모두 검사한다. 통과하지 못한 기록은 오류 없이 무시된다(새 게임처럼 보인다).
- 형식을 바꾸면 `v`를 올리고 `isValidSave`를 함께 고친다. 몬스터·기술 id를 지우거나 이름을 바꾸면 기존 저장이 무효가 되므로, id는 바꾸지 않는다.

## 공개 주소
- `https://yesthank.github.io/pocatmon/`: `index.html` 하나가 진입점이다. `?2d`는 2D 화면을 강제하고, `?fast`는 UI 지연을 줄이며(자동 점검용), `?seed=N`은 난수를 고정한다.
- 자동 점검용으로 `window.__pocatmon`(화면 상태 `state`, 저장소 `store`)을 노출한다. 게임 동작은 이 창구에 의존하지 않는다.
