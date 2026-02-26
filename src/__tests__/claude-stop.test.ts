import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../platforms/adapters/claude.js";

describe("Claude stop regression", () => {
  it("normalizes session stop events", () => {
    const event = claudeAdapter.normalizeSessionStop({
      session_id: "session-1",
      platform: "claude",
      contract_version: "1.0.0",
      cwd: "/tmp/project",
      transcript_path: "/tmp/project/.claude/transcript.jsonl",
    });

    expect(event.eventType).toBe("session_stop");
    expect(event.payload.transcriptPath).toContain("transcript");
    expect(event.projectContext.canonicalPath).toBe("/tmp/project");
  });
});
