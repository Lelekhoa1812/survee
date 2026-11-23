# System review

**Reviewed:** 23 November 2026  
**Scope:** repository, product flows, automated tests/build, production HTTP and MCP behavior, and recent Vercel runtime error clusters.  
**Status:** active review snapshot; this is not a security certification or a claim that every roadmap item is complete.

## Current assessment

The core interview lifecycle is in good shape for bounded, host-run questionnaire collection. The app validates questionnaires, isolates respondent links, retains recoverable drafts, supports routing and repeat records, separates respondent-level analytics from repeat rows, offers multiple export formats, and protects MCP operations with credential-scoped capabilities. The automated suite and production build are healthy.

The largest remaining risks are operational durability and scale: outbound mail can have an ambiguous result after a provider accepts it, respondent loads and exports grow with the whole interview, and uploaded assets have no workspace quota. Governance features are also host-dependent: consent notices, retention, withdrawal, and deletion schedules are not first-class workflows. A schema-backed questionnaire builder and scheduled campaign tools would materially improve adoption, but they need product design beyond a small repair.

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
- Full participant-list and export reads now stop explicitly above 100 people; the host page keeps other controls available, and targeted MCP answer reads load only one tenant-scoped person.
- A rejected cold-start Mongo connection now clears only its own cached promise so a warm worker can retry when the database recovers.
- Published questionnaire assets and asset deletion now share a transactional coordination point; a concurrent deletion cannot leave a newly published version pointing at a missing image.

## Ranked remaining gaps

| Priority | Gap | Impact | Recommended next step |
| --- | --- | --- | --- |
| P1 | **Outbound mail still needs reconciliation for ambiguous attempts.** Participant sends are persisted before SMTP; normal retries are suppressed, and rate-limited IMAP checks can resolve matching delivery-status notices. Workspace invite links now stay active through SMTP ambiguity and cannot be silently rotated; however, workspace sends do not persist a Message-ID or expose delivery reconciliation. Participant attempts without a DSN can remain unknown indefinitely. | Hosts may need a duplicate-risk decision for participant invites, while workspace invite delivery status remains unknown until a host or recipient confirms it. | Add a durable workspace mail attempt with stored Message-ID and a scoped, rate-limited delivery check; retain explicit revoke-before-replacement semantics. Add provider reconciliation or a host resolution workflow for pending participant attempts. |
| P1 | **Participant reads and exports need pagination for larger interviews.** Full-record reads and exports now stop after 100 people and fail explicitly instead of hydrating or exporting an unbounded cohort. Exports under that limit are still assembled in memory. | Interviews above 100 people cannot use the current full-list or export flows; large answer payloads can still make a 100-person response expensive. | Add cursor pagination to host/MCP listing and stream or background larger exports; show continuation/export status. |
| P1 | **Asset storage has no workspace quota, and active preview drafts can race deletion.** Publication now touches each referenced tenant asset in its transaction, while deletion scans references and deletes in a transaction that writes the same asset. This prevents a concurrent publish from committing a dangling image URL. Draft creation does not use that coordination point, but publication rejects a missing asset. | Aggregate storage costs can grow without a tenant bound; a preview draft created during deletion can become stale and fail when published. | Add configurable workspace quotas and coordinate draft creation with deletion or use a staged tombstone/garbage-collection flow. |
| P1 | **Consent, retention, and withdrawal rely on host procedures.** The app stores person-linked answers and supports manual deletion, but it does not manage notice versions, consent records, retention windows, or respondent withdrawal. | Hosts can collect data without a consistent in-product record of the notice or planned deletion. | Design a versioned notice and optional consent gate, plus workspace-configured retention, dry-run review, audited deletion, and a respondent withdrawal route. Avoid legal defaults; make policy owner-configurable. |
| P2 | **Questionnaires require HTML authoring.** There is no in-app builder for the supported question types and routing. | Non-technical hosts must source or edit files to create and revise a questionnaire. | Build a schema-backed editor with HTML import/export, checker diagnostics, live preview, accessibility states, and version diff/publish review. |
| P2 | **Campaign operations are mostly manual.** Hosts refresh progress and resend/check invitations manually; there are no scheduled reminders or completion notifications. | Follow-up work and response monitoring do not scale well across larger cohorts. | Add optional close dates, rate-limited reminders for eligible non-submitters, and owner-configured completion/failure notifications with audit history. |
| P2 | **Recovery assurance is not verifiable in the repository.** Tenant migration requires backup confirmation, but there is no documented restore drill or tested recovery objective. | A correct backup schedule is not proof that data can be restored in time. | Document the configured backup schedule/retention, define RPO/RTO, and run a periodic restore exercise with evidence. |
| P2 | **Cold-start database setup still includes data migration work.** Index setup can scan and deduplicate pending-signup records when a unique index is absent. | A large legacy collection can increase cold-start latency and memory during deployment or scale-out. | Move data cleanup into a bounded, resumable migration with progress/locking; leave runtime index checks lightweight. |
| P2 | **Analytics can be vulnerable to repeated small-cohort comparisons.** Small cells are currently part of the product contract and are disclosed; repeated filtering can still enable differencing. | Results may reveal information about individual respondents in small cohorts. | Decide on a workspace-level disclosure policy (minimum cell size, query budget, suppression or approved exceptions), then apply it consistently in UI and CSV. |
| P2 | **Database connection limits are per warm isolate.** The Mongo pool cap does not itself cap aggregate connections across serverless instances. | Bursts can exceed the database connection budget even when each function instance is within its own cap. | Measure concurrent-instance behavior and set a total connection budget or serverless connection policy. |

## Validation evidence

- Full automated suite: **924 tests passed across 134 files** after the current code changes.
- TypeScript check and optimized Next.js production build passed.
- Live MCP boundary checks covered missing/wrong credentials, hostile origin, content type, Accept, and method handling. A disposable interview was created, read, listed, deleted, and verified absent; no respondent data or email was used.
- Production code release `d92f2fb` reached **READY**. `https://kqa-bay.vercel.app` returned HTTP 200; unauthenticated MCP POST and workspace-invitation GET returned 401; Vercel reported no runtime errors in the hour after deployment. The earlier authenticated MCP `initialize` and `tools/list` audit returned 200 with 40 tools, and a disposable interview was created, read, listed, deleted, and confirmed absent; no respondent data or email was used.

Some repository evaluation scripts require provider-generated result JSON and were not run without those inputs. The public-route accessibility audit has been run previously; authenticated host and respondent flows still need a dedicated browser audit with a disposable account and interview fixture.

## Next review order

1. Extend durable mail attempt handling to workspace invitations and add an operator reconciliation workflow for attempts with no delivery-status notice.
2. Bound respondent listing and export memory.
3. Add workspace asset quotas and race-safe reference lifecycle.
4. Decide and implement consent, retention, and withdrawal workflows.
5. Scope the in-app questionnaire builder and campaign automation.

