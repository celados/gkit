import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

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
	capabilities?: JsonRecord[]
}

type ReviewedPolicy = {
	version: 1
	provider: 'google-ads'
	manifestRevision: string
	reviewedAt: string
	sourceChecksum: string
	entries: ReviewedEntry[]
}

type InventoryOperation = {
	path: string
	method: string
	operationId: string
	exposure: 'executable' | 'inventory'
	capabilityIds?: string[]
	reason: string
}

export type GeneratedGoogleAdsArtifacts = {
	manifest: string
	inventory: string
	docs: string
	inventoryDocs: string
}

export async function generateGoogleAdsArtifacts(
	packageRoot: string,
): Promise<GeneratedGoogleAdsArtifacts> {
	const sourceDirectory = join(packageRoot, 'sources/google-ads')
	const [sourceBytes, sourceMetadata, policy] = await Promise.all([
		readFile(join(sourceDirectory, 'discovery-v24.json')),
		readJson<SourceMetadata>(join(sourceDirectory, 'source.json')),
		readJson<ReviewedPolicy>(
			join(packageRoot, 'policy/google-ads.reviewed.json'),
		),
	])

	verifySource(sourceBytes, sourceMetadata)
	verifyPolicy(policy, sourceMetadata)

	const discovery = asRecord(JSON.parse(sourceBytes.toString('utf8')))
	if (
		discovery.version !== 'v24' ||
		discovery.revision !== sourceMetadata.revision
	) {
		throw new Error(
			'Pinned Google Ads discovery version or revision does not match metadata.',
		)
	}
	const operations = collectOperations(discovery)
	const operationsByKey = new Map(
		operations.map((operation) => [
			operationKey(operation.path, operation.method),
			operation,
		]),
	)
	const reviewedByKey = reviewEntries(policy, operationsByKey)
	const capabilities = policy.entries
		.flatMap((entry) => entry.capabilities ?? [])
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
				return { ...operation, exposure: 'inventory', reason: reviewed.reason! }
			}
			return {
				...operation,
				exposure: 'executable',
				capabilityIds: reviewed
					.capabilities!.map((capability) => String(capability.id))
					.sort(),
				reason:
					'Reviewed adapter, input, read effect, pagination, and response contracts are committed.',
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
	const artifacts = await generateGoogleAdsArtifacts(packageRoot)
	const outputs = [
		[
			join(packageRoot, 'generated/google-ads/manifest.json'),
			artifacts.manifest,
		],
		[
			join(packageRoot, 'generated/google-ads/inventory.json'),
			artifacts.inventory,
		],
		[
			join(packageRoot, 'docs/providers/google-ads/capabilities.md'),
			artifacts.docs,
		],
		[
			join(packageRoot, 'docs/providers/google-ads/inventory.md'),
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
				`Generated Google Ads artifacts are stale: ${drifted.join(', ')}`,
			)
		}
		return
	}

	for (const [path, contents] of outputs) {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, contents, 'utf8')
	}
}

function collectOperations(discovery: JsonRecord): InventoryOperation[] {
	const operations: InventoryOperation[] = []
	walkResources(asRecord(discovery.resources), operations)
	return operations.sort(
		(left, right) =>
			left.path.localeCompare(right.path) ||
			left.method.localeCompare(right.method),
	)
}

function walkResources(
	resources: JsonRecord,
	operations: InventoryOperation[],
): void {
	for (const resourceValue of Object.values(resources)) {
		const resource = asRecord(resourceValue)
		const methods = asRecord(resource.methods ?? {})
		for (const methodValue of Object.values(methods)) {
			const method = asRecord(methodValue)
			if (
				typeof method.path !== 'string' ||
				typeof method.httpMethod !== 'string' ||
				typeof method.id !== 'string'
			) {
				throw new Error(
					'Pinned Google Ads discovery contains an invalid REST method.',
				)
			}
			operations.push({
				path: method.path,
				method: method.httpMethod.toLowerCase(),
				operationId: method.id,
				exposure: 'inventory',
				reason: '',
			})
		}
		walkResources(asRecord(resource.resources ?? {}), operations)
	}
}

function reviewEntries(
	policy: ReviewedPolicy,
	operationsByKey: Map<string, InventoryOperation>,
): Map<string, ReviewedEntry> {
	const reviewed = new Map<string, ReviewedEntry>()
	for (const entry of policy.entries) {
		const key = operationKey(entry.path, entry.method)
		if (reviewed.has(key))
			throw new Error(`Duplicate reviewed Google Ads method ${key}.`)
		const operation = operationsByKey.get(key)
		if (!operation)
			throw new Error(
				`Reviewed Google Ads method ${key} is absent from source.`,
			)
		if (operation.operationId !== entry.operationId) {
			throw new Error(`Reviewed Google Ads method ${key} changed operation ID.`)
		}
		if (
			entry.exposure === 'executable' &&
			(!entry.capabilities || entry.capabilities.length === 0)
		) {
			throw new Error(
				`Executable Google Ads method ${key} has no capability records.`,
			)
		}
		if (entry.exposure === 'inventory' && !entry.reason) {
			throw new Error(
				`Inventory-only Google Ads method ${key} requires a reason.`,
			)
		}
		reviewed.set(key, entry)
	}
	return reviewed
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
		'title: Google Ads REST operation inventory',
		'description: >',
		'  Generated inventory of pinned Google Ads v24 REST methods and their gkit exposure decisions.',
		`provider: ${policy.provider}`,
		`inventoryRevision: ${policy.manifestRevision}`,
		'---',
		'',
		'# Google Ads REST operation inventory',
		'',
		`This pinned inventory contains ${operations.length} methods: ${executableCount} executable and ${operations.length - executableCount} inventory-only.`,
		'Inventory-only methods cannot be routed by `gkit google-ads api call`.',
		'',
		'| Method | Path | Operation ID | Exposure | Decision |',
		'| --- | --- | --- | --- | --- |',
	]
	for (const operation of operations) {
		const capabilities = operation.capabilityIds?.length
			? `; capabilities: ${operation.capabilityIds.map((id) => `\`${id}\``).join(', ')}`
			: ''
		lines.push(
			`| \`${operation.method.toUpperCase()}\` | \`${operation.path}\` | \`${operation.operationId}\` | \`${operation.exposure}\` | ${operation.reason}${capabilities} |`,
		)
	}
	return `${lines.join('\n')}\n`
}

function verifySource(bytes: Uint8Array, metadata: SourceMetadata): void {
	const checksum = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
	if (checksum !== metadata.checksum) {
		throw new Error(
			`Pinned Google Ads source checksum mismatch: expected ${metadata.checksum}.`,
		)
	}
}

function verifyPolicy(policy: ReviewedPolicy, metadata: SourceMetadata): void {
	if (
		policy.version !== 1 ||
		policy.provider !== 'google-ads' ||
		!policy.manifestRevision ||
		!policy.reviewedAt ||
		!Array.isArray(policy.entries)
	) {
		throw new Error('Reviewed Google Ads policy is structurally invalid.')
	}
	if (policy.sourceChecksum !== metadata.checksum) {
		throw new Error(
			'Reviewed Google Ads policy approval does not match the pinned source checksum.',
		)
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
		throw new Error('Pinned Google Ads discovery is not an object.')
	}
	return value as JsonRecord
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, 'utf8')) as T
}

if (import.meta.main) await run()
