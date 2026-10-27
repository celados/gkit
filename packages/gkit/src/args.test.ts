import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";

describe("gkit argv parser", () => {
  it("accepts the public spaced command and global profile", () => {
    expect(
      parseArgs([
        "--profile",
        "app-a",
        "dataforseo",
        "api",
        "call",
        "--capability-id",
        "dataforseo.backlinks.bulk_ranks.live",
        "--input",
        "@req.json",
        "--allow-spend",
        "--max-spend-usd",
        "0.05",
        "--out",
        "r.json",
      ]),
    ).toEqual({
      kind: "dataforseo-call",
      profileFlag: "app-a",
      capabilityId: "dataforseo.backlinks.bulk_ranks.live",
      input: "@req.json",
      allowSpend: true,
      maxSpendUsd: "0.05",
      out: "r.json",
      force: false,
      dryRun: false,
    });
  });

  it("keeps discovery commands profile-free", () => {
    expect(parseArgs(["--schema"])).toEqual({ kind: "schema", selector: null });
    expect(parseArgs(["@skill"])).toEqual({ kind: "skill", path: null });
    expect(parseArgs(["@skill", "SKILL.md"])).toEqual({ kind: "skill", path: "SKILL.md" });
    expect(parseArgs(["describe", "--id", "capability"])).toEqual({
      kind: "describe",
      id: "capability",
    });
    expect(() => parseArgs(["--profile", "app-a", "--schema"])).toThrow(
      "--schema does not load a profile",
    );
    expect(() => parseArgs(["--profile", "app-a", "@skill"])).toThrow(
      "@skill does not load a profile",
    );
    expect(parseArgs(["operations"])).toEqual({ kind: "operations-list", limit: 20 });
    expect(parseArgs(["operations", "list", "--limit", "5"])).toEqual({
      kind: "operations-list",
      limit: 5,
    });
    expect(parseArgs(["operations", "show", "--id", "op-1"])).toEqual({
      kind: "operations-show",
      operationId: "op-1",
    });
  });

  it("accepts the read-only PostHog command without spend flags", () => {
    expect(
      parseArgs([
        "--profile",
        "app-a",
        "posthog",
        "api",
        "call",
        "--capability-id",
        "posthog.query.run",
        "--input",
        "@req.json",
        "--out",
        "result.json",
        "--dry-run",
      ]),
    ).toEqual({
      kind: "posthog-call",
      profileFlag: "app-a",
      capabilityId: "posthog.query.run",
      input: "@req.json",
      out: "result.json",
      force: false,
      dryRun: true,
    });
    expect(() =>
      parseArgs([
        "posthog",
        "api",
        "call",
        "--capability-id",
        "posthog.query.run",
        "--input",
        "@req.json",
        "--allow-spend",
      ]),
    ).toThrow("Unknown flag");
  });

  it("accepts the reviewed Google Ads call without spend or manager flags", () => {
    expect(
      parseArgs([
        "--profile",
        "openclaw-web",
        "google-ads",
        "api",
        "call",
        "--capability-id",
        "google-ads.query.gaql",
        "--input",
        "@gaql.json",
        "--out",
        "pages.json",
        "--dry-run",
      ]),
    ).toEqual({
      kind: "google-ads-call",
      profileFlag: "openclaw-web",
      capabilityId: "google-ads.query.gaql",
      input: "@gaql.json",
      out: "pages.json",
      force: false,
      dryRun: true,
    });
    expect(() =>
      parseArgs([
        "google-ads",
        "api",
        "call",
        "--capability-id",
        "google-ads.query.gaql",
        "--input",
        "{}",
        "--login-customer-id",
        "0987654321",
      ]),
    ).toThrow("Unknown flag");
  });

  it.each([
    ["bing", "bing.sites.list", "bing-call"],
    ["gsc", "gsc.properties.list", "gsc-call"],
    ["hubspot", "hubspot.crm.objects.list", "hubspot-call"],
  ] as const)(
    "accepts the read-only %s call without spend flags",
    (provider, capabilityId, kind) => {
      expect(
        parseArgs([
          "--profile",
          "app-a",
          provider,
          "api",
          "call",
          "--capability-id",
          capabilityId,
          "--input",
          "{}",
          "--out",
          "result.json",
          "--dry-run",
        ]),
      ).toEqual({
        kind,
        profileFlag: "app-a",
        capabilityId,
        input: "{}",
        ...(provider === "gsc" ? { allowWrite: false } : {}),
        out: "result.json",
        force: false,
        dryRun: true,
      });
    },
  );

  it("parses --allow-write for GSC calls so the effect gate receives it", () => {
    expect(
      parseArgs([
        "--profile",
        "app-a",
        "gsc",
        "api",
        "call",
        "--capability-id",
        "gsc.sitemaps.submit",
        "--input",
        "{}",
        "--allow-write",
        "--out",
        "receipt.json",
      ]),
    ).toMatchObject({ kind: "gsc-call", capabilityId: "gsc.sitemaps.submit", allowWrite: true });
    expect(() =>
      parseArgs(["gsc", "api", "call", "--capability-id", "x", "--input", "{}", "--allow-write=yes"]),
    ).toThrow("does not accept a value");
  });

  it.each(["bing", "hubspot", "dataforseo"] as const)(
    "rejects --allow-write for %s, which has no write capabilities",
    (provider) => {
      expect(() =>
        parseArgs([provider, "api", "call", "--capability-id", "x", "--input", "{}", "--allow-write"]),
      ).toThrow("Unknown flag: --allow-write");
    },
  );

  it("rejects unknown or duplicate flags before execution", () => {
    expect(() =>
      parseArgs([
        "dataforseo",
        "api",
        "call",
        "--capability-id",
        "id",
        "--capability-id",
        "id-2",
        "--input",
        "@req.json",
      ]),
    ).toThrow("Duplicate flag");
    expect(() =>
      parseArgs([
        "dataforseo",
        "api",
        "call",
        "--capability-id",
        "id",
        "--input",
        "@req.json",
        "--unknown",
        "value",
      ]),
    ).toThrow("Unknown flag");
    expect(() =>
      parseArgs(["--profile", "app-a", "--profile=app-b", "dataforseo", "doctor"]),
    ).toThrow("--profile may be provided only once");
  });
});
