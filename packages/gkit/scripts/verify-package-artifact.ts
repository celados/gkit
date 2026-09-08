import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type PackResult = Readonly<{
  filename: string;
  files?: readonly Readonly<{ path: string }>[];
}>;

type PackageJson = Readonly<{
  name?: unknown;
  version?: unknown;
  private?: unknown;
}>;

const allowedTopLevelEntries = new Set(["bin", "docs", "generated", "package.json", "src"]);
const forbiddenPathPattern =
  /(^|\/)(?:\.env(?:\..*)?|\.npmrc|bunfig\.toml|[^/]*\.test\.[^/]+|__tests__|evals?|scripts?|sources?|policy)(?:\/|$)/i;
const secretMaterialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
] as const;

const packageRoot = resolve(import.meta.dir, "..");
const outputDirectory = parseOutputDirectory(Bun.argv.slice(2));
const temporaryRoot = await mkdtemp(join(tmpdir(), "gkit-package-artifact-"));
const packDirectory = join(temporaryRoot, "pack");
const consumerDirectory = join(temporaryRoot, "consumer");

try {
  await Promise.all([
    mkdir(packDirectory, { recursive: true }),
    mkdir(consumerDirectory, { recursive: true }),
  ]);
  const packageJson = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as PackageJson;
  if (packageJson.name !== "gkit" || typeof packageJson.version !== "string") {
    throw new Error("The package must have name gkit and a string version.");
  }
  if (packageJson.private !== true) {
    throw new Error("The gkit package must remain private to prevent registry publication.");
  }

  const packed = await runCommand(
    ["npm", "pack", "--json", "--pack-destination", packDirectory, packageRoot],
    temporaryRoot,
  );
  const packResults = JSON.parse(packed.stdout) as PackResult[];
  const packResult = packResults[0];
  if (!packResult?.filename || !packResult.files) {
    throw new Error("npm pack did not report the package filename and contents.");
  }
  await verifyPackageContents(packResult.files.map((file) => file.path));

  const tarballPath = join(packDirectory, packResult.filename);
  const globalDirectory = join(consumerDirectory, "global");
  const globalBinDirectory = join(consumerDirectory, "bin");
  await runCommand(
    [
      "bun",
      "add",
      "--global",
      "--registry",
      "https://registry.npmjs.org",
      "--network-concurrency",
      "8",
      `gkit@${tarballPath}`,
    ],
    consumerDirectory,
    {
      BUN_INSTALL_GLOBAL_DIR: globalDirectory,
      BUN_INSTALL_BIN: globalBinDirectory,
      BUN_INSTALL_CACHE_DIR: join(consumerDirectory, "cache"),
    },
  );

  const installedPackageJson = await readFile(
    join(globalDirectory, "node_modules", "gkit", "package.json"),
    "utf8",
  );
  if (installedPackageJson.includes('"catalog:"')) {
    throw new Error("The installed gkit artifact still contains workspace-only catalog ranges.");
  }

  const gkit = join(globalBinDirectory, "gkit");
  await runCommand([gkit, "--schema", "site"], consumerDirectory);
  const isolatedConfig = join(consumerDirectory, "config");
  const siteProfile = join(isolatedConfig, "gkit", "profiles", "package-test");
  await mkdir(siteProfile, { recursive: true });
  await writeFile(
    join(siteProfile, "..", "package-test.json"),
    JSON.stringify({ version: 1, name: "package-test", providers: {} }),
  );
  await writeFile(
    join(siteProfile, "site.json"),
    JSON.stringify({
      version: 1,
      site: "example.test",
      origins: ["https://example.test"],
      seeds: ["https://example.test/"],
      github: { repository: "fixture/site" },
    }),
  );
  const discovery = await runCommand(
    [
      gkit,
      "--profile",
      "package-test",
      "site",
      "discover",
      "--dry-run",
      "--out",
      join(consumerDirectory, "discovery"),
    ],
    consumerDirectory,
    { XDG_CONFIG_HOME: isolatedConfig },
  );
  if (JSON.parse(discovery.stdout).data?.status !== "prepared") {
    throw new Error("The installed artifact could not load the site discovery runtime.");
  }
  await runCommand([gkit, "--schema", "gsc"], consumerDirectory);
  const described = await runCommand(
    [gkit, "describe", "--id", "gsc.properties.list"],
    consumerDirectory,
  );
  const capability = JSON.parse(described.stdout) as { id?: unknown };
  if (capability.id !== "gsc.properties.list") {
    throw new Error("The installed gkit artifact returned an unexpected capability.");
  }
  const docs = await runCommand([gkit, "docs", "--provider", "gsc"], consumerDirectory);
  const capabilities = await readFile(join(docs.stdout.trim(), "capabilities.md"), "utf8");
  if (!capabilities.includes("gsc.properties.list")) {
    throw new Error("The installed gkit artifact could not read its provider documentation.");
  }

  if (outputDirectory) {
    await writeReleaseAssets(tarballPath, packageJson.version, outputDirectory);
  }
  process.stdout.write(`Verified installable gkit artifact: ${packResult.filename}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function parseOutputDirectory(arguments_: readonly string[]): string | undefined {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length !== 2 || arguments_[0] !== "--output-dir" || !arguments_[1]) {
    throw new Error("Usage: verify-package-artifact.ts [--output-dir <directory>]");
  }
  return resolve(arguments_[1]);
}

async function verifyPackageContents(paths: readonly string[]): Promise<void> {
  if (!paths.includes("bin/gkit.js") || !paths.includes("package.json")) {
    throw new Error("The package is missing its binary or package manifest.");
  }
  if (!paths.some((path) => path.startsWith("generated/"))) {
    throw new Error("The package is missing generated provider manifests.");
  }
  if (!paths.some((path) => path.startsWith("docs/"))) {
    throw new Error("The package is missing provider documentation.");
  }
  for (const path of paths) {
    const topLevelEntry = path.split("/", 1)[0];
    if (!topLevelEntry || !allowedTopLevelEntries.has(topLevelEntry)) {
      throw new Error(`Unexpected package entry: ${path}`);
    }
    if (forbiddenPathPattern.test(path)) {
      throw new Error(`Forbidden package entry: ${path}`);
    }
    const content = await readFile(join(packageRoot, path), "utf8");
    if (secretMaterialPatterns.some((pattern) => pattern.test(content))) {
      throw new Error(`Potential secret material found in package entry: ${path}`);
    }
  }
}

async function writeReleaseAssets(
  tarballPath: string,
  version: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const exactName = `gkit-${version}.tgz`;
  const stableName = "gkit.tgz";
  const exactPath = join(destination, exactName);
  const stablePath = join(destination, stableName);
  await copyFile(tarballPath, exactPath, constants.COPYFILE_EXCL);
  await copyFile(tarballPath, stablePath, constants.COPYFILE_EXCL);
  const digest = createHash("sha256")
    .update(await readFile(tarballPath))
    .digest("hex");
  await writeFile(
    join(destination, "SHA256SUMS"),
    `${digest}  ${exactName}\n${digest}  ${stableName}\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

async function runCommand(
  command: readonly string[],
  cwd: string,
  additionalEnvironment: Readonly<Record<string, string>> = {},
): Promise<{ stdout: string; stderr: string }> {
  const child = Bun.spawn([...command], {
    cwd,
    env: { ...Bun.env, ...additionalEnvironment, CI: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command.map((value) => basename(value)).join(" ")}\n${stdout}${stderr}`.trimEnd(),
    );
  }
  return { stdout, stderr };
}
