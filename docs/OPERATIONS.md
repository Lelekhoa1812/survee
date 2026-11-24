# Operations and recovery

This guide records repository-visible release and recovery steps. Vercel project settings, MongoDB Atlas backup configuration, alert recipients, and on-call ownership are external to this repository; verify them in their provider consoles and record the responsible owner before relying on them.

## Release gate

1. Confirm the release commit is on `main` and the GitHub Actions **CI / validate** run for that exact SHA succeeds. CI runs the unit suite, MongoDB 8 replica-set integration tests, the optimized Next.js build, and TypeScript checking.
2. Confirm Vercel has a **READY** production deployment for that same SHA. A Git push, a green unit test, or a failed/limited Vercel status check does not mean the production alias has the change.
3. Check the production alias and the deployment's source SHA. After release, verify the liveness and database-readiness endpoints, the changed public route, and Vercel's runtime error window:

   ```sh
   curl -fsS https://kqa-bay.vercel.app/api/healthz
   curl -fsS https://kqa-bay.vercel.app/api/readyz
   curl -fsS https://kqa-bay.vercel.app/
   ```

   `/api/healthz` is process liveness. `/api/readyz` performs a bounded MongoDB ping; it does not run index creation or migrations and is not proof that every collection/index is initialized.

4. If the deployment is not healthy, inspect its build/runtime logs and compare with the last known-good production deployment. Vercel rollback changes the deployed code, not MongoDB data or schema. Check migration compatibility before rolling application code back.

## Database backups and restores

The application requires a MongoDB replica set because answer saves and other multi-document writes use transactions. No backup schedule, recovery-point objective, retention setting, or restore drill is configured by this repository. Verify the Atlas backup policy and owner separately.

Before a migration or tenant reassignment that changes existing records:

1. Confirm a recent provider backup or point-in-time restore point exists for the correct cluster and database.
2. Record the backup timestamp, database, operator, and planned restore target in the change record. Do not copy a production backup into a publicly accessible or shared environment.
3. Prefer restoring into an isolated cluster/database and validate collection counts, indexes, application startup, representative host reads, respondent saves, and tenant-isolation checks before considering production recovery.
4. Do not restore an old snapshot over live production without an explicit recovery decision: doing so can discard interviews, answers, invitations, accounts, and activity written after the snapshot.

If using `mongodump`/`mongorestore`, install a compatible MongoDB Database Tools version and follow the vendor's current instructions in a trusted environment. Ensure secret URIs are not exposed through shell history, process listings, or build logs, and restore into a restricted, separate target. Protect the archive as sensitive data and delete temporary copies under the organization's approved data-handling process. This guide does not define a production overwrite procedure.

## Startup migrations and indexes

The first database-backed request in each warm process calls `ensureIndexes()`. That path applies schema/data migrations and creates the index set before returning the database handle. A failed initialization is retried on a later request; readiness only pings MongoDB and can pass before the migration/index path has completed.

For a migration release, review the migration function and its tests, estimate its full collection scan/write cost, verify backups, and monitor the first database-backed requests and database load after deployment. Do not treat a liveness or ping-only readiness response as migration completion. For tenant reassignment, use the owner-only audit and migration flow documented in the README; keep legacy fallback enabled until the audit shows zero unscoped owned records.

## Incident notes

- Capture the release SHA, Vercel deployment ID, UTC time window, route or MCP tool, and request ID. Application error logs intentionally omit raw exception messages and request payloads.
- Check liveness and readiness separately. A liveness success with readiness failure indicates the process is running but cannot confirm database connectivity.
- Mail delivery outcomes can remain `unknown` when SMTP acceptance is ambiguous and no matching DSN is available. Do not resend or rotate a respondent link automatically; use the host's exact-attempt reconciliation workflow.
- Rate limits use MongoDB-backed atomic buckets and fail closed when the store is unavailable. A rate-limit backend outage can therefore reject login or respondent requests until database service recovers.

## External settings to verify

The repository cannot verify provider-console state. The deployment owner should record:

- MongoDB backup policy, retention, restore access, and the date/result of the latest isolated restore drill.
- Vercel production deployment protection, rollback owner, and any post-deploy smoke checks or alerts.
- Alert routing for elevated 5xx rates, readiness failures, database pressure, failed startup initialization, and aging unknown mail attempts.
