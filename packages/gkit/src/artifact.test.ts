import { createHash } from 'node:crypto'
import {
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
	ArtifactError,
	reserveArtifactDestination,
	writeArtifact,
} from './artifact'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map(async (directory) => {
			await rm(directory, { recursive: true, force: true })
		}),
	)
})

describe('artifact publication', () => {
	it('preserves clean bytes, hashes them, and publishes with mode 0600', async () => {
		const directory = await temporaryDirectory()
		const destinationPath = join(directory, 'result.bin')
		const bytes = Uint8Array.from([0, 255, 10, 123, 34, 120, 34, 125])

		const receipt = await writeArtifact({ destinationPath, source: bytes })

		expect(new Uint8Array(await readFile(destinationPath))).toEqual(bytes)
		expect(receipt).toEqual({
			path: await realpath(destinationPath),
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		})
		expect((await stat(destinationPath)).mode & 0o777).toBe(0o600)
	})

	it('refuses replacement by default and force atomically replaces the file', async () => {
		const directory = await temporaryDirectory()
		const destinationPath = join(directory, 'result.json')
		await writeArtifact({ destinationPath, source: 'first' })

		const error = await rejectedArtifact(
			writeArtifact({
				destinationPath,
				source: 'second',
				lockTimeoutMs: 1_000,
			}),
		)

		expect(error.code).toBe('ARTIFACT_EXISTS')
		expect(await readFile(destinationPath, 'utf8')).toBe('first')

		await writeArtifact({ destinationPath, source: 'second', force: true })
		expect(await readFile(destinationPath, 'utf8')).toBe('second')
		expect((await stat(destinationPath)).mode & 0o777).toBe(0o600)
	})

	it('fails closed when a raw or derived secret spans source chunks', async () => {
		const directory = await temporaryDirectory()
		const destinationPath = join(directory, 'result.json')

		async function* source(): AsyncGenerator<Uint8Array> {
			yield Buffer.from('{"value":"prefix top-', 'utf8')
			yield Buffer.from('secret suffix"}', 'utf8')
		}

		const error = await rejectedArtifact(
			writeArtifact({
				destinationPath,
				source: source(),
				secretValues: ['top-secret'],
			}),
		)

		expect(error.code).toBe('SECRET_DETECTED')
		expect(await readdir(directory)).toEqual([])

		const encodedDestination = join(directory, 'encoded.json')
		const encodedError = await rejectedArtifact(
			writeArtifact({
				destinationPath: encodedDestination,
				source: encodeURIComponent('token/with space'),
				secretValues: ['token/with space'],
			}),
		)
		expect(encodedError.code).toBe('SECRET_DETECTED')
		expect(await readdir(directory)).toEqual([])

		const basicDestination = join(directory, 'basic.json')
		const basicValue = Buffer.from('login:password', 'utf8').toString('base64')
		const basicError = await rejectedArtifact(
			writeArtifact({
				destinationPath: basicDestination,
				source: `Basic ${basicValue}`,
				basicAuthCredentials: [{ login: 'login', password: 'password' }],
			}),
		)
		expect(basicError.code).toBe('SECRET_DETECTED')
		expect(await readdir(directory)).toEqual([])
	})

	it('lets exactly one concurrent no-force publisher win without changing its bytes', async () => {
		const directory = await temporaryDirectory()
		const destinationPath = join(directory, 'result.json')
		const payloads = Array.from(
			{ length: 12 },
			(_, index) => `payload-${index}`,
		)

		const results = await Promise.allSettled(
			payloads.map(async (source) => {
				const receipt = await writeArtifact({ destinationPath, source })
				return { receipt, source }
			}),
		)
		const winners = results.filter((result) => result.status === 'fulfilled')
		const losers = results.filter((result) => result.status === 'rejected')

		expect(winners).toHaveLength(1)
		expect(losers).toHaveLength(payloads.length - 1)
		const winner = winners[0]
		if (winner?.status !== 'fulfilled') {
			throw new Error('Expected one successful artifact publication.')
		}
		expect(await readFile(destinationPath, 'utf8')).toBe(winner.value.source)

		for (const loser of losers) {
			if (loser.status !== 'rejected') {
				continue
			}
			expect(loser.reason).toBeInstanceOf(ArtifactError)
			expect((loser.reason as ArtifactError).code).toBe('ARTIFACT_EXISTS')
		}
		expect((await readdir(directory)).sort()).toEqual(['result.json'])
	})

	it('reserves an absent destination before work and keeps a hard no-replace backstop', async () => {
		const directory = await temporaryDirectory()
		const destinationPath = join(directory, 'result.json')
		const reservation = await reserveArtifactDestination({ destinationPath })

		try {
			await writeFile(destinationPath, 'raced', { mode: 0o600 })
			const error = await rejectedArtifact(
				reservation.publish({ source: 'provider-result' }),
			)
			expect(error.code).toBe('ARTIFACT_EXISTS')
			expect(await readFile(destinationPath, 'utf8')).toBe('raced')
		} finally {
			await reservation.release()
		}
	})
})

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'gkit-artifact-test-'))
	temporaryDirectories.push(directory)
	return directory
}

async function rejectedArtifact(
	promise: Promise<unknown>,
): Promise<ArtifactError> {
	try {
		await promise
	} catch (error) {
		if (error instanceof ArtifactError) {
			return error
		}
		throw error
	}
	throw new Error('Expected artifact publication to fail.')
}
