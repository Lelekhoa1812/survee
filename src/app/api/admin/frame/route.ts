import { frameResponse, framePlaceholder } from "@/lib/frame";
import { adminSession } from "@/lib/http";
import { LIMITS } from "@/lib/format/schema";
import { getInterview, getVersion } from "@/lib/repo";

/** Preview a stored survey version: /api/admin/frame?interview=ID&version=N (version defaults to the current one). */
export async function GET(req: Request) {
  if (!(await adminSession())) return framePlaceholder("Sign in to preview.", 401);
  const u = new URL(req.url);
  const interview = await getInterview(u.searchParams.get("interview") ?? "");
  if (!interview) return framePlaceholder("Interview not found.");
  const v = Number(u.searchParams.get("version") ?? interview.currentVersion);
  const version = await getVersion(interview._id, Number.isInteger(v) ? v : interview.currentVersion);
  if (!version) return framePlaceholder("That survey version does not exist.");
  return frameResponse(version.html);
}

/** Preview or probe a file that has not been stored yet. The page posts it from a hidden form into the frame. */
export async function POST(req: Request) {
  if (!(await adminSession())) return framePlaceholder("Sign in to preview.", 401);
  // No origin check here on purpose. A form posted by the page into a sandboxed frame carries `Origin: null`, and this
  // route changes nothing: it only echoes the file back under a CSP that forces a sandbox, so a forged post gains nothing.
  const form = await req.formData().catch(() => null);
  const html = form?.get("html");
  if (typeof html !== "string" || !html.trim()) return framePlaceholder("No file was sent.", 400);
  if (html.length > LIMITS.maxFileBytes + 1024) return framePlaceholder("That file is too large.", 413);
  return frameResponse(html);
}
