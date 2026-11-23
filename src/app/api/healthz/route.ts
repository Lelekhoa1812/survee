import { json } from "@/lib/http";

/** Process liveness only; this endpoint deliberately does not contact MongoDB. */
export function GET(): Response {
  return json({ status: "ok" });
}
