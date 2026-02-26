import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Mind } from "../core/mind.js";
import { claudeAdapter, opencodeAdapter } from "../platforms/adapters/index.js";
import { processPlatformEvent } from "../platforms/pipeline.js";

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-cross-platform-o2c-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

describe("cross-platform continuity (OpenCode -> Claude)", () => {
  it("reads OpenCode-authored memory from Claude", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      const opencodeEvent = opencodeAdapter.normalizeToolObservation({
        session_id: "opencode-session-2",
        contract_version: "1.0.0",
        cwd: "/tmp/project-beta",
        tool_name: "Bash",
        tool_input: { command: "npm test" },
        tool_response: "ok",
      });

      if (!opencodeEvent) {
        throw new Error("Expected OpenCode tool observation event");
      }

      const opencodePipeline = processPlatformEvent(opencodeEvent);
      expect(opencodePipeline.skipped).toBe(false);
      expect(opencodePipeline.projectIdentityKey).toBe("/tmp/project-beta");

      const opencodeMind = await Mind.open({ memoryPath, debug: false });
      const token = "opencodetoclaudecrossplatformtoken";
      await opencodeMind.remember({
        type: "solution",
        summary: "OpenCode command outcome",
        content: `Persisted from OpenCode for cross-platform recall: ${token}`,
        metadata: {
          platform: "opencode",
          projectIdentityKey: opencodePipeline.projectIdentityKey,
        },
      });

      const claudeEvent = claudeAdapter.normalizeToolObservation({
        session_id: "claude-session-2",
        contract_version: "1.0.0",
        cwd: "/tmp/project-beta",
        tool_name: "Read",
        tool_input: { filePath: "README.md" },
        tool_response: "loaded",
      });

      if (!claudeEvent) {
        throw new Error("Expected Claude tool observation event");
      }

      const claudePipeline = processPlatformEvent(claudeEvent);
      expect(claudePipeline.skipped).toBe(false);
      expect(claudePipeline.projectIdentityKey).toBe(opencodePipeline.projectIdentityKey);

      const claudeMind = await Mind.open({ memoryPath, debug: false });
      const results = await claudeMind.search(token, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].observation.content).toContain(token);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
