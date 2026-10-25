// scripts/live.mjs — is this tree's build what GitHub Pages serves?
//   node scripts/live.mjs                 answers now (exit 1 if not)
//   node scripts/live.mjs --wait          polls every 10 s, up to 15 min
//   node scripts/live.mjs --url <base>    another host
// Last line: `LIVE: <build>` or `NOT LIVE: want <a>, <url> serves <b>`.
//
// "This tree's build" = dist/version.json, which `npm run build` writes. Builds first when
// dist/ is missing or older than a source file, so the answer is about the tree on disk.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_URL = "https://jannikarndt.github.io/asana-progression";
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("--url") || process.env.APP_URL || DEFAULT_URL).replace(/\/$/, "");
const wait = process.argv.includes("--wait");

function newest(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((n) => newest(join(path, n))));
}
const stamp = "dist/version.json";
const sources = ["src", "public", "index.html", "vite.config.ts", "package.json", "package-lock.json", "scripts/stamp-build.mjs", "tsconfig.json"];
if (!existsSync(stamp) || Math.max(...sources.map(newest)) > statSync(stamp).mtimeMs) {
  console.log("building (dist/ is missing or older than the sources)…");
  if (spawnSync("npm", ["run", "--silent", "build"], { stdio: "inherit" }).status !== 0) {
    console.log("NOT LIVE: the build failed");
    process.exit(1);
  }
}
const want = JSON.parse(readFileSync(stamp, "utf8")).build;
const started = Date.now();

async function served() {
  try {
    // Pages caches for ~10 min (max-age=600): the query string gets past it.
    const res = await fetch(`${base}/version.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => ({}));
    return body.build || `HTTP ${res.status}`;
  } catch (err) {
    return err.cause?.code || err.name;
  }
}

let last = "";
for (;;) {
  const got = await served();
  if (got === want) { console.log(`LIVE: ${want}`); process.exit(0); }
  const secs = Math.round((Date.now() - started) / 1000);
  if (!wait || secs > 900) { console.log(`NOT LIVE: want ${want}, ${base} serves ${got}`); process.exit(1); }
  if (got !== last) { console.log(`  ${secs} s: ${base} serves ${got}`); last = got; }
  await new Promise((r) => setTimeout(r, 10_000));
}
