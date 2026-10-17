---
name: prepare-customer-feedback-outreach
description: Prepare, safely execute when separately authorized, and evaluate evidence-grounded customer feedback outreach by combining authoritative Product eligibility, bounded PostHog behavior context, and Gmail history. Use when an Agent must investigate users who submitted, paid, unlocked, or stalled; decide who is suitable to contact; draft or send an approved feedback email; inspect replies; or evaluate later outcomes. Default to read-only research and local drafts—never create a Gmail draft or send without the corresponding explicit authorization.
---

# Prepare Customer Feedback Outreach

Produce a small, reviewable outreach batch whose eligibility, personalization,
and later outcome remain inspectable. Treat this as customer research with a
possible growth effect, not bulk email automation.

## Enter the work

1. If the current directory is a Growth Workspace, enter through `ctx read .`,
   read `./GROWTH.md`, and use its exact `app_profile` selector.
2. Recover the bounded question, existing evidence, uncertainty, authority, and
   next action from the relevant Growth Document.
3. Stop before provider calls when the Workspace lacks an explicit selector.
4. Create or update one Growth Document for the outreach Case. Do not create a
   CRM, campaign database, scheduler, or workflow engine.

## Build the evidence stack

Keep the three sources distinct:

- Use the Product backend as truth for identity, request, order, payment,
  unlock, fulfillment, exclusions, and prior contact eligibility.
- Use PostHog only for observed behavior context such as acquisition source,
  relevant page or feature use, funnel progress, and recency. Never use an
  analytics event as payment or entitlement proof.
- Use Gmail for communication history, drafts, sends, and replies. Never treat
  a Gmail search miss as proof that no contact occurred elsewhere.

Freeze a bounded audience snapshot before per-user research. Record its query
or command, as-of time, inclusion and exclusion rules, row limit, artifact
receipt, and unresolved identity gaps. Keep raw email addresses and message
bodies out of durable Markdown when stable business references or restricted
artifacts suffice.

## Inspect PostHog behavior

1. Discover the current capability offline with
   `gkit describe --id posthog.query.run` or `gkit docs --provider posthog`.
2. Run `gkit --profile <app_profile> posthog doctor`.
3. Prepare one bounded, read-only HogQL request for the frozen audience or one
   selected user. Join identities only through a verified Product mapping.
4. Dry-run the exact request before its live call and write each result to a new
   artifact path.
5. Record both receipts in the Growth Document: dry-run input hash, row limit,
   and planned path; then live outcome, rows, bytes, and artifact hash.
6. Separate observed events from interpretations. State missing events, lossy
   identity links, timezone, and query window explicitly.

Treat a zero-row identity query as an unresolved join, not proof of inactivity.
Recheck the Product's verified analytics identity and, when necessary, compare a
small frozen set of verified identities without expanding to fuzzy matching.

Use behavior to choose a relevant question, not to reveal surveillance. Do not
write phrases such as "I saw you visit Billing three times." Prefer a natural
question about the likely task or obstacle, and lower confidence when evidence
supports multiple explanations.

## Inspect Gmail context with `gws`

1. Run `gws auth status`; require `token_valid: true` in its output and do not
   rely on exit code alone. Stop if Gmail access is not ready. A method
   `--dry-run` may still require a valid OAuth token.
2. Discover commands with `gws gmail users messages list --help` and the exact
   method help needed next. Do not guess flags or request bodies when discovery
   fails.
3. Search a narrow mailbox window with `userId: "me"`, an exact recipient when
   available, and a small `maxResults`. Avoid mailbox-wide export.
4. Check direct sent and received correspondence separately, then search the
   exact address anywhere in the mailbox to catch internal notifications that
   mention it in their body. Classify those notifications instead of treating
   every address match as customer contact.
5. Read only the minimum message metadata or thread content needed to prevent a
   duplicate, contradicting, or tone-deaf outreach.
6. Preserve provider IDs and a restricted raw artifact when necessary; write
   only a redacted communication summary into the Growth Document.

Gmail reads do not authorize drafts, and drafts do not authorize sends. Without
explicit user authorization, return sendable copy or create no more than a
reviewable local draft. Never call a Gmail send method implicitly.

## Send only after separate authorization

Treat send authorization as one exact message to one reviewed recipient or one
explicitly approved batch. It does not follow from research, copy approval, or
Gmail draft creation.

Before sending:

1. Re-read the approved copy and confirm the recipient, subject, and body are
   non-empty and unchanged.
2. Refresh Product eligibility or the relevant support state and recheck the
   exact Gmail thread. Stop on a refund, suppression, active support conflict,
   duplicate send, or material state change.
3. Prefer an existing Gmail thread when replying. Preserve its subject,
   `threadId`, `In-Reply-To`, and `References` headers.
4. Run the exact Gmail send request as a dry-run before one live call. Do not
   expose access tokens or raw MIME in durable documents.
5. If the live result times out or is otherwise uncertain, search the intended
   thread and recipient before any retry. Never retry an uncertain send blindly.
6. Read back the returned message and require the intended recipient, subject,
   thread, and `SENT` label. Record `sent` separately from delivery, bounce,
   reply, unsubscribe, complaint, and later Product outcome.
7. Delete temporary plaintext or MIME files after confirmation.

When a specialized drafting skill is draft-only, keep sending outside that
skill. A user may separately authorize this workflow to send the already
reviewed copy; do not reinterpret the drafting skill's authority boundary.

## Produce the outreach brief

For each selected recipient, write a compact brief containing:

```yaml
recipient_ref: <stable business reference>
eligibility:
  observed: <authoritative Product facts>
  exclusions_checked: <dedupe, support, refund, internal, recent contact>
behavior_context:
  observed: <bounded PostHog facts>
  interpretation: <possible mechanism, not asserted truth>
  confidence: low | medium | high
gmail_context:
  observed: <relevant prior-contact fact or none found in searched scope>
email_strategy:
  objective: <one learning objective>
  primary_question: <one easy-to-answer question>
  avoid_claiming: <unsupported or overly revealing claims>
authority:
  draft: allowed | requires approval
  send: requires explicit approval
```

Draft a short, personal email with one primary question. Do not imply that
payment automatically repairs a clone or promise unverified product behavior.

## Evaluate and hand off

Track eligible, selected, drafted, sent, delivered when verifiable, replied,
feedback themes, later Product outcome, unsubscribe, and complaint separately.
Do not claim incremental conversion without a credible counterfactual. Treat
post-payment feedback as evidence for fulfillment, retention, referral, or a
later pre-payment intervention—not as a cause of the completed payment.

Update the existing Growth Document with observed facts, artifact links,
interpretation limits, decision, and one bounded next action. Confirm that a
fresh Agent can continue without chat history or host-specific secret paths.
