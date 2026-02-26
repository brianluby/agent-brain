import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveMemoryPathPolicy,
  resolveProjectIdentityKey,
  validateAdapterContractVersion,
} from "../platforms/index.js";

function createTempProjectDir(): string {
  return mkdtempSync(join(tmpdir(), "memvid-path-policy-"));
}

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
    const projectDir = createTempProjectDir();

    try {
      const result = resolveMemoryPathPolicy({
        projectDir,
        platform: "claude",
        defaultRelativePath: ".agent-brain/mind.mv2",
        legacyRelativePaths: [".claude/mind.mv2"],
      });
      expect(result.mode).toBe("legacy_first");
      expect(result.memoryPath).toBe(`${projectDir}/.agent-brain/mind.mv2`);
      expect(result.canonicalPath).toBe(`${projectDir}/.agent-brain/mind.mv2`);
      expect(result.migrationSuggestion).toBeUndefined();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses legacy file and suggests move when old path exists", () => {
    const projectDir = createTempProjectDir();

    try {
      const legacyDir = join(projectDir, ".claude");
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, "mind.mv2"), "legacy-memory");

      const result = resolveMemoryPathPolicy({
        projectDir,
        platform: "claude",
        defaultRelativePath: ".agent-brain/mind.mv2",
        legacyRelativePaths: [".claude/mind.mv2"],
      });
      expect(result.memoryPath).toBe(`${projectDir}/.claude/mind.mv2`);
      expect(result.canonicalPath).toBe(`${projectDir}/.agent-brain/mind.mv2`);
      expect(result.migrationSuggestion).toEqual({
        fromPath: `${projectDir}/.claude/mind.mv2`,
        toPath: `${projectDir}/.agent-brain/mind.mv2`,
      });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("uses platform path when opt-in is enabled", () => {
    const projectDir = createTempProjectDir();

    try {
      const result = resolveMemoryPathPolicy({
        projectDir,
        platform: "opencode",
        defaultRelativePath: ".agent-brain/mind.mv2",
        platformOptIn: true,
      });
      expect(result.mode).toBe("platform_opt_in");
      expect(result.memoryPath).toBe(`${projectDir}/.agent-brain/mind-opencode.mv2`);
      expect(result.canonicalPath).toBe(`${projectDir}/.agent-brain/mind-opencode.mv2`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
