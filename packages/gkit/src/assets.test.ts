import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(`${root}${dir}`, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
}

describe("embedded assets", () => {
  it("cover every runtime-read manifest and provider doc", () => {
    const onDisk = [
      ...walk("generated").filter((path) => path.endsWith("/manifest.json")),
      ...walk("docs/providers"),
    ].sort();
    // Read as text: vitest cannot import the bun text-import module itself.
    const embedded = [...readFileSync(`${root}src/assets.embed.ts`, "utf8").matchAll(/^ {2}"([^"]+)":/gm)].map(
      (match) => match[1],
    );
    expect(embedded.sort()).toEqual(onDisk);
  });
});
