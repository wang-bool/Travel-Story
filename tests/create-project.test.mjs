import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { copyProject, validateTarget } from "../lib/createProject.mjs";

async function makeTempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("validateTarget accepts a missing directory", async () => {
  const rootDir = await makeTempDir("travel-story-target-");
  const targetDir = path.join(rootDir, "new-project");

  try {
    await validateTarget(targetDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("validateTarget rejects a non-empty directory", async () => {
  const targetDir = await makeTempDir("travel-story-target-");
  await writeFile(path.join(targetDir, "existing.txt"), "exists");

  try {
    await assert.rejects(validateTarget(targetDir), /not empty/);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
});

test("copyProject writes application source and a normal app manifest", async () => {
  const sourceDir = await makeTempDir("travel-story-source-");
  const targetDir = await makeTempDir("travel-story-output-");
  const appDir = path.join(sourceDir, "app");
  const libDir = path.join(sourceDir, "lib");

  await mkdir(appDir, { recursive: true });
  await mkdir(libDir, { recursive: true });
  await writeFile(path.join(appDir, "page.tsx"), "export default function Page() { return null; }");
  await writeFile(path.join(libDir, "types.ts"), "export type Trip = { id: string };");
  await writeFile(path.join(libDir, "createProject.mjs"), "generator implementation");
  await writeFile(path.join(sourceDir, "package-lock.json"), "generator lockfile");
  await writeFile(
    path.join(sourceDir, "package.json"),
    JSON.stringify({
      name: "@wang-bool/create-travel-story",
      private: false,
      bin: { "create-travel-story": "bin/create-travel-story.mjs" },
      files: ["app"],
      scripts: { dev: "next dev", test: "node --test" },
    }),
  );

  try {
    await copyProject({ sourceDir, targetDir });

    assert.equal(
      await readFile(path.join(targetDir, "app", "page.tsx"), "utf8"),
      "export default function Page() { return null; }",
    );

    const manifest = JSON.parse(await readFile(path.join(targetDir, "package.json"), "utf8"));
    assert.equal(manifest.name, "travel-story");
    assert.equal(manifest.private, undefined);
    assert.equal(manifest.bin, undefined);
    assert.equal(manifest.files, undefined);
    assert.deepEqual(manifest.scripts, { dev: "next dev", test: "node --test" });
    await assert.rejects(readFile(path.join(targetDir, "lib", "createProject.mjs"), "utf8"), /ENOENT/);
    await assert.rejects(readFile(path.join(targetDir, "package-lock.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});
