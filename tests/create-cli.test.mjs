import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawn } from "node:child_process";

const repositoryDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repositoryDir, "bin", "create-travel-story.mjs");

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repositoryDir,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code));
  });
}

test("generator creates a project without installing dependencies when requested", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "travel-story-cli-"));
  const targetDir = path.join(rootDir, "my-travel-story");

  try {
    assert.equal(await runCli([targetDir, "--skip-install"]), 0);
    await access(path.join(targetDir, "app", "page.tsx"));
    await assert.rejects(access(path.join(targetDir, "node_modules")), /ENOENT/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
