import { appendFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type SemVer = Readonly<{
	raw: string
	major: bigint
	minor: bigint
	patch: bigint
	prerelease: readonly string[]
}>

type ReleaseDecision = Readonly<{
	version: string
	tag: string
	prerelease: boolean
	tagExists: boolean
}>

type CommandResult = Readonly<{
	stdout: string
	stderr: string
}>

const packagePath = 'packages/gkit/package.json'
const semVerPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function parseSemVer(value: string): SemVer {
	const match = semVerPattern.exec(value)
	if (!match) {
		throw new Error(`Invalid SemVer version: ${value}`)
	}
	return Object.freeze({
		raw: value,
		major: BigInt(match[1]),
		minor: BigInt(match[2]),
		patch: BigInt(match[3]),
		prerelease: Object.freeze(match[4]?.split('.') ?? []),
	})
}

export function compareSemVer(left: SemVer, right: SemVer): number {
	for (const key of ['major', 'minor', 'patch'] as const) {
		if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
	}
	if (left.prerelease.length === 0 || right.prerelease.length === 0) {
		if (left.prerelease.length === right.prerelease.length) return 0
		return left.prerelease.length === 0 ? 1 : -1
	}
	const length = Math.max(left.prerelease.length, right.prerelease.length)
	for (let index = 0; index < length; index += 1) {
		const leftIdentifier = left.prerelease[index]
		const rightIdentifier = right.prerelease[index]
		if (leftIdentifier === rightIdentifier) continue
		if (leftIdentifier === undefined) return -1
		if (rightIdentifier === undefined) return 1
		const leftNumeric = /^\d+$/.test(leftIdentifier)
		const rightNumeric = /^\d+$/.test(rightIdentifier)
		if (leftNumeric && rightNumeric) {
			if (leftIdentifier.length !== rightIdentifier.length) {
				return leftIdentifier.length < rightIdentifier.length ? -1 : 1
			}
			return leftIdentifier < rightIdentifier ? -1 : 1
		}
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
		return leftIdentifier < rightIdentifier ? -1 : 1
	}
	return 0
}

export function decideRelease(
	versionValue: string,
	tags: readonly string[],
	targetSha: string,
	tagTargets: ReadonlyMap<string, string>,
): ReleaseDecision {
	const version = parseSemVer(versionValue)
	const tag = `v${version.raw}`
	const releaseTags = tags.flatMap((candidate) => {
		if (!candidate.startsWith('v')) return []
		try {
			return [{ tag: candidate, version: parseSemVer(candidate.slice(1)) }]
		} catch {
			return []
		}
	})
	const existingTarget = tagTargets.get(tag)
	if (existingTarget !== undefined && existingTarget !== targetSha) {
		throw new Error(
			`Existing tag ${tag} points to ${existingTarget}, not ${targetSha}.`,
		)
	}
	for (const existing of releaseTags) {
		if (existing.tag === tag) continue
		if (compareSemVer(version, existing.version) <= 0) {
			throw new Error(
				`Version ${version.raw} must be greater than existing release tag ${existing.tag}.`,
			)
		}
	}
	return Object.freeze({
		version: version.raw,
		tag,
		prerelease: version.prerelease.length > 0,
		tagExists: existingTarget !== undefined,
	})
}

if (import.meta.main) await main()

async function main(): Promise<void> {
	const options = parseOptions(Bun.argv.slice(2))
	if (options.ref !== 'refs/heads/main') {
		throw new Error(
			`Releases must run from refs/heads/main, received ${options.ref}.`,
		)
	}
	const packageJson = await readPackageJson(resolve(packagePath))
	const version = requireVersion(packageJson)
	if (options.eventName === 'push' && options.beforeSha !== undefined) {
		const previousPackageJson = await readPackageJsonAtCommit(options.beforeSha)
		if (
			previousPackageJson !== undefined &&
			requireVersion(previousPackageJson) === version
		) {
			await writeOutputs(options.output, { release: 'false' })
			process.stdout.write('Package version did not change; release skipped.\n')
			return
		}
	}
	const tags = (
		await runCommand(['git', 'tag', '--list'], process.cwd())
	).stdout
		.split('\n')
		.filter(Boolean)
	const tagTargets = new Map<string, string>()
	for (const tag of tags) {
		const target = (
			await runCommand(['git', 'rev-list', '-n', '1', tag], process.cwd())
		).stdout.trim()
		tagTargets.set(tag, target)
	}
	const decision = decideRelease(version, tags, options.targetSha, tagTargets)
	await writeOutputs(options.output, {
		release: 'true',
		version: decision.version,
		tag: decision.tag,
		prerelease: String(decision.prerelease),
		tag_exists: String(decision.tagExists),
	})
	process.stdout.write(
		`Release preflight passed for ${decision.tag} at ${options.targetSha}.\n`,
	)
}

function parseOptions(arguments_: readonly string[]): {
	eventName: string
	beforeSha?: string
	targetSha: string
	ref: string
	output: string
} {
	const values = new Map<string, string>()
	for (let index = 0; index < arguments_.length; index += 2) {
		const key = arguments_[index]
		const value = arguments_[index + 1]
		if (!key?.startsWith('--') || value === undefined) {
			throw new Error('Release preflight arguments must be --key value pairs.')
		}
		values.set(key.slice(2), value)
	}
	const eventName = requireOption(values, 'event-name')
	const targetSha = requireOption(values, 'target-sha')
	const ref = requireOption(values, 'ref')
	const output = requireOption(values, 'output')
	const beforeSha = values.get('before-sha')
	return {
		eventName,
		targetSha,
		ref,
		output,
		...(beforeSha ? { beforeSha } : {}),
	}
}

function requireOption(
	values: ReadonlyMap<string, string>,
	name: string,
): string {
	const value = values.get(name)
	if (!value) throw new Error(`Missing required option --${name}.`)
	return value
}

async function readPackageJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function readPackageJsonAtCommit(
	commit: string,
): Promise<unknown | undefined> {
	if (/^0+$/.test(commit)) return undefined
	const result = await runCommand(
		['git', 'show', `${commit}:${packagePath}`],
		process.cwd(),
		true,
	)
	if (!result) return undefined
	return JSON.parse(result.stdout) as unknown
}

function requireVersion(value: unknown): string {
	if (!value || typeof value !== 'object' || !('version' in value)) {
		throw new Error(`${packagePath} must contain a version.`)
	}
	const version = (value as { version?: unknown }).version
	if (typeof version !== 'string')
		throw new Error('Package version must be a string.')
	parseSemVer(version)
	return version
}

async function writeOutputs(
	outputPath: string,
	values: Readonly<Record<string, string>>,
): Promise<void> {
	const content = Object.entries(values)
		.map(([key, value]) => `${key}=${value}\n`)
		.join('')
	await appendFile(outputPath, content, 'utf8')
}

function runCommand(
	command: readonly string[],
	cwd: string,
): Promise<CommandResult>
function runCommand(
	command: readonly string[],
	cwd: string,
	allowFailure: true,
): Promise<CommandResult | undefined>
async function runCommand(
	command: readonly string[],
	cwd: string,
	allowFailure = false,
): Promise<CommandResult | undefined> {
	const child = Bun.spawn([...command], {
		cwd,
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	])
	if (exitCode !== 0) {
		if (allowFailure) return undefined
		throw new Error(
			`Command failed (${exitCode}): ${command.join(' ')}\n${stdout}${stderr}`.trimEnd(),
		)
	}
	return { stdout, stderr }
}
