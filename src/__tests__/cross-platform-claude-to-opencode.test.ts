import { describe, expect, it } from "vitest";
import { resolveProjectIdentityKey } from "../platforms/identity.js";

// TODO: FR-010 — This test validates identity key resolution (FR-011) but not actual
// cross-platform memory retrieval. Add an integration test that writes memory via
// the Claude adapter and reads it back via the OpenCode adapter using the same
// memory file path to fully validate FR-010.
describe("cross-platform continuity (Claude -> OpenCode)", () => {
  it("resolves to the same project identity key", () => {
    const claudeIdentity = resolveProjectIdentityKey({
      canonicalPath: "/tmp/project-alpha",
    });

    const opencodeIdentity = resolveProjectIdentityKey({
      canonicalPath: "/tmp/project-alpha",
    });

    expect(claudeIdentity.key).toBe("/tmp/project-alpha");
    expect(opencodeIdentity.key).toBe("/tmp/project-alpha");
  });
});
