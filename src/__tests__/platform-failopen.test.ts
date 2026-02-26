import { describe, expect, it } from "vitest";
import type { ToolObservationEvent } from "../platforms/events.js";
import { processPlatformEvent } from "../platforms/pipeline.js";
import { AdapterRegistry } from "../platforms/registry.js";

function makeEvent(overrides: Partial<ToolObservationEvent> = {}): ToolObservationEvent {
  return {
    eventId: "evt-1",
    eventType: "tool_observation",
    platform: "claude",
    contractVersion: "1.0.0",
    sessionId: "session-1",
    timestamp: Date.now(),
    projectContext: { canonicalPath: "/tmp/project" },
    payload: {
      toolName: "Read",
      toolInput: {},
      toolResponse: "ok",
    },
    ...overrides,
  };
}

describe("platform fail-open behavior", () => {
  it("registry returns null for unsupported platforms", () => {
    const registry = new AdapterRegistry();
    expect(registry.resolve("unknown")).toBeNull();
  });

  it("skips incompatible contract major versions", () => {
    const result = processPlatformEvent(
      makeEvent({ contractVersion: "2.0.0" })
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("incompatible_contract_major");
  });

  it("skips when project identity cannot be resolved", () => {
    const result = processPlatformEvent(
      makeEvent({ projectContext: {} })
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("missing_project_identity");
  });

  it("accepts valid events with resolved project identity", () => {
    const result = processPlatformEvent(makeEvent());
    expect(result.skipped).toBe(false);
    expect(result.projectIdentityKey).toBe("/tmp/project");
  });
});
