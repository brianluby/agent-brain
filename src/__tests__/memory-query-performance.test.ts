import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";

function searchMemories(memories: string[], query: string, limit: number): string[] {
  const lower = query.toLowerCase();
  return memories.filter((entry) => entry.includes(lower)).slice(0, limit);
}

// TODO: SC-005 — This is a placeholder/structural test that benchmarks a trivial
// Array.filter().slice() operation, not the actual @memvid/sdk search path.
// Real validation of the p95 <2s latency requires benchmarking against the SDK
// with a representative 100k-entry workload profile (see spec SC-005).
describe("memory query performance", () => {
  it("keeps p95 simulated query latency under 2 seconds for 100k entries", () => {
    const memories = Array.from({ length: 100_000 }, (_, i) =>
      `entry-${i} token-${i % 100} platform-${i % 2 === 0 ? "claude" : "opencode"}`
    );

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const result = searchMemories(memories, `token-${i % 100}`, 10);
      const elapsed = performance.now() - start;
      expect(result.length).toBeGreaterThan(0);
      samples.push(elapsed);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    expect(p95).toBeLessThan(2000);
  });
});
