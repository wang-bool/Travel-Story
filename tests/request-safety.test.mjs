import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestTooLargeError,
  declaredBodyExceeds,
  getLimitBytes,
  isAllowedMediaType,
  isAllowedVideoType,
  isFrameName,
  isMediaId,
  isSessionId,
  readBodyWithinLimit,
  safeDisplayName,
} from "../lib/server/requestSafety.ts";

test("declared body size handles missing, valid, and malformed headers", () => {
  assert.equal(declaredBodyExceeds(new Headers(), 8), false);
  assert.equal(declaredBodyExceeds(new Headers({ "content-length": "8" }), 8), false);
  assert.equal(declaredBodyExceeds(new Headers({ "content-length": "9" }), 8), true);
  assert.equal(declaredBodyExceeds(new Headers({ "content-length": "abc" }), 8), false);
});

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
  const make = (size) => ({
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
