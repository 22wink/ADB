import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release", "ADB-Studio");
const webDist = join(root, "apps/web/dist");

if (!existsSync(join(webDist, "index.html"))) {
  console.error("missing web dist, run web build first");
  process.exit(1);
}

await esbuild.build({
  entryPoints: [join(root, "apps/server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: join(out, "server.mjs"),
  packages: "bundle",
  banner: {
    js: `import { createRequire as __adbCreateRequire } from 'node:module'; const require = __adbCreateRequire(import.meta.url);`,
  },
  logLevel: "info",
});

mkdirSync(join(out, "public"), { recursive: true });
cpSync(webDist, join(out, "public"), { recursive: true });
mkdirSync(join(root, "apps/server/public"), { recursive: true });
cpSync(webDist, join(root, "apps/server/public"), { recursive: true });
console.log("release UI/server updated (runtime kept)");
