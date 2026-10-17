---
name: growth-workspace
description: >
  Use when an External Agent must create, enter, resume, move, or hand off a gkit Growth Workspace, or when a directory contains GROWTH.md. Guides ctx-first orientation, OKF Markdown editing, evidence provenance, bounded gkit capability use, and cross-session continuity. Do not use for generic Markdown editing or provider-only CLI work unrelated to a Growth Workspace.
---

# Growth Workspace

Make the current work continuable by a fresh External Agent without hidden chat
history. The Workspace files, not this session, are the source of continuity.

## Enter

1. Run `ctx read .` from the candidate Workspace directory.
2. Read `./GROWTH.md`; the `./` matters because `ctx` otherwise treats the name
   as a URL-like input.
3. Read the non-secret `app_profile` selector from `GROWTH.md`. Do not infer it
   from the Product title and do not scan host profiles. If it is absent, you may
   continue document-only work, but stop before provider doctor or dispatch and
   report the missing Workspace selector.
4. Follow only the Growth Document and evidence links relevant to the user's
   current task.

Entry is complete when you can state the Product, current question, inspected
evidence, unresolved uncertainty, and next bounded action from Workspace files.

## Create

Create a Workspace only when the user asks to create one. Do not silently turn an
arbitrary directory into a Growth Workspace.

Start with one root file and no manifest, UUID, registry, database, or profile map:

```markdown
---
type: GrowthWorkspace
title: [Product name] Growth Workspace
description: [One sentence describing the Product and growth scope]
app_profile: [explicit non-secret App Profile selector]
---

# [Product name] Growth Workspace

## Product

[What is being grown and for whom.]

## Current work

- [Growth Document title](documents/example.md) — [current question or status]

## Working rules

- Preserve inspectable evidence and distinguish it from interpretation.
- Leave a bounded next action for the next Agent.
```

Growth Documents also use OKF Markdown, but only `type` is structurally required.
Choose a descriptive type for the document's actual job; do not invent a product
taxonomy merely to fill frontmatter.

Do not invent the selector from the Product name. Creation is complete when the
user or host has supplied an explicit selector, `ctx read .` discovers
`GROWTH.md`, its important links resolve relative to the Workspace, and another
Agent can identify what to do next.

## Continue

Before editing, recover five things from the relevant Growth Document and its
links:

1. the bounded growth question;
2. the observed facts and their inspectable sources;
3. the Agent's interpretation of those facts;
4. the uncertainty that limits the interpretation;
5. the next action that would reduce that uncertainty.

When new provider evidence is needed, use the existing gkit capability surface:

1. Use the exact `app_profile` selector from `GROWTH.md`; never substitute a
   similarly named local profile.
2. Discover offline with `gkit --schema`, `gkit describe`, or `gkit docs`.
3. Run `gkit --profile <app_profile> <provider> doctor`. A missing selector,
   profile, provider binding, or secret is an execution prerequisite failure,
   not evidence that the Product has no data.
4. Dry-run the exact operation before live dispatch.
5. Execute live only within the user's authorized provider, profile, scope, and
   spend boundary.
6. Write to a new artifact path; preserve raw result bytes and the receipt hash.
7. Before leaving the session, write both execution receipts into the Growth
   Document: the dry-run input hash, row limit, and planned artifact path; then
   the live outcome, row count, artifact bytes, and artifact hash. A raw artifact
   alone does not prove that the dry-run happened.
8. Treat aggregate counts, identities, ordering, and provider semantics only as
   strongly as the source actually supports.

Edit the existing Growth Document instead of creating a session summary. Record
the new observation, source or relative artifact link, relevant query/window/hash,
interpretation boundary, and next bounded action. Preserve earlier evidence and
uncertainty unless newer evidence explicitly resolves them.

Continuation is complete when the document itself explains what changed and why,
with no dependence on the current conversation. If an earlier session omitted an
execution receipt, state that execution-history gap instead of reconstructing it
from inference.

## Handoff check

From the Workspace root:

- `ctx read .` finds the Workspace and edited document;
- `ctx read ./GROWTH.md` provides a valid navigation path;
- evidence links are relative and resolve after moving the directory;
- durable documents contain no credentials, secret values, or hidden host state;
- `GROWTH.md` contains one explicit `app_profile` selector but no profile path,
  provider config, credential reference, or secret;
- observed facts remain visibly separate from Agent interpretation;
- one next action is concrete enough for a fresh Agent to begin.

The handoff is complete only when every check passes.
