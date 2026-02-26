#!/usr/bin/env node
/**
 * Memvid Mind - Timeline Script
 *
 * View recent memories using the SDK (no CLI dependency)
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
  const limit = parseInt(args[0] || "10", 10);

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
    console.log("✅ Memory initialized! No memories to show yet.\n");
    process.exit(0);
  }

  try {
    const mv = memvid as any;
    const timeline = await mv.timeline({ limit, reverse: true });

    // SDK returns array directly or { frames: [...] }
    const frames = Array.isArray(timeline) ? timeline : timeline.frames || [];

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
