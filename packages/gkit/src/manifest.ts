import Ajv, {
	type AnySchema,
	type ErrorObject,
	type ValidateFunction,
} from 'ajv'
import { readFile } from 'node:fs/promises'
import {
	array,
	check,
	integer,
	literal,
	maxValue,
	minLength,
	minValue,
	number,
	optional,
	picklist,
	pipe,
	record,
	regex,
	safeParse,
	strictObject,
	string,
	union,
	unknown,
	type InferOutput,
} from 'valibot'

const nonEmptyString = pipe(string(), minLength(1))
const nonNegativeSafeInteger = pipe(
	number(),
	integer(),
	minValue(0),
	maxValue(Number.MAX_SAFE_INTEGER),
)

export const effectSchema = picklist(['read', 'spend', 'write', 'destructive'])

const manifestExampleSchema = strictObject({
	title: optional(nonEmptyString),
	input: unknown(),
	command: nonEmptyString,
})

const linearItemsCostModelSchema = strictObject({
	type: literal('linear-items'),
	baseMicros: nonNegativeSafeInteger,
	perItemMicros: nonNegativeSafeInteger,
	itemsJsonPointer: pipe(string(), regex(/^(?:$|\/)/)),
	maxItems: pipe(number(), integer(), minValue(1), maxValue(1_000_000)),
})

const linearNumberCostModelSchema = strictObject({
	type: literal('linear-number'),
	baseMicros: nonNegativeSafeInteger,
	perUnitMicros: nonNegativeSafeInteger,
	valueJsonPointer: pipe(string(), regex(/^(?:$|\/)/)),
	maxValue: pipe(number(), integer(), minValue(1), maxValue(1_000_000)),
})

const fixedCostModelSchema = strictObject({
	type: literal('fixed'),
	micros: nonNegativeSafeInteger,
})

const capabilityCostSchema = strictObject({
	currency: literal('USD'),
	policyRevision: nonEmptyString,
	model: union([
		linearItemsCostModelSchema,
		linearNumberCostModelSchema,
		fixedCostModelSchema,
	]),
})

export const manifestRecordSchema = pipe(
	strictObject({
		id: nonEmptyString,
		provider: nonEmptyString,
		revision: nonEmptyString,
		adapterKey: nonEmptyString,
		title: nonEmptyString,
		description: nonEmptyString,
		effects: pipe(
			array(effectSchema),
			minLength(1),
			check(
				(effects) => new Set(effects).size === effects.length,
				'Capability effects must be unique.',
			),
		),
		inputSchema: record(string(), unknown()),
		examples: pipe(array(manifestExampleSchema), minLength(1)),
		cost: optional(capabilityCostSchema),
	}),
	check(
		(record) => record.effects.includes('spend') === Boolean(record.cost),
		'Spend capabilities must define exactly one reviewed cost policy.',
	),
)

const manifestSourceSchema = strictObject({
	url: nonEmptyString,
	revision: nonEmptyString,
	checksum: nonEmptyString,
})

export const executableManifestSchema = strictObject({
	version: literal(1),
	provider: nonEmptyString,
	revision: nonEmptyString,
	source: optional(manifestSourceSchema),
	reviewedAt: optional(
		pipe(
			string(),
			regex(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
			),
		),
	),
	capabilities: pipe(array(manifestRecordSchema), minLength(1)),
})

export type Effect = InferOutput<typeof effectSchema>
export type ManifestRecord = InferOutput<typeof manifestRecordSchema>
export type ExecutableManifest = InferOutput<typeof executableManifestSchema>

export type ManifestInputIssue = {
	instancePath: string
	keyword: string
	message: string
}

export type ManifestInputValidation =
	| { ok: true; value: unknown }
	| { ok: false; issues: ManifestInputIssue[] }

export type LoadedExecutableManifest = {
	document: ExecutableManifest
	records: ReadonlyMap<string, ManifestRecord>
}

export type ManifestErrorKind = 'MANIFEST_INVALID' | 'CAPABILITY_NOT_FOUND'

export class ManifestError extends Error {
	readonly kind: ManifestErrorKind

	constructor(kind: ManifestErrorKind, message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'ManifestError'
		this.kind = kind
	}
}

const inputValidators = new WeakMap<ManifestRecord, ValidateFunction>()

export async function loadExecutableManifest(
	path: string,
): Promise<LoadedExecutableManifest> {
	let source: string
	try {
		source = await readFile(path, 'utf8')
	} catch (error) {
		throw new ManifestError(
			'MANIFEST_INVALID',
			`Unable to read executable manifest at ${path}.`,
			error,
		)
	}

	let input: unknown
	try {
		input = JSON.parse(source)
	} catch (error) {
		throw new ManifestError(
			'MANIFEST_INVALID',
			`Executable manifest at ${path} is not valid JSON.`,
			error,
		)
	}

	return compileExecutableManifest(input)
}

export function compileExecutableManifest(
	input: unknown,
): LoadedExecutableManifest {
	const parsed = safeParse(executableManifestSchema, input)
	if (!parsed.success) {
		throw new ManifestError(
			'MANIFEST_INVALID',
			`Executable manifest failed structural validation: ${formatValibotIssues(parsed.issues)}`,
		)
	}

	const document = parsed.output
	const records = new Map<string, ManifestRecord>()
	const ajv = new Ajv({
		allErrors: true,
		allowUnionTypes: true,
		strict: true,
		validateFormats: false,
	})

	for (const record of document.capabilities) {
		if (record.provider !== document.provider) {
			throw new ManifestError(
				'MANIFEST_INVALID',
				`Capability ${record.id} belongs to ${record.provider}, not manifest provider ${document.provider}.`,
			)
		}
		if (records.has(record.id)) {
			throw new ManifestError(
				'MANIFEST_INVALID',
				`Executable manifest contains duplicate capability ID ${record.id}.`,
			)
		}

		let validator: ValidateFunction
		try {
			validator = ajv.compile(record.inputSchema as AnySchema)
		} catch (error) {
			throw new ManifestError(
				'MANIFEST_INVALID',
				`Input schema for capability ${record.id} could not be compiled.`,
				error,
			)
		}

		for (const example of record.examples) {
			if (!validator(example.input)) {
				throw new ManifestError(
					'MANIFEST_INVALID',
					`Example input for capability ${record.id} does not satisfy its input schema.`,
				)
			}
		}

		inputValidators.set(record, validator)
		records.set(record.id, record)
	}

	return Object.freeze({
		document: deepFreeze(document),
		records,
	})
}

export function getManifestRecord(
	manifest: LoadedExecutableManifest,
	capabilityId: string,
): ManifestRecord {
	const record = manifest.records.get(capabilityId)
	if (!record) {
		throw new ManifestError(
			'CAPABILITY_NOT_FOUND',
			`Capability ${capabilityId} is not present in the executable manifest.`,
		)
	}
	return record
}

export function validateManifestInput(
	record: ManifestRecord,
	input: unknown,
): ManifestInputValidation {
	const validator = inputValidators.get(record)
	if (!validator) {
		throw new ManifestError(
			'MANIFEST_INVALID',
			`Capability ${record.id} was not loaded from a compiled executable manifest.`,
		)
	}

	if (validator(input)) {
		return { ok: true, value: input }
	}

	return {
		ok: false,
		issues: (validator.errors ?? []).map(toManifestInputIssue),
	}
}

function toManifestInputIssue(error: ErrorObject): ManifestInputIssue {
	return {
		instancePath: error.instancePath,
		keyword: error.keyword,
		message: error.message ?? 'Input does not satisfy the manifest schema.',
	}
}

function formatValibotIssues(
	issues: readonly { message: string; path?: readonly unknown[] }[],
): string {
	return issues.map((issue) => issue.message).join('; ')
}

function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
		return value
	}

	for (const child of Object.values(value)) {
		deepFreeze(child)
	}
	return Object.freeze(value)
}
