# Reliable Recording Encoder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent corrupt WebCodecs H.264 output while retaining the fast offline WebCodecs recording path and automatic JPEG/FFmpeg recovery.

**Architecture:** The WebCodecs probe requests software H.264 only; if unavailable it selects the existing parallel JPEG frame-sequence sink and server-side NVENC/x264 assembly. Direct browser MP4s are keyframe-decoded by FFmpeg before delivery; an error triggers a one-time complete JPEG/FFmpeg re-render.

**Tech Stack:** Next.js 15, TypeScript, browser WebCodecs, mp4-muxer, Node.js built-in test runner, FFmpeg.

---

### Task 1: Lock the encoder-selection contract with a regression test

**Files:**
- Create: `tests/record-encoder-reliability.test.mjs`
- Modify: `lib/record/offline.ts:250-283`

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("offline recording requests software H.264 and retains JPEG fallback", async () => {
  const source = await readFile(
    new URL("../lib/record/offline.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /hardwareAcceleration:\s*"prefer-software"/);
  assert.doesNotMatch(source, /hardwareAcceleration:\s*"prefer-hardware"/);
  assert.match(source, /:\s*createJpegSink\(session, trip\.name, fps\)/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/record-encoder-reliability.test.mjs`

Expected: FAIL because `pickEncoderConfig` still requests `prefer-hardware`.

- [ ] **Step 3: Implement the minimum encoder preference change**

```ts
const candidates: VideoEncoderConfig[] = [
  { ...base, hardwareAcceleration: "prefer-software" } as VideoEncoderConfig,
];
```

Update the adjacent comments to describe software WebCodecs as the primary path and JPEG/FFmpeg as the compatibility fallback. Leave bitrate, frame timestamps, muxing, JPEG quality, batching, NVENC, and x264 settings unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/record-encoder-reliability.test.mjs`

Expected: PASS with 1 test and 0 failures.

- [ ] **Step 5: Commit the implementation and test**

```bash
git add lib/record/offline.ts tests/record-encoder-reliability.test.mjs
git commit -m "fix: prefer reliable software recording encoder"
```

### Task 2: Reject invalid direct MP4s and retry once with JPEG/FFmpeg

**Files:**
- Modify: `app/api/recordings/route.ts:43-105`
- Modify: `lib/record/offline.ts:91-261`
- Modify: `tests/record-encoder-reliability.test.mjs`

- [ ] **Step 1: Extend the failing regression test**

```js
assert.match(recordings, /async function validateMp4\(/);
assert.match(recordings, /await validateMp4\(rawPath\)/);
assert.match(offline, /run\(true\)/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/record-encoder-reliability.test.mjs`

Expected: FAIL because direct MP4 uploads are written without validation and the renderer has no retry path.

- [ ] **Step 3: Add server validation and client retry**

```ts
await validateMp4(rawPath); // FFmpeg decodes keyframes with -v error
```

Return `422 { error: "invalid-video-stream" }` after deleting an invalid direct MP4. In `renderOffline`, wrap the initial WebCodecs run; on a WebCodecs encoder, muxer, upload, or validation failure, run once more with `forceJpeg: true`. Do not retry cancellation or JPEG/FFmpeg failures.

- [ ] **Step 4: Run the regression test and typecheck**

Run: `node --test tests/record-encoder-reliability.test.mjs && npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Verify a known corrupt MP4 through the API**

Run: `curl -X POST 'http://127.0.0.1:3001/api/recordings?trip=validation-test&ext=mp4' -H 'Content-Type: video/mp4' --data-binary '@data/recordings/20260827082532-说走咱就走.mp4'`

Expected: HTTP 422 and `{ "error": "invalid-video-stream" }`.

### Task 3: Verify project-level compatibility

**Files:**
- Verify: `lib/record/offline.ts`
- Verify: `tests/record-encoder-reliability.test.mjs`

- [ ] **Step 1: Run all Node regression tests**

Run: `node --test tests/*.test.mjs`

Expected: every test passes, including the new encoder reliability test.

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Inspect the scoped diff**

Run: `git diff HEAD^ -- lib/record/offline.ts tests/record-encoder-reliability.test.mjs`

Expected: only the encoder preference/comment update and its regression test appear.
