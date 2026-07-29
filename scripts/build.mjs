import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("pnpm", ["--filter", "@adb-studio/adb-core", "build"]);
run("pnpm", ["--filter", "@adb-studio/web", "build"]);
run("pnpm", ["--filter", "@adb-studio/server", "build"]);

const webDist = join(root, "apps/web/dist");
const publicDir = join(root, "apps/server/public");
if (!existsSync(join(webDist, "index.html"))) {
  console.error("前端构建产物缺失");
  process.exit(1);
}
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(webDist, publicDir, { recursive: true });
console.log("已拷贝前端 → apps/server/public");
console.log("打包完成。运行: pnpm start  或  start.bat");
