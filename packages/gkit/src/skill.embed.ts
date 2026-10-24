// Text import: inlined into the bundled release artifact, read from disk in dev.
import skill from "./index.md" with { type: "text" };

export async function embedSkill(): Promise<Record<string, string>> {
  return { "SKILL.md": skill };
}
