import { describe, expect, it } from 'vitest'

import { generatePostHogArtifacts } from './generate-posthog'

const packageRoot = new URL('..', import.meta.url).pathname

describe('PostHog artifact generator', () => {
	it('projects the pinned query endpoint into one executable capability and inventory', async () => {
		const first = await generatePostHogArtifacts(packageRoot)
		const second = await generatePostHogArtifacts(packageRoot)

		expect(second).toEqual(first)

		const manifest = JSON.parse(first.manifest) as {
			capabilities: Array<{ id: string; adapterKey: string }>
		}
		const inventory = JSON.parse(first.inventory) as {
			operations: Array<{
				operationId: string
				exposure: 'executable' | 'inventory'
			}>
		}

		expect(manifest.capabilities).toEqual([
			expect.objectContaining({
				id: 'posthog.query.run',
				adapterKey: 'query.run',
			}),
		])
		expect(inventory.operations).toContainEqual(
			expect.objectContaining({
				operationId: 'query_create',
				exposure: 'executable',
			}),
		)
		expect(first.docs).toContain('posthog.query.run')
	}, 15_000)
})
