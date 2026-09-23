/** 开发入口：强制真实 ADB（覆盖 .env 中的 ADB_MOCK） */
process.env.ADB_MOCK = "0";
await import("./index.js");
