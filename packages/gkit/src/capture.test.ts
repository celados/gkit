import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const entry = fileURLToPath(new URL("../bin/gkit.js", import.meta.url));

// Real pipes: spawnSync hands the child a piped stdout, the shape of `gkit @skill | head`.
function run(args: string[], env: Record<string, string | undefined>) {
  return spawnSync("bun", [entry, ...args], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

describe("output-capture guard", () => {
  it("refuses an agent piping the guide, schema and help", () => {
    for (const args of [["@skill"], ["--schema"], ["--help"]]) {
      const r = run(args, { CLAUDE_CODE_SESSION_ID: "t" });
      expect(r.status).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("OUTPUT_CAPTURED");
    }
  });

  it("lets a person, the opt-out and data commands through", () => {
    expect(run(["@skill"], {}).stdout).not.toBe("");
    expect(run(["@skill"], { CLAUDE_CODE_SESSION_ID: "t", ARGC_ALLOW_CAPTURE: "1" }).status).toBe(0);
    expect(run(["docs"], { CLAUDE_CODE_SESSION_ID: "t" }).status).toBe(0);
  });
});
