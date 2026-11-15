import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("answer concurrency check script", () => {
  let server: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    server = undefined;
  });

  it("loads and sends one questionnaire version with every answer patch", async () => {
    const answers: Record<string, { value: unknown }> = {};
    const versions = new Set<number>();
    let puts = 0;
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: 12, answers }));
        return;
      }
      puts += 1;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { version?: number; answers?: Record<string, { value?: unknown }> };
      if (body.version !== undefined) versions.add(body.version);
      for (const [id, answer] of Object.entries(body.answers ?? {})) {
        if (answer.value === null) delete answers[id];
        else answers[id] = { value: answer.value };
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind to a port.");

    const result = await execFileAsync("node", ["scripts/concurrency-check.mjs", `http://127.0.0.1:${address.port}`, "synthetic-token"], { timeout: 10000 });

    expect(result.stdout).toContain("PASS  round 3: 8 simultaneous saves all kept");
    expect(puts).toBe(27);
    expect(versions).toEqual(new Set([12]));
    expect(Object.keys(answers)).toHaveLength(8);
  });
});
