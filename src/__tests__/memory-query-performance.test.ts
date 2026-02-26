import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { Mind } from "../core/mind.js";

const QUERY_COUNT = 20;
const WARMUP_QUERY_COUNT = 3;
const DEFAULT_ENTRY_COUNT = process.env.CI ? 120 : 80;
const ENTRY_COUNT = Number(process.env.MEMVID_PERF_ENTRIES || DEFAULT_ENTRY_COUNT);

function createTempMemoryPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-perf-sc005-"));
  return { dir, memoryPath: join(dir, "mind.mv2") };
}

async function seedMemory(memoryPath: string, entryCount: number): Promise<void> {
  const { create } = await import("@memvid/sdk");
  const memvid = await create(memoryPath, "basic");

  for (let i = 0; i < entryCount; i++) {
    await memvid.put({
      title: `Perf entry ${i}`,
      label: "discovery",
      text: `entry-${i} token-${i % 20} platform-${i % 2 === 0 ? "claude" : "opencode"}`,
      metadata: {
        timestamp: Date.now(),
        sessionId: `seed-session-${Math.floor(i / 50)}`,
      },
      tags: ["perf"],
    });
  }
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

describe("memory query performance", () => {
  it("keeps p95 real query latency under 2 seconds", async () => {
    const { dir, memoryPath } = createTempMemoryPath();

    try {
      await seedMemory(memoryPath, ENTRY_COUNT);
      const mind = await Mind.open({ memoryPath, debug: false });

      for (let i = 0; i < WARMUP_QUERY_COUNT; i++) {
        await mind.search(`token-${i % 20}`, 10);
      }

      const samples: number[] = [];
      for (let i = 0; i < QUERY_COUNT; i++) {
        const start = performance.now();

        if (i < 14) {
          const result = await mind.search(`token-${i % 20}`, 10);
          expect(result.length).toBeGreaterThan(0);
        } else if (i < 18) {
          const answer = await mind.ask(`What do you know about token-${i % 20}?`);
          expect(answer.length).toBeGreaterThan(0);
        } else if (i % 2 === 0) {
          const context = await mind.getContext();
          expect(context.recentObservations.length).toBeGreaterThan(0);
        } else {
          const stats = await mind.stats();
          expect(stats.totalObservations).toBeGreaterThan(0);
        }

        samples.push(performance.now() - start);
      }

      expect(p95(samples)).toBeLessThan(2000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
});
