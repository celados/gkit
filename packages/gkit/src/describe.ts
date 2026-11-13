import { GkitFailure } from './envelope'
import { ManifestError, type LoadedExecutableManifest } from './manifest'

export function describeCapability(
	manifest: LoadedExecutableManifest | readonly LoadedExecutableManifest[],
	capabilityId: string,
): string {
	try {
		for (const candidate of Array.isArray(manifest) ? manifest : [manifest]) {
			const record = candidate.records.get(capabilityId)
			if (record) return `${JSON.stringify(record, null, 2)}\n`
		}
		throw new ManifestError('CAPABILITY_NOT_FOUND', 'Capability was not found.')
	} catch (error) {
		if (
			error instanceof ManifestError &&
			error.kind === 'CAPABILITY_NOT_FOUND'
		) {
			throw new GkitFailure({
				code: 'CAPABILITY_NOT_FOUND',
				message: `Capability ${capabilityId} is not present in the executable manifest.`,
				hint: 'Run gkit --schema, then describe an exposed capability ID.',
			})
		}
		throw error
	}
}
