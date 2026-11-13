import { c, group } from '@celados/argc'
import { toStandardJsonSchema as s } from '@valibot/to-json-schema'
import * as v from 'valibot'

// Field keys are the flag spellings `site/commands.ts` parses. Positional
// arguments are fields described as such, in call order.
const command = (
	description: string,
	input: v.GenericSchema,
	examples: string[] = [],
) => c.meta({ description, examples }).input(s(input))
const text = (description: string) =>
	v.pipe(v.string(), v.description(description))
const flag = (description: string) =>
	v.pipe(v.boolean(), v.description(description))
const snapshot = (description: string) => text(`Positional: ${description}`)
const dryRun = v.optional(
	flag('Offline: validate and write the bounded input only'),
)
const output = {
	out: v.optional(text('Report file; required for markdown')),
	format: v.optional(v.picklist(['json', 'markdown']), 'json'),
	rules: v.optional(text('Audit rules, `@rules.json`')),
}
export const siteRouter = group(
	{
		description:
			'Portable SiteSnapshot artifacts. No implicit ledger or baseline.',
	},
	{
		doctor: command(
			'Validate local profile/site configuration; no network.',
			v.strictObject({}),
		),
		discover: command(
			'Save routes.json plus source XML and discovery coverage. Extra sitemap origins never widen the page scope.',
			v.strictObject({
				sitemaps: v.optional(text('URL list, `@urls.json`')),
				'sitemap-origins': v.optional(text('Extra origins, `@origins.json`')),
				'max-sitemaps': v.optional(v.number(), 50),
				'max-urls': v.optional(v.number(), 100000),
				out: text('New directory'),
				'dry-run': dryRun,
			}),
			[
				'gkit --profile <app> site discover --out <new-directory> --sitemaps @urls.json --dry-run',
			],
		),
		snapshot: command(
			'Write manifest.json, pages.jsonl and content/ from a build output or production observations. Exactly one of --build, --http.',
			v.strictObject({
				build: v.optional(text('Build output directory; needs --revision')),
				http: v.optional(
					flag('Observe production over HTTP instead of a build'),
				),
				revision: v.optional(text('Commit or tag the build came from')),
				repo: v.optional(text('Checkout for --revision')),
				routes: v.optional(text('Routes file from `site discover`')),
				context: text('Runtime-input label'),
				out: text('New directory'),
				'dry-run': dryRun,
			}),
			[
				'gkit --profile <app> site snapshot --build .output --revision <sha-or-tag> --context <label> --out <new-directory>',
			],
		),
		audit: command(
			'Audit a snapshot offline; leaves it unchanged.',
			v.strictObject({ snapshot: snapshot('snapshot directory'), ...output }),
			[
				'gkit site audit <snapshot-directory> --rules @rules.json --out report.json',
			],
		),
		diff: command(
			'Compare two snapshots offline: pages and audit results.',
			v.strictObject({
				base: snapshot('base snapshot'),
				head: snapshot('head snapshot'),
				...output,
			}),
			['gkit site diff <base-snapshot> <head-snapshot> --out diff.json'],
		),
		explain: command(
			'Explain a diff with the host Grok CLI over exact Git trees; --dry-run writes the bounded model input without invoking it. Results are cached under the profile.',
			v.strictObject({
				base: snapshot('base snapshot'),
				head: snapshot('head snapshot'),
				model: text('Grok model id'),
				repo: v.optional(text('Checkout holding both revisions')),
				out: text('Explanation file'),
				'dry-run': dryRun,
			}),
			[
				'gkit --profile <app> site explain <base-snapshot> <head-snapshot> --model <grok-model> --out explanation.json',
			],
		),
	},
)
