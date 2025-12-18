#!/usr/bin/env node
import { create, use } from '@memvid/sdk';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

async function main() {
  const args = process.argv.slice(2);
  const query = args[0];
  const limit = parseInt(args[1] || "5", 10);
  if (!query) {
    console.error("Usage: find.js <query> [limit]");
    process.exit(1);
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const memoryPath = resolve(projectDir, ".claude/mind.mv2");
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    const memoryDir = dirname(memoryPath);
    mkdirSync(memoryDir, { recursive: true });
    await create(memoryPath, "basic");
    console.log("\u2705 Memory initialized! No memories to search yet.\n");
    process.exit(0);
  }
  try {
    const memvid = await use("basic", memoryPath);
    const results = await memvid.find(query, { k: limit });
    const hits = results.hits || [];
    if (hits.length === 0) {
      console.log(`No memories found for: "${query}"`);
      process.exit(0);
    }
    console.log(`Found ${results.total_hits || hits.length} memories for: "${query}"
`);
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
//# sourceMappingURL=find.js.map
//# sourceMappingURL=find.js.map