---
type: "query"
date: "2026-11-23T22:05:57.159233+00:00"
question: "Trace the questionnaire authoring flow, including current-version editing paths and publication safeguards, and identify high-value gaps."
contributor: "graphify"
outcome: "useful"
source_nodes: ["NewInterview.tsx", "SurveyTab.tsx", "versions/route.ts", "Updating an existing questionnaire"]
---

# Q: Trace the questionnaire authoring flow, including current-version editing paths and publication safeguards, and identify high-value gaps.

## Answer

Expanded from original query via graph vocabulary: [authoring, editor, patch, preview, questionnaire, question, version, survey]. The map shows an in-app composer for new questionnaires in NewInterview, immutable stored survey versions, and live-version replacement in SurveyTab through upload, checker/live probe, signed preview, compatibility review, and guarded publication. Existing stable-ID visual editing is absent; the safe pathway is HTML editing and candidate upload. A practical smaller usability gap is source-file recovery: restore is candidate-only and not an obvious current-version download flow.

## Outcome

- Signal: useful

## Source Nodes

- NewInterview.tsx
- SurveyTab.tsx
- versions/route.ts
- Updating an existing questionnaire