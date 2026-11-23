import { consumeRateLimit } from "@/lib/repo";
import { fail } from "@/lib/http";
import type { NextResponse } from "next/server";

type RespondentAction = "load" | "save" | "submit";

const LIMITS: Record<RespondentAction, { token: number; ip: number }> = {
  load: { token: 180, ip: 1800 },
  save: { token: 600, ip: 3600 },
  submit: { token: 60, ip: 600 },
};

/** Rate limit respondent APIs without storing bearer tokens or raw addresses. */
export async function respondentRateLimit(req: Request, token: string, action: RespondentAction): Promise<NextResponse | null> {
  const limits = LIMITS[action];
  const platformIp = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  try {
    const checks = [consumeRateLimit(`respondent-${action}-token:${token}`, limits.token, 15)];
    if (platformIp) checks.push(consumeRateLimit(`respondent-${action}-ip:${platformIp}`, limits.ip, 15));
    const allowed = await Promise.all(checks);
    if (allowed.some((result) => !result)) return fail(429, "Too many requests for this respondent link. Wait a few minutes and try again.", { code: "rate_limited" });
    return null;
  } catch {
    return fail(503, "Respondent services are temporarily unavailable. Try again shortly.", { code: "rate_limit_unavailable" });
  }
}
