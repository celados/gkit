import { readFile } from "node:fs/promises";
import * as v from "valibot";
import { ArtifactError, withArtifactReservation, writeArtifact } from "../artifact";
import { GkitFailure, toFailureEnvelope, type Envelope, type EnvelopeMeta } from "../envelope";
import { ProfileError } from "../profile";
import { loadSite } from "./config";
import { captureSnapshot } from "./capture";
import { readSnapshot } from "./snapshot";
import { compareSnapshots, evaluateSnapshot } from "./compare";
import { inScope, rulesSchema, webUrl } from "./model";
import { resolveVersion } from "./git-context";
import { explainSnapshots } from "./explain";
import { discoverRoutes } from "./discover";
import type { SiteCommand } from "./commands";
const readJson = async (path: string) => JSON.parse(await readFile(path.replace(/^@/, ""), "utf8"));
export async function executeSite(command: SiteCommand, signal: AbortSignal): Promise<Envelope> {
  const meta: EnvelopeMeta = {
    profile: command.profileFlag,
    provider: null,
    capability: `site.${command.action}`,
    effects: [],
    cost: null,
    artifact: null,
    attemptId: null,
    spendOutcome: null,
    providerRequestId: null,
  };
  try {
    let data: unknown;
    if (
      command.action === "doctor" ||
      command.action === "snapshot" ||
      command.action === "discover"
    ) {
      const { profile, config, configPath } = await loadSite(command.profileFlag);
      meta.profile = profile.name;
      if (command.action === "doctor")
        return {
          ok: true,
          data: {
            status: "configuration_valid",
            config: configPath,
            site: config.site,
            routes: config.seeds.length,
            storage: "caller-owned snapshot directories",
            network_probed: false,
          },
          meta,
        };
      if (command.action === "discover") {
        const urls = v.pipe(v.array(webUrl), v.minLength(1), v.maxLength(100));
        const roots = command.sitemaps
          ? v.parse(urls, await readJson(command.sitemaps))
          : [new URL("/sitemap.xml", config.origins[0]).href];
        const extras = command.sitemapOrigins
          ? v.parse(urls, await readJson(command.sitemapOrigins))
          : [];
        if (extras.some((url) => new URL(url).pathname !== "/"))
          throw new GkitFailure({
            code: "INVALID_INPUT",
            message: "Sitemap origins must not include a path.",
          });
        const sitemapOrigins = [
          ...new Set([...config.origins, ...roots.map((url) => new URL(url).origin), ...extras]),
        ];
        const options = {
          roots: [...new Set(roots)],
          sitemapOrigins,
          maxSitemaps: command.maxSitemaps,
          maxUrls: command.maxUrls,
          out: command.out,
          signal,
        };
        if (command.dryRun)
          return { ok: true, data: { status: "prepared", ...options, signal: undefined }, meta };
        meta.effects = ["site:http-read", "local:write"];
        const result = await discoverRoutes(config, {
          ...options,
          progress: (message) => process.stderr.write(message + "\n"),
        });
        meta.artifact = result.receipt;
        return {
          ok: true,
          data: {
            id: result.manifest.id,
            coverage: result.manifest.coverage,
            artifact: result.receipt,
          },
          meta,
        };
      }
      const routes = command.routes
        ? v.parse(
            v.pipe(v.array(webUrl), v.minLength(1), v.maxLength(10000)),
            await readJson(command.routes),
          )
        : config.seeds;
      if (new Set(routes).size !== routes.length || routes.some((url) => !inScope(url, config)))
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "Routes must be unique URLs within the configured site origins.",
        });
      if (command.dryRun)
        return {
          ok: true,
          data: {
            status: "prepared",
            source: command.build ? "nuxt-build" : "production-http",
            routes,
            out: command.out,
            revision: command.revision,
            runtime_context: command.runtimeContext,
          },
          meta,
        };
      meta.effects = [
        ...(command.revision ? [command.repo ? "git:read" : "github:read"] : []),
        ...(command.build ? ["build:read", "local-server:execute"] : ["site:http-read"]),
        "local:write",
      ];
      const version = command.revision
        ? await resolveVersion(config.github.repository, command.revision, command.repo, signal)
        : null;
      const result = await captureSnapshot({
        config,
        routes,
        out: command.out,
        source: command.build
          ? { kind: "nuxt-build", path: command.build, version: version! }
          : { kind: "production-http", version },
        runtimeContext: command.runtimeContext,
        signal,
        progress: (text) => process.stderr.write(text + "\n"),
      });
      meta.artifact = result.receipt;
      data = result.snapshot.manifest;
    } else if (command.action === "audit" || command.action === "diff") {
      const rules = command.rules ? v.parse(rulesSchema, await readJson(command.rules)) : undefined;
      data =
        command.action === "audit"
          ? evaluateSnapshot(await readSnapshot(command.snapshot), rules)
          : compareSnapshots(
              await readSnapshot(command.base),
              await readSnapshot(command.head),
              rules,
            );
      if (command.out) {
        meta.effects = ["local:write"];
        const source =
          command.format === "markdown"
            ? `---\ntype: SiteReport\noperation: ${command.action}\n---\n\n# Site ${command.action}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`
            : JSON.stringify(data, null, 2) + "\n";
        meta.artifact = await writeArtifact({ destinationPath: command.out, source });
        data = { id: (data as { id: string }).id, artifact: meta.artifact };
      }
    } else {
      const { profile, config, cacheRoot } = await loadSite(command.profileFlag);
      meta.profile = profile.name;
      const [base, head] = await Promise.all([
        readSnapshot(command.base),
        readSnapshot(command.head),
      ]);
      if (
        [base, head].some(
          (snapshot) =>
            snapshot.manifest.site !== config.site ||
            snapshot.manifest.source.version?.repository !== config.github.repository,
        )
      )
        throw new GkitFailure({
          code: "INVALID_INPUT",
          message: "Both snapshots must match the selected profile site and repository.",
        });
      meta.effects = [
        "git:read",
        ...(!command.repo ? ["github:read"] : []),
        ...(command.dryRun ? [] : ["external-grok:invoke"]),
        "local:write",
      ];
      data = await withArtifactReservation(
        { destinationPath: command.out },
        async (reservation) => {
          const result = await explainSnapshots(base, head, {
            repo: command.repo,
            model: command.model,
            cacheRoot,
            dryRun: command.dryRun,
            signal,
          });
          meta.artifact = await reservation.publish({
            source: JSON.stringify(result, null, 2) + "\n",
          });
          return { status: result.status, artifact: meta.artifact };
        },
      );
    }
    return { ok: true, data, meta };
  } catch (error) {
    if (signal.aborted)
      return toFailureEnvelope(
        new GkitFailure({ code: "CANCELLED", message: "Site operation cancelled.", meta }),
      );
    if (error instanceof ProfileError)
      return toFailureEnvelope(
        new GkitFailure({ code: "PROFILE_ERROR", message: error.message, meta }),
      );
    if (error instanceof ArtifactError)
      return toFailureEnvelope(
        new GkitFailure({
          code: "LOCAL_IO_ERROR",
          message: error.message,
          details: { reason: error.code },
          meta,
        }),
      );
    if (v.isValiError(error))
      return toFailureEnvelope(
        new GkitFailure({
          code: "INVALID_INPUT",
          message: "Input does not match the site schema.",
          meta,
        }),
      );
    if (error instanceof GkitFailure) return { ...toFailureEnvelope(error), meta };
    return toFailureEnvelope(
      new GkitFailure({
        code: "LOCAL_IO_ERROR",
        message:
          "Site input or execution failed. Check snapshot/build/repository paths and host dependencies.",
        meta,
      }),
    );
  }
}
