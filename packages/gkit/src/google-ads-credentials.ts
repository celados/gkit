import type { JWTInput } from 'google-auth-library'

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import type { LoadedProfile } from './profile'

import { ProfileError } from './profile'

export type GoogleAdsServiceAccount = JWTInput &
	Readonly<{
		type: 'service_account'
		client_email: string
		private_key: string
	}>

export function resolveGoogleAdsServiceAccountPath(
	profile: LoadedProfile,
	configuredPath: string,
): string {
	if (configuredPath.trim().length === 0) {
		throw new ProfileError(
			'invalid_profile',
			'Google Ads serviceAccountFile is empty.',
		)
	}
	if (isAbsolute(configuredPath)) return resolve(configuredPath)

	const supportDirectory = resolve(dirname(profile.path), profile.name)
	const resolvedPath = resolve(supportDirectory, configuredPath)
	const relation = relative(supportDirectory, resolvedPath)
	if (relation.startsWith('..') || isAbsolute(relation)) {
		throw new ProfileError(
			'invalid_profile',
			'Relative Google Ads serviceAccountFile paths must stay inside the profile support directory.',
		)
	}
	return resolvedPath
}

export async function readGoogleAdsServiceAccount(
	path: string,
	read: typeof readFile = readFile,
): Promise<{ credentials: GoogleAdsServiceAccount; privateKey: string }> {
	let source: string
	try {
		source = await read(path, 'utf8')
	} catch {
		throw new ProfileError(
			'invalid_profile',
			'The configured Google Ads service-account file could not be read.',
		)
	}

	let value: unknown
	try {
		value = JSON.parse(source) as unknown
	} catch {
		throw new ProfileError(
			'invalid_profile',
			'The configured Google Ads service-account file is not valid JSON.',
		)
	}
	if (
		value === null ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		(value as Record<string, unknown>).type !== 'service_account' ||
		typeof (value as Record<string, unknown>).client_email !== 'string' ||
		typeof (value as Record<string, unknown>).private_key !== 'string' ||
		!(value as Record<string, string>).private_key.includes('BEGIN PRIVATE KEY')
	) {
		throw new ProfileError(
			'invalid_profile',
			'Google Ads requires a service_account JSON file with client_email and private_key.',
		)
	}

	const credentials = Object.freeze(value as GoogleAdsServiceAccount)
	return { credentials, privateKey: credentials.private_key }
}
