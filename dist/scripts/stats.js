#!/usr/bin/env node
import { create, use } from '@memvid/sdk';
import { existsSync, mkdirSync, statSync } from 'fs';
import { resolve, dirname } from 'path';

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    const memoryDir = dirname(memoryPath);
    mkdirSync(memoryDir, { recursive: true });
    await create(memoryPath, "basic");
    console.log("\u2705 Memory initialized! Stats will appear as you work.\n");
  }
  try {
    const memvid = await use("basic", memoryPath);
    const stats = await memvid.stats();
    const fileStats = statSync(memoryPath);
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("        MEMVID MIND STATISTICS         ");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
    console.log(`\u{1F4C1} Memory File: ${memoryPath}`);
    console.log(`\u{1F4CA} Total Frames: ${stats.frame_count || 0}`);
    console.log(`\u{1F4BE} File Size: ${formatBytes(fileStats.size)}`);
    if (stats.capacity_bytes && typeof stats.capacity_bytes === "number") {
      const usagePercent = (fileStats.size / stats.capacity_bytes * 100).toFixed(1);
      console.log(`\u{1F4C8} Capacity Used: ${usagePercent}%`);
    }
    const timeline = await memvid.timeline({ limit: 1, reverse: true });
    if (timeline.frames && timeline.frames.length > 0) {
      const latest = timeline.frames[0];
      const latestDate = latest.metadata?.timestamp ? new Date(latest.metadata.timestamp).toLocaleString() : "Unknown";
      console.log(`\u{1F550} Latest Memory: ${latestDate}`);
    }
    console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  } catch (error) {
    console.error("Error getting stats:", error);
    process.exit(1);
  }
}
main();
//# sourceMappingURL=stats.js.map
//# sourceMappingURL=stats.js.map