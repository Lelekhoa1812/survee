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

Two credentials are accepted. The `KQA_MCP_TOKEN` environment variable is a tenant-bound service principal that always operates in the legacy **Axion** workspace; a request cannot select a different tenant. A host can also create named keys under Settings. Each key is permanently bound to the signed-in workspace and has a name, a note, an optional expiry, and a value. The value is shown once. The database stores a SHA-256 hash plus a short fingerprint. A key can be revoked, restored, or deleted. Revoked, expired, and deleted keys are rejected.

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

Every tool uses the same bearer check. Arguments are checked against the published schema before the tool runs: required fields, types, enums, and unknown fields. A string sent where an integer is required is rejected, and `list_events` rejects a limit below 1. An omitted `version` or `limit` still means the current version or the default of 30. Failures are a short error, not a stack trace. The questionnaire HTML is never put in an email. There is no score.

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
| `upload_survey_version` | Replace the live file. A failed check stores nothing |
| `preview_questionnaire_version_patch` | Check a complete candidate HTML file against the current version and saved answers; stores nothing |
| `apply_questionnaire_version_patch` | Publish a previewed complete HTML file with version/hash checks and compatibility acknowledgement |
| `list_people` | People, optional email, status, progress, mail state, private link |
| `get_person` | One person |
| `add_people` | Add people to a multi-user interview. Email is optional |
| `update_person` | Name, optional email, private note. An empty email clears it |
| `remove_person` | Remove the person, their answers, and their invite history |
| `reopen_person` | Unlock a submitted person |
| `regenerate_link` | New private link. The old one stops working. Nothing is emailed automatically |
| `get_answers` | Answers for review, with the label a host would read. No score |
| `analyze_answers` | Current-version descriptive summaries with respondent scope, denominators, missingness, and pagination; no raw text or score |
| `get_status` | Open or closed, and not started / in progress / submitted |
| `list_events` | Recent audit rows |
| `export_interview` | `json`, `csv-wide`, `csv-long`, `md`, or `xlsx` (base64) |
| `get_mail_status` | Stored invite result. Does not open the mailbox |
| `send_invite` | Email one person's private link. One message per call |
| `check_invite_delivery` | IMAP check of the message id KQA stored. `delivered`, `bounced`, or `unknown` |

`get_design_guidance` is a deterministic instruction package; KQA does not include or call an LLM. `audit_questionnaire_design` runs the same static checker used by uploads and returns the checklist for rendered review. Static diagnostics cannot verify contrast, layout, keyboard interaction, motion, or assistive-technology behavior.

`get_analytics_guidance` returns the versioned `kqa-analytics/1` package for an integrated agent. It describes how to scope and interpret the descriptive summaries, explain missingness and multi-select denominators, choose charts, protect respondent privacy, and state limits on inference. It is guidance only: KQA does not generate or certify the downstream analysis.

For agent-authored questionnaire changes, call `preview_questionnaire_version_patch` with the complete candidate HTML. It returns the current version and base hash, a hash of the normalized candidate HTML, static diagnostics, and compatibility findings computed against the current survey and saved answers. Preview is non-mutating. If it passes, call `apply_questionnaire_version_patch` with the same complete HTML, `expectedVersion`, `baseHash`, and `candidateHash` from that preview. Apply reruns the checker and compatibility comparison on the server; it does not accept preview diagnostics or a client-supplied manifest. If compatibility findings are present, also pass `acknowledgeCompatibilityImpact: true`. The server rejects a stale version/base hash, changed candidate HTML, failed static checks, missing acknowledgement, or a concurrent publish. A successful apply adds a new immutable version and preserves prior versions and answers. These tools treat questionnaire files as arbitrary HTML: they do not edit question markup or custom JavaScript on the agent's behalf.

`analyze_answers` uses the current immutable survey version. By default it includes invited, in-progress, and submitted people; set `submittedOnly` to true or pass a `statuses` list to narrow the cohort. If both are supplied, `submittedOnly: true` can only be combined with `statuses: ["submitted"]`. Use `questionId` for one question or `offset` and `limit` to page through questions. `answeredCount` counts non-empty stored values, including values that no longer fit the current version; `unmappedResponseCount` reports those values, and they are excluded from valid numeric summaries and distributions. Missingness uses the eligible respondent count, and option distributions expose their valid-answer denominator. Scale questions report a distribution and median without a mean. Number summaries are descriptive and respect current minimum and maximum bounds. Text answers, names, notes, and private links are not returned.

`send_invite` refuses, and does not write a failed mail row, when the person has no email, the interview is closed, or `KQA_PUBLIC_URL` is unset. The link in the message is always `KQA_PUBLIC_URL` plus the token. Pass `resend: true` to send again to the same address and the same link. Changing the email or rotating the link clears the current "sent" state and does not send on its own.

`check_invite_delivery` takes a `personId` only. It connects to IMAP, searches for the stored message id, and disconnects. It will not search the mailbox for anything else. `unknown` is shown to the host as "Not confirmed yet."

Person status stays `invited` ("Not started") until they save an answer. A mail gateway prefetching the link does not count as an open.

## Deliberately absent

- Login and logout. The bearer token is the credential.
- Saving or submitting as the candidate.
- Reading the mailbox, listing messages, or searching for anything other than a message id this app stored.
- A score, an answer key, or a second email (no submission receipt, no mail to the host).
- The Next.js devtools at `/_next/mcp`.
