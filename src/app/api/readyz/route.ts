import { json } from "@/lib/http";
import { pingDatabase } from "@/lib/db";

/** Database readiness without exposing connection details or running migrations. */
export async function GET(): Promise<Response> {
  try {
    await pingDatabase();
    return json({ status: "ready" });
  } catch {
    return json({ status: "unavailable" }, 503);
  }
}
