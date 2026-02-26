import { describe, expect, it } from "vitest";
import { claudeAdapter } from "../platforms/adapters/claude.js";
import { claudeToolFixture } from "./fixtures/platform-events.js";

describe("Claude tool observation regression", () => {
  it("normalizes Claude tool events", () => {
    const event = claudeAdapter.normalizeToolObservation(claudeToolFixture);
    expect(event).not.toBeNull();
    expect(event?.eventType).toBe("tool_observation");
    expect(event?.payload.toolName).toBe("Read");
    expect(event?.platform).toBe("claude");
  });
});
