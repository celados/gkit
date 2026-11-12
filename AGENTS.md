# gkit Agent Instructions

## Product north star

gkit is a **headless, agent-native Growth Workspace**: a durable place where an
External Agent can find prior growth work, use bounded growth capabilities, and
leave trustworthy work for a later Agent to continue.

The continuity root is the Product's Growth Workspace, not an Agent session or a
Growth Project. A Growth Project is optional organization inside the Workspace.

## First product contract

- A portable Growth Workspace is a directory with one root `GROWTH.md` OKF file.
- `GROWTH.md` uses `type: GrowthWorkspace`, identifies the Product in
  human-readable form, declares one non-secret `app_profile` selector, and links
  to the important Growth Documents.
- Growth Documents are ordinary OKF Markdown files. Their contents are the source
  of truth.
- A fresh External Agent starts with `ctx read .`, reads `./GROWTH.md`, follows
  the relevant links, and can continue the work without relying on chat history.
- Agents edit documents with the relevant OKF/document skill and host file tools.
  gkit does not own Workspace or Document CRUD.
- Documents cite durable provider artifacts or other inspectable evidence and
  state the boundary between observed facts and Agent interpretation.

The same logical Workspace must remain portable between local and future Gesso
hosts. A host supplies storage, `ctx`, file editing, execution, and secrets; it
does not redefine Growth Workspace semantics.

The `growth-workspace` Agent skill is installed by the host, not copied into each
Growth Workspace. A Workspace remains portable data: `GROWTH.md`, Growth
Documents, requests, and referenced artifacts.

## Existing execution boundary

The repository currently implements an agent-first CLI and provider capability
runtime, plus a small project-local `growth-workspace` Agent skill that composes
the first document workflow. It does not yet implement the complete Growth
Workspace product.

- External Agents and Growth Skills own goals, orchestration, interpretation,
  and next-step judgment.
- The runtime owns capability discovery, profile scope, effects, authorization,
  provider dispatch, cost, artifacts, and explicit uncertain outcomes.
- One live operation binds one explicit App Profile. Cross-provider composition
  belongs to the External Agent.
- The Workspace supplies the App Profile selector; the host resolves its local
  profile and secrets. If the selector is absent, stop before provider doctor or
  dispatch. Never scan host profiles or infer one from the Product title.
- Discovery remains offline and must not resolve secrets. Live execution stays
  behind the existing capability and provider seams.
- Provider facts and artifacts are not conclusions. Agents must preserve their
  provenance and interpretation limits in Growth Documents.

## Complexity guardrail

For the first asynchronous vertical slice, do not add a document database,
private format, Workspace CRUD API, manifest, UUID, registry, multi-profile mapping,
host adapter, autonomous planner, workflow engine, CRDT, presence, comments,
permissions, cloud infrastructure, GitHub Connector, or Gesso integration.

Older accepted ADRs about Project Activity, Project Memory, Source Facts, and
connectors remain constraints if those features are revisited; they are not
current implementation scope and must not be pulled into the first slice.

Use [CONTEXT.md](./CONTEXT.md) for current canonical language and
[docs/adr](./docs/adr) for accepted architectural decisions.

## Local install after every change

On the user's machines `gkit` is the release bundle in `~/.local/bin`,
installed by the workspace `update-local-tool` skill. A change is not done when
it merges or releases. It is done when the user's local `gkit` runs it. The
user does not watch for this, so do it without being asked:

1. After the release workflow for your change succeeds, check whether the tool is
   installed: `command -v gkit`. If it is not, stop here.
2. Run `bash ~/workspace/.agents/skills/update-local-tool/update.sh gkit`. It prints `before -> after`.
3. Check your change with the installed binary, for example `gkit @schema` or the
   command you changed.
4. Put the `before -> after` line in your final report.

If the release failed, report that. Don't install a local build in its place.
