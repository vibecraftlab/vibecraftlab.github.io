# RUNBOOK — 빌드 · 서버 · 배포 로직과 실행 파일

툴체인 `0005.llm-wiki-site` 의 모든 실행 경로를 한 장으로. 규칙·배경은 `README.md` 와 vault `CLAUDE.md` §7 §11, 운영 정리는 vault `tooling/wiki/concepts/llm-wiki-publishing.md`.
2026-10-17 기준 검증값 (`verify.bat`): `npm run check` 1 published · 0 blocked · ⚠1 / sync 테스트 21 · 훅 테스트 20 / 내부 빌드 126장 → 432 파일.

## 전체 흐름

```
Obsidian vault (G:\내 드라이브\llm-wiki)
   │
   ├─ [내부]  npm run internal ──► quartz build -d <vault> --watch ──► public/ ──► 자체 정적 서버 127.0.0.1:8080
   │           (scripts/internal.mjs)                                              이 PC 에서만. 커밋 없음
   │
   └─ [공개]  npm run check ───► sync-public.mjs --check  (읽기만, 보고)
             npm run sync ────► sync-public.mjs          vault → content/   (③겹 필터, fail-closed)
             npm run publish ─► publish.mjs = sync → git add content → commit → push origin main
                                                                                   │
                                        GitHub Actions deploy.yml ◄────────────────┘
                                        npm ci → node site/build.mjs --out public → Pages 배포
                                        → https://vibecraftlab.github.io/  (1~2분)

             npm run site:serve ► site/build.mjs --serve  content/ → dist/ → 127.0.0.1:8090 (미리보기, 커밋 없음)
```

내부는 Quartz(`quartz.config.yaml`)로 vault 를 **직접** 읽고, 공개는 자체 생성기 `site/build.mjs` 가 sync 로 **걸러서 복사한** `content/` 만 읽는다 (2026-10-21 부터. 그전에는 공개도 Quartz 였다).

## 실행 파일 (`bat\`)

끝에 `pause` 로 멈춰서 결과를 보여준다(더블클릭용). 터미널·스크립트에서 바로 끝내려면 `set NOPAUSE=1`(PowerShell `$env:NOPAUSE=1`). 종료 코드 0 = 성공. 모두 `bat\` 의 상위 폴더(= repo 루트)로 이동한 뒤 실행하므로 어디서 호출해도 된다.

| 파일 | 하는 일 | 쓰는 것 | 쓰는 때 |
|---|---|---|---|
| `internal-serve.bat` | 내부 위키 서버 (watch + `127.0.0.1:8080`) | `public/` | 위키를 브라우저로 볼 때. Ctrl+C 로 종료 |
| `internal-build.bat` | 내부 위키 빌드만 (`--once`) | `public/` | 빌드가 깨지는지만 볼 때 |
| `check.bat` | 발행 검사 (읽기 전용) | 없음 | 발행 전 항상 |
| `sync.bat` | vault → `content/` (커밋 없음) | `content/` | 공개 빌드를 로컬에서 미리 볼 때 |
| `site-serve.bat` | 공개 블로그 빌드 + 미리보기 `127.0.0.1:8090` | `dist/` | 발행 전 실제 모습 확인. `sync.bat` 다음에 |
| `publish.bat` | 브랜치 확인 → check → **yes 입력** → publish | `content/` · git 커밋 · push | 실제 공개. **사람만** |
| `test.bat` | sync 테스트 23건 + vault 훅 테스트 20건 | 없음 | 패턴·스크립트를 바꿨을 때 |
| `typecheck.bat` | Quartz tsc + prettier | 없음 | Quartz 코드·설정을 손댔을 때 |
| `verify.bat` | check → test → internal-build 를 순서대로, 발행 없음 | `public/` | 툴체인 이동·새 PC·큰 변경 뒤 |

`publish.bat "post: 제목"` 처럼 인자를 주면 커밋 메시지가 된다. `.bat` 들은 2026-10-21 부터 git 에 들어 있다 (비밀·개인 경로 없음, 새 PC 에서도 그대로 쓴다).

`.bat` 본문은 **영문(ASCII)만** 쓴다. cmd 는 `chcp 65001` 뒤에 배치 파일을 바이트 오프셋으로 다시 읽어서, 파일 안에 한글이 있으면 줄이 깨져 엉뚱한 명령이 실행된다. `chcp 65001` 은 node 가 출력하는 한글을 제대로 보이게 하려고 둔 것이다. vault 기본 경로의 한글(`G:\내 드라이브\llm-wiki`)도 파일에 직접 쓰지 않고 `test.bat` `verify.bat` 가 node 의 `\u` 이스케이프로 풀어 받는다. `VAULT_PATH` 가 설정돼 있으면 그 값을 쓴다.

환경변수 (선택):

| 변수 | 기본 | 뜻 |
|---|---|---|
| `VAULT_PATH` | `G:\내 드라이브\llm-wiki` | vault 위치. 다른 PC 에서 바꾼다 |
| `PATTERNS_PATH` | `<vault>\.claude\hooks\patterns.js` | 비밀 패턴 정본 |
| `PORT` | `8080` | 내부 서버 포트 |

PowerShell: `$env:VAULT_PATH = "D:\path\llm-wiki"` · cmd: `set VAULT_PATH=D:\path\llm-wiki` 후 bat 실행.

## 각 로직

### 내부 위키 — `scripts/internal.mjs`

1. `VAULT_PATH`(기본 `G:\내 드라이브\llm-wiki`)가 존재하는지 확인. 없으면 종료 1.
2. Quartz CLI(`quartz/bootstrap-cli.mjs`)를 **셸 없이 node 로 직접** spawn: `build -d <vault> --watch`. 셸을 거치면 한글·공백 경로가 쪼개진다.
3. `--once` 면 빌드 종료 시 그 코드로 끝. 아니면 자체 HTTP 서버를 **`127.0.0.1` 에만** 바인딩해 `public/` 을 서빙. 요청 경로는 `slug` → `slug.html` → `slug/index.html` 순으로 찾고(Quartz v5 는 flat `slug.html`), 없으면 `404.html`. `cache-control: no-store` 라 새로고침이 곧 최신.
4. Ctrl+C → 자식(quartz watch) kill → 서버 close.

왜 Quartz 의 `--serve` 를 안 쓰나: `0.0.0.0` 에 열려서 같은 네트워크 누구나 `mpole/` 포함 vault 전체를 본다(2단계 리뷰 C1). 이 서버는 LAN 주소로 접속이 거부되는 것을 확인했다.

vault 의 `.obsidian` `.claude` `_specs` `_templates` `**/_README.md` 는 `quartz.config.yaml` 의 `ignorePatterns` 로 빠진다. `_dashboards/*.base` 는 `bases-page` 플러그인이 표로 렌더한다.

### 발행 검사·동기화 — `scripts/sync-public.mjs`

`sync({ vault, outDir, check, patternsPath })` 한 함수. `--check` 는 같은 계산을 하고 **쓰지만 않는다**.

1. vault 의 `.md` 전부 순회 (`.obsidian` `.claude` `node_modules` `.trash` 제외).
2. 게이트: 경로가 `study/wiki` `vibecraft/wiki` `tooling/wiki` `research/wiki` 아래 **그리고** frontmatter `published: true` **그리고** `pubDate` 있음. `draft: true` 는 조용히 제외. `mpole/` · `raw/` 는 플래그가 있어도 거부. frontmatter 가 엄격 YAML 에 안 맞으면 차단.
3. 비밀 검사 — **파일 전체**(frontmatter + 본문 + `%% %%` + `<!-- -->` 주석)에 `patterns.js` 의 BLOCK 규칙. 걸리면 `blocked` 에 파일·줄·이유. WARN 규칙(로컬 절대경로 등)은 `warnings` 에만. frontmatter 에 `password` 키가 있으면 차단.
4. 변환 — 코드 스팬·펜스를 자리표시자로 빼둔 뒤: 주석 제거 → 미공개 대상 `[[링크]]`·markdown 링크(`.md` 유무·`#앵커`)는 글자만 남기고 `downgraded` 에 기록 → `![[첨부]]`·markdown 이미지는 `{domain}/assets/public/` 아래만 복사, 나머지는 `[첨부 생략]` → 코드 복원.
5. 공개 frontmatter 는 화이트리스트만 다시 직렬화: `title` `description`(=description ?? summary) `date`(=pubDate) `modified`(=updated) `tags`(=blogTags ?? tags 마지막 세그먼트) `publish: true`. slug 가 겹치면 차단.
6. 쓰기(`--check` 가 아닐 때만): 차단이 **하나라도** 있으면 `content/` 를 전혀 건드리지 않고 종료 1. 없으면 이번에 안 나온 파일을 `content/` 에서 지우고 새 파일을 쓴다 — `content/` 는 sync 가 전적으로 소유.
7. 출력: `published N · blocked N · downgraded links N · warnings N` 와 `✓ ✗ ⚠` 목록, 강등 링크 목록("그것도 공개할까?").

### 공개 발행 — `scripts/publish.mjs`

1. `sync()` 실행(위 전체, `graph: true` 로 익명 위키 지도 `content/graph.json` 도 만든다). 차단이 있으면 출력하고 종료 1 — 아무것도 커밋되지 않는다.
2. 생성기 가드: `site` `.github` `package.json` `package-lock.json` `scripts` 에 커밋 안 된 변경이 있으면 멈춘다. CI 는 커밋된 생성기로 빌드하므로, 코드 변경은 사람이 먼저 직접 커밋한다.
3. `git add content` → staged 가 없으면 "바뀐 공개 페이지 없음" 으로 종료 0.
4. 커밋: 인자가 있으면 그 메시지, 없으면 `publish: YYYY-MM-DD (N files)`.
5. `git push` → Actions 링크 출력.

알려진 빈틈(ledger M3): 스크립트 자체는 브랜치 확인·확인 프롬프트·대량 삭제 가드가 없고, **이미 staged 된 다른 파일도 같이 커밋된다**. `publish.bat` 가 브랜치(main)와 `yes` 확인을 앞에 붙였지만, staged 상태는 여전히 사람이 `git status` 로 본다.

### GitHub Actions — `.github/workflows/deploy.yml`

트리거: `main` push 또는 수동 dispatch. `build` job: checkout(fetch-depth 0, git 날짜용) → configure-pages(enablement: true, Pages 리소스 없으면 생성) → Node 24 → npm 캐시 → `npm ci` → `node site/build.mjs --content content --out public` → `public/` 업로드. Quartz 플러그인 설치·빌드 단계는 없다. `deploy` job: `deploy-pages`. 소요 1~2분. 진행: https://github.com/vibecraftlab/vibecraftlab.github.io/actions

`content/` 가 안 바뀐 push(예: README 수정)도 Actions 는 돌지만 결과 사이트는 같다.

### 테스트

- `node --test scripts\sync-public.test.mjs` — sync 23건: 게이트·차단·링크 강등·코드 보호·첨부·frontmatter 화이트리스트·`content/` 소유.
- `node --test "<vault>\.claude\hooks\test-hooks.js"` — 훅 20건: `validate-write.js`(① 쓰기 훅) 와 `inject-hot.js`. 비밀 패턴은 ① 과 ③ 이 **같은** `patterns.js` 를 읽으므로 패턴을 바꾸면 둘 다 돌린다.

## 자주 하는 순서

| 상황 | 순서 |
|---|---|
| 위키 보기 | `internal-serve.bat` → http://127.0.0.1:8080 |
| 글 공개 | Obsidian 에서 `published: true` + `pubDate` → `check.bat` (✓ ⚠ 읽기) → `publish.bat` → 1~2분 뒤 사이트 |
| 패턴·스크립트 수정 | 수정 → `test.bat` → `check.bat` |
| 툴체인 이동·새 PC | `npm i` → `npx quartz plugin install --from-config` → `verify.bat` |
| 공개 빌드 미리보기 | `sync.bat` → `site-serve.bat` → http://127.0.0.1:8090 (결과 `dist/`, 내부 위키의 `public/` 과 겹치지 않는다) |
| 블로그 디자인·생성기 수정 | `site/` 고침 → `site-serve.bat` 로 확인 → **직접 커밋** → `publish.bat` (커밋 안 하면 publish 가 멈춘다) |

## 실패했을 때

| 증상 | 원인 · 조치 |
|---|---|
| `vault not found: …` | `VAULT_PATH` 가 틀림. Drive 동기화 확인 |
| `✗ …: 비밀 패턴` | 값을 지우거나 `[REDACTED]`. 패턴 오탐이면 `patterns.js` 고치고 `test.bat` |
| `✗ …: frontmatter` | Quartz 는 엄격 YAML — `"` 로 시작하는 값, 예약어는 따옴표로 감싼다 |
| 첫 빌드 실패 (`@quartz-themes/default`) | 런타임 설치 뒤 **한 번 더** 실행하면 성공 |
| `Warning: couldn't find git repository` | 무해. vault 는 git 이 아니라 Drive |
| 라이브 페이지의 `[[링크]]` 가 깨짐 | 코드 블록 보호가 빠진 옛 sync 산출물. `publish.bat` 로 재발행 |
| 공개하면 안 될 것이 나감 | `README.md` "공개는 되돌릴 수 없다" 절차: 사이트 제거 → 이력 제거(force push) → **비밀 재발급** → vault `log.md` 기록 |
