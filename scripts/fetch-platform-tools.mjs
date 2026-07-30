/**
 * 下载 Google platform-tools 到 platform-tools/{windows|darwin|linux}/
 * 用法:
 *   pnpm fetch:adb              # 当前系统
 *   pnpm fetch:adb -- windows   # 指定平台
 *   pnpm fetch:adb -- darwin
 *   pnpm fetch:adb -- all       # Win + Mac
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  chmodSync,
  renameSync,
  cpSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, ".cache");
const baseDir = join(root, "platform-tools");

const OS_MAP = {
  win32: "windows",
  darwin: "darwin",
  linux: "linux",
};

const VALID = new Set(["windows", "darwin", "linux"]);

function parseTargets() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.includes("all")) return ["windows", "darwin"];
  if (args.length === 0) {
    const cur = OS_MAP[process.platform];
    if (!cur) {
      console.error(`不支持的平台: ${process.platform}`);
      process.exit(1);
    }
    return [cur];
  }
  for (const a of args) {
    if (!VALID.has(a)) {
      console.error(`未知目标: ${a}（可用: windows | darwin | linux | all）`);
      process.exit(1);
    }
  }
  return args;
}

async function download(u, dest) {
  console.log(`下载 ${u}`);
  const res = await fetch(u);
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function extractZip(zipPath, outDir) {
  mkdirSync(outDir, { recursive: true });
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error("解压失败");
    return;
  }
  const r = spawnSync("unzip", ["-o", zipPath, "-d", outDir], {
    stdio: "inherit",
  });
  if (r.status !== 0) throw new Error("解压失败（需要 unzip）");
}

function chmodTree(dir) {
  if (process.platform === "win32") return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      chmodSync(p, 0o755);
    } catch {
      /* ignore */
    }
  }
}

async function installOne(fetchOs) {
  const zipName = `platform-tools-latest-${fetchOs}.zip`;
  const url = `https://dl.google.com/android/repository/${zipName}`;
  const destDir = join(baseDir, fetchOs);
  const zipPath = join(cacheDir, zipName);
  const extractTmp = join(cacheDir, `pt-extract-${fetchOs}`);

  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(zipPath)) {
    await download(url, zipPath);
  } else {
    console.log(`使用缓存 ${zipPath}`);
  }

  rmSync(extractTmp, { recursive: true, force: true });
  extractZip(zipPath, extractTmp);

  const extracted = join(extractTmp, "platform-tools");
  if (!existsSync(extracted)) {
    throw new Error("解压后未找到 platform-tools/");
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(baseDir, { recursive: true });
  try {
    renameSync(extracted, destDir);
  } catch {
    cpSync(extracted, destDir, { recursive: true });
    rmSync(extracted, { recursive: true, force: true });
  }
  rmSync(extractTmp, { recursive: true, force: true });
  chmodTree(destDir);

  const adbName = fetchOs === "windows" ? "adb.exe" : "adb";
  if (!existsSync(join(destDir, adbName))) {
    throw new Error(`缺少 ${adbName}`);
  }
  console.log(`已安装 ${fetchOs} → ${destDir}`);
}

/** 把旧版扁平 platform-tools/*.exe 迁到 platform-tools/windows/ */
function migrateLegacyFlatWindows() {
  const legacyAdb = join(baseDir, "adb.exe");
  const winDir = join(baseDir, "windows");
  if (!existsSync(legacyAdb) || existsSync(join(winDir, "adb.exe"))) return;

  console.log("迁移旧版扁平 platform-tools → platform-tools/windows/");
  mkdirSync(winDir, { recursive: true });
  for (const name of readdirSync(baseDir)) {
    if (name === "windows" || name === "darwin" || name === "linux") continue;
    const from = join(baseDir, name);
    const to = join(winDir, name);
    try {
      renameSync(from, to);
    } catch {
      cpSync(from, to, { recursive: true });
      rmSync(from, { recursive: true, force: true });
    }
  }
}

migrateLegacyFlatWindows();

const targets = parseTargets();
for (const t of targets) {
  await installOne(t);
}
