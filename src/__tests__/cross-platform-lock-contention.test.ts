import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Mind } from "../core/mind.js";

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-platform-lock-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

describe("cross-platform lock contention", () => {
  it("serializes writes from mixed platform sessions", async () => {
    const { dir, memoryPath } = createTempMemoryPath();
    const writes = 12;

    try {
      const tasks = Array.from({ length: writes }, async (_, index) => {
        const mind = await Mind.open({ memoryPath, debug: false });
        await mind.remember({
          type: "discovery",
          summary: `platform-write-${index}`,
          content: `write-${index}`,
          metadata: { platform: index % 2 === 0 ? "claude" : "opencode" },
        });
      });

      await Promise.all(tasks);

      const mind = await Mind.open({ memoryPath, debug: false });
      const stats = await mind.stats();
      expect(stats.totalObservations).toBe(writes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
