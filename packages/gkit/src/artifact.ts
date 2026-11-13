import { createHash, randomUUID } from 'node:crypto'
import {
	link,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	unlink,
	type FileHandle,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

const DEFAULT_LOCK_TIMEOUT_MS = 10_000
const LOCK_POLL_INTERVAL_MS = 10

export type ArtifactChunk = string | Uint8Array

export type ArtifactSource =
	| ArtifactChunk
	| Iterable<ArtifactChunk>
	| AsyncIterable<ArtifactChunk>

export type BasicAuthCredential = Readonly<{
	login: string
	password: string
}>

export type ArtifactReservationOptions = Readonly<{
	destinationPath: string
	force?: boolean
	lockTimeoutMs?: number
}>

export type ArtifactPublicationOptions = Readonly<{
	source: ArtifactSource
	secretValues?: readonly string[]
	basicAuthCredentials?: readonly BasicAuthCredential[]
}>

export type WriteArtifactOptions = ArtifactReservationOptions &
	ArtifactPublicationOptions

export type ArtifactReceipt = Readonly<{
	path: string
	bytes: number
	sha256: string
}>

export type ArtifactErrorCode =
	| 'ARTIFACT_ALREADY_PUBLISHED'
	| 'ARTIFACT_EXISTS'
	| 'ARTIFACT_IO_ERROR'
	| 'ARTIFACT_LOCKED'
	| 'ARTIFACT_RESERVATION_RELEASED'
	| 'INVALID_ARTIFACT_PATH'
	| 'INVALID_ARTIFACT_SOURCE'
	| 'SECRET_DETECTED'

export class ArtifactError extends Error {
	readonly code: ArtifactErrorCode
	readonly artifactPath: string | null

	constructor(
		code: ArtifactErrorCode,
		message: string,
		artifactPath: string | null = null,
		cause?: unknown,
	) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'ArtifactError'
		this.code = code
		this.artifactPath = artifactPath
	}
}

export type ArtifactReservation = Readonly<{
	path: string
	force: boolean
	publish(options: ArtifactPublicationOptions): Promise<ArtifactReceipt>
	release(): Promise<void>
}>

type DestinationLock = Readonly<{
	handle: FileHandle
	path: string
	token: string
}>

type ReservationState =
	| 'reserved'
	| 'publishing'
	| 'published'
	| 'failed'
	| 'released'

class ArtifactReservationImpl implements ArtifactReservation {
	readonly path: string
	readonly force: boolean

	#lock: DestinationLock | null
	#state: ReservationState = 'reserved'

	constructor(path: string, force: boolean, lock: DestinationLock) {
		this.path = path
		this.force = force
		this.#lock = lock
	}

	async publish(options: ArtifactPublicationOptions): Promise<ArtifactReceipt> {
		if (this.#state === 'released') {
			throw new ArtifactError(
				'ARTIFACT_RESERVATION_RELEASED',
				'The artifact reservation has already been released.',
				this.path,
			)
		}

		if (this.#state !== 'reserved') {
			throw new ArtifactError(
				'ARTIFACT_ALREADY_PUBLISHED',
				'This artifact reservation can publish at most once.',
				this.path,
			)
		}

		this.#state = 'publishing'

		try {
			const receipt = await publishReservedArtifact(
				this.path,
				this.force,
				options,
			)
			this.#state = 'published'
			return receipt
		} catch (error) {
			this.#state = 'failed'
			throw normalizeArtifactError(error, this.path)
		}
	}

	async release(): Promise<void> {
		if (this.#state === 'released') {
			return
		}

		const lock = this.#lock
		this.#lock = null
		this.#state = 'released'

		if (lock === null) {
			return
		}

		await releaseDestinationLock(lock, this.path)
	}
}

export async function reserveArtifactDestination(
	options: ArtifactReservationOptions,
): Promise<ArtifactReservation> {
	const force = options.force ?? false
	const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
	validateLockTimeout(lockTimeoutMs)

	let destinationPath: string
	try {
		destinationPath = await canonicalizeDestinationPath(options.destinationPath)
	} catch (error) {
		if (error instanceof ArtifactError) {
			throw error
		}
		throw new ArtifactError(
			'ARTIFACT_IO_ERROR',
			'Failed to prepare the artifact destination directory.',
			options.destinationPath.trim().length === 0
				? null
				: resolve(options.destinationPath),
			error,
		)
	}
	const lock = await acquireDestinationLock(destinationPath, lockTimeoutMs)

	try {
		if (!force && (await pathExists(destinationPath))) {
			throw new ArtifactError(
				'ARTIFACT_EXISTS',
				'The artifact destination already exists. Pass force to replace it.',
				destinationPath,
			)
		}

		return new ArtifactReservationImpl(destinationPath, force, lock)
	} catch (error) {
		await releaseDestinationLock(lock, destinationPath)
		throw normalizeArtifactError(error, destinationPath)
	}
}

export async function withArtifactReservation<T>(
	options: ArtifactReservationOptions,
	callback: (reservation: ArtifactReservation) => Promise<T>,
): Promise<T> {
	const reservation = await reserveArtifactDestination(options)

	try {
		return await callback(reservation)
	} finally {
		await reservation.release()
	}
}

export async function writeArtifact(
	options: WriteArtifactOptions,
): Promise<ArtifactReceipt> {
	const reservationOptions: ArtifactReservationOptions = {
		destinationPath: options.destinationPath,
		force: options.force,
		lockTimeoutMs: options.lockTimeoutMs,
	}
	const publicationOptions: ArtifactPublicationOptions = {
		source: options.source,
		secretValues: options.secretValues,
		basicAuthCredentials: options.basicAuthCredentials,
	}

	return await withArtifactReservation(
		reservationOptions,
		async (reservation) => {
			return await reservation.publish(publicationOptions)
		},
	)
}

async function canonicalizeDestinationPath(
	destinationPath: string,
): Promise<string> {
	if (destinationPath.trim().length === 0) {
		throw new ArtifactError(
			'INVALID_ARTIFACT_PATH',
			'The artifact destination path must not be empty.',
		)
	}

	const absolutePath = resolve(destinationPath)
	const fileName = basename(absolutePath)

	if (fileName.length === 0 || absolutePath === dirname(absolutePath)) {
		throw new ArtifactError(
			'INVALID_ARTIFACT_PATH',
			'The artifact destination must name a file.',
			absolutePath,
		)
	}

	const parentPath = dirname(absolutePath)
	await mkdir(parentPath, { recursive: true, mode: 0o700 })
	const canonicalParentPath = await realpath(parentPath)
	return join(canonicalParentPath, fileName)
}

async function acquireDestinationLock(
	destinationPath: string,
	lockTimeoutMs: number,
): Promise<DestinationLock> {
	const lockName = `.gkit-artifact-${createHash('sha256').update(destinationPath).digest('hex')}.lock`
	const lockPath = join(dirname(destinationPath), lockName)
	const deadline = Date.now() + lockTimeoutMs

	while (true) {
		try {
			const handle = await open(lockPath, 'wx', 0o600)
			const token = randomUUID()

			try {
				await handle.chmod(0o600)
				await handle.writeFile(
					`${JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })}\n`,
					'utf8',
				)
				await handle.sync()
			} catch (error) {
				await handle.close().catch(() => undefined)
				await unlink(lockPath).catch(() => undefined)
				throw error
			}

			return { handle, path: lockPath, token }
		} catch (error) {
			if (errorCode(error) !== 'EEXIST') {
				throw new ArtifactError(
					'ARTIFACT_IO_ERROR',
					'Failed to reserve the artifact destination.',
					destinationPath,
					error,
				)
			}

			if (Date.now() >= deadline) {
				throw new ArtifactError(
					'ARTIFACT_LOCKED',
					'The artifact destination is locked by another process. Review the lock before retrying.',
					destinationPath,
				)
			}

			await delay(LOCK_POLL_INTERVAL_MS)
		}
	}
}

async function releaseDestinationLock(
	lock: DestinationLock,
	destinationPath: string,
): Promise<void> {
	let releaseError: unknown

	try {
		const lockText = await readFile(lock.path, 'utf8')
		const record = JSON.parse(lockText) as unknown
		if (!isRecord(record) || record.token !== lock.token) {
			throw new Error('Artifact lock ownership changed unexpectedly.')
		}
	} catch (error) {
		releaseError = error
	}

	try {
		await lock.handle.close()
	} catch (error) {
		releaseError ??= error
	}

	if (releaseError === undefined) {
		try {
			await unlink(lock.path)
		} catch (error) {
			releaseError = error
		}
	}

	if (releaseError !== undefined) {
		throw new ArtifactError(
			'ARTIFACT_IO_ERROR',
			'Failed to release the artifact destination lock.',
			destinationPath,
			releaseError,
		)
	}
}

async function publishReservedArtifact(
	destinationPath: string,
	force: boolean,
	options: ArtifactPublicationOptions,
): Promise<ArtifactReceipt> {
	const tempPath = join(
		dirname(destinationPath),
		`.gkit-artifact-${process.pid}-${randomUUID()}.tmp`,
	)
	let tempExists = false
	let handle: FileHandle | null = null

	try {
		handle = await open(tempPath, 'wx', 0o600)
		tempExists = true
		await handle.chmod(0o600)

		const scanner = new StreamingSecretScanner(
			buildSensitivePatterns(
				options.secretValues,
				options.basicAuthCredentials,
			),
		)
		const hash = createHash('sha256')
		let byteCount = 0

		for await (const chunk of artifactChunks(options.source)) {
			scanner.scan(chunk)
			hash.update(chunk)
			byteCount += chunk.byteLength
			await writeAll(handle, chunk)
		}

		await handle.sync()
		await handle.close()
		handle = null

		if (force) {
			await rename(tempPath, destinationPath)
			tempExists = false
		} else {
			try {
				await link(tempPath, destinationPath)
			} catch (error) {
				if (errorCode(error) === 'EEXIST') {
					throw new ArtifactError(
						'ARTIFACT_EXISTS',
						'The artifact destination already exists. Pass force to replace it.',
						destinationPath,
					)
				}
				throw error
			}

			await unlink(tempPath)
			tempExists = false
		}

		await syncDirectory(dirname(destinationPath))

		return {
			path: destinationPath,
			bytes: byteCount,
			sha256: hash.digest('hex'),
		}
	} catch (error) {
		throw normalizeArtifactError(error, destinationPath)
	} finally {
		if (handle !== null) {
			await handle.close().catch(() => undefined)
		}
		if (tempExists) {
			await unlink(tempPath).catch(() => undefined)
		}
	}
}

async function* artifactChunks(
	source: ArtifactSource,
): AsyncGenerator<Uint8Array> {
	if (typeof source === 'string' || source instanceof Uint8Array) {
		yield normalizeChunk(source)
		return
	}

	if (!isIterableArtifactSource(source)) {
		throw new ArtifactError(
			'INVALID_ARTIFACT_SOURCE',
			'The artifact source must contain strings or byte arrays.',
		)
	}

	for await (const chunk of source) {
		yield normalizeChunk(chunk)
	}
}

function normalizeChunk(chunk: ArtifactChunk): Uint8Array {
	if (typeof chunk === 'string') {
		return Buffer.from(chunk, 'utf8')
	}
	if (chunk instanceof Uint8Array) {
		return Buffer.from(chunk)
	}

	throw new ArtifactError(
		'INVALID_ARTIFACT_SOURCE',
		'The artifact source must contain strings or byte arrays.',
	)
}

function isIterableArtifactSource(
	source: ArtifactSource,
): source is Iterable<ArtifactChunk> | AsyncIterable<ArtifactChunk> {
	const candidate = source as unknown as {
		[Symbol.iterator]?: unknown
		[Symbol.asyncIterator]?: unknown
	}
	return (
		typeof candidate[Symbol.iterator] === 'function' ||
		typeof candidate[Symbol.asyncIterator] === 'function'
	)
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
	let offset = 0

	while (offset < bytes.byteLength) {
		const result = await handle.write(
			bytes,
			offset,
			bytes.byteLength - offset,
			null,
		)
		if (result.bytesWritten <= 0) {
			throw new Error('Artifact write made no progress.')
		}
		offset += result.bytesWritten
	}
}

class StreamingSecretScanner {
	readonly #patterns: readonly Buffer[]
	readonly #tailLength: number
	#tail = Buffer.alloc(0)

	constructor(patterns: readonly Buffer[]) {
		this.#patterns = patterns
		this.#tailLength = Math.max(
			0,
			...patterns.map((pattern) => pattern.byteLength - 1),
		)
	}

	scan(bytes: Uint8Array): void {
		if (this.#patterns.length === 0) {
			return
		}

		const current = Buffer.from(bytes)
		const searchable =
			this.#tail.byteLength === 0
				? current
				: Buffer.concat([this.#tail, current])

		for (const pattern of this.#patterns) {
			if (searchable.indexOf(pattern) !== -1) {
				throw new ArtifactError(
					'SECRET_DETECTED',
					'The artifact contains a resolved or derived secret and was not published.',
				)
			}
		}

		if (this.#tailLength === 0) {
			this.#tail = Buffer.alloc(0)
			return
		}

		this.#tail = Buffer.from(searchable.subarray(-this.#tailLength))
	}
}

function buildSensitivePatterns(
	secretValues: readonly string[] | undefined,
	basicAuthCredentials: readonly BasicAuthCredential[] | undefined,
): readonly Buffer[] {
	const values = new Set<string>()

	for (const secret of secretValues ?? []) {
		addSecretVariants(values, secret)
	}

	for (const credential of basicAuthCredentials ?? []) {
		addSecretVariants(values, credential.login)
		addSecretVariants(values, credential.password)
		const encoded = Buffer.from(
			`${credential.login}:${credential.password}`,
			'utf8',
		).toString('base64')
		values.add(encoded)
		values.add(`Basic ${encoded}`)
	}

	return [...values]
		.filter((value) => value.length > 0)
		.map((value) => Buffer.from(value, 'utf8'))
		.sort((left, right) => right.byteLength - left.byteLength)
}

function addSecretVariants(values: Set<string>, secret: string): void {
	if (secret.length === 0) {
		return
	}

	values.add(secret)
	values.add(encodeURIComponent(secret))
	values.add(
		new URLSearchParams({ value: secret }).toString().slice('value='.length),
	)
	const jsonEncoded = JSON.stringify(secret)
	values.add(jsonEncoded.slice(1, -1))
	values.add(Buffer.from(secret, 'utf8').toString('base64'))
}

async function syncDirectory(directoryPath: string): Promise<void> {
	const directory = await open(directoryPath, 'r')
	try {
		await directory.sync()
	} finally {
		await directory.close()
	}
}

function normalizeArtifactError(
	error: unknown,
	artifactPath: string,
): ArtifactError {
	if (error instanceof ArtifactError) {
		if (error.artifactPath !== null) {
			return error
		}
		return new ArtifactError(
			error.code,
			error.message,
			artifactPath,
			error.cause,
		)
	}

	return new ArtifactError(
		'ARTIFACT_IO_ERROR',
		'The artifact could not be written safely.',
		artifactPath,
		error,
	)
}

function validateLockTimeout(lockTimeoutMs: number): void {
	if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
		throw new ArtifactError(
			'INVALID_ARTIFACT_PATH',
			'The artifact lock timeout must be a non-negative integer.',
		)
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path)
		return true
	} catch (error) {
		if (errorCode(error) === 'ENOENT') {
			return false
		}
		throw error
	}
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) {
		return undefined
	}
	return typeof error.code === 'string' ? error.code : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolveDelay) => {
		setTimeout(resolveDelay, milliseconds)
	})
}
