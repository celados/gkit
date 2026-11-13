import { describe, expect, it } from 'vitest'

import { generateGoogleAdsArtifacts } from './generate-google-ads'

const packageRoot = new URL('..', import.meta.url).pathname

describe('Google Ads artifact generator', () => {
	it('projects five pinned REST methods into six reviewed read capabilities', async () => {
		const first = await generateGoogleAdsArtifacts(packageRoot)
		const second = await generateGoogleAdsArtifacts(packageRoot)

		expect(second).toEqual(first)

		const manifest = JSON.parse(first.manifest) as {
			source: { revision: string; checksum: string }
			capabilities: Array<{ id: string; adapterKey: string; effects: string[] }>
		}
		const inventory = JSON.parse(first.inventory) as {
			operations: Array<{
				operationId: string
				exposure: 'executable' | 'inventory'
			}>
		}

		expect(manifest.source).toMatchObject({
			revision: '20260624',
			checksum:
				'sha256:202028d3abcb9e4681d35f3c28d06e6ced1eaac2ec57c56357c8ab5d522841d7',
		})
		expect(manifest.capabilities.map((capability) => capability.id)).toEqual([
			'google-ads.customers.list-accessible',
			'google-ads.fields.describe',
			'google-ads.fields.search',
			'google-ads.keyword-plan.generate-historical-metrics',
			'google-ads.keyword-plan.generate-ideas',
			'google-ads.query.gaql',
		])
		expect(
			manifest.capabilities.every(
				(capability) => capability.effects.join() === 'read',
			),
		).toBe(true)
		expect(
			inventory.operations.filter(
				(operation) => operation.exposure === 'executable',
			),
		).toHaveLength(5)
		expect(first.docs).toContain('google-ads.query.gaql')
		expect(first.inventoryDocs).toContain(
			'googleads.customers.googleAds.search',
		)
	}, 20_000)
})
