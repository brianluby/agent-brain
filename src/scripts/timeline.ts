#!/usr/bin/env node
/**
 * Memvid Mind - Timeline Script
 *
 * View recent memories using the SDK (no CLI dependency)
 */

import { use } from "@memvid/sdk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args[0] || "10", 10);

  // Get memory file path
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");

  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Start using Claude to build your memory!");
    process.exit(0);
  }

  try {
    const memvid = await use("basic", memoryPath);
    const timeline = await memvid.timeline({ limit, reverse: true });

    // SDK returns array directly or { frames: [...] }
    const frames = Array.isArray(timeline) ? timeline : (timeline.frames || []);

    if (frames.length === 0) {
      console.log("No memories yet. Start using Claude to build your memory!");
      process.exit(0);
    }

    console.log(`Recent ${frames.length} memories:\n`);

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const preview = frame.preview || "";
      const uri = frame.uri || `frame/${frame.frame_id}`;
      const timestamp = frame.timestamp
        ? new Date(frame.timestamp * 1000).toLocaleString()
        : "Unknown time";
      const snippet = preview.slice(0, 100).replace(/\n/g, " ");

      console.log(`#${i + 1} ${uri}`);
      console.log(`   📅 ${timestamp}`);
      console.log(`   ${snippet}${snippet.length >= 100 ? "..." : ""}`);
      console.log();
    }
  } catch (error) {
    console.error("Error reading timeline:", error);
    process.exit(1);
  }
}

main();
