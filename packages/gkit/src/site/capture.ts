import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, realpath, stat, readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import robotsParser from "robots-parser";
import { GkitFailure } from "../envelope";
import { extractFields } from "./audit";
import { pageUrl, type PageSnapshot, type SiteConfig, type SourceVersion } from "./model";
import { makeSnapshot, writeSnapshot } from "./snapshot";

export type CaptureOptions = {
  config: SiteConfig;
  routes: string[];
  out: string;
  source:
    | { kind: "nuxt-build"; path: string; version: SourceVersion }
    | { kind: "production-http"; version: SourceVersion | null };
  runtimeContext: string;
  signal: AbortSignal;
  progress?: (text: string) => void;
};
type Document = {
  url: string;
  status: number;
  text: string;
  headers: Record<string, string>;
  redirects: PageSnapshot["redirects"];
};
async function fetchDocument(
  url: string,
  transport: string | null,
  config: SiteConfig,
  signal: AbortSignal,
): Promise<Document> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]);
  const redirects: PageSnapshot["redirects"] = [];
  let current = url;
  const logicalOrigin = new URL(url).origin;
  for (let hop = 0; hop <= 8; hop++) {
    if (!config.origins.some((origin) => new URL(origin).origin === new URL(current).origin))
      throw new Error("Redirect outside declared origins");
    const target = transport ? new URL(new URL(current).pathname, transport).href : current;
    const response = await fetch(target, {
      signal: deadline,
      redirect: "manual",
      headers: {
        "user-agent": "GkitSiteSnapshot/1",
        accept: "text/html",
        ...(transport
          ? {
              host: new URL(current).host,
              "x-forwarded-host": new URL(current).host,
              "x-forwarded-proto": new URL(current).protocol.slice(0, -1),
            }
          : {}),
      },
    });
    const location = response.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      let next = pageUrl(location, current);
      if (!next) throw new Error("Unsupported redirect URL");
      if (transport && new URL(next).origin === new URL(transport).origin)
        next = new URL(new URL(next).pathname, logicalOrigin).href;
      redirects.push({ url: current, status: response.status, location: next });
      current = next;
      continue;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader)
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > config.maxBytes) {
            await reader.cancel();
            throw new Error("Response exceeds maxBytes");
          }
          chunks.push(part.value);
        }
      } finally {
        reader.releaseLock();
      }
    const headers: Record<string, string> = {};
    for (const name of [
      "content-type",
      "x-robots-tag",
      "content-language",
      "cache-control",
      "vary",
    ]) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }
    return {
      url: current,
      status: response.status,
      text: Buffer.concat(chunks).toString("utf8"),
      headers,
      redirects,
    };
  }
  throw new Error("Redirect limit exceeded");
}
export async function digestBuild(directory: string): Promise<string> {
  const root = await realpath(directory);
  const hash = createHash("sha256");
  const walk = async (relative: string, ancestors: Set<string>): Promise<void> => {
    const path = await realpath(resolve(root, relative));
    if (path !== root && !path.startsWith(root + sep))
      throw new Error("Build symlink escapes its root");
    const info = await stat(path);
    if (info.isDirectory()) {
      if (ancestors.has(path)) throw new Error("Build symlink cycle");
      const next = new Set([...ancestors, path]);
      for (const name of (await readdir(path)).sort())
        await walk(relative ? `${relative}/${name}` : name, next);
    } else if (info.isFile()) {
      hash.update(JSON.stringify([relative, info.size]));
      for await (const chunk of createReadStream(path)) hash.update(chunk);
    } else throw new Error("Unsupported build entry");
  };
  await walk("", new Set());
  return hash.digest("hex");
}
async function prerenderFile(
  build: string,
  route: string,
  maxBytes: number,
): Promise<string | null> {
  let root: string;
  try {
    root = await realpath(resolve(build, "public"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const pathname = decodeURIComponent(new URL(route).pathname);
  if (pathname.includes("\\") || pathname.split("/").some((part) => part === ".." || part === "."))
    throw new Error("Unsupported route path");
  const relative = pathname.replace(/^\/+|\/+$/g, "");
  const choices = relative
    ? [relative.endsWith(".html") ? relative : `${relative}/index.html`, `${relative}.html`]
    : ["index.html"];
  for (const choice of choices) {
    try {
      const path = await realpath(resolve(root, choice));
      if (!path.startsWith(root + sep)) throw new Error("Prerender file escapes build");
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (info.size > maxBytes) throw new Error("Prerender exceeds maxBytes");
      return await readFile(path, "utf8");
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOTDIR"
      )
        throw error;
    }
  }
  return null;
}
async function startNuxt(build: string, signal: AbortSignal) {
  const entry = await realpath(resolve(build, "server/index.mjs"));
  const port = await new Promise<number>((resolvePort, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("No port"));
      probe.close(() => resolvePort(address.port));
    });
  });
  const child = spawn("node", [entry], {
    cwd: build,
    env: {
      ...process.env,
      PORT: String(port),
      NITRO_PORT: String(port),
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: "ignore",
  });
  let exited = false;
  let failed = false;
  const closed = new Promise<void>((done) => {
    child.once("close", () => {
      exited = true;
      done();
    });
    child.once("error", () => {
      failed = true;
      done();
    });
  });
  const stop = async () => {
    if (!exited && !failed) {
      child.kill("SIGTERM");
      await Promise.race([closed, delay(2000)]);
      if (!exited) {
        child.kill("SIGKILL");
        await closed;
      }
    }
  };
  const url = `http://127.0.0.1:${port}`;
  try {
    for (let attempt = 0; attempt < 120; attempt++) {
      signal.throwIfAborted();
      if (exited || failed) throw new Error("Nuxt server exited before readiness");
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
          redirect: "manual",
        });
        await response.body?.cancel();
        return { url, stop };
      } catch {
        signal.throwIfAborted();
      }
      await delay(100, undefined, { signal });
    }
    throw new Error("Nuxt server readiness timed out");
  } catch (error) {
    await stop();
    throw error;
  }
}
export async function captureSnapshot(options: CaptureOptions) {
  return writeSnapshot(options.out, async (save) => {
    const { config, routes, signal } = options;
    const started = new Date().toISOString();
    const build = options.source.kind === "nuxt-build" ? await realpath(options.source.path) : null;
    const buildDigest = build ? await digestBuild(build) : null;
    let server: Awaited<ReturnType<typeof startNuxt>> | null = null;
    const robots = new Map<string, ReturnType<typeof robotsParser> | null>();
    const pages: PageSnapshot[] = [];
    try {
      for (const url of routes) {
        signal.throwIfAborted();
        options.progress?.(`Snapshot ${pages.length + 1}/${routes.length}: ${url}`);
        const common = { url, observed_at: new Date().toISOString() };
        let mode: PageSnapshot["mode"] = build ? "prerender" : "production-http";
        let document: Document | null = null;
        let staticHtml: string | null = null;
        try {
          if (build) {
            staticHtml = await prerenderFile(build, url, config.maxBytes);
            if (staticHtml === null) {
              mode = "server-http";
              server ??= await startNuxt(build, signal);
              document = await fetchDocument(url, server.url, config, signal);
            }
          } else {
            const origin = new URL(url).origin;
            if (!robots.has(origin)) {
              try {
                const response = await fetchDocument(`${origin}/robots.txt`, null, config, signal);
                robots.set(
                  origin,
                  response.status === 404
                    ? robotsParser(`${origin}/robots.txt`, "")
                    : response.status === 200
                      ? robotsParser(`${origin}/robots.txt`, response.text)
                      : null,
                );
              } catch {
                signal.throwIfAborted();
                robots.set(origin, null);
              }
            }
            const policy = robots.get(origin);
            if (!policy) throw new Error("Robots policy unavailable");
            if (policy.isAllowed(url, "GkitSiteSnapshot") === false)
              throw new Error("Disallowed by robots.txt");
            document = await fetchDocument(url, null, config, signal);
          }
        } catch (error) {
          signal.throwIfAborted();
          pages.push({
            ...common,
            status: "failed",
            http_status: null,
            final_url: null,
            redirects: [],
            html_hash: null,
            fields: null,
            error: error instanceof Error ? error.message : "Capture failed",
            mode,
            response_headers: {},
          });
          continue;
        }
        const text = staticHtml ?? document!.text;
        const htmlHash = await save(text);
        const finalUrl = document?.url ?? url;
        const isHtml =
          staticHtml !== null ||
          /text\/html|application\/xhtml\+xml/i.test(document?.headers["content-type"] ?? "");
        let fields: PageSnapshot["fields"] = null;
        let error: string | null = null;
        if (isHtml)
          try {
            fields = extractFields(text, finalUrl, document?.headers["x-robots-tag"] ?? null);
          } catch {
            error = "HTML extraction failed";
          }
        else if (document!.status < 400) error = "Expected HTML";
        pages.push({
          ...common,
          status: error ? "failed" : "observed",
          http_status: document?.status ?? null,
          final_url: finalUrl,
          redirects: document?.redirects ?? [],
          html_hash: htmlHash,
          fields,
          error,
          mode,
          response_headers: document?.headers ?? {},
        });
        if (config.delayMs) await delay(config.delayMs, undefined, { signal });
      }
    } finally {
      await server?.stop();
    }
    if (build && (await digestBuild(build)) !== buildDigest)
      throw new GkitFailure({
        code: "INVALID_INPUT",
        message: "Build changed during capture; snapshot was not published.",
      });
    const source =
      options.source.kind === "nuxt-build"
        ? {
            kind: "nuxt-build" as const,
            build_digest: buildDigest!,
            version: options.source.version,
            association: "caller-supplied-build" as const,
            runtime_context: options.runtimeContext,
          }
        : {
            kind: "production-http" as const,
            version: options.source.version,
            association: options.source.version
              ? ("caller-supplied-version" as const)
              : ("unassociated" as const),
            runtime_context: options.runtimeContext,
          };
    return makeSnapshot(config, routes, pages, source, started);
  });
}
