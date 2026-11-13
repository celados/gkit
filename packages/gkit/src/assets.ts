import {
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Set by `bun build --define` for the standalone release bundle (package.json `build`).
declare const GKIT_STANDALONE: boolean | undefined

/**
 * Root directory holding `generated/` and `docs/`.
 *
 * From source (and tests) that is the package root. The standalone bundle has no
 * package root next to it, so its embedded copy is written once to a
 * content-addressed cache directory and read from there — agents are handed real
 * directories by `gkit docs`, and manifests keep loading from files.
 */
export async function resolveAssetRoot(): Promise<string> {
	if (typeof GKIT_STANDALONE === 'undefined' || !GKIT_STANDALONE) {
		return fileURLToPath(new URL('..', import.meta.url))
	}
	const { embeddedAssets } = await import('./assets.embed')
	const key = Bun.hash(JSON.stringify(embeddedAssets)).toString(36)
	const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
	const root = join(cacheHome, 'gkit', 'assets', key)
	if (existsSync(join(root, '.complete'))) return root

	const staging = `${root}.tmp-${process.pid}`
	rmSync(staging, { recursive: true, force: true })
	for (const [path, text] of Object.entries(embeddedAssets)) {
		const target = join(staging, path)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, text)
	}
	writeFileSync(join(staging, '.complete'), '')
	try {
		renameSync(staging, root)
	} catch {
		// A concurrent run won the race with identical content.
		rmSync(staging, { recursive: true, force: true })
	}
	return root
}
