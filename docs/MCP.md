# KQA MCP server

This is how an agent operates a live interview: people, questionnaire files, answers, and the private-link email. It is not the Next.js development endpoint.

`/_next/mcp` exists only while `next dev` is running. It reports compiler errors and routes. It cannot see interviews, and it is not present in production. Do not point an agent at it.

Writing a questionnaire file is still [`AGENT_PLAYBOOK.md`](AGENT_PLAYBOOK.md), with the sourced design rules in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md). The public bundle at `/api/docs/bundle.md` is for that job. It is not a way to change live data.

## Connect

Stateless Streamable HTTP. One JSON-RPC request, one JSON response. There is no session and no long-lived stream.

| | |
|---|---|
| URL | `https://<your-host>/api/mcp` |
| Method | `POST` |
| Header | `Authorization: Bearer <key or KQA_MCP_TOKEN>` |
| Accept | `application/json, text/event-stream` |
| Body | A single JSON-RPC 2.0 message |

`DELETE` answers 405. This server does not open an SSE channel and does not keep a session. A call with no bearer answers 401 and points ChatGPT at the OAuth discovery documents.

ChatGPT connects to `https://<your-host>/api/mcp` with no pasted token. It discovers `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, then the host signs in and chooses Allow. That creates a key under Settings named after the app. The key is bound to the signed-in workspace. Revoke or delete the key to disconnect it. Other agents can use a workspace key or `KQA_MCP_TOKEN`.

Two credentials are accepted. The `KQA_MCP_TOKEN` environment variable is a tenant-bound service principal with full tool access that always operates in the legacy **Axion** workspace; a request cannot select a different tenant. A host can also create named keys under Settings. Each key is permanently bound to the signed-in workspace and has a name, a note, an optional expiry, a set of permissions, and a value. New named keys default to interview setup and aggregate-analysis read access. The host can grant only the capabilities the agent needs, and changes apply on the next request. The value is shown once. The database stores a SHA-256 hash plus a short fingerprint. A key can be revoked, restored, or deleted. Revoked, expired, and deleted keys are rejected.

### Credential permissions

`tools/list` returns only tools available to that credential, and the server checks permission again for every `tools/call`. Hiding a tool from the list is not the authorization boundary. `initialize` and `ping` remain available to any authenticated credential.

| Capability | Tools |
|---|---|
| `interviews:read` | `get_design_guidance`, `audit_questionnaire_design`, `list_interviews`, `get_interview`, `get_survey_html`, `list_versions`, `check_questionnaire`, `preview_questionnaire_version_patch` |
| `analytics:read` | `get_analytics_guidance`, `analyze_answers` |
| `respondents:read` | `list_people`, `get_person`, `get_answers`, `get_status`, `list_events`, `export_interview`, `get_mail_status` |
| `respondents:manage` | `add_people`, `update_person`, `remove_person`, `reopen_person`, `regenerate_link` |
| `interviews:manage` | `create_interview`, `update_interview` |
| `questionnaires:manage` | `apply_questionnaire_version_patch`, `upload_survey_version` |
| `email:send` | `send_invite` |
| `email:check` | `check_invite_delivery` |
| `interviews:delete` | `delete_interview` |

The `respondents:read` permission includes direct identifiers, private links, individual answers, and full interview exports; grant it only to agents that need respondent-level review. `interviews:delete` permanently removes an interview and related records. Existing named keys created before permissions were introduced retain full access until an owner edits them. Settings labels those credentials **Full access (legacy)** so owners can review and narrow them. OAuth connections currently request the broad `kqa` scope and start with all capabilities; an owner can narrow them in Settings. The Axion deployment token remains full access and is rotated through the deployment host.

Neither credential is the admin password, the session cookie, or a respondent link. Send it only in the Authorization header. A token in the query string is rejected. A missing bearer, the admin cookie, or a query-string token is HTTP 401 and does not touch the database. The server token is compared before any database call. Any other bearer is one lookup by hash. A failed lookup is the same HTTP 401.

A valid server token can read and write Axion data. An active key can read and write only its bound workspace. Anyone who has one can delete interviews in that workspace. Treat both like the session secret.

Locally the value lives in `.env` (gitignored). Production on Vercel needs the same name, plus `KQA_PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `IMAP_HOST`, and `IMAP_PORT`. Set those in the Vercel project. Do not paste the values into a chat, a doc, or a commit.

Example client entry (no secret in the file; the client reads the env var):

```json
{
  "mcpServers": {
    "kqa": {
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer ${KQA_MCP_TOKEN}" }
    }
  }
}
```

## What the tools do

Every tool uses the same bearer check and per-key capability check. Tool definitions include MCP read-only, destructive, idempotent, and external-world hints. Arguments are checked against the published schema before the tool runs: required fields, types, enums, and unknown fields. A string sent where an integer is required is rejected, and `list_events` rejects a limit below 1. An omitted `version` or `limit` still means the current version or the default of 30. Failures are a short error, not a stack trace. The questionnaire HTML is never put in an email. There is no score.

| Tool | What it does |
|---|---|
| `get_analytics_guidance` | Return versioned interpretation principles, a review checklist, and primary sources for descriptive survey analysis |
| `get_design_guidance` | Return KQA's versioned design principles, review checklist, and external sources for a product surface |
| `audit_questionnaire_design` | Run static questionnaire diagnostics and return the design review checklist; it does not render or certify the page |
| `list_interviews` | Host's interviews, open or closed, with people counts |
| `get_interview` | One interview and its question list. No HTML |
| `get_survey_html` | The stored file for a version |
| `list_versions` | Upload history without HTML |
| `check_questionnaire` | Run the checker. Nothing is stored |
| `create_interview` | Create from HTML. A failed check stores nothing |
| `update_interview` | Rename, notes, open, or close |
| `delete_interview` | Delete the interview, people, answers, and invite history. `confirmName` must match |
| `upload_survey_version` | Legacy upload for compatible changes; answer-impact findings return a signed preview and require acknowledgement |
| `preview_questionnaire_version_patch` | Check a complete candidate HTML file against the current version and saved answers; returns a short-lived token and stores nothing |
| `apply_questionnaire_version_patch` | Publish a previewed complete HTML file with a signed preview token, version/hash checks, and compatibility acknowledgement |
| `list_people` | People, optional email, status, progress, mail state, private link |
| `get_person` | One person |
| `add_people` | Add people to a multi-user interview. Email is optional |
| `update_person` | Name, optional email, private note. An empty email clears it |
| `remove_person` | Remove the person, their answers, and their invite history |
| `reopen_person` | Unlock a submitted person |
| `regenerate_link` | New private link. The old one stops working. Nothing is emailed automatically |
| `get_answers` | Answers for review, with the label a host would read. No score |
| `analyze_answers` | Current-version descriptive summaries with respondent scope, denominators, missingness, pagination, and optional side-by-side status groups from one scan; no raw text or score |
| `get_status` | Open or closed, and not started / in progress / submitted |
| `list_events` | Recent audit rows |
| `export_interview` | `json`, `csv-wide`, `csv-long`, `md`, or `xlsx` (base64) |
| `get_mail_status` | Stored invite result. Does not open the mailbox |
| `send_invite` | Email one person's private link. One message per call |
| `check_invite_delivery` | IMAP check of the message id KQA stored. `delivered`, `bounced`, or `unknown` |

`get_design_guidance` is a deterministic instruction package; KQA does not include or call an LLM. The questionnaire rubric also covers wording, response-option design, and respondent pretesting. These content checks require agent or human judgment and are not static checker findings. `audit_questionnaire_design` runs the same static checker used by uploads and returns the checklist for rendered review. Static diagnostics cannot verify question quality, contrast, layout, keyboard interaction, motion, or assistive-technology behavior.

`get_analytics_guidance` returns the versioned `kqa-analytics/5` package for an integrated agent. It describes how to scope and interpret the descriptive summaries, compare status cohorts from one scan, explain missingness and multi-select denominators, choose and code accessible charts, protect respondent privacy, and state limits on inference. Number summaries include Q1 and Q3 using Hyndman-Fan type 7, so a box plot can show the minimum-to-maximum range and quartiles; raw values and histogram bins are not returned. Dates and text are not aggregated. Each question page is a separate live read with its own `asOf`; pages do not form a consistent snapshot. It is guidance only: KQA does not generate or certify the downstream analysis.

For agent-authored questionnaire changes, call `preview_questionnaire_version_patch` with the complete candidate HTML. It returns the current version and base hash, a hash of the normalized candidate HTML, a hash of compatibility findings, static diagnostics, compatibility findings computed against the current survey and saved answers, and a signed `previewToken`. Preview is non-mutating. If it passes, call `apply_questionnaire_version_patch` with the same complete HTML, `expectedVersion`, `baseHash`, `candidateHash`, and `previewToken` from that preview. The token expires after 10 minutes and is bound to the authenticated tenant, interview, current version, base and candidate hashes, file name, and compatibility findings. If compatibility findings are present, also pass the preview's `compatibilityHash` and `acknowledgeCompatibilityImpact: true`. Apply verifies the token and reruns the checker and compatibility comparison on the server; it does not accept preview diagnostics or a client-supplied manifest. The server rejects a missing, expired, altered, or out-of-scope token; a stale version/base hash; changed candidate HTML or compatibility findings; failed static checks; missing acknowledgement; or a concurrent publish. A successful apply adds a new immutable version and preserves prior versions and answers. These tools treat questionnaire files as arbitrary HTML: they do not edit question markup or custom JavaScript on the agent's behalf.

`upload_survey_version` remains for compatible legacy uploads. It also runs the compatibility check and publishes through the same optimistic version guard. If the check finds answer-impact diagnostics (KQA700–KQA704), the call stores nothing and returns `currentVersion`, `baseHash`, `candidateHash`, `compatibilityHash`, a signed `previewToken`, diagnostics, and the checker report. Review that response, then retry the same HTML with the returned version and hashes, `previewToken`, and `acknowledgeCompatibilityImpact: true`. The token has the same 10-minute expiry and tenant/interview/candidate binding as the explicit preview token. The server verifies it and reruns the checks before publishing. Prefer the explicit preview/apply pair for agent-authored changes so the impact is visible before the publish call.

Compatibility findings are checked against the saved answers visible during each tool call. The preview returns a `compatibilityHash`; apply and acknowledged upload calls reject if the findings changed before the publish call. A response committed after the compatibility read in that same call is outside the calculated snapshot.

`analyze_answers` uses the current immutable survey version. By default it includes invited, in-progress, and submitted people; set `submittedOnly` to true or pass a `statuses` list to narrow the cohort. Set `compareStatuses: true` to return separate summaries for each selected status alongside the combined result. Those status groups are computed in one respondent scan and share the response's `asOf` time. This is one live read, not a frozen database snapshot. If `submittedOnly` and `statuses` are both supplied, `submittedOnly: true` can only be combined with `statuses: ["submitted"]`. KQA does not enforce a minimum cohort-size threshold, so singleton counts and percentages may be returned; integrated agents should disclose small-n limits and follow the host's disclosure rules. Use `questionId` for one question or `offset` and `limit` to page through questions. Each page is a separate live read with its own `asOf`; answer or status changes between calls can make pages differ. There is no historical time-window or trend analysis. `answeredCount` counts non-empty stored values, including values that no longer fit the current version; `unmappedResponseCount` reports those values, and they are excluded from valid numeric summaries and distributions. Missingness uses the eligible respondent count, and option distributions expose their valid-answer denominator. Scale questions report a distribution and median without a mean. Number summaries respect current minimum and maximum bounds and include Q1/Q3 calculated with the Hyndman-Fan type-7 sample quantile method. Text answers, names, notes, and private links are not returned.

`send_invite` refuses, and does not write a failed mail row, when the person has no email, the interview is closed, or `KQA_PUBLIC_URL` is unset. The link in the message is always `KQA_PUBLIC_URL` plus the token. Pass `resend: true` to send again to the same address and the same link. Changing the email or rotating the link clears the current "sent" state and does not send on its own.

`check_invite_delivery` takes a `personId` only. It connects to IMAP, searches for the stored message id, and disconnects. It will not search the mailbox for anything else. `unknown` is shown to the host as "Not confirmed yet."

Person status stays `invited` ("Not started") until they save an answer. A mail gateway prefetching the link does not count as an open.

## Deliberately absent

- Login and logout. The bearer token is the credential.
- Saving or submitting as the candidate.
- Reading the mailbox, listing messages, or searching for anything other than a message id this app stored.
- A score, an answer key, or a second email (no submission receipt, no mail to the host).
- The Next.js devtools at `/_next/mcp`.
