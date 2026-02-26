import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { buildSessionStartOutput } from "../hooks/session-start.js";

describe("session start startup regression", () => {
  it("builds startup context quickly", () => {
    const start = performance.now();

    for (let i = 0; i < 100; i++) {
      const output = buildSessionStartOutput({
        session_id: `session-${i}`,
        platform: "claude",
        contract_version: "1.0.0",
        cwd: "/tmp/project-alpha",
        hook_event_name: "SessionStart",
      });
      expect(output.continue).toBe(true);
    }

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
