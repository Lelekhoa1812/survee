---
type: "query"
date: "2026-11-15T08:49:19.431633+00:00"
question: "Trace the login, signup, and password recovery routes through their shared account and session components in KQA."
contributor: "graphify"
outcome: "useful"
source_nodes: ["login/route.ts", "checkCredentials()", "createSession()", "verifySession()"]
---

# Q: Trace the login, signup, and password recovery routes through their shared account and session components in KQA.

## Answer

Expanded from graph vocabulary: [auth, cookie, create, email, login, password, route, session, token, verify]. Traversal connects POST login/route.ts to checkCredentials(), createSession(), and verifySession() in lib/auth.ts. The traversal did not surface signup or password-recovery route chains clearly enough to rely on; inspect those source files directly.

## Outcome

- Signal: useful

## Source Nodes

- login/route.ts
- checkCredentials()
- createSession()
- verifySession()