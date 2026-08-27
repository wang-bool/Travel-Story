import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("record page renders offline (frame-exact) instead of realtime capture", async () => {
  const page = await readFile(
    new URL("../app/trip/[id]/record/page.tsx", import.meta.url),
    "utf8"
  );

  // 逐帧离线渲染：帧间隔严格相等、绝不掉帧，根治「生成过程顺、成片跳点」的掉帧
  assert.match(page, /renderOffline\(\{/);
  assert.doesNotMatch(page, /recordRealtime\(\{/);
  // 合成器必须走离线模式（直读地图画布 + renderFrame），不开 captureStream
  assert.match(page, /offline:\s*true/);
});
