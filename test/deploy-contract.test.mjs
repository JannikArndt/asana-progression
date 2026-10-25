// test/deploy-contract.test.mjs — the deploy conventions, as tests.
// Adapted from the app-conventions skill for a Pages repo built by Actions
// (no Dockerfile). Fails when a pin floats, when a workflow runs without
// permissions or a timeout, when only the deploy job may publish, when the
// live check is missing, or when a command is undocumented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const has = (p) => existsSync(join(ROOT, p));

const workflows = has(".github/workflows") ? readdirSync(join(ROOT, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)) : [];

test("every action is pinned to a commit SHA with its version as a comment", () => {
  for (const f of workflows) {
    for (const [line, ref] of read(`.github/workflows/${f}`).matchAll(/uses:\s*(\S+)(.*)$/gm)) {
      if (ref.startsWith("./")) continue;
      assert.match(line, /@[0-9a-f]{40}\s+#\s*v\d/, `${f}: ${ref.trim()} is not pinned to a SHA with a # vX comment`);
    }
  }
});

test("every workflow declares permissions and every job a timeout", () => {
  for (const f of workflows) {
    const y = read(`.github/workflows/${f}`);
    assert.match(y, /^permissions:/m, `${f} has no top-level permissions`);
    const jobs = y.split(/^jobs:\s*$/m)[1] || "";
    const names = [...jobs.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((m) => m[1]);
    for (const name of names) {
      const body = jobs.split(new RegExp(`^ {2}${name}:\\s*$`, "m"))[1].split(/^ {2}[\w-]+:\s*$/m)[0];
      assert.match(body, /timeout-minutes:/, `${f}: job ${name} has no timeout-minutes`);
    }
  }
});

test("CLAUDE.md exists and names every npm script", () => {
  assert.ok(has("CLAUDE.md"), "CLAUDE.md is missing");
  if (!has("package.json")) return;
  const claude = read("CLAUDE.md");
  const scripts = Object.keys(JSON.parse(read("package.json")).scripts || {});
  for (const s of ["verify", "live", "ship"]) assert.ok(scripts.includes(s), `package.json has no "${s}" script`);
  for (const s of scripts) assert.match(claude, new RegExp(`npm (run )?${s}\\b`), `CLAUDE.md does not mention npm run ${s}`);
});

test("only the deploy job may publish, and it confirms the build is live", () => {
  const y = read(".github/workflows/deploy.yml");
  assert.doesNotMatch(y.split(/^jobs:/m)[0], /pages: write|id-token: write/, "pages/id-token write belongs on the deploy job only");
  const deploy = y.split(/^ {2}deploy:\s*$/m)[1] || "";
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /version\.json/, "the deploy job does not poll version.json");
  assert.match(deploy, /needs: \[verify, e2e\]|needs: \[e2e, verify\]/, "e2e must gate the deploy");
});

test("the build stamps dist/version.json", () => {
  assert.match(JSON.parse(read("package.json")).scripts.build, /stamp-build\.mjs/);
});
