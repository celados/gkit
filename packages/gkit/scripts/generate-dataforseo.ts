import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'

import { renderProviderDocs } from '../src/docs'
import { compileExecutableManifest } from '../src/manifest'

type JsonRecord = Record<string, unknown>

type SourceMetadata = {
	repository: string
	path: string
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
	provider: string
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

export type GeneratedDataForSeoArtifacts = {
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

export async function generateDataForSeoArtifacts(
	packageRoot: string,
): Promise<GeneratedDataForSeoArtifacts> {
	const sourceDirectory = join(packageRoot, 'sources/dataforseo')
	const sourcePath = join(sourceDirectory, 'openapi.yaml')
	const [sourceBytes, sourceMetadata, policy] = await Promise.all([
		readFile(sourcePath),
		readJson<SourceMetadata>(join(sourceDirectory, 'source.json')),
		readJson<ReviewedPolicy>(
			join(packageRoot, 'policy/dataforseo.reviewed.json'),
		),
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

	const reviewedByKey = new Map<string, ReviewedEntry>()
	for (const entry of policy.entries) {
		const key = operationKey(entry.path, entry.method)
		if (reviewedByKey.has(key)) {
			throw new Error(
				`Reviewed DataForSEO policy contains duplicate operation ${key}.`,
			)
		}
		const operation = operationsByKey.get(key)
		if (!operation) {
			throw new Error(
				`Reviewed DataForSEO operation ${key} is absent from the pinned source.`,
			)
		}
		if (operation.operationId !== entry.operationId) {
			throw new Error(
				`Reviewed operation ${key} expected ${entry.operationId}, found ${operation.operationId}.`,
			)
		}
		if (entry.exposure === 'executable' && !entry.capability) {
			throw new Error(
				`Executable DataForSEO operation ${key} has no capability record.`,
			)
		}
		if (entry.exposure === 'inventory' && !entry.reason) {
			throw new Error(
				`Inventory-only DataForSEO operation ${key} requires a reason.`,
			)
		}
		reviewedByKey.set(key, entry)
	}

	const capabilities = policy.entries
		.filter((entry) => entry.exposure === 'executable')
		.map((entry) => entry.capability!)
		.sort((left, right) => String(left.id).localeCompare(String(right.id)))
	const source = {
		url: `${sourceMetadata.repository}/blob/${sourceMetadata.revision}/${sourceMetadata.path}`,
		revision: sourceMetadata.revision,
		checksum: sourceMetadata.checksum,
	}
	const manifestDocument = {
		version: 1,
		provider: policy.provider,
		revision: policy.manifestRevision,
		source,
		reviewedAt: policy.reviewedAt,
		capabilities,
	}
	const manifest = stableJson(manifestDocument)
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
					'Reviewed adapter, input, effect, and cost contracts are committed.',
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
	const artifacts = await generateDataForSeoArtifacts(packageRoot)
	const outputs = [
		[
			join(packageRoot, 'generated/dataforseo/manifest.json'),
			artifacts.manifest,
		],
		[
			join(packageRoot, 'generated/dataforseo/inventory.json'),
			artifacts.inventory,
		],
		[
			join(packageRoot, 'docs/providers/dataforseo/backlinks.md'),
			artifacts.docs,
		],
		[
			join(packageRoot, 'docs/providers/dataforseo/inventory.md'),
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
				`Generated DataForSEO artifacts are stale: ${drifted.join(', ')}`,
			)
		}
		return
	}

	for (const [path, contents] of outputs) {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, contents, 'utf8')
	}
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
		'title: DataForSEO operation inventory',
		'description: >',
		'  Generated inventory of pinned DataForSEO operations and their gkit exposure decisions.',
		`provider: ${policy.provider}`,
		`inventoryRevision: ${policy.manifestRevision}`,
		'---',
		'',
		'# DataForSEO operation inventory',
		'',
		`This pinned inventory contains ${operations.length} operations: ${executableCount} executable and ${operations.length - executableCount} inventory-only.`,
		'Inventory-only operations cannot be routed by `gkit dataforseo api call`.',
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
							`Pinned DataForSEO operation ${method.toUpperCase()} ${path} has no operationId.`,
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

function verifySource(bytes: Uint8Array, metadata: SourceMetadata): void {
	const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
	if (checksum !== metadata.checksum) {
		throw new Error(
			`Pinned DataForSEO source checksum mismatch: expected ${metadata.checksum}.`,
		)
	}
}

function verifyPolicy(policy: ReviewedPolicy): void {
	if (
		policy.version !== 1 ||
		policy.provider !== 'dataforseo' ||
		!policy.manifestRevision ||
		!policy.reviewedAt ||
		!Array.isArray(policy.entries)
	) {
		throw new Error('Reviewed DataForSEO policy is structurally invalid.')
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
		throw new Error('Pinned DataForSEO source is not an OpenAPI object.')
	}
	return value as JsonRecord
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

if (import.meta.main) {
	await run()
}
