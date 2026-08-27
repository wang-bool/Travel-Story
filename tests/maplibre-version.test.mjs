import assert from "node:assert/strict";
import test from "node:test";
import maplibrePackage from "maplibre-gl/package.json" with { type: "json" };

test("uses a MapLibre release containing the raster abort-controller race fix", () => {
  const [major, minor] = maplibrePackage.version.split(".").map(Number);

  assert.ok(
    major > 6 || (major === 6 && minor >= 1),
    `maplibre-gl ${maplibrePackage.version} lacks the raster abort-controller race fix`
  );
});
