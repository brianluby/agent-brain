import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Mind } from "../../core/mind.js";
import { opencodeAdapter } from "../../platforms/adapters/index.js";
import { processPlatformEvent } from "../../platforms/pipeline.js";

interface SessionResult {
  id: string;
  retrievable: boolean;
}

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-metric-sc002-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

function retrievalRate(results: SessionResult[]): number {
  const passed = results.filter((result) => result.retrievable).length;
  return (passed / results.length) * 100;
}

describe("SC-002 OpenCode retrieval rate", () => {
  it("meets >=95% retrievable session threshold using real memory storage", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      const event = opencodeAdapter.normalizeSessionStart({
        session_id: "opencode-metric-session",
        contract_version: "1.0.0",
        project_id: "sc-002-project",
        cwd: "/tmp/sc-002-project",
      });
      const pipelineResult = processPlatformEvent(event);

      expect(pipelineResult.skipped).toBe(false);
      expect(pipelineResult.projectIdentityKey).toBe("sc-002-project");

      const writerMind = await Mind.open({ memoryPath, debug: false });
      const sessionCount = 20;
      const tokens: Array<{ sessionId: string; token: string }> = [];

      for (let index = 0; index < sessionCount; index++) {
        const sessionId = `opencode-session-${index}`;
        const token = `sc002token${index}alpha`;
        tokens.push({ sessionId, token });

        await writerMind.remember({
          type: "discovery",
          summary: `OpenCode retrieval sample ${index}`,
          content: `Session ${sessionId} persisted retrieval token ${token}`,
          metadata: {
            platform: "opencode",
            sessionId,
            projectIdentityKey: pipelineResult.projectIdentityKey,
          },
        });
      }

      const readerMind = await Mind.open({ memoryPath, debug: false });
      const results: SessionResult[] = [];

      for (const sample of tokens) {
        const matches = await readerMind.search(sample.token, 1);
        results.push({
          id: sample.sessionId,
          retrievable: matches.length > 0 && matches[0].observation.content.includes(sample.token),
        });
      }

      const rate = retrievalRate(results);
      expect(rate).toBeGreaterThanOrEqual(95);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);
});
