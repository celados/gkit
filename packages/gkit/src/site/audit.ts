import { load } from "cheerio";
import {
  hash,
  identity,
  pageUrl,
  type Fields,
  type Finding,
  type Observation,
  type Rules,
} from "./model";

export function extractFields(html: string, url: string, robotsHeader: string | null): Fields {
  const $ = load(html);
  const base = $("base[href]").first().attr("href");
  const documentUrl = base ? new URL(base, url).href : url;
  const href = (value: string | undefined) => (value ? pageUrl(value, documentUrl) : null);
  const canonical = $("link[rel]")
    .toArray()
    .filter((el) => ($(el).attr("rel") ?? "").toLowerCase().split(/\s+/).includes("canonical"))
    .map((el) => href($(el).attr("href")) ?? $(el).attr("href") ?? "");
  const meta = (name: string) =>
    $("meta[name]")
      .toArray()
      .filter((el) => $(el).attr("name")?.toLowerCase() === name)
      .map((el) => $(el).attr("content") ?? "");
  const hreflang = $("link[hreflang][href]")
    .toArray()
    .map((el) => ({
      lang: $(el).attr("hreflang")!.toLowerCase(),
      url: href($(el).attr("href")) ?? $(el).attr("href")!,
    }))
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.url.localeCompare(b.url));
  const links = [
    ...new Set(
      $("a[href]")
        .toArray()
        .flatMap((el) => {
          const value = href($(el).attr("href"));
          return value ? [value] : [];
        }),
    ),
  ].sort();
  const title = $("title").first().text().trim();
  const h1 = $("h1")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim());
  $("script,style,noscript").remove();
  return {
    title,
    description: meta("description")[0]?.trim() ?? "",
    h1,
    canonical,
    robots: [...meta("robots"), ...meta("googlebot"), ...(robotsHeader ? [robotsHeader] : [])],
    lang: $("html").attr("lang") ?? "",
    hreflang,
    links,
    body_hash: hash($("body").text().replace(/\s+/g, " ").trim()),
  };
}

export function audit(
  observations: Observation[],
  config: { site: string; rules: Rules },
): Finding[] {
  const results: Finding[] = [];
  const byUrl = new Map(observations.map((page) => [page.url, page]));
  const add = (
    page: Observation,
    rule: string,
    detail: string,
    severity: Finding["severity"] = "error",
  ) =>
    results.push({
      id: identity("finding", [
        config.site,
        page.url,
        rule,
        [
          "internal-dead-link",
          "hreflang-dead-target",
          "hreflang-return-link",
          "hreflang-language",
        ].includes(rule)
          ? detail
          : null,
      ]),
      url: page.url,
      rule,
      detail,
      severity,
    });
  for (const page of observations) {
    if (page.status !== "observed") continue;
    if (page.http_status! >= 400) add(page, "http-error", String(page.http_status));
    if (page.redirects.length > 1)
      add(page, "redirect-chain", String(page.redirects.length), "warning");
    const fields = page.fields;
    if (!fields || page.http_status! >= 400) continue;
    const policy = [...config.rules]
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)
      .find((rule) => new URL(page.url).pathname.startsWith(rule.pathPrefix));
    if (policy) {
      for (const field of policy.required)
        if (field === "h1" ? !fields.h1.some(Boolean) : !fields[field])
          add(page, `missing-${field}`, field);
      const noindex = fields.robots.some((value) => /\b(noindex|none)\b/i.test(value));
      if (noindex === policy.indexable)
        add(page, "index-directive", policy.indexable ? "Unexpected noindex" : "Expected noindex");
      if (policy.canonical !== "ignore" && fields.canonical.length !== 1)
        add(page, "canonical-count", String(fields.canonical.length));
      if (
        policy.canonical === "self" &&
        fields.canonical.length === 1 &&
        fields.canonical[0] !== page.final_url
      )
        add(page, "canonical-target", fields.canonical[0]!);
    }
    for (const link of fields.links) {
      const target = byUrl.get(link);
      if (target?.status === "observed" && target.http_status! >= 400)
        add(page, "internal-dead-link", link);
    }
    for (const alternate of fields.hreflang) {
      if (!/^(x-default|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/.test(alternate.lang))
        add(page, "hreflang-language", alternate.lang);
      const target = byUrl.get(alternate.url);
      if (target?.status !== "observed") continue;
      if (target.http_status! >= 400) add(page, "hreflang-dead-target", alternate.url);
      else if (
        target.fields &&
        !target.fields.hreflang.some((entry) => entry.url === page.final_url)
      )
        add(page, "hreflang-return-link", alternate.url);
    }
  }
  return [...new Map(results.map((finding) => [finding.id, finding])).values()];
}
