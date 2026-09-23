/**
 * 开发启动：先编 adb-core，再并行起 core/server/web。
 * `node scripts/dev.mjs --real` 强制 ADB_MOCK=0（真实设备）。
 */
import { spawnSync } from "node:child_process";

const real = process.argv.includes("--real");
const env = { ...process.env };
if (real) env.ADB_MOCK = "0";

function run(args) {
  console.log(`> pnpm ${args.join(" ")}`);
  const r = spawnSync("pnpm", args, {
    stdio: "inherit",
    shell: true,
    env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run(["--filter", "@adb-studio/adb-core", "build"]);
run([
  "--parallel",
  "--filter",
  "@adb-studio/adb-core",
  "--filter",
  "@adb-studio/server",
  "--filter",
  "@adb-studio/web",
  "dev",
]);
