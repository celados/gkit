import { describe, expect, test } from 'vitest'

import {
	ProfileError,
	getProviderEnvironment,
	loadProfile,
	loadProfileEnvironment,
	profilePath,
	resolveProviderSecrets,
	selectProfileName,
} from './profile'

function profileDocument(
	config: Record<string, unknown> = {},
	secrets: Record<string, string> = {
		login: 'env:APP_A_DATAFORSEO_LOGIN',
		password: 'env:APP_A_DATAFORSEO_PASSWORD',
	},
) {
	return {
		version: 1,
		name: 'app-a',
		providers: {
			dataforseo: {
				config,
				policy: {
					maxSpendUsdPerCall: '0.050000',
				},
				secrets,
			},
		},
	}
}

async function loadDocument(input: unknown) {
	return loadProfile('app-a', {
		xdgConfigHome: '/tmp/gkit-profile-test',
		readTextFile: async () => JSON.stringify(input),
	})
}

describe('profile selection', () => {
	test('requires a profile and gives the flag priority over GKIT_PROFILE', () => {
		expect(selectProfileName('flag-app', { GKIT_PROFILE: 'env-app' })).toBe(
			'flag-app',
		)
		expect(selectProfileName(undefined, { GKIT_PROFILE: 'env-app' })).toBe(
			'env-app',
		)
		expect(() => selectProfileName(undefined, {})).toThrow(
			expect.objectContaining({ reason: 'missing_selector' }),
		)
	})

	test('rejects path traversal and non-slug selectors', () => {
		for (const name of ['../app-a', 'app_a', 'App-A', '-app']) {
			expect(() => selectProfileName(name, {})).toThrow(
				expect.objectContaining({ reason: 'invalid_slug' }),
			)
		}
	})

	test('accepts domain-style App profile names', () => {
		expect(selectProfileName('clonesite.ai', {})).toBe('clonesite.ai')
		expect(profilePath('clonesite.ai', { xdgConfigHome: '/tmp/config' })).toBe(
			'/tmp/config/gkit/profiles/clonesite.ai.json',
		)
	})

	test('uses the XDG config path without accepting a path-like profile name', () => {
		expect(
			profilePath('app-a', { xdgConfigHome: '/xdg', home: '/ignored' }),
		).toBe('/xdg/gkit/profiles/app-a.json')
		expect(profilePath('app-a', { xdgConfigHome: '', home: '/home/app' })).toBe(
			'/home/app/.config/gkit/profiles/app-a.json',
		)
		expect(() => profilePath('app-a', { xdgConfigHome: 'relative' })).toThrow(
			expect.objectContaining({ reason: 'invalid_profile' }),
		)
	})
})

describe('profile loading and secret resolution', () => {
	test('loads the profile-adjacent .env without overriding explicit environment values', async () => {
		const profile = await loadDocument(profileDocument())
		const loaded = await loadProfileEnvironment(
			profile,
			{
				APP_A_DATAFORSEO_LOGIN: 'process-login',
				PROCESS_ONLY: 'process-value',
			},
			{
				readTextFile: async (path) => {
					expect(path).toBe('/tmp/gkit-profile-test/gkit/profiles/app-a/.env')
					return [
						'APP_A_DATAFORSEO_LOGIN=file-login',
						'APP_A_DATAFORSEO_PASSWORD=file-password',
						'FILE_ONLY=file-value',
					].join('\n')
				},
			},
		)

		expect(loaded).toEqual({
			APP_A_DATAFORSEO_LOGIN: 'process-login',
			APP_A_DATAFORSEO_PASSWORD: 'file-password',
			FILE_ONLY: 'file-value',
			PROCESS_ONLY: 'process-value',
		})
		expect(Object.isFrozen(loaded)).toBe(true)
	})

	test('treats a missing profile .env as optional but surfaces other read failures', async () => {
		const profile = await loadDocument(profileDocument())
		const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })

		await expect(
			loadProfileEnvironment(
				profile,
				{ AMBIENT: 'value' },
				{
					readTextFile: async () => {
						throw missing
					},
				},
			),
		).resolves.toEqual({ AMBIENT: 'value' })

		await expect(
			loadProfileEnvironment(
				profile,
				{},
				{
					readTextFile: async () => {
						throw Object.assign(new Error('denied'), { code: 'EACCES' })
					},
				},
			),
		).rejects.toMatchObject({
			reason: 'invalid_profile',
			message: expect.stringContaining('profile environment'),
		})
	})

	test('defaults DataForSEO to the fixed production environment', async () => {
		const profile = await loadDocument(profileDocument())

		expect(getProviderEnvironment(profile, 'dataforseo')).toBe('production')
		expect(profile.providers.dataforseo?.config).toEqual({
			environment: 'production',
		})
		expect(Object.isFrozen(profile.providers.dataforseo?.config)).toBe(true)
	})

	test('accepts the fixed sandbox environment and rejects transport overrides', async () => {
		const sandbox = await loadDocument(
			profileDocument({ environment: 'sandbox' }),
		)
		expect(getProviderEnvironment(sandbox, 'dataforseo')).toBe('sandbox')

		await expect(
			loadDocument(
				profileDocument({
					environment: 'production',
					baseUrl: 'https://attacker.invalid',
				}),
			),
		).rejects.toMatchObject({ reason: 'invalid_profile' })
	})

	test('rejects filename/name mismatches', async () => {
		const input = profileDocument()
		input.name = 'app-b'

		await expect(loadDocument(input)).rejects.toMatchObject({
			reason: 'name_mismatch',
		})
	})

	test('rejects plaintext secret values and secret-looking config fields', async () => {
		await expect(
			loadDocument(profileDocument({}, { password: 'plain-text' })),
		).rejects.toMatchObject({ reason: 'invalid_profile' })

		await expect(
			loadDocument(profileDocument({ password: 'plain-text' })),
		).rejects.toMatchObject({
			reason: 'invalid_profile',
		})
	})

	test('requires exactly the DataForSEO credential references', async () => {
		await expect(
			loadDocument(
				profileDocument({}, { login: 'env:APP_A_DATAFORSEO_LOGIN' }),
			),
		).rejects.toMatchObject({ reason: 'invalid_profile' })

		await expect(
			loadDocument(
				profileDocument(
					{},
					{
						login: 'env:APP_A_DATAFORSEO_LOGIN',
						password: 'env:APP_A_DATAFORSEO_PASSWORD',
						token: 'env:APP_A_DATAFORSEO_TOKEN',
					},
				),
			),
		).rejects.toMatchObject({ reason: 'invalid_profile' })
	})

	test("resolves only the selected provider's env references after loading", async () => {
		const input = profileDocument()
		input.providers = {
			...input.providers,
			posthog: {
				config: { host: 'https://us.posthog.com', projectId: '12345' },
				policy: {},
				secrets: { apiToken: 'env:APP_A_POSTHOG_TOKEN' },
			},
		} as typeof input.providers
		const profile = await loadDocument(input)

		const resolved = resolveProviderSecrets(profile, 'dataforseo', {
			APP_A_DATAFORSEO_LOGIN: 'login',
			APP_A_DATAFORSEO_PASSWORD: 'password',
		})
		expect(resolved).toEqual({ login: 'login', password: 'password' })
		expect(Object.isFrozen(resolved)).toBe(true)
	})

	test('accepts only the fixed PostHog origins, numeric project id, and api token reference', async () => {
		const input = profileDocument()
		input.providers = {
			...input.providers,
			posthog: {
				config: { host: 'https://eu.posthog.com', projectId: '12345' },
				policy: {},
				secrets: { apiToken: 'env:APP_A_POSTHOG_TOKEN' },
			},
		} as typeof input.providers

		const profile = await loadDocument(input)
		expect(profile.providers.posthog?.config).toEqual({
			host: 'https://eu.posthog.com',
			projectId: '12345',
		})
		expect(
			resolveProviderSecrets(profile, 'posthog', {
				APP_A_POSTHOG_TOKEN: 'phx_test',
			}),
		).toEqual({
			apiToken: 'phx_test',
		})

		for (const posthog of [
			{
				config: { host: 'https://attacker.invalid', projectId: '12345' },
				policy: {},
				secrets: { apiToken: 'env:APP_A_POSTHOG_TOKEN' },
			},
			{
				config: { host: 'https://us.posthog.com', projectId: 'not-numeric' },
				policy: {},
				secrets: { apiToken: 'env:APP_A_POSTHOG_TOKEN' },
			},
			{
				config: { host: 'https://us.posthog.com', projectId: '12345' },
				policy: {},
				secrets: {
					apiToken: 'env:APP_A_POSTHOG_TOKEN',
					extra: 'env:APP_A_POSTHOG_EXTRA',
				},
			},
		]) {
			const invalid = profileDocument()
			invalid.providers = {
				...invalid.providers,
				posthog,
			} as typeof invalid.providers
			await expect(loadDocument(invalid)).rejects.toMatchObject({
				reason: 'invalid_profile',
			})
		}
	})

	test('accepts only single-account Google Ads config and service-account env references', async () => {
		const input = profileDocument()
		input.providers = {
			...input.providers,
			'google-ads': {
				config: { customerId: '1234567890' },
				policy: {},
				secrets: {
					developerToken: 'env:APP_A_GOOGLE_ADS_DEVELOPER_TOKEN',
					serviceAccountFile: 'env:APP_A_GOOGLE_ADS_SERVICE_ACCOUNT_FILE',
				},
			},
		} as typeof input.providers

		const profile = await loadDocument(input)
		expect(profile.providers['google-ads']?.config).toEqual({
			customerId: '1234567890',
		})
		expect(
			resolveProviderSecrets(profile, 'google-ads', {
				APP_A_GOOGLE_ADS_DEVELOPER_TOKEN: 'developer-token',
				APP_A_GOOGLE_ADS_SERVICE_ACCOUNT_FILE: 'credentials/google-ads.json',
			}),
		).toEqual({
			developerToken: 'developer-token',
			serviceAccountFile: 'credentials/google-ads.json',
		})

		for (const config of [
			{ customerId: 'bad' },
			{ customerId: '1234567890', loginCustomerId: '0987654321' },
		]) {
			const invalid = profileDocument()
			invalid.providers = {
				...invalid.providers,
				'google-ads': {
					config,
					policy: {},
					secrets: {
						developerToken: 'env:APP_A_GOOGLE_ADS_DEVELOPER_TOKEN',
						serviceAccountFile: 'env:APP_A_GOOGLE_ADS_SERVICE_ACCOUNT_FILE',
					},
				},
			} as typeof invalid.providers
			await expect(loadDocument(invalid)).rejects.toMatchObject({
				reason: 'invalid_profile',
			})
		}
	})

	test('accepts only strict Bing and GSC profile boundaries', async () => {
		const input = profileDocument()
		input.providers = {
			...input.providers,
			bing: {
				config: { siteUrl: 'https://example.com/' },
				policy: {},
				secrets: { apiKey: 'env:APP_A_BING_API_KEY' },
			},
			gsc: {
				config: { siteUrl: 'sc-domain:example.com' },
				policy: {},
				secrets: { serviceAccountFile: 'env:APP_A_GSC_SERVICE_ACCOUNT_FILE' },
			},
		} as typeof input.providers
		const profile = await loadDocument(input)
		expect(profile.providers.bing?.config).toEqual({
			siteUrl: 'https://example.com/',
		})
		expect(profile.providers.gsc?.config).toEqual({
			siteUrl: 'sc-domain:example.com',
		})
		expect(
			resolveProviderSecrets(profile, 'bing', { APP_A_BING_API_KEY: 'secret' }),
		).toEqual({
			apiKey: 'secret',
		})
		expect(
			resolveProviderSecrets(profile, 'gsc', {
				APP_A_GSC_SERVICE_ACCOUNT_FILE: 'credentials/gsc.json',
			}),
		).toEqual({ serviceAccountFile: 'credentials/gsc.json' })

		for (const [provider, config, secrets] of [
			[
				'bing',
				{ siteUrl: 'file:///tmp/site' },
				{ apiKey: 'env:APP_A_BING_API_KEY' },
			],
			[
				'gsc',
				{
					siteUrl: 'sc-domain:example.com',
					origin: 'https://attacker.invalid',
				},
				{ serviceAccountFile: 'env:APP_A_GSC_SERVICE_ACCOUNT_FILE' },
			],
		] as const) {
			const invalid = profileDocument()
			invalid.providers = {
				...invalid.providers,
				[provider]: { config, policy: {}, secrets },
			} as typeof invalid.providers
			await expect(loadDocument(invalid)).rejects.toMatchObject({
				reason: 'invalid_profile',
			})
		}
	})

	test('accepts only a static HubSpot access-token env reference with no config', async () => {
		const input = profileDocument()
		input.providers = {
			...input.providers,
			hubspot: {
				config: {},
				policy: {},
				secrets: { accessToken: 'env:APP_A_HUBSPOT_ACCESS_TOKEN' },
			},
		} as typeof input.providers
		const profile = await loadDocument(input)

		expect(profile.providers.hubspot?.config).toEqual({})
		expect(
			resolveProviderSecrets(profile, 'hubspot', {
				APP_A_HUBSPOT_ACCESS_TOKEN: 'resolved-hubspot-secret',
			}),
		).toEqual({ accessToken: 'resolved-hubspot-secret' })

		for (const hubspot of [
			{
				config: { portalId: '123' },
				policy: {},
				secrets: { accessToken: 'env:APP_A_HUBSPOT_ACCESS_TOKEN' },
			},
			{
				config: {},
				policy: {},
				secrets: {
					accessToken: 'env:APP_A_HUBSPOT_ACCESS_TOKEN',
					apiKey: 'env:APP_A_HUBSPOT_API_KEY',
				},
			},
		]) {
			const invalid = profileDocument()
			invalid.providers = {
				...invalid.providers,
				hubspot,
			} as typeof invalid.providers
			await expect(loadDocument(invalid)).rejects.toMatchObject({
				reason: 'invalid_profile',
			})
		}
	})

	test('reports a missing referenced env var without reading arbitrary secrets', async () => {
		const profile = await loadDocument(profileDocument())

		expect(() =>
			resolveProviderSecrets(profile, 'dataforseo', {
				APP_A_DATAFORSEO_LOGIN: 'login',
			}),
		).toThrow(
			expect.objectContaining({
				reason: 'secret_env_missing',
				message: expect.stringContaining('APP_A_DATAFORSEO_PASSWORD'),
			}),
		)
	})

	test('uses stable errors for missing providers', async () => {
		const profile = await loadDocument(profileDocument())

		expect(() => resolveProviderSecrets(profile, 'posthog', {})).toThrow(
			ProfileError,
		)
		expect(() => resolveProviderSecrets(profile, 'posthog', {})).toThrow(
			expect.objectContaining({ reason: 'provider_missing' }),
		)
	})
})
