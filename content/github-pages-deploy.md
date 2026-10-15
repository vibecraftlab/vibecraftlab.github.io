---
title: GitHub 블로그 배포 — Astro + GitHub Pages 완전 정리
description: Astro 정적 사이트를 GitHub Pages로 배포하는 전체 과정. 세팅부터 URL 구조, 트러블슈팅, 배포
  자동화까지 실전에서 겪은 그대로 정리.
date: 2026-08-02
modified: 2026-08-02
tags: [github-pages, astro, github-actions, deploy, ci-cd]
publish: true
---
# GitHub 블로그 배포 — Astro + GitHub Pages 완전 정리

Obsidian 개인 위키에서 `published: true` 인 페이지만 골라서 정적 블로그로 배포하는 파이프라인 전체를 실전 사례로 정리한 글이다. 원본 저장소: `hellotect2022/hellotect2022.github.io`.

**전체 흐름**:

```
Obsidian vault  →  sync script  →  Astro build  →  GitHub Pages
(사적 KB)          (published만)     (정적 HTML)      (공개, 무료)
```

이 글 하나만 있으면 **처음부터 끝까지 재현 가능**하도록 썼다. 실제 배포하면서 부딪힌 실패까지 포함.

---

## 1. 요약 (TL;DR)

- **스택**: Astro 5 + 바닐라 CSS + Shiki(dual theme) + GitHub Actions
- **호스팅**: GitHub Pages (무료, HTTPS 자동, 커스텀 도메인 지원)
- **최종 URL**: `https://hellotect2022.github.io/` (user page 방식)
- **컨텐츠 소스**: Obsidian vault의 `tech/wiki/`, `projects/*/wiki/` 중 `published: true` 페이지
- **일상 발행**: `npm run deploy` 한 번 (§7)
- **핵심 함정 3가지**:
  1. Pages Source를 GitHub Actions로 설정만으로는 부족 → **`configure-pages@v5` 필요** (§4.3)
  2. Vault의 계층 태그(`도구/…`)를 그대로 노출하면 URL이 지저분 → **`blogTags` 매핑** (§3.3)
  3. `<username>.github.io` 로 repo 이름 지으면 서브패스 없이 root에서 서빙 (§5)

---

## 2. 프로젝트 구조

```
my-tech-blog/                       # (repo 이름은 hellotect2022.github.io)
├── astro.config.mjs                # SITE, BASE, Shiki 테마, wikilink 처리
├── package.json                    # deps + npm scripts (dev, build, sync, deploy)
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   └── assets/synced/              # vault 이미지가 sync 되는 곳
├── scripts/
│   ├── sync-from-vault.mjs         # vault → blog repo 동기화
│   └── deploy.mjs                  # sync + commit + push 자동화
├── src/
│   ├── content/
│   │   ├── config.ts               # Content Collection 스키마
│   │   └── blog/
│   │       ├── *.md                # 직접 작성 글
│   │       └── synced/             # sync된 글 (스크립트가 관리)
│   ├── styles/global.css           # 디자인 시스템 (팔레트/타이포/prose)
│   ├── layouts/                    # BaseLayout, PostLayout
│   ├── components/                 # Header, Footer, PostCard, ThemeToggle 등
│   ├── pages/                      # index, about, blog, tags, rss.xml.js
│   └── lib/
│       └── site.ts                 # 사이트 메타 (제목/저자/네비/소셜)
└── .github/workflows/deploy.yml    # GitHub Pages 자동 배포
```

---

## 3. 콘텐츠 작성

### 3.1 직접 작성 (vault 안 거치고)

`src/content/blog/{slug}.md`:

```markdown
---
title: 나의 새 글 제목
description: 검색/소셜용 한 줄 요약
pubDate: 2026-08-15
tags: [rust, tokio]
published: true
---

본문 마크다운...
```

**Frontmatter 스키마** (`src/content/config.ts`):

| 필드 | 필수 | 타입 | 의미 |
|------|------|------|------|
| `title` | ✓ | string | 헤딩 · 브라우저 타이틀 · OG |
| `description` | | string | 카드/OG 요약 |
| `pubDate` | ✓ | date | `2026-08-15` 형식 |
| `updatedDate` | | date | 갱신 시각 (표시됨) |
| `tags` | | string[] | 블로그 태그 (직접 작성 시). vault sync 경우 자동 파생 |
| `blogTags` | | string[] | **vault 전용** — 블로그 노출용 flat 태그 (§3.3) |
| `draft` | | boolean | true면 빌드에서 제외 |
| `published` | | boolean | vault 사이드 flag (sync 스크립트가 필터) |

### 3.2 Obsidian vault에서 발행

vault 페이지 frontmatter에 `published: true` 만 추가하면 sync 대상:

```yaml
---
title: Rust 소유권 30줄 요약
pubDate: 2026-08-02
tags: [도구/rust, 주제/ownership]
blogTags: [rust, ownership]     # ← 블로그에는 이게 나옴
published: true
---
```

이후:

```powershell
cd C:\Users\dhhan\01.claude\my-tech-blog
npm run sync
```

sync 스크립트 동작 (`scripts/sync-from-vault.mjs`):
1. `SOURCE_DIRS` 스캔 (기본: `tech/wiki`, `projects/suda-chat/wiki`, `projects/simulation/wiki`)
2. frontmatter `published: true` 인 것만 필터
3. `src/content/blog/synced/{slug}.md` 로 복사
4. Obsidian wikilink `[[페이지]]` → `/blog/{slug}` 링크로 변환
   - 대상 페이지도 published 이면 실제 링크, 아니면 텍스트로 fallback (사적 페이지 링크 유출 방지)
5. 로컬 이미지 → `public/assets/synced/` 복사 + URL 재작성
6. 이전에 sync 됐지만 지금은 unpublished 된 파일은 자동 삭제

**Vault 위치 변경** (다른 PC 등):

```powershell
$env:VAULT_PATH = "D:/other/path/obsidian"
npm run sync
```

### 3.3 Vault 태그 vs 블로그 태그 (`blogTags` 매핑)

Obsidian에서는 `tags: [도구/github-pages, 분야/frontend]` 처럼 **계층형** 태그가 자연스럽지만, 블로그 URL로 나오면 `/tags/도구github-pages/` 처럼 지저분해진다.

Sync 스크립트가 두 방식 지원:

**방식 A — 명시적 `blogTags`** (권장):

```yaml
tags: [도구/github-pages, 도구/astro, 분야/frontend]
blogTags: [github-pages, astro, frontend]     # ← 블로그에는 이게
```

**방식 B — 자동 파생** (`blogTags` 없을 때):

`tags` 각 항목의 마지막 세그먼트만 취함 → `도구/github-pages` → `github-pages`, `분야/frontend` → `frontend`. 중복 제거 후 flat 배열.

**언제 어느 방식**:
- KB 태그와 블로그 태그를 다르게 큐레이션 → 방식 A
- 계층 접두사만 벗기면 충분 → 방식 B (아무것도 안 하면 됨)

구현: `scripts/sync-from-vault.mjs` 의 `deriveBlogTags()` 함수.

---

## 4. GitHub Pages 최초 세팅

### 4.1 Repo · Actions 권한

**Repo 생성** (GitHub 웹):
- Repo 이름을 `<username>.github.io` 로 하면 root 도메인에서 서빙 (§5.2)
- 다른 이름이면 서브패스 (`<username>.github.io/<repo>/`)

**Local git 연결**:

```powershell
git init
git remote add origin https://github.com/hellotect2022/hellotect2022.github.io.git
git branch -M main
```

**Workflow 권한** (GUI):

`https://github.com/hellotect2022/<repo>/settings/actions` 하단:
- **Workflow permissions** = **Read and write permissions**
- 기본이 read-only인 경우 있음. workflow 안에 `pages: write` 선언해도 이게 막혀있으면 실패

**Pages Source** (GUI):

`https://github.com/hellotect2022/<repo>/settings/pages`:
- **Source** 를 **`GitHub Actions`** 로 선택 (Deploy from a branch 아님!)

이 UI 세팅만으로 부족한 경우가 있음 → §4.3 참조.

### 4.2 Workflow 완성본 (`.github/workflows/deploy.yml`)

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: pages
  cancel-in-progress: true

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Pages
        uses: actions/configure-pages@v5
        with:
          enablement: true          # ← 이거 없으면 첫 배포 404

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build
        env:
          BASE_URL: /               # user page면 /, 프로젝트 페이지면 /<repo>

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

각 스텝의 역할:

| 스텝 | 역할 |
|------|------|
| `actions/checkout@v4` | 소스 체크아웃 |
| **`actions/configure-pages@v5`** | Pages 환경 설정 · `enablement: true` 로 없으면 자동 생성 |
| `actions/setup-node@v4` | Node.js 22 + npm 캐시 |
| `npm ci` | 의존성 설치 (lock 파일 기반, 결정적) |
| `npm run build` | Astro 정적 빌드 → `dist/` |
| `actions/upload-pages-artifact@v3` | `dist/` 를 Pages 배포용 artifact로 업로드 |
| `actions/deploy-pages@v4` | artifact를 실제 Pages 서비스에 배포 |

### 4.3 왜 `configure-pages@v5` 가 필수인가

**증상 (첫 배포에서 만난 실패)**:

```
Error: Creating Pages deployment failed
Error: HttpError: Not Found
Error: Failed to create deployment (status: 404) with build version xxx.
Ensure GitHub Pages has been enabled: https://github.com/{user}/{repo}/settings/pages
```

**원인**:
`actions/deploy-pages@v4` 가 배포하려는데 **repo에 Pages 리소스가 존재하지 않음**. GitHub API가 Pages site 를 찾지 못해 404 반환.

- UI에서 Source를 GitHub Actions로 저장했어도 실제 Pages 리소스는 미생성일 수 있음 (UI 상태와 API 상태 분리)
- 첫 workflow 실행 전까지 "provisioned" 안 됨
- 조직 정책 · 권한 이슈로 UI 설정이 반영 안 될 수 있음

**해결**:

Workflow에 `configure-pages@v5` + `enablement: true` 추가. 이 스텝이:
- Pages 리소스가 있으면 그대로 사용
- **없으면 API로 활성화 (create) 후 진행**

**왜 UI보다 workflow에서 하는 게 나은가**:
- 재현성: 다른 사람이 fork 해도 첫 push에 자동 활성화
- 명시성: `.github/workflows/deploy.yml` 만 보면 배포 요구사항 다 파악
- 안정성: UI 상태와 실제 API 상태 불일치 이슈 회피

---

## 5. URL 구조 & Repo 이름

### 5.1 URL 해부

```
https://hellotect2022.github.io / [subpath] / blog /
              │                       │          │
        GitHub 계정 (고정)      Repo 서브패스   Astro 페이지
                              (없거나 있거나)
```

Repo 이름에 따라 URL 구조가 다르다.

### 5.2 옵션 1 — `<username>.github.io` (user page) ⭐

Repo를 **`hellotect2022.github.io`** 로 지으면 GitHub이 특별 취급 → root 도메인에서 서빙.

- **URL**: `https://hellotect2022.github.io/blog/` (서브패스 없음)
- **Astro 설정**: `base: '/'`
- **계정당 하나만** 가능 (user page 슬롯)

이 글이 배포된 실제 방식.

### 5.3 옵션 2 — 다른 repo 이름 (project page)

Repo가 `my-tech-blog` 같은 일반 이름이면 서브패스로 서빙.

- **URL**: `https://hellotect2022.github.io/my-tech-blog/blog/`
- **Astro 설정**: `base: '/my-tech-blog'`
- **여러 개** 가능 (계정당 project page 무제한)

포트폴리오처럼 여러 프로젝트를 배포할 때 유용.

### 5.4 옵션 3 — Custom domain

도메인 구입 후 (`hellotect.dev` 등):

- **URL**: `https://hellotect.dev/blog/`
- **Astro 설정**: `base: '/'`, `site: 'https://hellotect.dev'`
- **CNAME 파일**: `public/CNAME` 에 도메인만 한 줄
- **DNS**: 도메인 관리 콘솔에서 `@` (or subdomain) → `hellotect2022.github.io` CNAME 레코드
- **GitHub UI**: Settings → Pages → Custom domain 에 도메인 입력 + Enforce HTTPS

### 5.5 실전 rename 절차 (옵션 2 → 옵션 1로 이동)

`my-tech-blog` 로 시작했다가 `<username>.github.io` 로 옮기는 경우.

**Step 1: GitHub UI**

`https://github.com/hellotect2022/my-tech-blog/settings` → **Rename** → 새 이름 `hellotect2022.github.io` 입력 → **Rename**.

GitHub이 자동으로:
- 이전 URL에서 새 URL로 redirect 설정
- Pages 리소스는 그대로 유지 (재배포 필요)

**Step 2: 로컬 remote 갱신**

```powershell
cd C:\Users\dhhan\01.claude\my-tech-blog
git remote set-url origin https://github.com/hellotect2022/hellotect2022.github.io.git
git remote -v         # 확인
```

**Step 3: 3개 파일 수정**

1. `astro.config.mjs`:
   ```js
   const SITE = 'https://hellotect2022.github.io';
   const BASE = '/';                    // ← 서브패스 제거
   ```

2. `.github/workflows/deploy.yml`:
   ```yaml
   env:
     BASE_URL: /                        # ← 마찬가지
   ```

3. `src/lib/site.ts`:
   ```ts
   url: 'https://hellotect2022.github.io',   // 서브패스 없음
   ```

**Step 4: 로컬 검증**

```powershell
npm run sync
npm run build
```

`dist/` 안의 링크가 `/` 로 시작하는지 (`/my-tech-blog/` 아닌지) 확인.

**Step 5: push**

```powershell
git add -A
git commit -m "chore: migrate to user page (hellotect2022.github.io)"
git push
```

1~2분 뒤 `https://hellotect2022.github.io/` 에서 서빙 시작.

**주의사항**:
- 기존 URL로의 링크(구글/트위터/북마크)는 redirect 되지만 CDN 캐시 때문에 몇 분~수십 분 걸릴 수 있음
- OG 미리보기가 캐시되어 있으면 새 URL 반영 지연 (Facebook/Twitter debugger로 재크롤 가능)
- **⚠ Pages 리소스는 새 repo로 자동 이전되지 않음** — rename 후 첫 배포 시 `Get Pages site failed: Not Found` + `Create Pages site failed: Resource not accessible` 에러 발생 가능. 해결은 §6.1 참조 (요약: 새 repo에서도 Settings → Pages → Source = GitHub Actions 를 **다시** 설정 + Settings → Actions → Workflow permissions = Read and write 설정 후 workflow re-run).

---

## 6. 트러블슈팅

### 6.1 `Failed to create deployment (status: 404) — Ensure GitHub Pages has been enabled` ⭐

**원인**: Pages 리소스 미생성. §4.3 참조.

**해결**: workflow 에 `actions/configure-pages@v5` with `enablement: true` 스텝 추가.

#### 6.1.a Rename 후 재발 — `Get Pages site failed / Create Pages site failed: Resource not accessible`

Repo rename (예: `my-tech-blog` → `<username>.github.io`) 이후 첫 배포에서 다음 조합의 에러가 나오면:

```
Run actions/configure-pages@v5
Warning: Get Pages site failed. Error: Not Found
Error: Create Pages site failed. Error: Resource not accessible by integration
Error: HttpError: Resource not accessible by integration
```

**원인**:
- `Get Pages site failed: Not Found` = 새 repo에는 Pages 리소스가 없음 (이전 repo의 Pages 는 rename 시 자동 이전 안 됨)
- `Create Pages site failed: Resource not accessible` = `configure-pages@v5 + enablement: true` 가 자동 생성을 시도했지만 **workflow가 create 권한 부족**

Rename 시 GitHub은 URL redirect 는 자동으로 잡아주지만 Pages 리소스는 새 repo와 별개.

**해결 (두 개 다 해야 함)**:

1. **Pages 활성화 (UI에서 다시)**
   - `https://github.com/<user>/<new-repo>/settings/pages`
   - **Source** = **GitHub Actions** 로 선택
   - (이전 repo에서 설정했던 게 rename 하면서 리셋됨)

2. **Workflow 권한 상향**
   - `https://github.com/<user>/<new-repo>/settings/actions` 하단
   - **Workflow permissions** = **Read and write permissions**
   - Save

그 후 Actions 재실행 (Actions 탭 → 실패한 workflow → Re-run all jobs).

**왜 두 개 다 필요한가**:
- workflow 안 `permissions:` 블록에 `pages: write` 를 선언해도, 저장소 default 가 read-only 이면 **downgrade** 됨
- `configure-pages@v5 + enablement: true` 는 Pages 를 자동 생성해주지만 **create 권한** 이 있어야 동작
- 가장 확실: UI 활성화 + workflow 권한 상향 → 이후 workflow 는 GET 만 하면 되므로 안정

### 6.2 `Node 20 is being deprecated`

**증상**:
```
Node 20 is being deprecated. This workflow is running with Node 24 by default.
```

**해결**: `.github/workflows/deploy.yml` 의 `node-version: '20'` → `'22'` 로 상향. 경고이지 에러 아님.

### 6.3 `npm ci` 실패: `Missing: xxx`

**원인**: `package-lock.json` 이 커밋 안 됨. `.gitignore` 에 포함돼있으면 안 됨.

**해결**:
```powershell
npm install                    # package-lock.json 생성
git add package-lock.json
git commit -m "add lockfile"
```

### 6.4 배포는 성공했는데 CSS · JS · 링크가 다 깨짐

**원인**: `base` 경로 불일치. 서브패스 배포(`/repo/`) 인데 코드에서 `/blog` 같은 절대 경로 하드코딩.

**해결**:
1. `astro.config.mjs` 의 `base` 가 실제 배포 경로와 일치하는지
2. 컴포넌트에서 링크는 반드시 `import.meta.env.BASE_URL` 참조:
   ```astro
   ---
   const base = import.meta.env.BASE_URL.replace(/\/$/, '');
   ---
   <a href={`${base}/blog`}>Blog</a>
   ```

Astro는 `<a href="/blog">` 같은 정적 링크에 자동으로 base를 붙여주지만, 문자열로 조립한 경로는 수동 처리 필요.

### 6.5 첫 배포 후 잠깐 404

**원인**: DNS/CDN 캐시 전파 지연.

**해결**: 5분 정도 기다린 뒤 재시도. Actions 초록불이면 배포는 이미 성공. `/settings/pages` 상단에 "Your site is live at ..." 표시되는지 확인.

### 6.6 Sync 시 "Vault not found"

**원인**: `VAULT_PATH` 상수/환경변수가 실제 vault 위치와 다름.

**해결**: `scripts/sync-from-vault.mjs` 상단 `VAULT_PATH` 확인. 다른 PC에서는 환경변수로 override.

### 6.7 라이트 테마에서 코드 블록 검게 나옴

**원인**: Shiki dual theme 스타일이 라이트 모드에서 오버라이드됨.

**해결**: `global.css` 의 `[data-theme='light']` 블록에서 astro-code 색상 명시적으로 설정 (이미 반영됨).

---

## 7. 배포 자동화

### 7.1 옵션 검토

발행할 때마다 `npm run sync && git add -A && git commit -m "..." && git push` 4단계는 귀찮다. 자동화 옵션 검토:

| 옵션 | 방식 | 트리거 | 통제감 | 복잡도 |
|------|------|--------|--------|--------|
| **npm run deploy** | 4단계 묶은 스크립트 | 사용자가 명령 실행 | 높음 | 낮음 ⭐ |
| git alias | `git deploy` 로 등록 | 사용자가 명령 실행 | 높음 | 낮음 |
| Claude Code Stop hook | Claude 세션 종료 시 실행 | 자동 | 낮음 | 중간 |
| GitHub Actions cron | 매 시간 vault fetch 후 배포 | 자동 (시간) | 낮음 | 높음 |
| Watch daemon | vault 변경 감지 후 자동 실행 | 자동 (이벤트) | 낮음 | 중간 |

**추천: 옵션 1 (npm run deploy)** — 통제감 유지하면서 4단계 → 1단계로 압축.

너무 자동화하면 실수로 사적 페이지가 발행될 위험 (frontmatter에 published:true 잘못 붙인 경우 등). **사용자가 명시적으로 배포 명령을 내리는 게 안전**.

### 7.2 `npm run deploy` 구현

`scripts/deploy.mjs`:

```js
#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(cmd) {
  console.log(`▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

function quietOutput(cmd) {
  try { return execSync(cmd, { stdio: 'pipe' }).toString().trim(); }
  catch { return ''; }
}

// 1. Sync vault → synced/
run('node scripts/sync-from-vault.mjs');

// 2. Stage everything
run('git add -A');

// 3. If nothing to commit, exit
const staged = quietOutput('git diff --cached --name-only');
if (!staged) {
  console.log('\n✓ No changes to publish.');
  process.exit(0);
}

console.log(`\n✎ Staged files:\n${staged}\n`);

// 4. Compose commit message
const customMsg = process.argv.slice(2).join(' ').trim();
const now = new Date().toISOString().slice(0, 10);
const count = staged.split('\n').length;
const msg = customMsg || `publish: ${now} (${count} file${count > 1 ? 's' : ''})`;

// 5. Commit + push
run(`git commit -m ${JSON.stringify(msg)}`);
run('git push');

console.log(`\n✓ Deployed. Actions: https://github.com/hellotect2022/hellotect2022.github.io/actions`);
```

`package.json` scripts 에 추가:

```json
{
  "scripts": {
    "deploy": "node scripts/deploy.mjs"
  }
}
```

**사용법**:

```powershell
npm run deploy                          # 자동 커밋 메시지 ("publish: 2026-08-02 (3 files)")
npm run deploy -- "post: Rust 소유권 정리"    # 커스텀 메시지
```

**동작**:
1. `npm run sync` — vault → synced/
2. `git add -A` — 스테이징
3. 스테이지된 파일 없으면 종료
4. 스테이지 파일 목록 표시
5. `git commit -m "..."` — 자동 또는 커스텀 메시지
6. `git push` — 원격 push (Actions 트리거)

**안전장치**:
- Sync 결과가 없으면 (`published: true` 페이지 무변화) 커밋 없이 종료
- 사용자가 명령을 명시적으로 내려야 실행 (실수 방지)
- 자동 메시지에 날짜/파일수 포함 → history 보고 뭘 배포했는지 파악 쉬움

### 7.3 다른 자동화 옵션 (참고)

**Git alias**:

```powershell
git config --global alias.deploy '!npm run deploy'
# 이후 어떤 폴더에서든:
git deploy
```

**Claude Code Stop hook** (`.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "cd C:/Users/dhhan/01.claude/my-tech-blog && npm run deploy"
      }]
    }]
  }
}
```

Claude 응답 종료 때마다 자동 배포. **주의**: 개발 중이거나 실험 중일 때도 배포됨 → 의도치 않은 게 나갈 수 있음. 별로 추천 안 함.

**GitHub Actions cron** (매 시간 vault fetch 후 배포):

vault를 별도 private repo로 관리하고 CI에서 clone해오는 방식. 설정 복잡 + private repo 필요 + 매 시간 낭비.

**결론**: 옵션 1 (npm run deploy) 이 실용성 최고.

---

## 8. 일상 워크플로우

### 새 글 발행 (vault 사용)

```
Obsidian vault에서 평소대로 KB 작성
        │
        ▼ (공개하고 싶은 페이지에)
frontmatter에 published: true + blogTags 추가
        │
        ▼ (my-tech-blog 폴더에서)
npm run deploy
        │
        ▼ (~5초)
sync → commit → push 완료
        │
        ▼ (GitHub Actions 자동, 1~2분)
https://hellotect2022.github.io/blog/<slug>/ 에 반영
```

### 기존 글 수정

```
vault에서 수정 → npm run deploy
```

같은 slug 이면 덮어씀. sync 스크립트가 알아서.

### 발행 취소

vault frontmatter에서 `published: true` 제거 (또는 `false` 로) → `npm run deploy`.

sync 스크립트가 이전에 synced 됐던 파일을 자동 삭제 → build 에서 페이지 제외 → 배포에서 사라짐.

---

## 9. 커스터마이즈 지점

- **브랜딩**: `src/lib/site.ts` (title, author, email, navigation, social)
- **팔레트/폰트/간격**: `src/styles/global.css` 상단 `:root` CSS 변수
- **레이아웃**: `src/layouts/BaseLayout.astro`, `PostLayout.astro`
- **컴포넌트**: `src/components/*.astro`
- **홈페이지 히어로**: `src/pages/index.astro`
- **About 페이지**: `src/pages/about.astro`
- **Sync 대상 폴더**: `scripts/sync-from-vault.mjs` 의 `SOURCE_DIRS`

---

## 10. 명령어 치트시트

```powershell
# 개발
npm install                          # 최초 1회
npm run dev                          # 로컬 dev 서버 (HMR)
npm run build                        # 프로덕션 빌드 (자동 sync)
npm run preview                      # 빌드 결과 미리보기
npm run sync                         # vault → synced/ 수동 동기화
npm run deploy                       # sync + commit + push (자동 배포)
npm run deploy -- "커스텀 메시지"    # 위와 동일 + 메시지 지정

# 확인
git status                           # 로컬 변경사항
git log --oneline -5                 # 최근 커밋
git remote -v                        # 원격 저장소 URL

# 유지관리
npx @astrojs/upgrade                 # Astro 버전 업데이트
npm audit fix                        # 취약점 자동 수정
npm outdated                         # 오래된 패키지
```

---

## 11. 학습 포인트 (실전 회고)

1. **UI 설정과 실제 리소스는 분리** — GitHub Pages Source 를 UI에서 GitHub Actions로 선택했다고 자동으로 Pages 리소스가 생기지 않는다. `configure-pages@v5 + enablement: true` 로 확실히.
2. **에러 메시지의 링크를 정독하라** — `Ensure GitHub Pages has been enabled: <url>` 이 원인과 해결책을 이미 알려주고 있었다.
3. **선언적 배포** — UI 클릭 대신 코드(workflow.yml)로 배포 설정 표현. 재현성 · 감사성 · 협업성 모두 이득.
4. **User page vs project page 는 큰 차이** — `<username>.github.io` 로 이름 지으면 서브패스 없는 root URL. 가치 있는 이 슬롯은 대표 사이트에 할당.
5. **자동화는 실수 리스크와 트레이드오프** — Claude Stop hook 같이 완전 자동은 편하지만 실수로 사적 페이지 발행 가능. 명령형 자동화(npm run deploy)가 실용성/안전성 균형.
6. **태그 계층은 KB용, 발행에는 flat** — `blogTags` 로 분리해서 관리.

---

## 12. 참고

- Astro 공식: https://docs.astro.build
- Astro GitHub Pages 가이드: https://docs.astro.build/en/guides/deploy/github/
- Content Collections: https://docs.astro.build/en/guides/content-collections/
- View Transitions: https://docs.astro.build/en/guides/view-transitions/
- Shiki 테마: https://shiki.style/themes
- `configure-pages` 액션: https://github.com/actions/configure-pages
- `deploy-pages` 액션: https://github.com/actions/deploy-pages
- GitHub Pages: https://docs.github.com/en/pages

이 vault의 관련 페이지:
- rust-overview · rust-idioms — 블로그의 실 콘텐츠 예시
- suda-chat-architecture · simulation-architecture — Rust 스택 실사례
