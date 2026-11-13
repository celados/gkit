import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

import {
	ManifestError,
	compileExecutableManifest,
	getManifestRecord,
	loadExecutableManifest,
	validateManifestInput,
} from './manifest'

function executableManifest() {
	return {
		version: 1,
		provider: 'dataforseo',
		revision: 'dataforseo-2026-07-13.1',
		source: {
			url: 'https://docs.dataforseo.com/v3/backlinks-bulk_ranks-live/',
			revision: '2026-07-13',
			checksum: 'sha256:test',
		},
		reviewedAt: '2026-07-13T23:48:57+08:00',
		capabilities: [
			{
				id: 'dataforseo.backlinks.bulk_ranks.live',
				provider: 'dataforseo',
				revision: '1',
				adapterKey: 'backlinks.bulk-ranks-live',
				title: 'Bulk backlink ranks',
				description: 'Read DataForSEO backlink ranks for reviewed targets.',
				effects: ['read', 'spend'],
				inputSchema: {
					type: 'object',
					additionalProperties: false,
					required: ['targets'],
					properties: {
						targets: {
							type: 'array',
							minItems: 1,
							maxItems: 1_000,
							items: { type: 'string', minLength: 1 },
						},
					},
				},
				examples: [
					{
						title: 'Compare two domains',
						input: { targets: ['example.com', 'example.org'] },
						command:
							'gkit --profile app-a dataforseo api call --operation-id dataforseo.backlinks.bulk_ranks.live --input @request.json',
					},
				],
				cost: {
					currency: 'USD',
					policyRevision: 'dataforseo-backlinks-2026-07-01',
					model: {
						type: 'linear-items',
						baseMicros: 24_000,
						perItemMicros: 36,
						itemsJsonPointer: '/targets',
						maxItems: 1_000,
					},
				},
			},
		],
	}
}

describe('executable manifest', () => {
	test('loads the committed Slice 1 manifest', async () => {
		const path = fileURLToPath(
			new URL('../generated/dataforseo/manifest.json', import.meta.url),
		)
		const manifest = await loadExecutableManifest(path)
		const record = getManifestRecord(
			manifest,
			'dataforseo.backlinks.bulk_ranks.live',
		)

		expect(
			validateManifestInput(record, { targets: ['example.com'] }),
		).toMatchObject({
			ok: true,
		})
	})

	test('compiles the committed input schema once and validates runtime input', () => {
		const manifest = compileExecutableManifest(executableManifest())
		const record = getManifestRecord(
			manifest,
			'dataforseo.backlinks.bulk_ranks.live',
		)

		expect(validateManifestInput(record, { targets: ['example.com'] })).toEqual(
			{
				ok: true,
				value: { targets: ['example.com'] },
			},
		)

		const invalid = validateManifestInput(record, {
			targets: [],
			password: 'must-not-be-accepted',
		})
		expect(invalid.ok).toBe(false)
		if (!invalid.ok) {
			expect(invalid.issues.map((issue) => issue.keyword)).toEqual(
				expect.arrayContaining(['minItems', 'additionalProperties']),
			)
		}
	})

	test('keeps discovery metadata on the same reviewed record', () => {
		const manifest = compileExecutableManifest(executableManifest())
		const record = getManifestRecord(
			manifest,
			'dataforseo.backlinks.bulk_ranks.live',
		)

		expect(record.title).toBe('Bulk backlink ranks')
		expect(record.description).toContain('reviewed targets')
		expect(record.examples[0]?.input).toEqual({
			targets: ['example.com', 'example.org'],
		})
		expect(manifest.document.source?.checksum).toBe('sha256:test')
	})

	test('rejects duplicate IDs, provider mismatches, and unreviewed fields', () => {
		const duplicate = executableManifest()
		duplicate.capabilities.push(structuredClone(duplicate.capabilities[0]!))
		expect(() => compileExecutableManifest(duplicate)).toThrow(
			'duplicate capability ID',
		)

		const mismatch = executableManifest()
		mismatch.capabilities[0]!.provider = 'posthog'
		expect(() => compileExecutableManifest(mismatch)).toThrow(
			'not manifest provider',
		)

		const extraField = executableManifest() as ReturnType<
			typeof executableManifest
		> & {
			handlerSchema?: unknown
		}
		extraField.handlerSchema = {}
		expect(() => compileExecutableManifest(extraField)).toThrow(ManifestError)
	})

	test('requires every spend record to have a reviewed cost policy', () => {
		const input = executableManifest()
		Reflect.deleteProperty(input.capabilities[0]!, 'cost')

		expect(() => compileExecutableManifest(input)).toThrow(
			'Spend capabilities must define exactly one reviewed cost policy',
		)
	})

	test('rejects examples that drift from the executable input schema', () => {
		const input = executableManifest()
		input.capabilities[0]!.examples[0]!.input = { targets: [] }

		expect(() => compileExecutableManifest(input)).toThrow(
			'Example input for capability',
		)
	})

	test('returns a stable capability-not-found error', () => {
		const manifest = compileExecutableManifest(executableManifest())

		expect(() => getManifestRecord(manifest, 'missing.operation')).toThrow(
			expect.objectContaining({ kind: 'CAPABILITY_NOT_FOUND' }),
		)
	})
})
