# Local Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Travel Story as an npm-backed local-project generator and document its repository listing and submission copy.

**Architecture:** The repository is itself the npm package. A Node executable copies a selected allowlist of source paths into a new directory, writes a normal application `package.json`, and optionally runs `npm install`. A small utility module owns validation and copy rules so unit tests do not invoke npm or write outside temporary directories.

**Tech Stack:** Node.js 20, Node test runner, npm, TypeScript application source.

---

### Task 1: Generator utility and tests

**Files:**
- Create: `bin/create-travel-story.mjs`
- Create: `lib/createProject.mjs`
- Create: `tests/create-project.test.mjs`
- Modify: `package.json`

- [x] **Step 1: Write failing tests**

Add Node tests that import `copyProject` and `validateTarget` from `lib/createProject.mjs`. Test a missing target, a non-empty target, a copied `app/page.tsx`, and generated `package.json` with `name: "travel-story"` and no `bin` field.

- [x] **Step 2: Run the test file**

Run: `node --test tests/create-project.test.mjs`

Expected: FAIL because `lib/createProject.mjs` does not exist.

- [x] **Step 3: Implement the utility**

Implement `validateTarget(targetDir)` with `fs.stat`, `fs.readdir`, and explicit errors. Implement `copyProject({ sourceDir, targetDir })` with a fixed list of application paths. Copy files recursively with `fs.cp`, omit `package-lock.json`, write a package manifest without `private`, `bin`, `files`, and generator-only scripts, and write `.gitignore`.

- [x] **Step 4: Run the test file**

Run: `node --test tests/create-project.test.mjs`

Expected: PASS.

- [x] **Step 5: Add the executable and package scripts**

Implement `bin/create-travel-story.mjs`. Parse `[directory]` and `--skip-install`; require Node 20; check `ffmpeg`; call the utility; run `npm install` in the target unless skipped. Set npm metadata, `bin`, `files`, `test`, and `check` in `package.json`.

- [x] **Step 6: Run the generator in a temporary directory**

Run: `node bin/create-travel-story.mjs /tmp/travel-story-generator-test --skip-install`

Expected: target contains app source and a normal app package manifest; command exits 0.

- [x] **Step 7: Commit**

```bash
git add bin/create-travel-story.mjs lib/createProject.mjs tests/create-project.test.mjs package.json
git commit -m "feat: add npx project generator"
```

### Task 2: README and submission material

**Files:**
- Modify: `README.md`
- Create: `docs/repository-listing.md`

- [x] **Step 1: Add README quick start**

Add the scoped `npx` command before the existing manual clone instructions. State that npm publication is required before the command is public and keep the existing Node and FFmpeg requirements.

- [x] **Step 2: Write repository listing document**

Record a GitHub description, 13 topics, direct submission links, and short Chinese and English copy. State that awesome-selfhosted submission waits for a first release older than four months.

- [x] **Step 3: Run documentation checks**

Run: `rg -n 'TODO|TBD|—' README.md docs/repository-listing.md`

Expected: no matches.

- [x] **Step 4: Commit**

```bash
git add README.md docs/repository-listing.md
git commit -m "docs: add launch and submission guide"
```

### Task 3: Release verification

**Files:**
- Verify only

- [x] **Step 1: Run release checks**

Run: `npm run check && npm pack --dry-run`

Expected: tests, type check, and production build pass; the npm file list excludes runtime data and dependencies.

- [x] **Step 2: Inspect the generated project**

Run: `node bin/create-travel-story.mjs /tmp/travel-story-generator-test --skip-install && test -f /tmp/travel-story-generator-test/app/page.tsx && test ! -e /tmp/travel-story-generator-test/node_modules`

Expected: command exits 0.

- [x] **Step 3: Commit only if verification required a source change**

Run `git status --short`. If verification changed no tracked source files, create no additional commit. If a source fix was required, stage that named file and commit it with `fix: prepare npm distribution`.
