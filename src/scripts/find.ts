#!/usr/bin/env node
/**
 * Memvid Mind - Find Script
 *
 * Search memories using the SDK (no CLI dependency)
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
  const query = args[0];
  const limit = parseInt(args[1] || "5", 10);

  if (!query) {
    console.error("Usage: find.js <query> [limit]");
    process.exit(1);
  }

  // Get memory file path
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.cwd();
  const { memoryPath, migrationPrompt } = resolveScriptMemoryPath(projectDir);

  if (migrationPrompt) {
    console.log("Legacy memory detected at .claude/mind.mv2.");
    console.log(`Move it to .agent-brain/mind.mv2? Run: ${migrationPrompt}\n`);
  }

  // Load SDK dynamically
  const { use, create } = await loadSDK();

  // Open memory safely (handles corrupted files)
  const { memvid, isNew } = await openMemorySafely(memoryPath, use, create);

  if (isNew || !memvid) {
    console.log("✅ Memory initialized! No memories to search yet.\n");
    process.exit(0);
  }

  try {
    // Use lexical-only search with mode: "lex" for fast retrieval
    const results = await (memvid as any).find(query, { k: limit, mode: "lex" });

    // SDK returns { hits: [...], context: ..., total_hits: ... }
    const hits = results.hits || [];

    if (hits.length === 0) {
      console.log(`No memories found for: "${query}"`);
      process.exit(0);
    }

    console.log(`Found ${results.total_hits || hits.length} memories for: "${query}"\n`);

    for (const hit of hits) {
      const title = hit.title || "Untitled";
      const score = hit.score?.toFixed(2) || "N/A";
      const snippet = (hit.snippet || "").slice(0, 200).replace(/\n/g, " ");
      const labels = hit.labels?.slice(0, 3).join(", ") || "";

      console.log(`[${labels || "memory"}] ${title}`);
      console.log(`  Score: ${score} | URI: ${hit.uri || ""}`);
      console.log(`  ${snippet}${snippet.length >= 200 ? "..." : ""}`);
      console.log();
    }
  } catch (error) {
    console.error("Error searching memories:", error);
    process.exit(1);
  }
}

main();
