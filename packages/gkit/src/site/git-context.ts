import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as v from "valibot";
import { GkitFailure } from "../envelope";
import { hash, type SourceVersion } from "./model";
const exec = promisify(execFile);
async function git(repo: string, args: string[], signal: AbortSignal, maxBuffer = 15000000) {
  return (
    await exec("git", ["-C", repo, ...args], {
      signal,
      timeout: 60000,
      maxBuffer,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout;
}
export async function resolveVersion(
  repository: string,
  revision: string,
  repo: string | null,
  signal: AbortSignal,
): Promise<SourceVersion> {
  if (!revision || revision.startsWith("-") || /[\x00-\x20]/.test(revision))
    throw new GkitFailure({ code: "INVALID_INPUT", message: "Invalid revision." });
  if (repo) {
    const sha = (await git(repo, ["rev-parse", "--verify", `${revision}^{commit}`], signal)).trim();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid Git object");
    return { repository, commit_sha: sha, ref: revision, resolved_by: "local-git" };
  }
  // Commit endpoint resolves tags (including annotated tags) to an exact commit.
  const result = await exec(
    "gh",
    [
      "api",
      "--hostname",
      "github.com",
      `repos/${repository}/commits/${encodeURIComponent(revision)}`,
    ],
    { signal, timeout: 30000, maxBuffer: 15000000 },
  );
  const parsed = v.parse(
    v.object({ sha: v.pipe(v.string(), v.regex(/^[a-f0-9]{40}$/)) }),
    JSON.parse(result.stdout),
  );
  return { repository, commit_sha: parsed.sha, ref: revision, resolved_by: "github-api" };
}
export async function codeContext(
  base: SourceVersion,
  head: SourceVersion,
  localRepo: string | null,
  signal: AbortSignal,
) {
  if (
    base.repository !== head.repository ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(base.repository)
  )
    throw new GkitFailure({
      code: "INVALID_INPUT",
      message: "Code comparison requires one GitHub repository.",
    });
  let temporary: string | null = null;
  let repo = localRepo;
  try {
    if (!repo) {
      temporary = await mkdtemp(join(tmpdir(), "gkit-site-git-"));
      repo = temporary;
      await exec("git", ["init", "--bare", repo], { signal });
      // gh handles private-repository authentication without copying credentials.
      for (const sha of new Set([base.commit_sha, head.commit_sha])) {
        await exec(
          "git",
          [
            "-C",
            repo,
            "-c",
            "credential.helper=",
            "-c",
            "credential.helper=!gh auth git-credential",
            "fetch",
            "--no-tags",
            "--depth=1",
            `https://github.com/${base.repository}.git`,
            sha,
          ],
          {
            signal,
            timeout: 120000,
            maxBuffer: 1000000,
            env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          },
        );
      }
    }
    for (const sha of [base.commit_sha, head.commit_sha])
      await git(repo, ["cat-file", "-e", `${sha}^{commit}`], signal);
    const all = (
      await git(
        repo,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--name-only",
          "-z",
          base.commit_sha,
          head.commit_sha,
          "--",
        ],
        signal,
      )
    )
      .split("\0")
      .filter(Boolean);
    const useful = (path: string) =>
      !/(^|\/)(node_modules|\.git|\.nuxt|\.output|dist|coverage)\//.test(path) &&
      !/(^|\/)(\.env[^/]*|[^/]*lock[^/]*|[^/]*\.map)$/.test(path) &&
      /\.(vue|[cm]?[jt]sx?|json|css|scss|md|ya?ml)$/.test(path);
    const chosen = all.filter(useful).slice(0, 40);
    const files: { path: string; patch: string; truncated: boolean }[] = [];
    let budget = 100000;
    for (const path of chosen) {
      if (budget <= 0) break;
      const patch = await git(
        repo,
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--unified=3",
          base.commit_sha,
          head.commit_sha,
          "--",
          path,
        ],
        signal,
      );
      const text = patch.slice(0, Math.min(12000, budget));
      budget -= text.length;
      files.push({ path, patch: text, truncated: text.length < patch.length });
    }
    const supporting = [];
    for (const path of [
      "nuxt.config.ts",
      "app/app.vue",
      "app/layouts/default.vue",
      "i18n/locales.ts",
      "package.json",
    ]) {
      if (chosen.includes(path) || budget <= 0) continue;
      for (const version of [base, head]) {
        try {
          const text = await git(repo, ["show", `${version.commit_sha}:${path}`], signal);
          const selected = text.slice(0, Math.min(6000, budget));
          budget -= selected.length;
          supporting.push({
            path,
            sha: version.commit_sha,
            text: selected,
            truncated: selected.length < text.length,
          });
        } catch {
          signal.throwIfAborted();
        }
      }
    }
    const result = {
      repository: base.repository,
      base_sha: base.commit_sha,
      head_sha: head.commit_sha,
      method: "git-diff-two-trees",
      filter_version: "nuxt-context-v1",
      changed_files: all,
      included_files: files,
      omitted_files: all.filter((path) => !files.some((file) => file.path === path)),
      supporting_context: supporting,
      truncated:
        files.some((f) => f.truncated) ||
        supporting.some((f) => f.truncated) ||
        all.length !== files.length,
    };
    return { ...result, input_hash: hash(JSON.stringify(result)) };
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
