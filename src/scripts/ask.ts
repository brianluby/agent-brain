#!/usr/bin/env node
/**
 * Memvid Mind - Ask Script
 *
 * Ask questions about memories using the SDK (no CLI dependency)
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openMemorySafely, resolveScriptMemoryPath } from "./utils.js";

// Ensure dependencies are installed before importing SDK
async function ensureDeps() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(__dirname, "../..");
  const sdkPath = resolve(pluginRoot, "node_modules/@memvid/sdk");

  if (!existsSync(sdkPath)) {
    console.log("Installing dependencies...");
    try {
      execSync("npm install --production --no-fund --no-audit", {
        cwd: pluginRoot,
        stdio: "inherit",
        timeout: 120000,
      });
    } catch {
      console.error("Failed to install dependencies. Please run: npm install");
      process.exit(1);
    }
  }
}

// Dynamic import for SDK
async function loadSDK() {
  await ensureDeps();
  return await import("@memvid/sdk");
}

async function main() {
  const args = process.argv.slice(2);
  const question = args.join(" ");

  if (!question) {
    console.error("Usage: ask.js <question>");
    process.exit(1);
  }

  // Get memory file path
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.cwd();
  const { memoryPath, migrationPrompt } = resolveScriptMemoryPath(projectDir);

  if (migrationPrompt) {
    console.log("Legacy memory detected; you can move it with the command below.");
    console.log(`${migrationPrompt}\n`);
  }

  // Load SDK dynamically
  const { use, create } = await loadSDK();

  // Open memory safely (handles corrupted files)
  const { memvid, isNew } = await openMemorySafely(memoryPath, use, create);

  if (isNew || !memvid) {
    console.log("✅ Memory initialized! No memories to ask about yet.\n");
    process.exit(0);
  }

  try {
    const mv = memvid as any;
    const result = await mv.ask(question, { k: 5, mode: "lex" });

    if (result.answer) {
      console.log("Answer:", result.answer);
    } else {
      // Fall back to search if ask doesn't return answer
      const searchResults = await mv.find(question, { k: 5, mode: "lex" });

      if (!searchResults.hits || searchResults.hits.length === 0) {
        console.log("No relevant memories found for your question.");
        process.exit(0);
      }

      console.log("Relevant memories:\n");
      for (const hit of searchResults.hits) {
        const title = hit.title || "Untitled";
        const snippet = (hit.snippet || "").slice(0, 300).replace(/\n/g, " ");
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
