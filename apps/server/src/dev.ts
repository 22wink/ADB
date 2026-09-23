/** 开发入口：默认开启 Mock；.env 设 ADB_MOCK=0 可切真实 ADB */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(appRoot, ".env") });

if (process.env.ADB_MOCK === undefined) {
  process.env.ADB_MOCK = "1";
}

await import("./index.js");
