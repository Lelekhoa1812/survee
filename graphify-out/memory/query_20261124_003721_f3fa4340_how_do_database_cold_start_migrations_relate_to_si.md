---
type: "query"
date: "2026-11-24T00:37:21.602800+00:00"
question: "How do database cold-start migrations relate to signup writes, analytics consistency, respondent deletion, and export limits?"
contributor: "graphify"
outcome: "dead_end"
source_nodes: ["repo/index.ts", "answers.ts", "xlsx.ts"]
---

# Q: How do database cold-start migrations relate to signup writes, analytics consistency, respondent deletion, and export limits?

## Answer

Expanded from graph vocabulary: [answers, interview, participant, write]. The broad graph links answer handling and participant repository flows to export modules, but its traversal was too broad to establish the analytics consistency boundary; source inspection is needed for the route-level revision check.

## Outcome

- Signal: dead_end

## Source Nodes

- repo/index.ts
- answers.ts
- xlsx.ts