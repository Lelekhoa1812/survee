import { beforeEach, describe, expect, it, vi } from "vitest";

const pingDatabase = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/db", () => ({ pingDatabase }));

import { GET as health } from "../src/app/api/healthz/route";
import { GET as readiness } from "../src/app/api/readyz/route";

describe("health endpoints", () => {
  beforeEach(() => pingDatabase.mockReset());

  it("reports liveness without pinging the database", async () => {
    const response = health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  it("reports readiness after a successful database ping", async () => {
    pingDatabase.mockResolvedValueOnce(undefined);
    const response = await readiness();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
    expect(pingDatabase).toHaveBeenCalledOnce();
  });

  it("fails readiness without exposing database error details", async () => {
    pingDatabase.mockRejectedValueOnce(new Error("mongodb://private-host refused"));
    const response = await readiness();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain("private-host");
  });
});
