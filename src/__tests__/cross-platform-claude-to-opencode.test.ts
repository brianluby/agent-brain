import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Mind } from "../core/mind.js";
import { claudeAdapter, opencodeAdapter } from "../platforms/adapters/index.js";
import { processPlatformEvent } from "../platforms/pipeline.js";

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-cross-platform-c2o-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

describe("cross-platform continuity (Claude -> OpenCode)", () => {
  it("reads Claude-authored memory from OpenCode", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      const claudeEvent = claudeAdapter.normalizeToolObservation({
        session_id: "claude-session-1",
        contract_version: "1.0.0",
        project_id: "project-alpha",
        cwd: "/tmp/project-alpha",
        tool_name: "Read",
        tool_input: { filePath: "src/app.ts" },
        tool_response: "loaded",
      });

      if (!claudeEvent) {
        throw new Error("Expected Claude tool observation event");
      }

      const claudePipeline = processPlatformEvent(claudeEvent);
      expect(claudePipeline.skipped).toBe(false);
      expect(claudePipeline.projectIdentityKey).toBe("project-alpha");

      const claudeMind = await Mind.open({ memoryPath, debug: false });
      const token = "claudetoopencodecrossplatformtoken";
      await claudeMind.remember({
        type: "decision",
        summary: "Claude session decision",
        content: `Persisted from Claude for cross-platform recall: ${token}`,
        metadata: {
          platform: "claude",
          projectIdentityKey: claudePipeline.projectIdentityKey,
        },
      });

      const opencodeEvent = opencodeAdapter.normalizeToolObservation({
        session_id: "opencode-session-1",
        contract_version: "1.0.0",
        project_id: "project-alpha",
        cwd: "/tmp/project-alpha",
        tool_name: "Read",
        tool_input: { filePath: "src/app.ts" },
        tool_response: "loaded",
      });

      if (!opencodeEvent) {
        throw new Error("Expected OpenCode tool observation event");
      }

      const opencodePipeline = processPlatformEvent(opencodeEvent);
      expect(opencodePipeline.skipped).toBe(false);
      expect(opencodePipeline.projectIdentityKey).toBe(claudePipeline.projectIdentityKey);

      const opencodeMind = await Mind.open({ memoryPath, debug: false });
      const results = await opencodeMind.search(token, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].observation.content).toContain(token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
