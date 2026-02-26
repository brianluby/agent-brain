import { describe, expect, it } from "vitest";
import { opencodeAdapter } from "../platforms/adapters/opencode.js";
import { validateAdapterContractVersion } from "../platforms/contract.js";
import { opencodeToolFixture } from "./fixtures/platform-events.js";

describe("OpenCode adapter contract", () => {
  it("uses a compatible contract version", () => {
    const validation = validateAdapterContractVersion(opencodeAdapter.contractVersion);
    expect(validation.compatible).toBe(true);
  });

  it("normalizes OpenCode tool observations", () => {
    const event = opencodeAdapter.normalizeToolObservation(opencodeToolFixture);
    expect(event).not.toBeNull();
    expect(event?.platform).toBe("opencode");
    expect(event?.projectContext.platformProjectId).toBe("project-alpha");
  });
});
