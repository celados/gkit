import { c, group } from "argc";
import { toStandardJsonSchema as s } from "@valibot/to-json-schema";
import * as v from "valibot";
const command = (description: string, input: v.GenericSchema) =>
  c.meta({ description }).input(s(input));
const output = {
  out: v.optional(v.string()),
  format: v.optional(v.picklist(["json", "markdown"])),
  rules: v.optional(v.string()),
};
export const siteRouter = group(
  { description: "Portable SiteSnapshot artifacts. No implicit ledger or baseline." },
  {
    doctor: command("Validate local profile/site configuration; no network.", v.strictObject({})),
    discover: command(
      "gkit --profile <app> site discover --out <new-directory> [--sitemaps @urls.json] [--sitemap-origins @origins.json]. Saves routes.json plus source XML and discovery coverage. Additional sitemap origins never widen the page scope. --dry-run is offline.",
      v.strictObject({
        sitemaps: v.optional(v.string()),
        sitemapOrigins: v.optional(v.string()),
        maxSitemaps: v.optional(v.number()),
        maxUrls: v.optional(v.number()),
        out: v.string(),
        dryRun: v.optional(v.boolean()),
      }),
    ),
    snapshot: command(
      "gkit --profile <app> site snapshot --build .output --revision <sha-or-tag> --context <runtime-input-label> --out <new-directory>. Or --http for production observations. Writes manifest.json, pages.jsonl and content/; --dry-run is offline.",
      v.strictObject({
        build: v.optional(v.string()),
        http: v.optional(v.boolean()),
        revision: v.optional(v.string()),
        repo: v.optional(v.string()),
        routes: v.optional(v.string()),
        context: v.string(),
        out: v.string(),
        dryRun: v.optional(v.boolean()),
      }),
    ),
    audit: command(
      "gkit site audit <snapshot-directory> [--rules @rules.json] [--out report.json]. Offline; leaves the snapshot unchanged.",
      v.strictObject({ snapshot: v.string(), ...output }),
    ),
    diff: command(
      "gkit site diff <base-snapshot> <head-snapshot> [--rules @rules.json] [--out diff.json]. Offline page and audit comparison.",
      v.strictObject({ base: v.string(), head: v.string(), ...output }),
    ),
    explain: command(
      "gkit --profile <app> site explain <base-snapshot> <head-snapshot> --model <grok-model> --out explanation.json [--repo <checkout>] [--dry-run]. Reads exact Git trees and invokes host Grok CLI; --dry-run writes the bounded model input without invoking Grok. Successful results cached under the selected profile.",
      v.strictObject({
        base: v.string(),
        head: v.string(),
        model: v.string(),
        repo: v.optional(v.string()),
        out: v.string(),
        dryRun: v.optional(v.boolean()),
      }),
    ),
  },
);
