#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { copyProject } from "../lib/createProject.mjs";

function printUsage() {
  console.log("Usage: npx @wang-bool/create-travel-story [directory] [--skip-install]");
}

function parseArguments(args) {
  let targetName;
  let skipInstall = false;

  for (const arg of args) {
    if (arg === "--skip-install") {
      skipInstall = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (targetName) {
      throw new Error("Only one target directory is allowed.");
    } else {
      targetName = arg;
    }
  }

  return { skipInstall, targetName: targetName || "travel-story" };
}

function requireNode20() {
  const majorVersion = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (majorVersion < 20) {
    throw new Error(`Node.js 20 or later is required. Found ${process.versions.node}.`);
  }
}

function warnWhenFfmpegMissing() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    console.warn("ffmpeg was not found. Planning works, but MP4 export needs ffmpeg in PATH.");
  }
}

function installDependencies(targetDir) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["install"], {
    cwd: targetDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("npm install failed.");
  }
}

async function main() {
  requireNode20();
  const { skipInstall, targetName } = parseArguments(process.argv.slice(2));
  const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targetDir = path.resolve(process.cwd(), targetName);

  await copyProject({ sourceDir, targetDir });
  warnWhenFfmpegMissing();

  if (!skipInstall) {
    console.log("Installing dependencies...");
    installDependencies(targetDir);
  }

  console.log(`\nTravel Story is ready in ${targetDir}`);
  console.log(`cd ${targetName}`);
  console.log("cp .env.example .env.local");
  console.log("npm run dev");
}

main().catch((error) => {
  console.error(`\nUnable to create Travel Story: ${error.message}`);
  process.exitCode = 1;
});
