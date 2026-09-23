/** 开发入口：强制真实 ADB（覆盖 .env 中的 ADB_MOCK） */
process.env.ADB_MOCK = "0";
// 热更新会反复重启，默认不开浏览器
if (process.env.OPEN_BROWSER === undefined) {
  process.env.OPEN_BROWSER = "0";
}
await import("./index.js");
