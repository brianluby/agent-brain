#!/usr/bin/env node
/**
 * Memvid Mind - Ask Script
 *
 * Ask questions about memories using the SDK (no CLI dependency)
 */

import { use } from "@memvid/sdk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const args = process.argv.slice(2);
  const question = args.join(" ");

  if (!question) {
    console.error("Usage: ask.js <question>");
    process.exit(1);
  }

  // Get memory file path
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");

  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Start using Claude to build your memory!");
    process.exit(0);
  }

  try {
    const memvid = await use("basic", memoryPath);
    const result = await memvid.ask(question, { k: 5 });

    if (result.answer) {
      console.log("Answer:", result.answer);
    } else {
      // Fall back to search if ask doesn't return answer
      const searchResults = await memvid.find(question, { k: 5 });

      if (!searchResults.frames || searchResults.frames.length === 0) {
        console.log("No relevant memories found for your question.");
        process.exit(0);
      }

      console.log("Relevant memories:\n");
      for (const frame of searchResults.frames) {
        const title = frame.title || "Untitled";
        const snippet = (frame.text || "").slice(0, 300).replace(/\n/g, " ");
        console.log(`• ${title}`);
        console.log(`  ${snippet}${snippet.length >= 300 ? "..." : ""}\n`);
      }
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
