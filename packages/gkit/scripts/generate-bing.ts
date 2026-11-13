import { resolve } from 'node:path'

import { writeContractProviderArtifacts } from './generate-contract-provider'

if (import.meta.main) {
	await writeContractProviderArtifacts({
		packageRoot: resolve(new URL('..', import.meta.url).pathname),
		provider: 'bing',
		check: process.argv.slice(2).includes('--check'),
	})
}
