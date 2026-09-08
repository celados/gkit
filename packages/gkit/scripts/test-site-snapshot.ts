import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readSnapshot } from "../src/site/snapshot";
const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "gkit-snapshot-test-"));
const repo = join(root, "repo");
await mkdir(repo);
const git = async (args: string[]) => (await exec("git", ["-C", repo, ...args])).stdout.trim();
const cli = new URL("../src/cli.ts", import.meta.url).pathname;
const config = join(root, "config");
const profile = join(config, "gkit/profiles/app");
await mkdir(profile, { recursive: true });
await writeFile(
  join(config, "gkit/profiles/app.json"),
  JSON.stringify({ version: 1, name: "app", providers: {} }),
);
await writeFile(
  join(profile, "site.json"),
  JSON.stringify({
    version: 1,
    site: "example.com",
    origins: ["https://example.com"],
    seeds: ["https://example.com/", "https://example.com/fr"],
    delayMs: 0,
    github: { repository: "owner/site" },
  }),
);
const bin = join(root, "bin");
await mkdir(bin);
await writeFile(
  join(bin, "grok"),
  `#!/usr/bin/env bun
import {appendFileSync} from "node:fs";
if(process.argv.includes("--version")){console.log("fixture-grok-1");process.exit(0)}
const i=process.argv.indexOf("--tools");if(i<0||process.argv[i+1]!=="")process.exit(2);
appendFileSync(process.env.SITE_TEST_ROOT+"/grok-calls","call\\n");
console.log(JSON.stringify({summary:"The title changed.",evidence:[{page_url:"https://example.com/",claim:"The snapshot title changed.",code_paths:["app/pages/index.vue"],confidence:"medium",caveat:"Runtime inputs may also affect output."}],unknowns:[]}));
`,
  { mode: 0o700 },
);
const env = {
  ...process.env,
  PATH: `${bin}:${process.env.PATH}`,
  XDG_CONFIG_HOME: config,
  XDG_STATE_HOME: join(root, "unused-state"),
  SITE_TEST_ROOT: root,
};
const run = async (args: string[], expected = 0) => {
  const child = Bun.spawn([Bun.which("bun")!, cli, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, expected, out + err);
  return JSON.parse(out);
};
const build = async (name: string, title: string) => {
  const path = join(root, name);
  await mkdir(join(path, "public"), { recursive: true });
  await mkdir(join(path, "server"));
  const html = `<html><title>${title}</title><meta name="description" content="Example"><link rel="canonical" href="https://example.com/"><h1>Example</h1></html>`;
  await writeFile(join(path, "public/index.html"), html);
  await writeFile(
    join(path, "server/index.mjs"),
    `import http from "node:http";const server=http.createServer((req,res)=>{res.setHeader("content-type","text/html");res.end(${JSON.stringify(html.replace('href="https://example.com/"', 'href="https://example.com/fr"'))})});server.listen(Number(process.env.PORT),"127.0.0.1");process.on("SIGTERM",()=>server.close());`,
  );
  return path;
};
let scenarios = 0;
try {
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "fixture@example.invalid"]);
  await git(["config", "user.name", "Fixture"]);
  await mkdir(join(repo, "app/pages"), { recursive: true });
  await writeFile(join(repo, "app/pages/index.vue"), "<template><h1>A</h1></template>\n");
  await git(["add", "."]);
  await git(["commit", "-m", "A"]);
  const a = await git(["rev-parse", "HEAD"]);
  await writeFile(join(repo, "app/pages/index.vue"), "<template><h1>B</h1></template>\n");
  await git(["commit", "-am", "B"]);
  const b = await git(["rev-parse", "HEAD"]);
  const buildA = await build("output-a", "A");
  const buildB = await build("output-b", "B");
  const snapA = join(root, "a");
  const snapB = join(root, "b");
  await run([
    "--profile",
    "app",
    "site",
    "snapshot",
    "--build",
    buildA,
    "--revision",
    a,
    "--repo",
    repo,
    "--context",
    "fixture",
    "--out",
    snapA,
    "--dry-run",
  ]);
  await assert.rejects(readFile(join(snapA, "manifest.json")));
  scenarios++;
  for (const [output, sha, out] of [
    [buildA, a, snapA],
    [buildB, b, snapB],
  ]) {
    const result = await run([
      "--profile",
      "app",
      "site",
      "snapshot",
      "--build",
      output!,
      "--revision",
      sha!,
      "--repo",
      repo,
      "--context",
      "fixture",
      "--out",
      out!,
    ]);
    assert.equal(result.data.coverage.observed, 2);
  }
  const captured = await readSnapshot(snapA);
  assert.deepEqual(
    captured.pages.map((page) => page.mode),
    ["prerender", "server-http"],
  );
  assert.equal(captured.pages[0]?.http_status, null);
  scenarios++;
  const first = await readFile(join(snapA, "manifest.json"), "utf8");
  await run(
    [
      "--profile",
      "app",
      "site",
      "snapshot",
      "--build",
      buildB,
      "--revision",
      b,
      "--repo",
      repo,
      "--context",
      "fixture",
      "--out",
      snapA,
    ],
    1,
  );
  assert.equal(await readFile(join(snapA, "manifest.json"), "utf8"), first);
  scenarios++;
  const moved = join(root, "moved");
  await cp(snapA, moved, { recursive: true });
  await rm(snapA, { recursive: true });
  assert.equal((await readSnapshot(moved)).manifest.snapshot_id, captured.manifest.snapshot_id);
  scenarios++;
  const diff = await run(["site", "diff", moved, snapB]);
  assert.equal(diff.data.summary.changed_pages, 2);
  assert.equal(diff.data.coverage.comparable_urls, 2);
  scenarios++;
  await rm(profile, { recursive: true });
  const audited = await run(["site", "audit", moved]);
  assert.equal(audited.ok, true);
  scenarios++;
  await mkdir(profile);
  await writeFile(
    join(profile, "site.json"),
    JSON.stringify({
      version: 1,
      site: "example.com",
      origins: ["https://example.com"],
      seeds: ["https://example.com/"],
      github: { repository: "owner/site" },
    }),
  );
  const input = join(root, "input.json");
  await run([
    "--profile",
    "app",
    "site",
    "explain",
    moved,
    snapB,
    "--repo",
    repo,
    "--model",
    "fixture-model",
    "--out",
    input,
    "--dry-run",
  ]);
  const prepared = JSON.parse(await readFile(input, "utf8"));
  assert.equal(prepared.input.code.method, "git-diff-two-trees");
  await assert.rejects(readFile(join(root, "grok-calls")));
  scenarios++;
  for (const suffix of ["first", "cached"]) {
    const result = await run([
      "--profile",
      "app",
      "site",
      "explain",
      moved,
      snapB,
      "--repo",
      repo,
      "--model",
      "fixture-model",
      "--out",
      join(root, `${suffix}.json`),
    ]);
    assert.equal(result.data.status, suffix === "first" ? "generated" : "cached");
  }
  assert.equal((await readFile(join(root, "grok-calls"), "utf8")).trim(), "call");
  scenarios++;
  await run(
    [
      "--profile",
      "app",
      "site",
      "explain",
      moved,
      snapB,
      "--repo",
      repo,
      "--model",
      "fixture-model",
      "--out",
      join(root, "first.json"),
    ],
    1,
  );
  assert.equal((await readFile(join(root, "grok-calls"), "utf8")).trim(), "call");
  scenarios++;
  await rm(join(profile, "cache"), { recursive: true });
  await run([
    "--profile",
    "app",
    "site",
    "explain",
    moved,
    snapB,
    "--repo",
    repo,
    "--model",
    "fixture-model",
    "--out",
    join(root, "rebuilt.json"),
  ]);
  assert.equal((await readFile(join(root, "grok-calls"), "utf8")).trim().split("\n").length, 2);
  scenarios++;
  const cacheDirectory = join(profile, "cache/site-explanations");
  const cacheFiles = await readdir(cacheDirectory);
  assert.equal(cacheFiles.length, 1);
  await writeFile(join(cacheDirectory, cacheFiles[0]!), "damaged");
  for (const suffix of ["repaired", "repair-cached"]) {
    const result = await run([
      "--profile",
      "app",
      "site",
      "explain",
      moved,
      snapB,
      "--repo",
      repo,
      "--model",
      "fixture-model",
      "--out",
      join(root, `${suffix}.json`),
    ]);
    assert.equal(result.data.status, suffix === "repaired" ? "generated" : "cached");
  }
  assert.equal((await readFile(join(root, "grok-calls"), "utf8")).trim().split("\n").length, 3);
  scenarios++;
  await rm(join(buildA, "public"), { recursive: true });
  await run([
    "--profile",
    "app",
    "site",
    "snapshot",
    "--build",
    buildA,
    "--revision",
    a,
    "--repo",
    repo,
    "--context",
    "fixture",
    "--out",
    join(root, "ssr-only"),
  ]);
  const ssrOnly = await readSnapshot(join(root, "ssr-only"));
  assert.equal(ssrOnly.pages[0]?.mode, "server-http");
  assert.equal(ssrOnly.manifest.coverage.observed, 1);
  scenarios++;
  const original = await readSnapshot(moved);
  await writeFile(join(moved, "content", original.pages[0]!.html_hash!), "tampered");
  await run(["site", "audit", moved], 1);
  scenarios++;
  const incomplete = join(root, "incomplete");
  await mkdir(incomplete);
  await writeFile(join(incomplete, "pages.jsonl"), "");
  await run(["site", "audit", incomplete], 1);
  scenarios++;
  await assert.rejects(readdir(join(root, "unused-state")));
  scenarios++;
  console.log(JSON.stringify({ ok: true, scenarios }));
} finally {
  await rm(root, { recursive: true, force: true });
}
