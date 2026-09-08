import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import * as v from "valibot";
import { loadProfile, selectProfileName } from "../profile";
import { GkitFailure } from "../envelope";
import { inScope, siteConfigSchema } from "./model";

export async function loadSite(profileFlag: string | null) {
  const profile = await loadProfile(selectProfileName(profileFlag ?? undefined));
  const configPath = resolve(
    dirname(profile.path),
    profile.site?.configFile ?? `${profile.name}/site.json`,
  );
  let input: unknown;
  try {
    input = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    throw new GkitFailure({
      code: "PROFILE_ERROR",
      message: "Cannot read the site configuration JSON.",
    });
  }
  const result = v.safeParse(siteConfigSchema, input);
  if (!result.success)
    throw new GkitFailure({
      code: "PROFILE_ERROR",
      message: "Invalid site configuration.",
      details: {
        issues: result.issues.map((issue) => ({
          message: issue.message,
          path: issue.path?.map((part) => part.key).join("."),
        })),
      },
    });
  const config = result.output;
  if (
    config.origins.some((origin) => new URL(origin).pathname !== "/") ||
    config.seeds.some((url) => !inScope(url, config))
  )
    throw new GkitFailure({
      code: "PROFILE_ERROR",
      message: "Origins must be origins; all page seeds must be in scope.",
    });
  const cacheRoot = resolve(dirname(profile.path), profile.name, "cache", "site-explanations");
  return { profile, config, configPath, cacheRoot };
}
