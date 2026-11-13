import { describe, expect, it } from 'vitest'

import { compareSemVer, decideRelease, parseSemVer } from './release-preflight'

describe('release preflight', () => {
	it('implements SemVer precedence including prereleases', () => {
		const ordered = [
			'1.0.0-alpha',
			'1.0.0-alpha.1',
			'1.0.0-alpha.beta',
			'1.0.0-beta',
			'1.0.0-beta.2',
			'1.0.0-beta.11',
			'1.0.0-rc.1',
			'1.0.0',
		].map(parseSemVer)
		for (let index = 1; index < ordered.length; index += 1) {
			expect(compareSemVer(ordered[index - 1]!, ordered[index]!)).toBe(-1)
		}
		expect(
			compareSemVer(
				parseSemVer('999999999999999999999999.0.0'),
				parseSemVer('1000000000000000000000000.0.0'),
			),
		).toBe(-1)
	})

	it('rejects invalid SemVer values', () => {
		for (const version of ['v1.0.0', '1.0', '01.0.0', '1.0.0-01', '1.0.0-']) {
			expect(() => parseSemVer(version)).toThrow('Invalid SemVer')
		}
	})

	it('allows a new version only when it is greater than every release tag', () => {
		expect(
			decideRelease('1.2.0', ['not-a-release', 'v1.1.9'], 'abc', new Map()),
		).toEqual({
			version: '1.2.0',
			tag: 'v1.2.0',
			prerelease: false,
			tagExists: false,
		})
		expect(() => decideRelease('1.1.8', ['v1.1.9'], 'abc', new Map())).toThrow(
			'must be greater',
		)
	})

	it('permits an idempotent rerun only when the tag points to the same commit', () => {
		expect(
			decideRelease(
				'1.2.0-beta.1',
				['v1.2.0-beta.1'],
				'abc',
				new Map([['v1.2.0-beta.1', 'abc']]),
			),
		).toMatchObject({ prerelease: true, tagExists: true })
		expect(() =>
			decideRelease(
				'1.2.0-beta.1',
				['v1.2.0-beta.1'],
				'abc',
				new Map([['v1.2.0-beta.1', 'different']]),
			),
		).toThrow('not abc')
	})

	it('does not let build metadata bypass equal precedence', () => {
		expect(() =>
			decideRelease('1.2.0+new', ['v1.2.0+old'], 'abc', new Map()),
		).toThrow('must be greater')
	})
})
