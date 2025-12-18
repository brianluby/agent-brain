#!/usr/bin/env node
import { create, use } from '@memvid/sdk';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const question = args.join(" ");
  if (!question) {
    console.error("Usage: ask.js <question>");
    process.exit(1);
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    const memoryDir = dirname(memoryPath);
    mkdirSync(memoryDir, { recursive: true });
    await create(memoryPath, "basic");
    console.log("\u2705 Memory initialized! No memories to ask about yet.\n");
    process.exit(0);
  }
  try {
    const memvid = await use("basic", memoryPath);
    const result = await memvid.ask(question, { k: 5 });
    if (result.answer) {
      console.log("Answer:", result.answer);
    } else {
      const searchResults = await memvid.find(question, { k: 5 });
      if (!searchResults.frames || searchResults.frames.length === 0) {
        console.log("No relevant memories found for your question.");
        process.exit(0);
      }
      console.log("Relevant memories:\n");
      for (const frame of searchResults.frames) {
        const title = frame.title || "Untitled";
        const snippet = (frame.text || "").slice(0, 300).replace(/\n/g, " ");
        console.log(`\u2022 ${title}`);
        console.log(`  ${snippet}${snippet.length >= 300 ? "..." : ""}
`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}
main();
//# sourceMappingURL=ask.js.map
//# sourceMappingURL=ask.js.map