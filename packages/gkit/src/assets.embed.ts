// Every runtime-read asset, inlined into the standalone bundle (bun text/json imports).
// Keep in sync with generated/*/manifest.json and docs/providers/**; assets.test.ts fails on drift.

import a0 from '../docs/providers/bing/capabilities.md' with { type: 'text' }
import a1 from '../docs/providers/bing/inventory.md' with { type: 'text' }
import a2 from '../docs/providers/dataforseo/backlinks.md' with { type: 'text' }
import a3 from '../docs/providers/dataforseo/inventory.md' with { type: 'text' }
import a4 from '../docs/providers/google-ads/capabilities.md' with { type: 'text' }
import a5 from '../docs/providers/google-ads/inventory.md' with { type: 'text' }
import a6 from '../docs/providers/gsc/capabilities.md' with { type: 'text' }
import a7 from '../docs/providers/gsc/inventory.md' with { type: 'text' }
import a8 from '../docs/providers/hubspot/capabilities.md' with { type: 'text' }
import a9 from '../docs/providers/hubspot/inventory.md' with { type: 'text' }
import a10 from '../docs/providers/pagespeed/capabilities.md' with { type: 'text' }
import a11 from '../docs/providers/pagespeed/inventory.md' with { type: 'text' }
import a12 from '../docs/providers/posthog/capabilities.md' with { type: 'text' }
import a13 from '../docs/providers/posthog/inventory.md' with { type: 'text' }
import a14 from '../generated/bing/manifest.json' with { type: 'json' }
import a15 from '../generated/dataforseo/manifest.json' with { type: 'json' }
import a16 from '../generated/google-ads/manifest.json' with { type: 'json' }
import a17 from '../generated/gsc/manifest.json' with { type: 'json' }
import a18 from '../generated/hubspot/manifest.json' with { type: 'json' }
import a19 from '../generated/pagespeed/manifest.json' with { type: 'json' }
import a20 from '../generated/posthog/manifest.json' with { type: 'json' }

export const embeddedAssets: Readonly<Record<string, string>> = {
	'docs/providers/bing/capabilities.md': a0,
	'docs/providers/bing/inventory.md': a1,
	'docs/providers/dataforseo/backlinks.md': a2,
	'docs/providers/dataforseo/inventory.md': a3,
	'docs/providers/google-ads/capabilities.md': a4,
	'docs/providers/google-ads/inventory.md': a5,
	'docs/providers/gsc/capabilities.md': a6,
	'docs/providers/gsc/inventory.md': a7,
	'docs/providers/hubspot/capabilities.md': a8,
	'docs/providers/hubspot/inventory.md': a9,
	'docs/providers/pagespeed/capabilities.md': a10,
	'docs/providers/pagespeed/inventory.md': a11,
	'docs/providers/posthog/capabilities.md': a12,
	'docs/providers/posthog/inventory.md': a13,
	'generated/bing/manifest.json': `${JSON.stringify(a14, null, 2)}\n`,
	'generated/dataforseo/manifest.json': `${JSON.stringify(a15, null, 2)}\n`,
	'generated/google-ads/manifest.json': `${JSON.stringify(a16, null, 2)}\n`,
	'generated/gsc/manifest.json': `${JSON.stringify(a17, null, 2)}\n`,
	'generated/hubspot/manifest.json': `${JSON.stringify(a18, null, 2)}\n`,
	'generated/pagespeed/manifest.json': `${JSON.stringify(a19, null, 2)}\n`,
	'generated/posthog/manifest.json': `${JSON.stringify(a20, null, 2)}\n`,
}
