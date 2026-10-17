---
type: GrowthAnalysis
title: Activation event baseline
description: Aggregate event evidence for the first activation question.
---

# Activation event baseline

## Question

Which observed events should be investigated next as possible activation signals?

## Observed evidence

The aggregate export records 1,240 `page.viewed` events, 118
`signup.completed` events, and 42 `workspace.created` events during 2026-08-01
through 2026-08-07 UTC.

Source: [raw aggregate counts](../artifacts/event-counts.json)

Recorded SHA-256:
`52fd54b54c7a244aecba770e4946a4bc546b26704e983fe24df4b1fed2ab3d17`

## Interpretation boundary

These are event totals, not unique users or an ordered funnel. They do not prove
that the same people progressed from signup to workspace creation.

## Open question

Can an aggregate query grouped by a documented stable identity establish the
ordered signup-to-workspace path without exposing person-level data?

## Next action

Confirm the provider's supported identity semantics before designing that query.
