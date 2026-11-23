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

## Ranked remaining gaps

| Priority | Gap | Impact | Recommended next step |
| --- | --- | --- | --- |
| P1 | **SMTP delivery and persistence are not one durable operation.** A provider can accept a message before local persistence fails. Retrying can duplicate mail; workspace-invite retries rotate the stored token and can invalidate a previously delivered link. | Invite status can be ambiguous and recipients can receive stale links. Rate limits reduce repetition but do not make retries idempotent. | Add a transactional outbox with stable attempt IDs, durable send states, idempotent retries, and reconciliation for provider-accepted/local-ack-failed cases. |
| P1 | **Participant reads and exports load the full interview.** `listParticipants()` hydrates all matching people, and the export route builds the complete export in memory. | Large interviews can increase response time and function memory until they fail. | Add cursor pagination to host/MCP listing and stream or background large exports; set explicit per-request bounds and show continuation/export status. |
| P1 | **Asset storage has no workspace quota, and reference-check/delete can race publication.** The current per-file limit does not bound aggregate workspace usage. A version can potentially reference an asset after the deletion scan. | Storage costs can grow without a tenant bound; concurrent changes can leave a published questionnaire with a broken image. | Add configurable workspace quotas and coordinate asset deletion with version publication through a shared atomic protocol or a staged tombstone/garbage-collection flow. |
| P1 | **Consent, retention, and withdrawal rely on host procedures.** The app stores person-linked answers and supports manual deletion, but it does not manage notice versions, consent records, retention windows, or respondent withdrawal. | Hosts can collect data without a consistent in-product record of the notice or planned deletion. | Design a versioned notice and optional consent gate, plus workspace-configured retention, dry-run review, audited deletion, and a respondent withdrawal route. Avoid legal defaults; make policy owner-configurable. |
| P2 | **Questionnaires require HTML authoring.** There is no in-app builder for the supported question types and routing. | Non-technical hosts must source or edit files to create and revise a questionnaire. | Build a schema-backed editor with HTML import/export, checker diagnostics, live preview, accessibility states, and version diff/publish review. |
| P2 | **Campaign operations are mostly manual.** Hosts refresh progress and resend/check invitations manually; there are no scheduled reminders or completion notifications. | Follow-up work and response monitoring do not scale well across larger cohorts. | Add optional close dates, rate-limited reminders for eligible non-submitters, and owner-configured completion/failure notifications with audit history. |
| P2 | **Recovery assurance is not verifiable in the repository.** Tenant migration requires backup confirmation, but there is no documented restore drill or tested recovery objective. | A correct backup schedule is not proof that data can be restored in time. | Document the configured backup schedule/retention, define RPO/RTO, and run a periodic restore exercise with evidence. |
| P2 | **Cold-start database setup still includes data migration work.** Index setup can scan and deduplicate pending-signup records when a unique index is absent. | A large legacy collection can increase cold-start latency and memory during deployment or scale-out. | Move data cleanup into a bounded, resumable migration with progress/locking; leave runtime index checks lightweight. |
| P2 | **Analytics can be vulnerable to repeated small-cohort comparisons.** Small cells are currently part of the product contract and are disclosed; repeated filtering can still enable differencing. | Results may reveal information about individual respondents in small cohorts. | Decide on a workspace-level disclosure policy (minimum cell size, query budget, suppression or approved exceptions), then apply it consistently in UI and CSV. |
| P2 | **Database connection limits are per warm isolate.** The Mongo pool cap does not itself cap aggregate connections across serverless instances. | Bursts can exceed the database connection budget even when each function instance is within its own cap. | Measure concurrent-instance behavior and set a total connection budget or serverless connection policy. |

## Validation evidence

- Full automated suite: **906 tests passed across 131 files** after the current code changes.
- TypeScript check and optimized Next.js production build passed.
- Live MCP boundary checks covered missing/wrong credentials, hostile origin, content type, Accept, and method handling. A disposable interview was created, read, listed, deleted, and verified absent; no respondent data or email was used.
- Latest production deployment for `9adccc9` reached **READY** and includes the code release from `e0589cf`. `https://kqa-bay.vercel.app` returned HTTP 200; unauthenticated MCP POST returned 401. A fresh authenticated MCP `initialize` and `tools/list` both returned 200 with 40 tools.
- Vercel reported no runtime error clusters in the last hour at review time.

Some repository evaluation scripts require provider-generated result JSON and were not run without those inputs. The public-route accessibility audit has been run previously; authenticated host and respondent flows still need a dedicated browser audit with a disposable account and interview fixture.

## Next review order

1. Ship a durable mail outbox and retry model.
2. Bound respondent listing and export memory.
3. Add workspace asset quotas and race-safe reference lifecycle.
4. Decide and implement consent, retention, and withdrawal workflows.
5. Scope the in-app questionnaire builder and campaign automation.

