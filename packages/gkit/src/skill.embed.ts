import site from '../docs/site.md' with { type: 'text' }
// Text import: inlined into the bundled release artifact, read from disk in dev.
import skill from './index.md' with { type: 'text' }

export async function embedSkill(): Promise<Record<string, string>> {
	return { 'SKILL.md': skill, 'references/site.md': site }
}
