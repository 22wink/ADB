/** 打包 macOS 发布包。用法: node scripts/pack-mac.mjs [arm64|x64] */
process.env.RELEASE_OS = "darwin";
const arch = process.argv[2] || process.env.RELEASE_ARCH || "arm64";
if (arch !== "arm64" && arch !== "x64") {
  console.error("用法: node scripts/pack-mac.mjs [arm64|x64]");
  process.exit(1);
}
process.env.RELEASE_ARCH = arch;
await import("./pack.mjs");
