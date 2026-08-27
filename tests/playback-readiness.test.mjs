import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("playback starts once the map style is ready instead of waiting for every tile", async () => {
  const source = await readFile(new URL("../lib/map/playback.ts", import.meta.url), "utf8");
  const readiness = source.match(/const whenLoaded = \(\) =>[\s\S]*?\n    \}\);/);

  assert.ok(readiness, "playback readiness guard must exist");
  // 业务图层（ensureLayers 在 load/style.load 后必然建好）就绪即放行，
  // 不依赖「所有瓦片下载完成」——否则国内栅格底图预热后会永久卡在播放前
  assert.match(readiness[0], /getLayer\("ts-vehicle"\)/);
  assert.doesNotMatch(readiness[0], /engine\.map\.loaded\(\)/);
  // 超时兜底：style.load 事件丢失时也不能挂死
  assert.match(readiness[0], /setTimeout\(finish/);
});
