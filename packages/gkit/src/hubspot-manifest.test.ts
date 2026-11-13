import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { getManifestRecord, loadExecutableManifest } from './manifest'

describe('HubSpot reviewed manifest', () => {
	it('exposes only the seven reviewed cost-free read capabilities', async () => {
		const manifest = await loadExecutableManifest(
			new URL('../generated/hubspot/manifest.json', import.meta.url).pathname,
		)
		expect(manifest.document.capabilities).toHaveLength(7)
		for (const capability of manifest.document.capabilities) {
			expect(capability.provider).toBe('hubspot')
			expect(capability.effects).toEqual(['read'])
			expect(capability.cost).toBeUndefined()
		}
		expect(
			getManifestRecord(manifest, 'hubspot.crm.objects.search').adapterKey,
		).toBe('crm.objects.search')
		expect(() =>
			getManifestRecord(manifest, 'hubspot.crm.objects.create'),
		).toThrow(expect.objectContaining({ kind: 'CAPABILITY_NOT_FOUND' }))
	})

	it('keeps every mutation inventory-only', async () => {
		const inventory = JSON.parse(
			await readFile(
				new URL('../generated/hubspot/inventory.json', import.meta.url),
				'utf8',
			),
		) as {
			operations: Array<{
				method: string
				operationId: string
				exposure: string
			}>
		}
		const mutations = inventory.operations.filter(
			(operation) =>
				operation.method !== 'get' &&
				operation.operationId !== 'crm.objects.search',
		)
		expect(mutations.length).toBeGreaterThan(0)
		expect(
			mutations.every((operation) => operation.exposure === 'inventory'),
		).toBe(true)
	})
})
