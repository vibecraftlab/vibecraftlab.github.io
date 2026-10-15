# llm-wiki-site — Quartz 툴체인 (내부 위키 + 공개 사이트)

Obsidian vault `G:\내 드라이브\llm-wiki` 의 두 가지 출력을 **Quartz v5 하나**로 만든다.

| 빌드 | 입력 | 명령 | 결과 |
|---|---|---|---|
| **내부** | vault 전체 (`.obsidian` `.claude` `_specs` `_templates` 제외) | `npm run internal` | `http://localhost:8080` — 나만 봄. 커밋·push 하지 않는다 |
| **공개** | `content/` ← `scripts/sync-public.mjs` 가 vault 에서 `published: true` + `pubDate` 페이지만 걸러 넣음 | `npm run publish` | push → GitHub Actions → `https://vibecraftlab.github.io/` |

설계·규칙은 vault 의 `CLAUDE.md` §7·§11 과 `_specs/2026-09-30-llm-wiki-design.md` §5.6. 이 README 는 명령 치트시트다.

## 명령

```powershell
cd C:\Users\dhhan1\01.claude\llm-wiki-site

npm run internal                 # 내부 위키 서빙 (Ctrl+C 로 종료). vault 를 고치면 자동 반영
npm run internal -- --once       # 빌드만 (public/ 에 결과)

npm run check                    # 발행 검사만 — 무엇이 나가고 무엇이 왜 막히는지. 아무것도 안 씀
npm run sync                     # vault → content/ (차단이 하나라도 있으면 중단)
npm run publish                  # sync → commit → push (사람이 직접 실행할 때만)
npm run publish -- "post: 제목"  # 커밋 메시지 지정

node --test scripts/sync-public.test.mjs   # sync 테스트 12건
npm run typecheck                # Quartz 자체 tsc/prettier (업스트림 check)
```

## 발행 규칙 (sync 가 강제)

- 공개 허용 폴더: `study/wiki` `vibecraft/wiki` `tooling/wiki` `research/wiki`. `mpole/` `**/raw/` 는 플래그가 있어도 **거부**.
- 게이트: frontmatter `published: true` **와** `pubDate`. `draft: true` 는 조용히 제외.
- 비밀 패턴(vault `.claude/hooks/patterns.js`, 쓰기 훅과 같은 정본)에 걸리면 **전체 중단**, 파일·줄 출력. 조용히 지우지 않는다.
- 미공개 페이지로의 `[[링크]]` 는 글자만 남긴다 + 목록 출력("그것도 공개할까?").
- 첨부는 `{domain}/assets/public/` 아래만 복사. 그 외 `![[…]]` 는 `[첨부 생략]`.
- 공개 frontmatter: `title` `description`(=description ?? summary) `date`(=pubDate) `modified`(=updated) `tags`(=blogTags ?? tags 마지막 세그먼트) `publish: true`. 나머지 키는 제거.
- `content/` 는 sync 가 소유 — 손으로 넣은 파일은 다음 sync 에서 삭제된다.

## 새 PC 체크리스트

1. Node 24+, git, (Drive 동기화된) vault
2. `git clone https://github.com/vibecraftlab/vibecraftlab.github.io.git llm-wiki-site && cd llm-wiki-site`
3. `npm i` → `npx quartz plugin install --from-config`
4. vault 위치가 다르면 `$env:VAULT_PATH = "D:\path\llm-wiki"` (PowerShell) 후 명령 실행
5. 업스트림 갱신: `git remote add upstream https://github.com/jackyzha0/quartz.git` → `git fetch upstream v5` → 필요할 때 merge

## 설정 메모 (`quartz.config.yaml`)

- 내부·공개 공용 한 벌. `ignorePatterns` 의 vault 전용 항목은 `content/` 에 없으므로 공개 빌드에 무해.
- `latex` off(본문 `$5` 오인) · `og-image` off(빌드 시간) · `explicit-publish` off(sync 가 거른다) · `remove-draft` on · `bases-page` on(`.base` 대시보드가 내부 위키에서 표로 렌더).
- 첫 빌드에서 `@quartz-themes/default` 가 런타임 `npm install` 로 설치된다 → 그 빌드는 실패하고 두 번째부터 성공.
- Quartz v5 는 `slug.html` 로 내보낸다 (`slug/index.html` 아님).
