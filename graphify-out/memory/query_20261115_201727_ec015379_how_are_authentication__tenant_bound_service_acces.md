---
type: "query"
date: "2026-11-15T20:17:27.996425+00:00"
question: "How are authentication, tenant-bound service access, key permissions, questionnaire MCP editing, and analytics guidance connected in KQA? Query expansion: admin auth authorization guard session key mcp tool response survey questionnaire design."
contributor: "graphify"
outcome: "useful"
source_nodes: ["guardAdmin()", "SESSION_COOKIE", "authorizationServerMetadata()", "mcp/http.ts", "tools.ts", "survey.ts", "AI agent playbook: write a KQA questionnaire", "AdminNav.tsx"]
---

# Q: How are authentication, tenant-bound service access, key permissions, questionnaire MCP editing, and analytics guidance connected in KQA? Query expansion: admin auth authorization guard session key mcp tool response survey questionnaire design.

## Answer

Useful traversal found a concise cross-cutting set of implementation anchors: guardAdmin() and SESSION_COOKIE for admin auth; oauth.ts and tools.ts for MCP auth and capabilities; survey.ts and the AI agent playbook for questionnaire behavior; and AdminNav.tsx for the admin surface. Follow-up source audits are still required for current tenant isolation and no-cohort-threshold analytics behavior.

## Outcome

- Signal: useful

## Source Nodes

- guardAdmin()
- SESSION_COOKIE
- authorizationServerMetadata()
- mcp/http.ts
- tools.ts
- survey.ts
- AI agent playbook: write a KQA questionnaire
- AdminNav.tsx