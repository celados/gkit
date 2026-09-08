import { audit } from "./audit";
import {
  canonicalJson,
  hash,
  identity,
  RULES_VERSION,
  type Rules,
  type SiteSnapshot,
} from "./model";

export function evaluateSnapshot(
  snapshot: SiteSnapshot,
  rules: Rules = snapshot.manifest.expectations,
) {
  return {
    schema_version: 1,
    id: identity("audit", [snapshot.manifest.snapshot_id, RULES_VERSION, rules]),
    snapshot_id: snapshot.manifest.snapshot_id,
    rules_version: RULES_VERSION,
    expectations_hash: hash(JSON.stringify(rules)),
    coverage: snapshot.manifest.coverage,
    limits: [
      "HTTP headers/status are not observed for prerender files.",
      "Relation checks need observations of their targets; absent targets are unknown.",
    ],
    findings: audit(snapshot.pages, { site: snapshot.manifest.site, rules }),
  };
}
export function compareSnapshots(base: SiteSnapshot, head: SiteSnapshot, rules?: Rules) {
  const a = base.manifest;
  const b = head.manifest;
  const conditionsMatch =
    a.site === b.site &&
    JSON.stringify([...a.origins].sort()) === JSON.stringify([...b.origins].sort()) &&
    a.source.kind === b.source.kind &&
    a.source.runtime_context === b.source.runtime_context &&
    a.extractor_version === b.extractor_version;
  const left = new Map(base.pages.map((page) => [page.url, page]));
  const right = new Map(head.pages.map((page) => [page.url, page]));
  const urls = [...new Set([...a.routes, ...b.routes])].sort();
  const comparable = new Set<string>();
  const pages = urls.map((url) => {
    const before = left.get(url);
    const after = right.get(url);
    if (!before || !after || before.status !== "observed" || after.status !== "observed")
      return {
        url,
        status: "unobserved",
        before: before?.status ?? "not_in_scope",
        after: after?.status ?? "not_in_scope",
        changes: [],
      };
    if (!conditionsMatch || before.mode !== after.mode)
      return { url, status: "incomparable", before: before.mode, after: after.mode, changes: [] };
    comparable.add(url);
    const beforeFields = {
      http_status: before.http_status,
      final_url: before.final_url,
      redirects: before.redirects,
      response_headers: before.response_headers,
      ...before.fields,
    };
    const afterFields = {
      http_status: after.http_status,
      final_url: after.final_url,
      redirects: after.redirects,
      response_headers: after.response_headers,
      ...after.fields,
    };
    const changes = [
      ...new Set([...Object.keys(beforeFields), ...Object.keys(afterFields)]),
    ].flatMap((field) => {
      const prior = (beforeFields as Record<string, unknown>)[field] ?? null;
      const next = (afterFields as Record<string, unknown>)[field] ?? null;
      return canonicalJson(prior) === canonicalJson(next)
        ? []
        : [{ field, before: prior, after: next }];
    });
    return { url, status: changes.length ? "changed" : "unchanged", changes };
  });
  const leftAudit = evaluateSnapshot(base, rules);
  const rightAudit = evaluateSnapshot(head, rules);
  const rulesMatch = leftAudit.expectations_hash === rightAudit.expectations_hash;
  const leftFindings = new Map(leftAudit.findings.map((f) => [f.id, f]));
  const rightFindings = new Map(rightAudit.findings.map((f) => [f.id, f]));
  const findings = [...new Set([...leftFindings.keys(), ...rightFindings.keys()])].map((id) => {
    const before = leftFindings.get(id);
    const after = rightFindings.get(id);
    const finding = after ?? before!;
    const prior = left.get(finding.url);
    const next = right.get(finding.url);
    let covered =
      rulesMatch &&
      comparable.has(finding.url) &&
      (finding.rule === "http-error"
        ? prior?.http_status !== null && next?.http_status !== null
        : !!prior?.fields &&
          !!next?.fields &&
          (prior.http_status === null || prior.http_status < 400) &&
          (next.http_status === null || next.http_status < 400));
    if (
      ["internal-dead-link", "hreflang-dead-target", "hreflang-return-link"].includes(finding.rule)
    )
      covered = covered && comparable.has(finding.detail);
    if (finding.rule === "hreflang-return-link") {
      const priorTarget = left.get(finding.detail);
      const nextTarget = right.get(finding.detail);
      covered =
        covered &&
        !!priorTarget?.fields &&
        !!nextTarget?.fields &&
        (priorTarget.http_status === null || priorTarget.http_status < 400) &&
        (nextTarget.http_status === null || nextTarget.http_status < 400);
    }
    return {
      ...finding,
      state: !covered
        ? "observed_only"
        : before && after
          ? "persistent"
          : after
            ? "new"
            : "resolved",
      present_in: before && after ? "both" : before ? "base" : "head",
    };
  });
  return {
    schema_version: 1,
    diff_version: "snapshot-diff-v2",
    id: identity("diff", [
      a.snapshot_id,
      b.snapshot_id,
      leftAudit.id,
      rightAudit.id,
      "snapshot-diff-v2",
    ]),
    base: { snapshot_id: a.snapshot_id, source: a.source },
    head: { snapshot_id: b.snapshot_id, source: b.source },
    status: comparable.size === urls.length && rulesMatch ? "complete" : "partial",
    coverage: {
      conditions_match: conditionsMatch,
      rules_match: rulesMatch,
      known_urls: urls.length,
      comparable_urls: comparable.size,
      scope: "declared-routes",
    },
    rules_version: RULES_VERSION,
    pages,
    findings,
    summary: {
      changed_pages: pages.filter((p) => p.status === "changed").length,
      new_findings: findings.filter((f) => f.state === "new").length,
      resolved_findings: findings.filter((f) => f.state === "resolved").length,
    },
    interpretation: "Observed output differences; release causation is not established.",
  };
}
