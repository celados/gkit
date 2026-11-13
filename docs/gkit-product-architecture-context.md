---
type: Reference
title: gkit Product Architecture Context
description: The confirmed minimum product boundary and first vertical slice for gkit.
status: active
version: 0.4
generated: { by: codex/gpt-5, at: '2026-08-14T14:39:07+08:00' }
tags: [gkit, growth-workspace, agent-native]
---

# gkit Product Architecture Context

## Product boundary

gkit is the complete **headless, agent-native Growth Workspace**, analogous to
Macro in product shape: External Agents enter one durable workspace, find prior
work, use shared capabilities, and leave addressable work for later Agents.

The Product's Growth Workspace is the continuity root. Growth Projects are
optional organization inside it. gkit is not an autonomous Growth Agent, a
generic connector platform, or only a provider CLI.

The existing Growth Capability Runtime is a subordinate execution module.
External Agents and Growth Skills retain goals, orchestration, interpretation,
and next-step judgment.

## Confirmed minimum

1. **The Workspace is portable.** Its first physical form is a directory that
   can live independently or inside a local or future Gesso host. See
   [ADR-0023](./adr/0023-keep-growth-workspaces-portable-across-hosts.md).
2. **`GROWTH.md` is the entrypoint.** One root OKF document with
   `type: GrowthWorkspace` gives human-readable Product identity, orientation,
   and links. The directory is the first identity boundary. See
   [ADR-0024](./adr/0024-use-growth-md-as-the-workspace-entrypoint.md).
3. **One App Profile selector binds execution.** `GROWTH.md` declares one
   non-secret `app_profile` selector. The Agent passes it explicitly to gkit,
   while the host resolves the matching profile and secrets. A missing selector
   stops provider readiness and dispatch without profile scanning or guessing.
   See
   [ADR-0026](./adr/0026-declare-one-app-profile-selector-in-growth-md.md).
4. **Growth Documents are the first collaboration object.** They are ordinary
   OKF Markdown files whose contents are authoritative. Investigation, plan,
   analysis, and strategy begin as document patterns, not separate object types.
   See [ADR-0022](./adr/0022-use-okf-markdown-for-the-first-growth-documents.md).
5. **Hosts provide document access.** Local and future Gesso hosts expose `ctx`
   for discovery and reading. Agents edit through OKF/document skills and host
   file tools; gkit adds no mandatory Workspace or Document CRUD. See
   [ADR-0025](./adr/0025-use-host-document-tools-instead-of-gkit-crud.md).
6. **Collaboration is asynchronous.** A fresh Agent in another session or host
   must be able to find, understand, and continue prior work without chat history.
7. **Reasoning stays external.** gkit does not embed a planner or autonomous
   loop. Growth Skills are Agent-consumed procedures. See
   [ADR-0019](./adr/0019-keep-sop-orchestration-in-external-agent-skills.md).

## Minimum behavior contract

```text
External Agent
  -> ctx read .
  -> read ./GROWTH.md and one relevant Growth Document
  -> inspect linked evidence or run a bounded Growth Capability
  -> distinguish observed facts from interpretation
  -> edit the Growth Document with evidence, conclusion limits, and next step
  -> later External Agent repeats the same entry path and continues
```

The vertical slice passes only when the later Agent can answer:

- What Product and growth question is this work about?
- What was actually observed, from which inspectable source?
- What remains interpretation or uncertainty?
- What is the next bounded action, and can it be continued without hidden chat
  context or an absolute path tied to the previous host?

## Existing implementation seam

The current repository already supplies useful execution pieces: offline
capability discovery, scoped provider reads, effect and spend gates, raw artifact
capture with byte count and SHA-256, and explicit dispatched/outcome uncertainty.
It does not yet implement Growth Workspace continuity. The first slice composes
these existing pieces with OKF documents rather than adding a new runtime.

## Local dogfood evidence

An isolated two-session dogfood in
`.scratch/growth-workspace-dogfood/` passed the local composition with friction:

- Session A created `GROWTH.md`, ran one aggregate-only PostHog read through the
  existing capability, retained the raw hashed artifact, and wrote an OKF Growth
  Document with an interpretation boundary and open question.
- A fresh ephemeral Session B began with `ctx read .`, recovered the work, used
  profile-free gkit discovery, dry-ran the next aggregate query, preserved the
  original artifact, and wrote the handoff into the same document.
- Copying the whole directory to a new path preserved `ctx` discovery, relative
  links, and artifact integrity.

This proves local cross-session continuation and directory portability. It does
not prove Gesso hosting, cross-machine profile provisioning, concurrent editing,
large-workspace retrieval, or provider identity semantics.

## Growth Workspace skill evidence

The local composition is now captured in the project-local
`.agents/skills/growth-workspace/` skill. Its contract is intentionally small:
enter through `ctx`, create only a root `GROWTH.md` and necessary documents,
preserve evidence provenance and interpretation limits, and finish with a
host-independent handoff check.

Three fresh ephemeral Codex sessions exercised creation, continuation of an
existing evidence-backed document, and continuation after relocating the whole
directory. All three implicitly selected the skill, entered through `ctx`, kept
evidence and interpretation separate, left one bounded next action, and created
no adapter, registry, profile map, database, or synchronization layer. The 15
file-level assertions passed. This is a with-skill behavioral check, not a
quantitative no-skill comparison; the earlier local dogfood remains the
qualitative baseline.

A later real PostHog dogfood closed the full local Evidence loop. One session
created and dry-ran a bounded aggregate week-over-week request, executed one
read-only live call, and retained the raw artifact. A fresh session entered only
through the Workspace, verified the request and artifact, recomputed the result,
directly answered the bounded question, marked it answered, and left one narrower
next action. No new gkit runtime was needed.

That run also exposed one behavioral requirement: the executing Agent must write
the dry-run plan and live receipt into the Growth Document before yielding. The
raw provider artifact proves its data but cannot independently prove that a
dry-run occurred. This requirement belongs in the Agent skill, not a new journal
or document service for the first slice.

The skill delivery boundary was then exercised with two isolated host Git roots.
In both, the Growth Workspace lived at `workspaces/acme/` and contained only
`GROWTH.md`, documents, and artifacts. The baseline host had no
`growth-workspace` installation; its fresh Agent did not invoke the skill and
initially used generic file discovery. The second host installed the identical
skill package at host-level `.agents/skills/growth-workspace`; its fresh Agent
automatically invoked the skill and entered the child Workspace through
`ctx read .` without the Workspace carrying a skill copy. This validates the
local host boundary for the then-current skill package.

The skill later added the confirmed `app_profile` selector and fail-closed
provider-entry behavior. A subsequent isolated host installed the current skill
source above a child Workspace whose `GROWTH.md` omitted that selector. A fresh,
read-only Agent invoked the host skill, entered through `ctx read .`, inspected
the linked document, and stopped before profile discovery, provider doctor, or
dispatch. A shadow `gkit` executable was not invoked. This closes the local
selector delta without a provider or network call. Remote `skill add`
installation remains pending until the repository publishes the skill source;
no custom installer is needed.

## Deferred, not part of the first slice

- Project Activity, Project Memory, Source Fact, and connector taxonomies;
- GitHub transport, labels, synchronization, or automatic Agent triggers;
- Gesso integration or a generic host adapter;
- document schemas beyond OKF's required `type` field;
- UUIDs, manifests, registries, profile mappings, databases, or revision services;
- realtime collaboration, CRDTs, presence, comments, permissions, and multi-writer
  synchronization;
- an autonomous planner, workflow engine, or cloud infrastructure.

ADRs 0017, 0018, and 0021 remain accepted constraints **if** those deferred
features are revisited. They do not make those features current product scope.

Gesso-specific validation waits for a released host. The current product boundary
does not require speculative integration work in the meantime.
