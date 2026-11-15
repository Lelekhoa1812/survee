import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

describe("reduced-motion support", () => {
  it("disables animations and scrolling movement while shortening transitions", () => {
    const mediaStart = stylesheet.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaStart).toBeGreaterThanOrEqual(0);
    const blockStart = stylesheet.indexOf("{", mediaStart);
    let depth = 0;
    let blockEnd = -1;
    for (let index = blockStart; index < stylesheet.length; index += 1) {
      if (stylesheet[index] === "{") depth += 1;
      if (stylesheet[index] === "}") depth -= 1;
      if (depth === 0) {
        blockEnd = index;
        break;
      }
    }
    const block = stylesheet.slice(blockStart + 1, blockEnd);
    expect(block).toMatch(/animation:\s*none\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
    expect(block).toMatch(/transition-duration:\s*\.01ms\s*!important/);
  });
});
