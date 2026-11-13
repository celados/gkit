import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'

import { renderProviderDocs } from '../src/docs'
import { compileExecutableManifest } from '../src/manifest'

type JsonRecord = Record<string, unknown>

type SourceMetadata = {
	url: string
	revision: string
	checksum: string
	retrievedAt: string
}

type ReviewedEntry = {
	path: string
	method: string
	operationId: string
	exposure: 'executable' | 'inventory'
	reason?: string
	capability?: JsonRecord
}

type ReviewedPolicy = {
	version: 1
	provider: 'posthog'
	manifestRevision: string
	reviewedAt: string
	entries: ReviewedEntry[]
}

type InventoryOperation = {
	path: string
	method: string
	operationId: string
	tags: string[]
	exposure: 'executable' | 'inventory'
	capabilityId?: string
	reason: string
}

export type GeneratedPostHogArtifacts = {
	manifest: string
	inventory: string
	docs: string
	inventoryDocs: string
}

const httpMethods = new Set([
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put',
])

export async function generatePostHogArtifacts(
	packageRoot: string,
): Promise<GeneratedPostHogArtifacts> {
	const sourceDirectory = join(packageRoot, 'sources/posthog')
	const [sourceBytes, sourceMetadata, policy] = await Promise.all([
		readFile(join(sourceDirectory, 'openapi.yaml')),
		readJson<SourceMetadata>(join(sourceDirectory, 'source.json')),
		readJson<ReviewedPolicy>(join(packageRoot, 'policy/posthog.reviewed.json')),
	])

	verifySource(sourceBytes, sourceMetadata)
	verifyPolicy(policy)

	const openApi = asRecord(parse(sourceBytes.toString('utf8')))
	const operations = collectOperations(openApi)
	const operationsByKey = new Map(
		operations.map((operation) => [
			operationKey(operation.path, operation.method),
			operation,
		]),
	)
	const reviewedByKey = reviewEntries(policy, operationsByKey)
	const capabilities = policy.entries
		.filter((entry) => entry.exposure === 'executable')
		.map((entry) => entry.capability!)
		.sort((left, right) => String(left.id).localeCompare(String(right.id)))
	const source = {
		url: sourceMetadata.url,
		revision: sourceMetadata.revision,
		checksum: sourceMetadata.checksum,
	}
	const manifest = stableJson({
		version: 1,
		provider: policy.provider,
		revision: policy.manifestRevision,
		source,
		reviewedAt: policy.reviewedAt,
		capabilities,
	})
	const compiledManifest = compileExecutableManifest(JSON.parse(manifest))
	const inventoryOperations = operations.map(
		(operation): InventoryOperation => {
			const reviewed = reviewedByKey.get(
				operationKey(operation.path, operation.method),
			)
			if (!reviewed) {
				return {
					...operation,
					exposure: 'inventory',
					reason: 'Not reviewed for executable gkit exposure.',
				}
			}
			if (reviewed.exposure === 'inventory') {
				return {
					...operation,
					exposure: 'inventory',
					reason: reviewed.reason!,
				}
			}
			return {
				...operation,
				exposure: 'executable',
				capabilityId: String(reviewed.capability!.id),
				reason:
					'Reviewed adapter, input, effect, and response contracts are committed.',
			}
		},
	)

	return {
		manifest,
		inventory: stableJson({
			version: 1,
			provider: policy.provider,
			revision: policy.manifestRevision,
			source,
			operations: inventoryOperations,
		}),
		docs: renderProviderDocs(compiledManifest),
		inventoryDocs: renderInventoryDocs(policy, inventoryOperations),
	}
}

async function run(): Promise<void> {
	const packageRoot = resolve(new URL('..', import.meta.url).pathname)
	const check = process.argv.slice(2).includes('--check')
	const artifacts = await generatePostHogArtifacts(packageRoot)
	const outputs = [
		[join(packageRoot, 'generated/posthog/manifest.json'), artifacts.manifest],
		[
			join(packageRoot, 'generated/posthog/inventory.json'),
			artifacts.inventory,
		],
		[
			join(packageRoot, 'docs/providers/posthog/capabilities.md'),
			artifacts.docs,
		],
		[
			join(packageRoot, 'docs/providers/posthog/inventory.md'),
			artifacts.inventoryDocs,
		],
	] as const

	if (check) {
		const drifted: string[] = []
		for (const [path, expected] of outputs) {
			try {
				if ((await readFile(path, 'utf8')) !== expected) drifted.push(path)
			} catch {
				drifted.push(path)
			}
		}
		if (drifted.length > 0) {
			throw new Error(
				`Generated PostHog artifacts are stale: ${drifted.join(', ')}`,
			)
		}
		return
	}

	for (const [path, contents] of outputs) {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, contents, 'utf8')
	}
}

function reviewEntries(
	policy: ReviewedPolicy,
	operationsByKey: Map<string, InventoryOperation>,
): Map<string, ReviewedEntry> {
	const reviewedByKey = new Map<string, ReviewedEntry>()
	for (const entry of policy.entries) {
		const key = operationKey(entry.path, entry.method)
		if (reviewedByKey.has(key)) {
			throw new Error(
				`Reviewed PostHog policy contains duplicate operation ${key}.`,
			)
		}
		const operation = operationsByKey.get(key)
		if (!operation) {
			throw new Error(
				`Reviewed PostHog operation ${key} is absent from the pinned source.`,
			)
		}
		if (operation.operationId !== entry.operationId) {
			throw new Error(
				`Reviewed operation ${key} expected ${entry.operationId}, found ${operation.operationId}.`,
			)
		}
		if (entry.exposure === 'executable' && !entry.capability) {
			throw new Error(
				`Executable PostHog operation ${key} has no capability record.`,
			)
		}
		if (entry.exposure === 'inventory' && !entry.reason) {
			throw new Error(
				`Inventory-only PostHog operation ${key} requires a reason.`,
			)
		}
		reviewedByKey.set(key, entry)
	}
	return reviewedByKey
}

function collectOperations(openApi: JsonRecord): InventoryOperation[] {
	const paths = asRecord(openApi.paths)
	return Object.entries(paths)
		.flatMap(([path, pathValue]) => {
			const pathRecord = asRecord(pathValue)
			return Object.entries(pathRecord)
				.filter(([method]) => httpMethods.has(method.toLowerCase()))
				.map(([method, operationValue]) => {
					const operation = asRecord(operationValue)
					const operationId = operation.operationId
					if (typeof operationId !== 'string' || operationId.length === 0) {
						throw new Error(
							`Pinned PostHog operation ${method.toUpperCase()} ${path} has no operationId.`,
						)
					}
					const tags = Array.isArray(operation.tags)
						? operation.tags
								.filter((tag): tag is string => typeof tag === 'string')
								.sort()
						: []
					return {
						path,
						method: method.toLowerCase(),
						operationId,
						tags,
						exposure: 'inventory' as const,
						reason: '',
					}
				})
		})
		.sort(
			(left, right) =>
				left.path.localeCompare(right.path) ||
				left.method.localeCompare(right.method),
		)
}

function renderInventoryDocs(
	policy: ReviewedPolicy,
	operations: InventoryOperation[],
): string {
	const executableCount = operations.filter(
		(operation) => operation.exposure === 'executable',
	).length
	const lines = [
		'---',
		'type: Reference',
		'title: PostHog operation inventory',
		'description: >',
		'  Generated inventory of pinned PostHog operations and their gkit exposure decisions.',
		`provider: ${policy.provider}`,
		`inventoryRevision: ${policy.manifestRevision}`,
		'---',
		'',
		'# PostHog operation inventory',
		'',
		`This pinned inventory contains ${operations.length} operations: ${executableCount} executable and ${operations.length - executableCount} inventory-only.`,
		'Inventory-only operations cannot be routed by `gkit posthog api call`.',
		'',
		'| Method | Path | Operation ID | Exposure | Decision |',
		'| --- | --- | --- | --- | --- |',
	]
	for (const operation of operations) {
		const capability = operation.capabilityId
			? `; capability: \`${operation.capabilityId}\``
			: ''
		lines.push(
			`| \`${operation.method.toUpperCase()}\` | \`${operation.path}\` | \`${operation.operationId}\` | \`${operation.exposure}\` | ${operation.reason}${capability} |`,
		)
	}
	return `${lines.join('\n')}\n`
}

function verifySource(bytes: Uint8Array, metadata: SourceMetadata): void {
	const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
	if (checksum !== metadata.checksum) {
		throw new Error(
			`Pinned PostHog source checksum mismatch: expected ${metadata.checksum}.`,
		)
	}
}

function verifyPolicy(policy: ReviewedPolicy): void {
	if (
		policy.version !== 1 ||
		policy.provider !== 'posthog' ||
		!policy.manifestRevision ||
		!policy.reviewedAt ||
		!Array.isArray(policy.entries)
	) {
		throw new Error('Reviewed PostHog policy is structurally invalid.')
	}
}

function operationKey(path: string, method: string): string {
	return `${method.toLowerCase()} ${path}`
}

function stableJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`
}

function asRecord(value: unknown): JsonRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Pinned PostHog source is not an OpenAPI object.')
	}
	return value as JsonRecord
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

if (import.meta.main) {
	await run()
}
