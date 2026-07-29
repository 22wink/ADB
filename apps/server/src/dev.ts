/** 开发入口：强制开启 ADB Mock，再启动服务 */
process.env.ADB_MOCK = "1";
await import("./index.js");
