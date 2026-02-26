import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import keywordFixture from "../fixtures/cross-platform-keywords.json";
import { Mind } from "../../core/mind.js";
import { claudeAdapter, opencodeAdapter } from "../../platforms/adapters/index.js";
import { processPlatformEvent } from "../../platforms/pipeline.js";

interface RecallResult {
  checkId: string;
  topFive: string[];
}

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-metric-sc003-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

function isRelevant(topFive: string[], keywords: string[]): boolean {
  const tokens = new Set(
    topFive
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );

  return keywords.some((keyword) => {
    const keywordTokens = keyword
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return keywordTokens.some((token) => tokens.has(token));
  });
}

describe("SC-003 cross-platform recall rate", () => {
  it("meets >=90% relevance threshold with Claude/OpenCode continuity", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      const claudeStart = claudeAdapter.normalizeSessionStart({
        session_id: "claude-sc003",
        contract_version: "1.0.0",
        project_id: "sc-003-project",
        cwd: "/tmp/sc-003-project",
      });
      const opencodeStart = opencodeAdapter.normalizeSessionStart({
        session_id: "opencode-sc003",
        contract_version: "1.0.0",
        project_id: "sc-003-project",
        cwd: "/tmp/sc-003-project",
      });

      const claudePipeline = processPlatformEvent(claudeStart);
      const opencodePipeline = processPlatformEvent(opencodeStart);

      expect(claudePipeline.skipped).toBe(false);
      expect(opencodePipeline.skipped).toBe(false);
      expect(claudePipeline.projectIdentityKey).toBe(opencodePipeline.projectIdentityKey);

      const claudeMind = await Mind.open({ memoryPath, debug: false });
      const opencodeMind = await Mind.open({ memoryPath, debug: false });

      const checks = keywordFixture.checks;
      if (checks.length === 0) {
        return;
      }

      for (let index = 0; index < checks.length; index++) {
        const check = checks[index];
        const sourcePlatform = index % 2 === 0 ? "claude" : "opencode";
        const writer = sourcePlatform === "claude" ? claudeMind : opencodeMind;

        await writer.remember({
          type: "discovery",
          summary: `Cross-platform knowledge ${check.id}`,
          content: `${check.id} shared memory ${check.keywords.join(" ")}`,
          metadata: {
            platform: sourcePlatform,
            projectIdentityKey: claudePipeline.projectIdentityKey,
            checkId: check.id,
          },
        });
      }

      const results: RecallResult[] = [];
      for (let index = 0; index < checks.length; index++) {
        const check = checks[index];
        const queryPlatform = index % 2 === 0 ? "opencode" : "claude";
        const reader = queryPlatform === "claude" ? claudeMind : opencodeMind;
        const matches = await reader.search(`${check.id} ${check.keywords[0]}`, 5);
        results.push({
          checkId: check.id,
          topFive: matches.map(
            (match) => `${match.observation.summary} ${match.observation.content}`
          ),
        });
      }

      const passed = results.filter((result) => {
        const check = checks.find((item) => item.id === result.checkId);
        return check ? isRelevant(result.topFive, check.keywords) : false;
      }).length;

      const rate = results.length === 0 ? 0 : (passed / results.length) * 100;
      expect(rate).toBeGreaterThanOrEqual(90);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
