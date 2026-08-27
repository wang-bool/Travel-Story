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

test("corrupt direct MP4 uploads are rejected and retried through JPEG fallback", async () => {
  const [offline, recordings] = await Promise.all([
    readFile(new URL("../lib/record/offline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/recordings/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(recordings, /async function validateMp4\(/);
  assert.match(recordings, /await validateMp4\(rawPath\)/);
  assert.match(offline, /run\(true\)/);
});
