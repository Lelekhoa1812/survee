# System review

**Reviewed:** 23 November 2026  
**Scope:** repository, product flows, automated tests/build, production HTTP and MCP behavior, and recent Vercel runtime error clusters.  
**Status:** active review snapshot; this is not a security certification or a claim that every roadmap item is complete.

## Current assessment

The core interview lifecycle is in good shape for bounded, host-run questionnaire collection. The app validates questionnaires, isolates respondent links, retains recoverable drafts, supports routing and repeat records, separates respondent-level analytics from repeat rows, offers multiple export formats, and protects MCP operations with credential-scoped capabilities. The automated suite and production build are healthy.

The largest remaining risks are operational durability and scale: outbound mail can have an ambiguous result after a provider accepts it, individual respondent payloads can grow with questionnaire size, full exports remain in-memory and capped, and uploaded assets have no workspace quota. Governance features are also host-dependent: consent notices, retention, withdrawal, and deletion schedules are not first-class workflows. A schema-backed questionnaire builder and scheduled campaign tools would materially improve adoption, but they need product design beyond a small repair.

## Shipped during this review

The following changes are pushed to `main` and deployed:

- Oversized respondent saves preserve the last valid draft.
- MCP request and schema validation reject malformed, oversized, hostile-origin, and unsupported requests.
- Repeat records are present in Excel/JSON and readable Markdown exports; CSV omissions remain disclosed.
- Relay-based DSN results remain unconfirmed rather than being reported as delivered.
- Respondent deletion removes associated mail history transactionally.
- Asset deletion now checks the confirmed name and public ID at the atomic delete, preventing a concurrent rename from defeating confirmation.
- Invite sends, workspace invites, and delivery checks have atomic per-person/recipient/workspace limits and fail closed when the rate-limit store is unavailable.
- IMAP checks and logout cleanup have bounded deadlines; timeouts retain the existing `unknown` result.
- Authentication distinguishes invalid/revoked sessions (401) from account-store outages (503 on API/frame routes).
- Audit event write failures produce sanitized operational logs, and unknown MCP tool attempts enter the audit path.
- Participant invite attempts are durably recorded as pending before SMTP; ambiguous outcomes block ordinary retries, an on-demand IMAP check can resolve a matching delivery-status notice, and explicit resend warns of possible duplicates.
- Active workspace invitation links no longer rotate on repeated requests or concurrent sends; SMTP ambiguity leaves the invitation active, with revoke-before-replacement behavior shown in settings.
- Workspace invitation attempts persist their exact Message-ID before SMTP; hosts can check that id for delivery-status evidence with per-invitation and workspace throttles.
- The host People list, host Answers matrix, and MCP people/status/mail-status reads paginate in bounded cursor pages. MCP interview-wide answer reads page through bounded 50-row results (maximum 100) and apply `submittedOnly` in the database query; full exports remain capped at 100. Targeted MCP answer reads load one tenant-scoped person.
- A rejected cold-start Mongo connection now clears only its own cached promise so a warm worker can retry when the database recovers.
- Published questionnaire assets and asset deletion now share a transactional coordination point; a concurrent deletion cannot leave a newly published version pointing at a missing image.
- Preview-draft saves now touch referenced assets in a transaction, coordinating draft creation and reclamation with asset deletion.
- Respondent deletion now erases linked activity events and stale analytics runs, including legacy event/mail rows without a tenant field. Deletion, invitee additions, and reopening submitted answers increment the respondent revision in their transaction.
- Paged analytics cache creation now fences against concurrent respondent writes and questionnaire publication. A stale scan returns `analysis_run_stale` rather than caching results after a conflicting change.
- Public accessibility auditing now checks for an `h1` in each questionnaire document while allowing the respondent shell to identify its embedded questionnaire through the iframe title.
- Public respondent load, frame, save, and submit APIs now have separate hashed per-link and per-Vercel-IP rate limits; an unavailable shared limiter fails closed with 503.
- Host Overview and People pages now retain progress counts but omit answer, repeat-record, and order-history payloads; assignment history is not queried until the Answers tab loads.
- The host Answers matrix now pages through respondents using the same bounded cursor contract as the People list.
- Settings now shows tenant-scoped workspace image count and aggregate stored bytes; the app still does not enforce a workspace quota.
- Adding more than 100 people in one request is now rejected atomically at the host API and MCP boundaries. The host dialog no longer truncates oversized pasted lists silently and directs hosts to split them into batches.
- Questionnaire publication guidance labels its answer count as the first loaded respondent page, avoiding an implied interview-wide total for larger interviews.

## Ranked remaining gaps

| Priority | Gap | Impact | Recommended next step |
| --- | --- | --- | --- |
| P1 | **Outbound mail reconciliation is partial.** Participant and workspace sends persist Message-IDs before SMTP and suppress silent token rotation/retry. Hosts can perform rate-limited IMAP checks for exact stored IDs. Attempts without a matching delivery-status notice can remain unknown indefinitely. | Hosts still need a duplicate-risk decision for an ambiguous participant invite; an IMAP status check cannot prove delivery when the mailbox has no matching notice. | Add provider delivery webhooks or an explicit host resolution workflow for pending attempts, with audit history and duplicate-send warnings. |
| P1 | **Full exports are capped by people, not by bytes.** The host People list, answer matrix, and MCP people/status/mail-status and interview-wide answer reads use bounded cursor pages. `submittedOnly` is applied in the database. Full exports stop at 100 people, but a capped cohort can still contain very large answer and repeat-record payloads; CSV, Markdown, JSON, and XLSX materialize several arrays/buffers, and MCP embeds the full file body in its response. | Hosts cannot export more than 100 people, and a high-volume questionnaire can still consume large memory and response payloads below that cap. | Add explicit input/output byte bounds, then stream host CSV/JSON or create background export artifacts. Keep MCP responses byte-bounded and direct larger exports to host downloads. |
| P1 | **Asset storage has no workspace quota.** Settings now shows workspace image count and bytes. Publication, preview-draft saves, and deletion coordinate transactionally, preventing a concurrent draft or publish from committing a dangling image URL. | Aggregate storage costs can grow without a tenant bound. | Define and enforce a configurable workspace quota, including the policy for existing over-quota workspaces. |
| P1 | **Consent, retention, and withdrawal rely on host procedures.** The app stores person-linked answers and supports manual deletion, but it does not manage notice versions, consent records, retention windows, or respondent withdrawal. | Hosts can collect data without a consistent in-product record of the notice or planned deletion. | Design a versioned notice and optional consent gate, plus workspace-configured retention, dry-run review, audited deletion, and a respondent withdrawal route. Avoid legal defaults; make policy owner-configurable. |
| P2 | **The connected KQA `list_people` tool cannot continue its returned cursor.** The exposed tool accepts only `interviewId`, although the server returns `nextCursor` and supports `cursor`/`limit`. A 51-person disposable interview returned the same 50 person IDs on a repeated connected-tool call with the cursor supplied. | Hosts using this connected tool surface can repeatedly read only the newest 50 people; the app's own MCP endpoint has cursor support. | Expose `cursor` and `limit` in the connected-tool schema and verify that consecutive calls return disjoint pages through the final row. |
| P2 | **Questionnaires require HTML authoring.** There is no in-app builder for the supported question types and routing. | Non-technical hosts must source or edit files to create and revise a questionnaire. | Build a schema-backed editor with HTML import/export, checker diagnostics, live preview, accessibility states, and version diff/publish review. |
| P2 | **Campaign operations are mostly manual.** Hosts refresh progress and resend/check invitations manually; there are no scheduled reminders or completion notifications. | Follow-up work and response monitoring do not scale well across larger cohorts. | Add optional close dates, rate-limited reminders for eligible non-submitters, and owner-configured completion/failure notifications with audit history. |
| P2 | **Recovery assurance is not verifiable in the repository.** Tenant migration requires backup confirmation, but there is no documented restore drill or tested recovery objective. | A correct backup schedule is not proof that data can be restored in time. | Document the configured backup schedule/retention, define RPO/RTO, and run a periodic restore exercise with evidence. |
| P2 | **Cold-start database setup still includes data migration and DDL work.** Index setup can scan and deduplicate pending-signup records when a unique index is absent, while each new serverless isolate may repeat the scan and index setup. | A large legacy collection can increase cold-start latency and memory during scale-out; the runtime database credential also needs index and data-cleanup privileges. | Move data cleanup into a bounded, resumable migration with progress/locking; leave runtime index checks lightweight and use a narrower runtime database role. |
| P2 | **Tenant backfill has no cross-invocation lock or progress checkpoints.** The migration is retry-friendly and only fills missing tenant IDs, but it runs collection-wide updates sequentially and verifies afterward. | Concurrent runs can repeat expensive scans, and a partial run has no visible per-collection progress for the operator to resume. | Add an owner-scoped lease and durable per-collection checkpoints/count verification while retaining idempotent updates. |
| P2 | **Analytics can be vulnerable to repeated small-cohort comparisons.** Small cells are currently part of the product contract and are disclosed; repeated filtering can still enable differencing. | Results may reveal information about individual respondents in small cohorts. | Decide on a workspace-level disclosure policy (minimum cell size, query budget, suppression or approved exceptions), then apply it consistently in UI and CSV. |
| P2 | **Database connection limits are per warm isolate.** The Mongo pool cap does not itself cap aggregate connections across serverless instances. | Bursts can exceed the database connection budget even when each function instance is within its own cap. | Measure concurrent-instance behavior and set a total connection budget or serverless connection policy. |

## Validation evidence

- Full automated suite: **970 tests passed across 140 files**; TypeScript check and optimized Next.js production build passed. The answer-pagination interaction also has a DOM test that exercises loading and appending an older page. New host, API, and MCP regressions cover oversized add-people batches; survey-tab coverage checks that the publish warning labels its page-limited answer count; source MCP coverage verifies disjoint cursor pages and export encoding/limit errors.
- Static questionnaire checker: **18** starter, example, and authoring-reference files passed with zero errors, warnings, or notes.
- `npm audit --audit-level=moderate` and `npm audit --omit=dev --audit-level=moderate` found no known package vulnerabilities.
- Live MCP boundary checks covered missing/wrong credentials, hostile origin, content type, Accept, and method handling. A disposable interview was created, read, listed, deleted, and verified absent; no respondent data or email was used.
- Production release `4338dce` reached **READY**. Runtime error review found no errors in the 15 minutes after deployment. The homepage returns HTTP 200, the image-usage endpoint requires authentication (401 without a session), an unknown frame token returns 404, and unauthenticated MCP and add-people POSTs return 401. The live MCP `add_people` tool rejects a 101-person request with `invalid_args`; it did not reach a write. A live rate-limit probe against a fabricated nonexistent respondent token returned 180 expected 404s followed by 429 on request 181. Public accessibility audit covered five public routes at four viewport widths (20 samples): zero automated violations and six axe contrast needs-review results; authenticated host screens were not included. An authenticated MCP `initialize` and `tools/list` audit returned 200 with 40 tools; disposable interviews were created, read, listed, deleted, and confirmed absent; no respondent data or email was used.

- A production respondent E2E run used a disposable interview and participant with no email. All ten checks passed: offline edits synced after reconnect, an out-of-range number was rejected and explained, rejected input reverted to saved state, rapid edits kept the final value, submission locked the first window, and a second window could not overwrite submitted answers. The first run exposed an eight-second toast wait that was too short for a production API round trip; the harness now waits 15 seconds. Both disposable interviews were deleted after the checks.
- A connected KQA MCP paging probe used 51 disposable people. The first `list_people` result returned 50 people and a `nextCursor`; a second call with that cursor still returned the same 50 IDs. The connected tool schema exposes only `interviewId`, while the app MCP tool implementation accepts `cursor` and `limit`. The disposable interview was deleted after the probe.

Some repository evaluation scripts require provider-generated result JSON and were not run without those inputs. The authenticated host console still needs a dedicated browser audit; respondent E2E coverage is currently focused on offline saving, validation, and submission locking.

## Next review order

1. Stream or background full exports, which remain capped at 100 people and assembled in memory.
2. Define and enforce configurable workspace asset quotas.
3. Decide and implement consent, retention, withdrawal, and complete participant-erasure workflows.
4. Settle delivery attempts with no delivery-status notice through provider reconciliation or a host resolution workflow.
5. Move cold-start pending-signup cleanup into a bounded, resumable migration and review the serverless Mongo connection budget.
6. Scope the in-app questionnaire builder and campaign automation.

