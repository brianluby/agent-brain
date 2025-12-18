#!/usr/bin/env node
import { create, use } from '@memvid/sdk';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args[0] || "10", 10);
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    const memoryDir = dirname(memoryPath);
    mkdirSync(memoryDir, { recursive: true });
    await create(memoryPath, "basic");
    console.log("\u2705 Memory initialized! No memories to show yet.\n");
    process.exit(0);
  }
  try {
    const memvid = await use("basic", memoryPath);
    const timeline = await memvid.timeline({ limit, reverse: true });
    const frames = Array.isArray(timeline) ? timeline : timeline.frames || [];
    if (frames.length === 0) {
      console.log("No memories yet. Start using Claude to build your memory!");
      process.exit(0);
    }
    console.log(`Recent ${frames.length} memories:
`);
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const preview = frame.preview || "";
      const uri = frame.uri || `frame/${frame.frame_id}`;
      const timestamp = frame.timestamp ? new Date(frame.timestamp * 1e3).toLocaleString() : "Unknown time";
      const snippet = preview.slice(0, 100).replace(/\n/g, " ");
      console.log(`#${i + 1} ${uri}`);
      console.log(`   \u{1F4C5} ${timestamp}`);
      console.log(`   ${snippet}${snippet.length >= 100 ? "..." : ""}`);
      console.log();
    }
  } catch (error) {
    console.error("Error reading timeline:", error);
    process.exit(1);
  }
}
main();
//# sourceMappingURL=timeline.js.map
//# sourceMappingURL=timeline.js.map