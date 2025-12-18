#!/usr/bin/env node
/**
 * Memvid Mind - Stats Script
 *
 * Get memory statistics using the SDK (no CLI dependency)
 */

import { use } from "@memvid/sdk";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

async function main() {
  // Get memory file path
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");

  if (!existsSync(memoryPath)) {
    console.log("No memory file found at:", memoryPath);
    console.log("Start using Claude to build your memory!");
    process.exit(0);
  }

  try {
    const memvid = await use("basic", memoryPath);
    const stats = await memvid.stats();
    const fileStats = statSync(memoryPath);

    console.log("═══════════════════════════════════════");
    console.log("        MEMVID MIND STATISTICS         ");
    console.log("═══════════════════════════════════════\n");

    console.log(`📁 Memory File: ${memoryPath}`);
    console.log(`📊 Total Frames: ${stats.frame_count || 0}`);
    console.log(`💾 File Size: ${formatBytes(fileStats.size)}`);

    if (stats.capacity_bytes && typeof stats.capacity_bytes === 'number') {
      const usagePercent = ((fileStats.size / stats.capacity_bytes) * 100).toFixed(1);
      console.log(`📈 Capacity Used: ${usagePercent}%`);
    }

    // Get timeline for recent activity
    const timeline = await memvid.timeline({ limit: 1, reverse: true });
    if (timeline.frames && timeline.frames.length > 0) {
      const latest = timeline.frames[0];
      const latestDate = latest.metadata?.timestamp
        ? new Date(latest.metadata.timestamp as number).toLocaleString()
        : "Unknown";
      console.log(`🕐 Latest Memory: ${latestDate}`);
    }

    console.log("\n═══════════════════════════════════════");
  } catch (error) {
    console.error("Error getting stats:", error);
    process.exit(1);
  }
}

main();
