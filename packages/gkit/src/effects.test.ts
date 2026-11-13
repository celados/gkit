import { describe, expect, test } from 'vitest'

import { evaluateEffects, usdToMicros } from './effects'
import {
	compileExecutableManifest,
	getManifestRecord,
	type ManifestRecord,
} from './manifest'

function spendRecord(): ManifestRecord {
	const manifest = compileExecutableManifest({
		version: 1,
		provider: 'dataforseo',
		revision: '1',
		capabilities: [
			{
				id: 'dataforseo.backlinks.bulk_ranks.live',
				provider: 'dataforseo',
				revision: '1',
				adapterKey: 'backlinks.bulk-ranks-live',
				title: 'Bulk backlink ranks',
				description: 'Read ranks for a bounded target list.',
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
							items: { type: 'string' },
						},
					},
				},
				examples: [
					{
						input: { targets: ['example.com'] },
						command: 'gkit dataforseo api call --input @request.json',
					},
				],
				cost: {
					currency: 'USD',
					policyRevision: 'pricing-2026-07-01',
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
	})
	return getManifestRecord(manifest, 'dataforseo.backlinks.bulk_ranks.live')
}

function evaluateSpend(
	overrides: Partial<Parameters<typeof evaluateEffects>[0]> = {},
) {
	return evaluateEffects({
		record: spendRecord(),
		input: { targets: ['example.com', 'example.org'] },
		profilePolicy: { maxSpendUsdPerCall: '0.05' },
		authorization: { allowSpend: true, maxSpendUsd: '0.05' },
		environment: 'production',
		...overrides,
	})
}

describe('integer USD amounts', () => {
	test('converts decimals exactly without floating point arithmetic', () => {
		expect(usdToMicros('0.000001')).toBe(1)
		expect(usdToMicros('0.024072')).toBe(24_072)
		expect(usdToMicros('123.4')).toBe(123_400_000)
	})

	test('rejects signs, exponents, excessive precision, and unsafe values', () => {
		for (const input of [
			'-1',
			'+1',
			'1e-3',
			'0.0000001',
			'01',
			'999999999999999999999',
		]) {
			expect(() => usdToMicros(input)).toThrow(RangeError)
		}
	})
})

describe('effect gate', () => {
	test('bounds fixed and linear-number reviewed cost models', () => {
		const fixedRecord = {
			...spendRecord(),
			cost: {
				currency: 'USD' as const,
				policyRevision: 'fixed-v1',
				model: { type: 'fixed' as const, micros: 2_000 },
			},
		}
		expect(
			evaluateEffects({
				record: fixedRecord,
				input: {},
				profilePolicy: { maxSpendUsdPerCall: '0.03' },
				authorization: { allowSpend: true, maxSpendUsd: '0.002' },
				environment: 'production',
			}),
		).toMatchObject({ allowed: true, maxCostMicros: 2_000 })

		const linearRecord = {
			...spendRecord(),
			cost: {
				currency: 'USD' as const,
				policyRevision: 'linear-v1',
				model: {
					type: 'linear-number' as const,
					baseMicros: 24_000,
					perUnitMicros: 36,
					valueJsonPointer: '/limit',
					maxValue: 100,
				},
			},
		}
		expect(
			evaluateEffects({
				record: linearRecord,
				input: { limit: 20 },
				profilePolicy: { maxSpendUsdPerCall: '0.03' },
				authorization: { allowSpend: true, maxSpendUsd: '0.024720' },
				environment: 'production',
			}),
		).toMatchObject({ allowed: true, maxCostMicros: 24_720 })
	})
	test('allows read effects without spend metadata', () => {
		const record = {
			...spendRecord(),
			effects: ['read'] as ManifestRecord['effects'],
			cost: undefined,
		}
		const decision = evaluateEffects({
			record,
			input: {},
			profilePolicy: {},
			authorization: {},
			environment: 'production',
		})

		expect(decision).toMatchObject({ allowed: true, maxCostMicros: null })
	})

	test('requires explicit spend acknowledgement before using any cap', () => {
		const decision = evaluateSpend({ authorization: { maxSpendUsd: '0.05' } })

		expect(decision).toMatchObject({
			allowed: false,
			code: 'EFFECT_NOT_ALLOWED',
			reason: 'missing_allow_spend',
		})
	})

	test('requires valid invocation and profile per-call caps', () => {
		expect(
			evaluateSpend({
				authorization: { allowSpend: true },
			}),
		).toMatchObject({ allowed: false, reason: 'missing_invocation_cap' })
		expect(
			evaluateSpend({
				authorization: { allowSpend: true, maxSpendUsd: '0.0000001' },
			}),
		).toMatchObject({ allowed: false, reason: 'invalid_invocation_cap' })
		expect(evaluateSpend({ profilePolicy: {} })).toMatchObject({
			allowed: false,
			reason: 'missing_profile_cap',
		})
	})

	test('computes the conservative bound and enforces both per-call caps', () => {
		expect(evaluateSpend()).toMatchObject({
			allowed: true,
			maxCostMicros: 24_072,
			liveCostUpperBoundMicros: 24_072,
			invocationMaxCostMicros: 50_000,
			profileMaxCostMicros: 50_000,
			policyRevision: 'pricing-2026-07-01',
		})

		expect(
			evaluateSpend({
				authorization: { allowSpend: true, maxSpendUsd: '0.02' },
			}),
		).toMatchObject({ allowed: false, reason: 'above_invocation_cap' })

		expect(
			evaluateSpend({
				profilePolicy: { maxSpendUsdPerCall: '0.02' },
			}),
		).toMatchObject({ allowed: false, reason: 'above_profile_cap' })
	})

	test('fails closed when the input cannot be bounded', () => {
		expect(evaluateSpend({ input: { targets: 'example.com' } })).toMatchObject({
			allowed: false,
			reason: 'cost_bound_unavailable',
		})

		expect(
			evaluateSpend({ input: { targets: Array.from({ length: 1_001 }) } }),
		).toMatchObject({
			allowed: false,
			reason: 'cost_bound_unavailable',
		})
	})

	test('keeps sandbox acknowledgement and caps while authorizing zero cost', () => {
		expect(
			evaluateSpend({
				environment: 'sandbox',
				profilePolicy: { maxSpendUsdPerCall: '0' },
				authorization: { allowSpend: true, maxSpendUsd: '0' },
			}),
		).toMatchObject({
			allowed: true,
			environment: 'sandbox',
			maxCostMicros: 0,
			liveCostUpperBoundMicros: 24_072,
		})

		expect(
			evaluateSpend({
				environment: 'sandbox',
				authorization: { maxSpendUsd: '0' },
			}),
		).toMatchObject({ allowed: false, reason: 'missing_allow_spend' })
	})

	test('requires both write gates for destructive capabilities', () => {
		const record = {
			...spendRecord(),
			effects: ['write', 'destructive'] as ManifestRecord['effects'],
			cost: undefined,
		}
		const base = {
			record,
			input: {},
			profilePolicy: {},
			authorization: {},
			environment: 'production' as const,
		}

		expect(evaluateEffects(base)).toMatchObject({
			allowed: false,
			reason: 'missing_allow_write',
		})
		expect(
			evaluateEffects({
				...base,
				authorization: { allowWrite: true },
			}),
		).toMatchObject({
			allowed: false,
			reason: 'missing_allow_destructive',
		})
		expect(
			evaluateEffects({
				...base,
				authorization: { allowWrite: true, allowDestructive: true },
			}),
		).toMatchObject({ allowed: true })

		const destructiveOnly = {
			...record,
			effects: ['destructive'] as ManifestRecord['effects'],
		}
		expect(
			evaluateEffects({
				...base,
				record: destructiveOnly,
				authorization: { allowDestructive: true },
			}),
		).toMatchObject({ allowed: false, reason: 'missing_allow_write' })
	})
})
