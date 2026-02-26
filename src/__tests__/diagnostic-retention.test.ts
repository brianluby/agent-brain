import { describe, expect, it } from "vitest";
import { createRedactedDiagnostic } from "../platforms/diagnostic-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("diagnostic retention", () => {
  it("sets 30-day retention metadata", () => {
    const now = Date.now();
    const diagnostic = createRedactedDiagnostic({
      platform: "claude",
      errorType: "malformed_payload",
      now,
    });

    expect(diagnostic.retentionDays).toBe(30);
    expect(diagnostic.expiresAt).toBe(now + (30 * DAY_MS));
    expect(diagnostic.redacted).toBe(true);
  });
});
