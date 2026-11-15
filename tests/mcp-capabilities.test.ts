import { describe, expect, it } from "vitest";
import { canCallMcpTool, DEFAULT_MCP_CAPABILITIES, MCP_CAPABILITIES, MCP_TOOL_CAPABILITIES, parseMcpCapabilities } from "../src/lib/mcp/capabilities";

describe("MCP credential capabilities", () => {
  it("rejects empty, duplicate, and unknown permissions", () => {
    expect(parseMcpCapabilities([])).toBeNull();
    expect(parseMcpCapabilities(["analytics:read", "analytics:read"])).toBeNull();
    expect(parseMcpCapabilities(["root:all"])).toBeNull();
  });

  it("uses least-privilege defaults and does not expose sensitive tools", () => {
    expect(DEFAULT_MCP_CAPABILITIES).toEqual(["interviews:read", "analytics:read"]);
    expect(canCallMcpTool("list_interviews", DEFAULT_MCP_CAPABILITIES)).toBe(true);
    expect(canCallMcpTool("analyze_answers", DEFAULT_MCP_CAPABILITIES)).toBe(true);
    expect(canCallMcpTool("get_answers", DEFAULT_MCP_CAPABILITIES)).toBe(false);
    expect(canCallMcpTool("send_invite", DEFAULT_MCP_CAPABILITIES)).toBe(false);
    expect(canCallMcpTool("delete_interview", DEFAULT_MCP_CAPABILITIES)).toBe(false);
  });

  it("keeps every registered MCP tool assigned to a known capability", () => {
    expect(Object.keys(MCP_TOOL_CAPABILITIES).length).toBeGreaterThan(0);
    expect(Object.values(MCP_TOOL_CAPABILITIES).every((capability) => (MCP_CAPABILITIES as readonly string[]).includes(capability))).toBe(true);
  });

  it("treats missing capabilities as the explicit legacy full-access compatibility case", () => {
    expect(canCallMcpTool("delete_interview")).toBe(true);
    expect(canCallMcpTool("tool_added_without_a_capability")).toBe(false);
  });
});
