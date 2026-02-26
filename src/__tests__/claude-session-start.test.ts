import { describe, expect, it } from "vitest";
import { buildSessionStartOutput } from "../hooks/session-start.js";
import { claudeSessionStartFixture } from "./fixtures/platform-events.js";

describe("Claude session start regression", () => {
  it("returns continue output with session context", () => {
    const output = buildSessionStartOutput(claudeSessionStartFixture);
    expect(output.continue).toBe(true);
    const hookSpecificOutput = output.hookSpecificOutput as { additionalContext: string };
    expect(hookSpecificOutput.additionalContext).toContain("Claude Mind");
    expect(hookSpecificOutput.additionalContext).toContain("Platform: **claude**");
  });
});
