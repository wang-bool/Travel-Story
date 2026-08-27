import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_PATHS = [
  ".env.example",
  ".gitignore",
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "next-env.d.ts",
  "next.config.ts",
  "tsconfig.json",
  "需求文档.md",
  "app",
  "components",
  "lib",
  "public",
  "scripts",
  "tests",
];

const DEFAULT_GITIGNORE = `node_modules/
.next/
out/
*.tsbuildinfo
.DS_Store
.worktrees/
*.log
coverage/
.vscode/
.idea/
Thumbs.db
*.tmp
*.temp
.env
.env.local
.env.*.local
tile-cache/
data/
`;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateTarget(targetDir) {
  try {
    const targetStat = await stat(targetDir);
    if (!targetStat.isDirectory()) {
      throw new Error(`Target path is not a directory: ${targetDir}`);
    }

    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory is not empty: ${targetDir}`);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function createAppManifest(generatorManifest) {
  const {
    bin: _bin,
    files: _files,
    private: _private,
    publishConfig: _publishConfig,
    ...appManifest
  } = generatorManifest;

  return {
    ...appManifest,
    name: "travel-story",
  };
}

export async function copyProject({ sourceDir, targetDir }) {
  await validateTarget(targetDir);
  await mkdir(targetDir, { recursive: true });

  for (const relativePath of PROJECT_PATHS) {
    const sourcePath = path.join(sourceDir, relativePath);
    if (await exists(sourcePath)) {
      await cp(sourcePath, path.join(targetDir, relativePath), { recursive: true });
    }
  }

  await rm(path.join(targetDir, "lib", "createProject.mjs"), { force: true });
  await rm(path.join(targetDir, "package-lock.json"), { force: true });

  const generatorManifest = JSON.parse(
    await readFile(path.join(sourceDir, "package.json"), "utf8"),
  );
  await writeFile(
    path.join(targetDir, "package.json"),
    `${JSON.stringify(createAppManifest(generatorManifest), null, 2)}\n`,
  );

  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, DEFAULT_GITIGNORE);
  }
}
