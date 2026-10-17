---
name: gws-draft-clonesite-founder-email
description: Draft personal founder emails and customer replies for Clonesite and ExportFramer, grounded in verified Product eligibility, bounded PostHog behavior, Gmail history, and the current service offer. Use when an Agent must ask for feedback, recover a stalled paid clone, follow up after delivery, respond to product or payment feedback, or introduce relevant Webflow/Framer migration, managed hosting, CMS-content migration, SEO, or GEO help. This skill is draft-only—create a Gmail draft only after explicit draft authorization and hand any separately authorized send to the outreach execution workflow.
---

# Draft Clonesite Founder Email

Write one useful founder email, not a catalog of services. Keep Product facts,
behavior evidence, communication history, and commercial interpretation visibly
separate until the final copy is grounded.

## Establish the recipient context

1. Use `$prepare-customer-feedback-outreach` when eligibility, PostHog behavior,
   or prior Gmail contact has not already been verified.
2. Identify one stable Product recipient reference, one reason to contact, one
   learning or recovery objective, and the authority boundary.
3. Resolve the recipient's current Product-owned preview URL. Include that URL
   in every feedback outreach email so the recipient can identify the relevant
   result. Use the full `preview.clonesite.ai` URL without tracking parameters;
   place it immediately before the primary question and never invent or shorten
   a missing URL. Do not repeat it in an in-thread reply when the thread already
   establishes the relevant result.
4. Refresh time-sensitive eligibility and confirm that the preview URL is still
   usable before creating a Gmail draft. Do not use
   PostHog as payment, entitlement, delivery, or source-license truth.
5. Search direct sent and received Gmail history with a small exact query. Also
   classify internal notifications that merely mention the address.
6. If the email may later be sent, inspect 3-5 recent founder-written customer
   emails when available and summarize tone without copying customer content
   into durable documents.

## Select one relevant offer

Read [references/offer-context.md](references/offer-context.md) before mentioning
Clonesite, ExportFramer, managed hosting, CMS, SEO, or GEO.

Choose the narrowest offer that matches observed customer intent:

- Use **feedback only** when evidence does not support a relevant service.
- Mention **managed migration and hosting** when a Webflow or Framer customer
  appears concerned with ownership, hosting, handoff, or keeping the current
  site live.
- Mention **Clonesite custom rebuild** when the site needs ongoing editing,
  living CMS behavior, forms, integrations, or maintainable application code.
- Mention **SEO/GEO delivery in every outreach email** as one short, optional
  capability after the primary feedback question. Keep it subordinate to the
  reason for contact, scope it as hands-on work, and never imply guaranteed
  rankings or observed search intent.

Do not mention every offer by default. Every email includes the light SEO/GEO
line above; add at most one other adjacent offer when Product or behavior
evidence makes it relevant.

## Write in Deniffer's founder voice

Use first person, warm and direct language:

```text
Hi <first name>,

I'm Deniffer, founder of Clonesite.

<one sentence showing why this email is relevant without exposing tracking>
<full Product-verified preview URL on its own line>
<one easy-to-answer primary question>

<optional one- or two-sentence relevant service offer>

Just reply directly — I read every response.

Deniffer
Founder, Clonesite
```

Keep the email short enough to read without scrolling. Avoid surveillance
phrasing such as listing pages the recipient visited. Translate behavior into a
natural question and lower certainty when several explanations fit.

Do not claim automated Webflow export, live CMS synchronization, guaranteed
pixel perfection, guaranteed rankings, automatic repair after payment, or any
scope not verified for that customer. Prefer "we can help migrate" and "within
the scope we agree" over "everything will stay exactly the same."

## Turn replies into product learning

When a customer replies with confusion, disappointment, or a changed decision:

1. Acknowledge the customer's experience without defending the product or
   asserting an unverified cause.
2. Reflect the useful observed fact, such as a good preview or a failed handoff,
   while naming the unresolved expectation gap.
3. Ask one easy-to-answer question that locates the gap in a page, button,
   wording, price, or handoff step. For a payment-versus-source mismatch, ask
   whether checkout implied source was included or failed to show the separate
   source unlock clearly enough.
4. Say that the goal is to fix the confusing part, not to reverse the customer's
   decision. Do not offer a refund, free source, discount, or delivery promise
   without separate authority.
5. Do not repeat the SEO/GEO offer in a support or learning reply when the
   original outreach already mentioned it.

Keep the response short and in the existing Gmail thread. Draft it first; this
skill still does not authorize sending.

## Review before creating a Gmail draft

Return the proposed email in this exact shape first:

```gmail-draft
{
  "to": ["recipient@example.com"],
  "cc": [],
  "bcc": [],
  "subject": "One clear subject",
  "body": "Complete plain-text body"
}
```

State which facts came from Product truth, PostHog, Gmail, the public offer, and
owner-confirmed custom service scope. Flag any unresolved claim that would
change the email.

## Create, never send

Create a Gmail draft only when the user explicitly asks to create or save the
draft. Draft authorization does not authorize sending.

1. Run `gws auth status` and require `token_valid: true` for the intended
   Workspace mailbox.
2. Recheck direct Gmail history, current Product eligibility, and preview URL.
3. Write the approved plain-text body to a restricted temporary file.
4. Run
   `scripts/create_gws_draft.py --to <email> --subject <subject> --body-file <path>`.
5. Read back the returned draft ID and message ID. Report only that the draft
   exists; do not call any Gmail send method.

Use `--dry-run` while validating the request construction. Delete temporary
plaintext after the draft result is confirmed. Never print access tokens, raw
MIME, or unrelated mailbox content.

## Preserve the result

When operating inside a Growth Workspace, update the existing Growth Document
with the recipient reference, evidence boundaries, approved copy, draft receipt
when one exists, and the next decision. Keep raw addresses and message bodies in
restricted artifacts rather than durable shared Markdown when possible.
