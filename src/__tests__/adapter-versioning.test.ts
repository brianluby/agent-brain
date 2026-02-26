import { describe, expect, it } from "vitest";
import type { SessionStartEvent } from "../platforms/events.js";
import { processPlatformEvent } from "../platforms/pipeline.js";
import { validateAdapterContractVersion } from "../platforms/contract.js";

describe("adapter versioning", () => {
  it("rejects incompatible major versions", () => {
    const validation = validateAdapterContractVersion("2.0.0");
    expect(validation.compatible).toBe(false);
    expect(validation.reason).toBe("incompatible_contract_major");
  });

  it("fails open with diagnostics for incompatible major versions", () => {
    const event: SessionStartEvent = {
      eventId: "evt",
      eventType: "session_start",
      platform: "claude",
      contractVersion: "2.0.0",
      sessionId: "session-1",
      timestamp: Date.now(),
      projectContext: { canonicalPath: "/tmp/project" },
      payload: {},
    };

    const result = processPlatformEvent(event);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("incompatible_contract_major");
    expect(result.diagnostic?.redacted).toBe(true);
  });
});
