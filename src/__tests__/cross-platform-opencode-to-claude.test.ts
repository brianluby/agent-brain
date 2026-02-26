import { describe, expect, it } from "vitest";
import { resolveProjectIdentityKey } from "../platforms/identity.js";

// TODO: FR-010 — This test validates identity key resolution (FR-011) but not actual
// cross-platform memory retrieval. Add an integration test that writes memory via
// the OpenCode adapter and reads it back via the Claude adapter using the same
// memory file path to fully validate FR-010.
describe("cross-platform continuity (OpenCode -> Claude)", () => {
  it("uses canonical path fallback when platform ID is missing", () => {
    const opencodeIdentity = resolveProjectIdentityKey({
      canonicalPath: "/tmp/project-beta",
    });

    const claudeIdentity = resolveProjectIdentityKey({
      canonicalPath: "/tmp/project-beta",
    });

    expect(opencodeIdentity.key).toBe("/tmp/project-beta");
    expect(claudeIdentity.key).toBe("/tmp/project-beta");
  });
});
