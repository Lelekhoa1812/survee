import { describe, expect, it } from "vitest";
import { shouldRecordVisit } from "../src/lib/visit";

function req(headers: Record<string, string>): Pick<Request, "headers"> {
  return { headers: new Headers(headers) };
}

describe("mail prefetch does not count as an open", () => {
  it("ignores a bare GET, a prefetch, and a known preview agent", () => {
    expect(shouldRecordVisit(req({}))).toBe(false);
    expect(shouldRecordVisit(req({ "x-kqa-client": "respondent", purpose: "prefetch" }))).toBe(false);
    expect(shouldRecordVisit(req({ "x-kqa-client": "respondent", "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)" }))).toBe(false);
    expect(shouldRecordVisit(req({ "x-kqa-client": "respondent", "sec-fetch-mode": "navigate" }))).toBe(false);
  });

  it("records a visit from the respondent app", () => {
    expect(shouldRecordVisit(req({ "x-kqa-client": "respondent", "sec-fetch-mode": "cors", "user-agent": "Mozilla/5.0" }))).toBe(true);
  });
});
