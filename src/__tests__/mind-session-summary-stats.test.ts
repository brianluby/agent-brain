import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Mind } from "../core/mind.js";

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-mind-stats-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

describe("Mind session summaries and stats", () => {
  it("returns saved session summaries and aggregated stats", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      const mind = await Mind.open({ memoryPath, debug: false });
      await mind.remember({
        type: "discovery",
        summary: "Investigated startup issue",
        content: "Found a race condition in startup path",
      });
      await mind.remember({
        type: "decision",
        summary: "Chose lock-based serialization",
        content: "Using a per-project lock avoids write corruption",
      });
      await mind.remember({
        type: "bugfix",
        summary: "Patched session metadata handling",
        content: "Session identifiers are now propagated consistently",
      });

      await mind.saveSessionSummary({
        keyDecisions: ["Use lock-based write serialization"],
        filesModified: ["src/core/mind.ts"],
        summary: "Resolved startup race by serializing writes.",
      });

      const context = await mind.getContext();
      const currentSessionSummary = context.sessionSummaries.find(
        (summary) => summary.id === mind.getSessionId()
      );

      expect(currentSessionSummary).toBeDefined();
      expect(currentSessionSummary?.observationCount).toBeGreaterThanOrEqual(3);

      const stats = await mind.stats();
      expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
      expect(stats.topTypes.discovery).toBeGreaterThanOrEqual(1);
      expect(stats.topTypes.decision).toBeGreaterThanOrEqual(1);
      expect(stats.topTypes.bugfix).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
