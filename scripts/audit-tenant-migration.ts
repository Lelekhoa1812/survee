/**
 * Read-only preflight for assigning the existing single-host records to a tenant.
 * It opens Mongo directly and never creates indexes or writes documents. Output is
 * counts and referential integrity only; no addresses, answers, or secrets are read.
 *
 *   npm run audit:tenant-migration
 */
import { loadEnvConfig } from "@next/env";
import { MongoClient } from "mongodb";
import { auditTenantMigration } from "../src/lib/tenant-migration";

loadEnvConfig(process.cwd());

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not configured.");
  process.exit(2);
}

const dbName = process.env.MONGODB_DB || "kqa";
const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 8000, appName: "kqa-tenant-migration-audit" });

async function main() {
  await client.connect();
  const report = await auditTenantMigration(client.db(dbName));
  console.log(JSON.stringify({ database: dbName, ...report }, null, 2));
  if (!report.preflight.readyForReviewedBackfill) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Tenant migration audit failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await client.close().catch(() => {});
});
