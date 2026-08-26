# Travel Story Open-Source Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare Travel Story for a public MIT release without deleting the owner's local trips, media, recordings, tile cache, or API keys.

**Architecture:** Keep the single-user Next.js application and flat-file storage. Add one server-only request-safety module shared by API routes, harden writes at the storage boundary, remove proven dead code and generated screenshots, then document the application and its deployment limits. Dependency versions and the lockfile remain unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Node.js built-in test runner, MapLibre GL, flat-file storage, FFmpeg.

---

## File map

Create `lib/server/requestSafety.ts`, `tests/request-safety.test.mjs`, `README.md`, `LICENSE`, and two QR assets below `public/readme/`.

Modify `.gitignore`, `.env.example`, `lib/server/db.ts`, trip/media/recording API routes, four files with proven resource or unused-code cleanup, and `需求文档.md`.

Delete the four PNG files below `测试截图/`. Keep `package.json`, `package-lock.json`, `.env.local`, `data/`, and `tile-cache/` unchanged.

### Task 1: Repository hygiene

**Files:**
- Modify: `.gitignore`
- Delete: `测试截图/*.png`

- [ ] **Step 1: Record the local-data baseline**

Run:

```bash
find data -type f -printf '%s\t%p\n' | sort > /tmp/travel-story-data-before.txt
find tile-cache -type f -printf '%s\t%p\n' | sort > /tmp/travel-story-tiles-before.txt
```

Expected: both commands complete without changing either directory.

- [ ] **Step 2: Add ignore rules**

Add the following rules and stop ignoring `next-env.d.ts`, which is part of the TypeScript project baseline:

```gitignore
# 日志与测试输出
*.log
coverage/

# 编辑器与系统文件
.vscode/
.idea/
Thumbs.db

# 临时文件
*.tmp
*.temp

# 隔离开发工作树
.worktrees/
```

- [ ] **Step 3: Delete obsolete screenshots**

Delete these exact files and remove the empty directory:

```text
测试截图/截图 2026-08-26 13-38-12.png
测试截图/截图 2026-08-26 15-11-24.png
测试截图/截图 2026-08-26 15-13-30.png
测试截图/截图 2026-08-26 15-22-29.png
```

- [ ] **Step 4: Rename the branch and verify ignored files**

```bash
git branch -m main
git check-ignore -v .env.local data/trips.json tile-cache/_tilejson.json .next/build-manifest.json node_modules/next/package.json tsconfig.tsbuildinfo
git status --short --ignored
```

Expected: every listed local file is ignored and nothing below `data/` or `tile-cache/` is tracked.

- [ ] **Step 5: Confirm local data did not change**

```bash
find data -type f -printf '%s\t%p\n' | sort > /tmp/travel-story-data-after.txt
find tile-cache -type f -printf '%s\t%p\n' | sort > /tmp/travel-story-tiles-after.txt
diff -u /tmp/travel-story-data-before.txt /tmp/travel-story-data-after.txt
diff -u /tmp/travel-story-tiles-before.txt /tmp/travel-story-tiles-after.txt
```

Expected: both diffs are empty.

- [ ] **Step 6: Commit the complete source baseline**

```bash
git add .env.example .gitignore app components lib next-env.d.ts next.config.ts package.json package-lock.json scripts tsconfig.json 需求文档.md docs
git commit -m "chore: add Travel Story source baseline"
```

### Task 2: Tested request-safety module

**Files:**
- Create: `lib/server/requestSafety.ts`
- Create: `tests/request-safety.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/request-safety.test.mjs`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestTooLargeError,
  getLimitBytes,
  isAllowedMediaType,
  isAllowedVideoType,
  isFrameName,
  isMediaId,
  isSessionId,
  readBodyWithinLimit,
  safeDisplayName,
} from "../lib/server/requestSafety.ts";

test("limit parsing uses defaults and accepts positive decimal MB values", () => {
  assert.equal(getLimitBytes(undefined, 10), 10 * 1024 * 1024);
  assert.equal(getLimitBytes("0", 10), 10 * 1024 * 1024);
  assert.equal(getLimitBytes("-4", 10), 10 * 1024 * 1024);
  assert.equal(getLimitBytes("abc", 10), 10 * 1024 * 1024);
  assert.equal(getLimitBytes("1.5", 10), Math.floor(1.5 * 1024 * 1024));
});

test("declared oversize is rejected before reading", async () => {
  let read = false;
  const request = {
    headers: new Headers({ "content-length": "9" }),
    async arrayBuffer() {
      read = true;
      return new Uint8Array(9).buffer;
    },
  };
  await assert.rejects(() => readBodyWithinLimit(request, 8), RequestTooLargeError);
  assert.equal(read, false);
});

test("actual oversize is rejected and exact limit passes", async () => {
  const make = (size: number) => ({
    headers: new Headers(),
    async arrayBuffer() {
      return new Uint8Array(size).buffer;
    },
  });
  await assert.rejects(() => readBodyWithinLimit(make(9), 8), RequestTooLargeError);
  assert.equal((await readBodyWithinLimit(make(8), 8)).length, 8);
});

test("identifiers reject traversal and malformed values", () => {
  assert.equal(isMediaId("media_123-abc"), true);
  assert.equal(isMediaId("../secret"), false);
  assert.equal(isMediaId("a".repeat(129)), false);
  assert.equal(isSessionId("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isSessionId("!!!"), false);
  assert.equal(isFrameName("000042.jpg"), true);
  assert.equal(isFrameName("../42.jpg"), false);
  assert.equal(isFrameName("42.png"), false);
});

test("MIME checks allow images and matching supported videos", () => {
  assert.equal(isAllowedMediaType("image/jpeg"), true);
  assert.equal(isAllowedMediaType("video/quicktime"), true);
  assert.equal(isAllowedMediaType("application/octet-stream"), true);
  assert.equal(isAllowedMediaType("text/html"), false);
  assert.equal(isAllowedVideoType("video/mp4", "mp4"), true);
  assert.equal(isAllowedVideoType("video/webm;codecs=vp9", "webm"), true);
  assert.equal(isAllowedVideoType("video/mp4", "webm"), false);
});

test("display names remove controls and stay bounded", () => {
  assert.equal(safeDisplayName("a\u0000b", "fallback"), "ab");
  assert.equal(safeDisplayName("", "fallback"), "fallback");
  assert.equal(safeDisplayName("x".repeat(300), "fallback").length, 200);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --no-warnings --experimental-strip-types tests/request-safety.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the module**

Create `lib/server/requestSafety.ts`:

```ts
const BYTES_PER_MB = 1024 * 1024;

export class RequestTooLargeError extends Error {
  constructor() {
    super("request-too-large");
    this.name = "RequestTooLargeError";
  }
}

type BodyRequest = {
  headers: Headers;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function getLimitBytes(raw: string | undefined, fallbackMb: number): number {
  const parsed = Number(raw);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  return Math.floor(mb * BYTES_PER_MB);
}

export async function readBodyWithinLimit(req: BodyRequest, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestTooLargeError();
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > maxBytes) throw new RequestTooLargeError();
  return body;
}

export const isMediaId = (value: string): boolean =>
  /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const isSessionId = (value: string): boolean =>
  /^[A-Za-z0-9-]{1,64}$/.test(value);

export const isFrameName = (value: string): boolean =>
  /^\d{6}\.jpg$/.test(value);

export function isAllowedMediaType(value: string): boolean {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  return type === "application/octet-stream" ||
    /^image\/[a-z0-9.+-]+$/.test(type) ||
    /^video\/[a-z0-9.+-]+$/.test(type);
}

export function isAllowedVideoType(value: string, ext: "mp4" | "webm"): boolean {
  const type = value.split(";", 1)[0].trim().toLowerCase();
  return ext === "mp4" ? type === "video/mp4" : type === "video/webm";
}

export function safeDisplayName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
  return cleaned || fallback;
}
```

- [ ] **Step 4: Verify GREEN**

```bash
node --no-warnings --experimental-strip-types tests/request-safety.test.mjs
npx tsc --noEmit --incremental false
```

Expected: six tests pass and TypeScript exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/server/requestSafety.ts tests/request-safety.test.mjs
git commit -m "test: define server request safety rules"
```

### Task 3: Bounded trip and media writes

**Files:**
- Modify: `lib/server/db.ts`
- Modify: `app/api/trips/route.ts`
- Modify: `app/api/media/route.ts`

- [ ] **Step 1: Add atomic file writes**

Add to `lib/server/db.ts`:

```ts
async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}
```

Import `randomUUID` from `node:crypto`. Use the helper for `TRIPS_FILE`, the media body, and the media sidecar. Remove the old trip-specific temporary-file code.

- [ ] **Step 2: Bound trip JSON**

In `app/api/trips/route.ts`, use `MAX_TRIPS_BODY_MB` with fallback 10 and `readBodyWithinLimit`. Decode UTF-8, parse JSON, and accept only a non-null object with an array property named `trips`. Return `request-too-large` with 413, `invalid-json` with 400, `invalid-trips` with 400, and `write-failed` with 500. Log unexpected errors on the server. Never return `String(e)`.

- [ ] **Step 3: Bound media uploads**

In `app/api/media/route.ts`, require `isMediaId(id)`, normalize the name with `safeDisplayName`, require `isAllowedMediaType`, and use `MAX_MEDIA_UPLOAD_MB` with fallback 250. Return stable codes `invalid-media-id`, `unsupported-media-type`, `empty-file`, `request-too-large`, and `upload-failed`.

- [ ] **Step 4: Verify**

```bash
node --no-warnings --experimental-strip-types tests/request-safety.test.mjs
npm run typecheck
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server/db.ts app/api/trips/route.ts app/api/media/route.ts
git commit -m "fix: bound trip and media writes"
```

### Task 4: Recording validation

**Files:**
- Modify: `app/api/recordings/route.ts`
- Modify: `app/api/recordings/frames/route.ts`

- [ ] **Step 1: Validate complete recordings**

Require an exact `mp4` or `webm` extension, a matching video MIME type, and `MAX_RECORDING_UPLOAD_MB` with fallback 512. Return 400 for `invalid-video-extension`, `unsupported-video-type`, or `empty-video`; return 413 for `request-too-large`; return 500 `recording-failed` for unexpected errors. Keep the current WebM preservation fallback after FFmpeg failure.

- [ ] **Step 2: Validate frame sessions**

Change `framesDir` to reject sessions unless `isSessionId` passes. POST and DELETE return 400 `invalid-session`. The input `!!!` must never resolve to `frames-`.

- [ ] **Step 3: Validate JPEG batches**

Before `formData()`, reject a declared length above `MAX_FRAME_BATCH_MB`, fallback 64. After parsing, sum `File.size` and return 413 when the real total exceeds the limit. Require every entry to be a `File`, every name to pass `isFrameName`, and every MIME to equal `image/jpeg`. Validate the whole batch before creating the directory or writing any file.

- [ ] **Step 4: Validate finalize**

Call `fs.stat(dir)` before FFmpeg and return 400 `missing-frames` if the frame directory does not exist. Keep FPS in the 1 through 120 range with fallback 60. Log unexpected errors and return 500 `frame-processing-failed`.

- [ ] **Step 5: Verify and commit**

```bash
node --no-warnings --experimental-strip-types tests/request-safety.test.mjs
npm run typecheck
npm run build
git add app/api/recordings/route.ts app/api/recordings/frames/route.ts
git commit -m "fix: validate recording uploads"
```

Expected: tests, typecheck, and production build pass before the commit.

### Task 5: Proven code cleanup

**Files:**
- Modify: `components/PlanTimeline.tsx`
- Modify: `components/TravelMap.tsx`
- Modify: `lib/record/realtime.ts`
- Modify: `lib/record/offline.ts`

- [ ] **Step 1: Reproduce the unused import**

```bash
npx tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters
```

Expected: only `TripDay` in `components/PlanTimeline.tsx` is reported.

- [ ] **Step 2: Remove `TripDay` from the type import**

Keep `Transport`, `Trip`, and `TripStop`.

- [ ] **Step 3: Unregister map listeners**

Before `mapEngine.destroy()` in `components/TravelMap.tsx`, add:

```ts
mapEngine.map.off("move", schedule);
mapEngine.map.off("resize", schedule);
```

- [ ] **Step 4: Stop captured media tracks**

In `recordRealtime`, store `compositor.canvas.captureStream(fps)` in `let stream: MediaStream | null`. Pass it to `MediaRecorder`. In `finally`, add:

```ts
stream?.getTracks().forEach((track) => track.stop());
```

- [ ] **Step 5: Close the offline MessageChannel**

Declare `let yieldChannel: MessageChannel | null = null` outside the async render body, assign it where the channel is created, and close both ports in `finally`:

```ts
yieldChannel?.port1.close();
yieldChannel?.port2.close();
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters
npm run build
git add components/PlanTimeline.tsx components/TravelMap.tsx lib/record/realtime.ts lib/record/offline.ts
git commit -m "refactor: release map and recording resources"
```

Expected: strict unused-code checking and production build pass.

### Task 6: Open-source documents and assets

**Files:**
- Modify: `.env.example`
- Create: `README.md`
- Create: `LICENSE`
- Create: `public/readme/wechat-official-account.jpg`
- Create: `public/readme/wechat-group.png`
- Modify: `需求文档.md`

- [ ] **Step 1: Add upload settings**

Append to `.env.example`:

```dotenv
# 可选上传限制，单位 MB。留空时使用注释中的默认值
MAX_MEDIA_UPLOAD_MB=250
MAX_RECORDING_UPLOAD_MB=512
MAX_FRAME_BATCH_MB=64
MAX_TRIPS_BODY_MB=10
```

- [ ] **Step 2: Add MIT license**

Use the standard MIT text and this line:

```text
Copyright (c) 2026 王不二丶bOol
```

- [ ] **Step 3: Copy QR images**

Copy the provided 344 × 344 JPEG to `public/readme/wechat-official-account.jpg` and the 939 × 1491 PNG to `public/readme/wechat-group.png`. Verify both with `file`.

- [ ] **Step 4: Write README**

Use these top-level sections:

```markdown
# Travel Story
## 项目截图
## 已实现功能
## 运行环境
## 安装与启动
## 地图与第三方服务
## 本地数据与备份
## 自部署边界
## 已知问题
## 开源许可
## 关注与交流
```

Describe only implemented behavior. Require Node.js 20 or newer, npm, and FFmpeg. Show install, environment copy, development, build, and start commands. Explain both map keys and four upload limits. Explain `data/`, `tile-cache/`, the lack of authentication, and the three accepted high-severity audit findings. List all five requested screenshot filenames but embed only files that exist. Show the two QR images side by side and state that the group QR may expire.

- [ ] **Step 5: Update `需求文档.md`**

Replace the stale feature sequence with sections for document status, positioning, current user flow, implemented Plan/Record/Story/map/storage behavior, partial features, missing features, current data model, actual architecture, fallbacks, open-source boundaries, and development order.

Mark trip CRUD, day and stop editing, place search, transport routes, both base maps, globe footprints, playback, stop media, realtime recording, WebM conversion, both orientations, both resolutions, and 30/60 FPS as implemented.

Mark reverse-geocoded footprint metadata, cache prewarming, browser-dependent WebCodecs, JPEG fallback, FFmpeg, and NVENC as partial or environment-dependent.

Mark accounts, multi-user isolation, public sharing, cloud storage, AI planning and copy, automatic EXIF reconstruction, music templates, and collaboration as not implemented. Name the actual modules under `lib/store.ts`, `lib/server/db.ts`, `lib/map/`, and `lib/record/`.

- [ ] **Step 6: Check and commit docs**

```bash
rg -n 'TODO|TBD|NEXT_PUBLIC_(GAODE|LOCATIONIQ)|GAODE_KEY=.+|LOCATIONIQ_KEY=.+' README.md 需求文档.md .env.example LICENSE
git add .env.example README.md LICENSE public/readme 需求文档.md
git commit -m "docs: prepare Travel Story for open source"
```

Expected: no placeholder markers, public key names, or populated key values.

### Task 7: Final verification

**Files:**
- Verify all tracked project files

- [ ] **Step 1: Run code checks**

```bash
npm run typecheck
npx tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters
node --no-warnings --experimental-strip-types tests/request-safety.test.mjs
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Run audit without changing dependencies**

```bash
npm audit --json --registry=https://registry.npmjs.org
```

Expected: accepted findings for Next.js, PostCSS, and sharp remain. Do not run `npm audit fix`.

- [ ] **Step 3: Scan filenames for secrets**

```bash
rg -l --hidden --glob '!.git/**' --glob '!node_modules/**' --glob '!.next/**' --glob '!data/**' --glob '!tile-cache/**' --glob '!.env.local' '(-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})' .
```

Expected: no filenames. The command must not print secret values.

- [ ] **Step 4: Verify the Git release surface**

```bash
git status --short --ignored
git ls-files
git check-ignore -v .env.local data/trips.json tile-cache/_tilejson.json .next/build-manifest.json node_modules/next/package.json tsconfig.tsbuildinfo
git diff --check
```

Expected: local secrets, user data, caches, dependencies, and generated builds are ignored; `测试截图/` is absent.

- [ ] **Step 5: Recheck local files**

Repeat the two `find` snapshots from Task 1 and compare them with the `before` files in `/tmp`. Explain any cache addition created by verification; do not delete user files.

- [ ] **Step 6: Review history**

```bash
git log --oneline --decorate -8
git status --short
```

Expected: separate commits for hygiene, validation, resource cleanup, and documentation, with no secret or local data staged.
