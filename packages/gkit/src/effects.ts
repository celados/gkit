import type { ManifestRecord } from './manifest'
import type { ProviderEnvironment, ProviderPolicy } from './profile'

export type EffectAuthorization = {
	allowSpend?: boolean
	allowWrite?: boolean
	allowDestructive?: boolean
	maxSpendUsd?: string
}

export type EffectGateRequest = {
	record: ManifestRecord
	input: unknown
	profilePolicy: ProviderPolicy
	authorization: EffectAuthorization
	environment: ProviderEnvironment
}

export type EffectDenialReason =
	| 'missing_allow_write'
	| 'missing_allow_destructive'
	| 'missing_allow_spend'
	| 'cost_bound_unavailable'
	| 'missing_invocation_cap'
	| 'invalid_invocation_cap'
	| 'missing_profile_cap'
	| 'invalid_profile_cap'
	| 'above_invocation_cap'
	| 'above_profile_cap'

export type AllowedEffectDecision = {
	allowed: true
	effects: ManifestRecord['effects']
	environment: ProviderEnvironment
	currency: 'USD' | null
	policyRevision: string | null
	maxCostMicros: number | null
	liveCostUpperBoundMicros: number | null
	invocationMaxCostMicros: number | null
	profileMaxCostMicros: number | null
}

export type DeniedEffectDecision = {
	allowed: false
	code: 'EFFECT_NOT_ALLOWED'
	reason: EffectDenialReason
	message: string
	hint: string
}

export type EffectDecision = AllowedEffectDecision | DeniedEffectDecision

export function evaluateEffects(request: EffectGateRequest): EffectDecision {
	const { record, input, profilePolicy, authorization, environment } = request

	if (
		(record.effects.includes('write') ||
			record.effects.includes('destructive')) &&
		!authorization.allowWrite
	) {
		return denied(
			'missing_allow_write',
			'This capability can change provider state.',
			'Review the request, then rerun with --allow-write.',
		)
	}
	if (
		record.effects.includes('destructive') &&
		!authorization.allowDestructive
	) {
		return denied(
			'missing_allow_destructive',
			'This capability can destructively change provider state.',
			'Review the request, then rerun with --allow-write --allow-destructive.',
		)
	}
	if (!record.effects.includes('spend')) {
		return allowedWithoutSpend(record, environment)
	}
	if (!authorization.allowSpend) {
		return denied(
			'missing_allow_spend',
			'This capability can spend provider credits.',
			'Review the request, then rerun with --allow-spend and --max-spend-usd.',
		)
	}
	if (!record.cost) {
		return denied(
			'cost_bound_unavailable',
			'This spend capability has no reviewed cost bound.',
			'Do not dispatch it until the executable manifest has a reviewed cost policy.',
		)
	}

	const liveCostUpperBoundMicros = calculateLiveCostBound(record, input)
	if (liveCostUpperBoundMicros === null) {
		return denied(
			'cost_bound_unavailable',
			'The request input cannot be bounded by the reviewed cost policy.',
			'Validate and constrain the request input before dispatch.',
		)
	}

	if (authorization.maxSpendUsd === undefined) {
		return denied(
			'missing_invocation_cap',
			'Spend calls require an invocation cost cap.',
			'Pass --max-spend-usd with a reviewed decimal USD amount.',
		)
	}
	const invocationMaxCostMicros = tryUsdToMicros(authorization.maxSpendUsd)
	if (invocationMaxCostMicros === null) {
		return denied(
			'invalid_invocation_cap',
			'The invocation cost cap is not a valid USD decimal.',
			'Use a non-negative decimal with at most six fractional digits.',
		)
	}

	if (profilePolicy.maxSpendUsdPerCall === undefined) {
		return denied(
			'missing_profile_cap',
			'This profile has no per-call spend cap.',
			'Set policy.maxSpendUsdPerCall in the profile before dispatch.',
		)
	}
	const profileMaxCostMicros = tryUsdToMicros(profilePolicy.maxSpendUsdPerCall)
	if (profileMaxCostMicros === null) {
		return denied(
			'invalid_profile_cap',
			'The profile per-call spend cap is invalid.',
			'Use a non-negative decimal with at most six fractional digits.',
		)
	}

	const maxCostMicros = environment === 'sandbox' ? 0 : liveCostUpperBoundMicros
	if (maxCostMicros > invocationMaxCostMicros) {
		return denied(
			'above_invocation_cap',
			'The reviewed cost bound exceeds the invocation cap.',
			'Increase --max-spend-usd only after reviewing the request.',
		)
	}
	if (maxCostMicros > profileMaxCostMicros) {
		return denied(
			'above_profile_cap',
			'The reviewed cost bound exceeds the profile per-call cap.',
			'Reduce the request or update the profile policy after review.',
		)
	}

	return {
		allowed: true,
		effects: record.effects,
		environment,
		currency: record.cost.currency,
		policyRevision: record.cost.policyRevision,
		maxCostMicros,
		liveCostUpperBoundMicros,
		invocationMaxCostMicros,
		profileMaxCostMicros,
	}
}

export function usdToMicros(value: string): number {
	const micros = tryUsdToMicros(value)
	if (micros === null) {
		throw new RangeError(
			'USD amount must be a non-negative decimal with at most six fractional digits.',
		)
	}
	return micros
}

function allowedWithoutSpend(
	record: ManifestRecord,
	environment: ProviderEnvironment,
): AllowedEffectDecision {
	return {
		allowed: true,
		effects: record.effects,
		environment,
		currency: null,
		policyRevision: null,
		maxCostMicros: null,
		liveCostUpperBoundMicros: null,
		invocationMaxCostMicros: null,
		profileMaxCostMicros: null,
	}
}

function denied(
	reason: EffectDenialReason,
	message: string,
	hint: string,
): DeniedEffectDecision {
	return {
		allowed: false,
		code: 'EFFECT_NOT_ALLOWED',
		reason,
		message,
		hint,
	}
}

function calculateLiveCostBound(
	record: ManifestRecord,
	input: unknown,
): number | null {
	if (!record.cost) {
		return null
	}
	const model = record.cost.model
	if (model.type === 'fixed') {
		return model.micros
	}

	let units: number
	if (model.type === 'linear-items') {
		const items = resolveJsonPointer(input, model.itemsJsonPointer)
		if (!Array.isArray(items) || items.length > model.maxItems) return null
		units = items.length
	} else {
		const value = resolveJsonPointer(input, model.valueJsonPointer)
		if (
			!Number.isSafeInteger(value) ||
			(value as number) < 0 ||
			(value as number) > model.maxValue
		) {
			return null
		}
		units = value as number
	}

	const perUnitMicros =
		model.type === 'linear-items' ? model.perItemMicros : model.perUnitMicros
	const cost = BigInt(model.baseMicros) + BigInt(perUnitMicros) * BigInt(units)
	if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
		return null
	}
	return Number(cost)
}

function resolveJsonPointer(input: unknown, pointer: string): unknown {
	if (pointer === '') {
		return input
	}

	let current = input
	for (const encodedSegment of pointer.slice(1).split('/')) {
		if (current === null || typeof current !== 'object') {
			return undefined
		}
		const segment = encodedSegment.replaceAll('~1', '/').replaceAll('~0', '~')
		current = (current as Record<string, unknown>)[segment]
	}
	return current
}

function tryUsdToMicros(value: string): number | null {
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value)
	if (!match) {
		return null
	}

	const wholeMicros = BigInt(match[1]) * 1_000_000n
	const fractionalMicros = BigInt((match[2] ?? '').padEnd(6, '0'))
	const micros = wholeMicros + fractionalMicros
	if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
		return null
	}
	return Number(micros)
}
