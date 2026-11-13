import { MongoClient, type Collection, type Db } from "mongodb";
import { dbName, mongoUri } from "./env";
import type { ApiKeyDoc, EventDoc, InterviewDoc, LoginAttemptDoc, MailMessageDoc, ParticipantDoc, RevokedSessionDoc, SurveyVersionDoc } from "./repo/types";

declare global {
  // eslint-disable-next-line no-var
  var __kqaMongo: { client: Promise<MongoClient>; indexes?: Promise<void> } | undefined;
}

function client(): Promise<MongoClient> {
  if (!globalThis.__kqaMongo) {
    const c = new MongoClient(mongoUri(), { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, appName: "kqa" });
    globalThis.__kqaMongo = { client: c.connect() };
  }
  return globalThis.__kqaMongo.client;
}

export async function db(): Promise<Db> {
  const c = await client();
  const d = c.db(dbName());
  if (!globalThis.__kqaMongo!.indexes) {
    globalThis.__kqaMongo!.indexes = ensureIndexes(d).catch((e) => {
      globalThis.__kqaMongo!.indexes = undefined;
      throw e;
    });
  }
  await globalThis.__kqaMongo!.indexes;
  return d;
}

async function ensureIndexes(d: Db) {
  await Promise.all([
    d.collection("participants").createIndex({ token: 1 }, { unique: true, name: "token_unique" }),
    d.collection("participants").createIndex({ interviewId: 1, createdAt: 1 }, { name: "by_interview" }),
    d.collection("survey_versions").createIndex({ interviewId: 1, version: -1 }, { unique: true, name: "interview_version" }),
    d.collection("interviews").createIndex({ updatedAt: -1 }, { name: "recent" }),
    d.collection("events").createIndex({ interviewId: 1, at: -1 }, { name: "by_interview_time" }),
    d.collection("events").createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180, name: "ttl_180d" }),
    d.collection("login_attempts").createIndex({ at: 1 }, { expireAfterSeconds: 60 * 30, name: "ttl_30m" }),
    d.collection("login_attempts").createIndex({ key: 1, at: -1 }, { name: "by_key" }),
    d.collection("revoked_sessions").createIndex({ sid: 1 }, { unique: true, name: "sid_unique" }),
    d.collection("revoked_sessions").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiry" }),
    d.collection("mail_messages").createIndex({ participantId: 1, sentAt: -1 }, { name: "by_participant" }),
    d.collection("mail_messages").createIndex({ interviewId: 1, sentAt: -1 }, { name: "by_interview" }),
    d.collection("api_keys").createIndex({ hash: 1 }, { unique: true, name: "hash_unique" }),
    d.collection("api_keys").createIndex({ createdAt: -1 }, { name: "recent_keys" }),
  ]);
}

export const col = {
  interviews: async (): Promise<Collection<InterviewDoc>> => (await db()).collection<InterviewDoc>("interviews"),
  versions: async (): Promise<Collection<SurveyVersionDoc>> => (await db()).collection<SurveyVersionDoc>("survey_versions"),
  participants: async (): Promise<Collection<ParticipantDoc>> => (await db()).collection<ParticipantDoc>("participants"),
  events: async (): Promise<Collection<EventDoc>> => (await db()).collection<EventDoc>("events"),
  logins: async (): Promise<Collection<LoginAttemptDoc>> => (await db()).collection<LoginAttemptDoc>("login_attempts"),
  revoked: async (): Promise<Collection<RevokedSessionDoc>> => (await db()).collection<RevokedSessionDoc>("revoked_sessions"),
  mail: async (): Promise<Collection<MailMessageDoc>> => (await db()).collection<MailMessageDoc>("mail_messages"),
  apiKeys: async (): Promise<Collection<ApiKeyDoc>> => (await db()).collection<ApiKeyDoc>("api_keys"),
};
