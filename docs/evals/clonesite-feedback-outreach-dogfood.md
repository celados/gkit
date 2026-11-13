---
type: Evaluation
title: Clonesite founder feedback outreach dogfood
description: >
  Redacted evaluation of a Product, Gmail, and PostHog workflow for selecting,
  contacting, and learning from paid Clonesite customers.
status: conditional-pass # conditional-pass | passed | failed
version: 1.0
generated: { by: codex/gpt-5, at: '2026-08-14T21:30:00+08:00' }
tags: [gkit, growth-workspace, gmail, posthog, clonesite, dogfood]
---

# Clonesite Founder Feedback Outreach Dogfood

## Evaluation question

Can an External Agent use authoritative Product state, bounded PostHog behavior,
and Gmail history to prepare and safely execute useful founder outreach without
building a campaign system or relying on chat history?

## Verdict

Conditional pass. The workflow produced a reviewable audience, prevented unsafe
contacts, supported 12 explicitly authorized sends, verified Gmail send state,
and turned the first customer reply into a concrete Product question. It has not
demonstrated incremental conversion, delivery for every message, or a repeatable
commercial outcome.

## Scope and authority

- Product and provider reads were bounded and read-only.
- Gmail drafts and sends required separate explicit user authorization.
- Raw customer identifiers, message bodies, provider responses, and receipts
  remained in a restricted ignored Growth Workspace.
- This document contains only aggregate or generalized evidence.
- No scheduler, campaign database, autonomous planner, or bulk-send system was
  created.

## Observed evidence

- A frozen Product audience contained paid clone tasks with ready previews and
  no active source license under the evaluated policy.
- Gmail history found a Product-eligible candidate with a prior refund request
  and operator confirmation. The candidate was excluded, proving that Product
  eligibility alone was insufficient for safe outreach.
- PostHog behavior helped select a relevant question, but zero-row identity
  queries were treated as unresolved joins rather than inactivity.
- Twelve reviewed messages were sent in three small batches after explicit user
  authorization. Gmail readback found the expected recipient, subject, thread,
  and `SENT` label for the inspected messages.
- A bounded mailbox check found no obvious bounce at that observation time. This
  was not proof of delivery.
- The first reply said the visual preview was accurate but exposed a mismatch
  between what the customer believed the payment included and the later source
  access path. The founder follow-up acknowledged the confusion and asked which
  checkout wording or visibility boundary created the expectation.

## Reusable workflow

1. Enter a Growth Workspace through `ctx read .` and its root `GROWTH.md`.
2. Freeze a Product-owned audience with explicit inclusion, exclusion, time,
   limit, and dedupe rules.
3. Use Gmail direct history as a hard safety layer for refunds, support
   conflicts, duplicate founder follow-ups, and existing relationships.
4. Use PostHog only as bounded behavioral context through Product-verified
   identities. Never use it as payment, entitlement, or fulfillment truth.
5. Write one founder question that can reduce one uncertainty. Include the full
   Product-owned preview URL in new feedback outreach.
6. Mention hands-on SEO/GEO briefly in every initial outreach email without
   implying observed search intent or guaranteed rankings. Add migration or
   hosting only when the customer's source platform or goal supports it.
7. Separate research, local copy, Gmail draft, and send authorization. Before a
   live send, recheck current Product and Gmail state and dry-run the exact
   request.
8. On an uncertain send result, read back the intended thread before retrying.
   After success, verify `SENT` and keep delivery and reply as separate facts.
9. Treat replies as Product research: acknowledge first, avoid defending the
   model, and ask one question that locates the expectation or handoff gap.
10. Record evidence, interpretation limits, decisions, and one bounded next
    action in the existing Growth Document.

## Acceptance gates

| Gate            | Passing evidence                                                                         |
| --------------- | ---------------------------------------------------------------------------------------- |
| Eligibility     | Product state supports the selected cohort and exclusions                                |
| Contact safety  | No refund, suppression, active support conflict, or duplicate direct thread              |
| Personalization | PostHog context is bounded, identity-grounded, and not exposed as surveillance           |
| Copy            | One primary question, founder voice, verified preview URL, truthful service scope        |
| Authority       | Draft and send permissions are explicit and separate                                     |
| Send            | Intended recipient, subject, thread, and `SENT` label read back from Gmail               |
| Evaluation      | Reply, bounce, complaint, later Product outcome, and service interest tracked separately |

## Product findings, not workflow facts

- One historical audience policy had an obsolete exact-price gate. A source fix
  existed during the dogfood, but its intended deployment identity was not
  verified here.
- Product-only eligibility missed at least one refund/support exclusion that
  Gmail history caught.
- One customer reply suggests the checkout and source-access model can create a
  payment expectation mismatch. One reply is enough to justify investigation,
  not enough to quantify prevalence or prove a specific UI cause.

## Reusable assets

- [Prepare customer feedback outreach](../../.agents/skills/prepare-customer-feedback-outreach/SKILL.md)
- [Draft Clonesite founder email](../../.agents/skills/gws-draft-clonesite-founder-email/SKILL.md)
- [Growth Workspace continuity skill](../../.agents/skills/growth-workspace/SKILL.md)

## Next evaluation

Verify the relevant Product deployment before freezing another cohort. For the
existing sends, observe replies, bounces, complaints, later source unlocks, and
service interest as separate outcomes. Use a new Growth Case for a different
cohort instead of copying restricted customer data from the first run.
