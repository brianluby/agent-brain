import { describe, expect, it } from "vitest";
import {
  resolveMemoryPathPolicy,
  resolveProjectIdentityKey,
  validateAdapterContractVersion,
} from "../platforms/index.js";

describe("platform foundation", () => {
  it("validates compatible contract major", () => {
    const result = validateAdapterContractVersion("1.2.3");
    expect(result.compatible).toBe(true);
    expect(result.supportedMajor).toBe(1);
  });

  it("resolves project identity with platform ID first", () => {
    const identity = resolveProjectIdentityKey({
      platformProjectId: "project-42",
      canonicalPath: "/tmp/demo",
    });
    expect(identity.key).toBe("project-42");
    expect(identity.source).toBe("platform_project_id");
  });

  it("falls back to canonical path when platform ID is absent", () => {
    const identity = resolveProjectIdentityKey({
      canonicalPath: "/tmp/demo",
    });
    expect(identity.key).toBe("/tmp/demo");
    expect(identity.source).toBe("canonical_path");
  });

  it("uses legacy-first path policy by default", () => {
    const result = resolveMemoryPathPolicy({
      projectDir: "/tmp/project",
      platform: "claude",
      legacyRelativePath: ".claude/mind.mv2",
    });
    expect(result.mode).toBe("legacy_first");
    expect(result.memoryPath).toBe("/tmp/project/.claude/mind.mv2");
  });

  it("uses platform path when opt-in is enabled", () => {
    const result = resolveMemoryPathPolicy({
      projectDir: "/tmp/project",
      platform: "opencode",
      legacyRelativePath: ".claude/mind.mv2",
      platformOptIn: true,
      platformRelativePath: ".claude/mind-opencode.mv2",
    });
    expect(result.mode).toBe("platform_opt_in");
    expect(result.memoryPath).toBe("/tmp/project/.claude/mind-opencode.mv2");
  });
});
