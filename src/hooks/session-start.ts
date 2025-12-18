#!/usr/bin/env node
/**
 * Memvid Mind - Session Start Hook
 *
 * SMART CONTEXT INJECTION
 * Injects relevant context from memory at the start of each session.
 * Uses project name + recent activity to surface the most useful memories.
 */

import { getMind } from "../core/mind.js";
import {
  readStdin,
  writeOutput,
  debug,
  formatTimestamp,
} from "../utils/helpers.js";
import type { HookInput, Observation } from "../types.js";
import { basename } from "node:path";

// Maximum memories to inject at session start
const MAX_RECENT_MEMORIES = 8;
const MAX_RELEVANT_MEMORIES = 5;

// Type icons for visual scanning
const TYPE_ICONS: Record<string, string> = {
  decision: "🎯",
  discovery: "💡",
  problem: "⚠️",
  solution: "✅",
  pattern: "🔄",
  warning: "🚨",
  success: "🎉",
  refactor: "🔧",
  bugfix: "🐛",
  feature: "✨",
  observation: "👁️",
};

async function main() {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);

    debug(`Session starting: ${hookInput.session_id}`);

    // Initialize mind
    const mind = await getMind();

    // Get project name for semantic search
    const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectName = basename(projectDir);

    // Get recent context AND search for project-relevant memories
    const context = await mind.getContext(projectName);
    const stats = await mind.stats();

    // Format context for injection
    const contextLines: string[] = [];

    if (context.recentObservations.length > 0 || stats.totalObservations > 0) {
      contextLines.push("<memvid-mind-context>");
      contextLines.push(`# 🧠 Memory Bank: ${stats.totalObservations} memories`);
      contextLines.push("");
      contextLines.push("**IMPORTANT: When user asks about injected context, session start context, or what memories were loaded, show this FULL list below verbatim.**");
      contextLines.push("");

      // Recent memories (most valuable for continuity)
      // Prioritize file edits and filter out noisy command outputs
      if (context.recentObservations.length > 0) {
        contextLines.push("## Recent Activity");

        // Separate file edits from other observations
        const fileEdits = context.recentObservations.filter(
          obs => obs.tool === "FileEdit" || obs.tool === "FileChanges" || obs.tool === "Edit" || obs.tool === "Write"
        );
        const otherObs = context.recentObservations.filter(
          obs => obs.tool !== "FileEdit" && obs.tool !== "FileChanges" && obs.tool !== "Bash" && !obs.summary.includes("Command:")
        );

        // Show file edits first (they're the most important)
        if (fileEdits.length > 0) {
          contextLines.push("### Files Edited");
          for (const obs of fileEdits.slice(0, 5)) {
            const timeAgo = formatTimestamp(obs.timestamp);
            contextLines.push(`🔧 **${obs.summary}** _(${timeAgo})_`);
          }
          contextLines.push("");
        }

        // Then show other recent activity (excluding noisy Bash outputs)
        if (otherObs.length > 0) {
          contextLines.push("### Other Activity");
          for (const obs of otherObs.slice(0, MAX_RECENT_MEMORIES - fileEdits.length)) {
            const icon = TYPE_ICONS[obs.type] || "📝";
            const timeAgo = formatTimestamp(obs.timestamp);
            contextLines.push(`${icon} **${obs.summary}** _(${timeAgo})_`);
          }
          contextLines.push("");
        }
      }

      // Relevant memories from semantic search (based on project)
      if (context.relevantMemories.length > 0) {
        contextLines.push(`## Relevant to "${projectName}"`);
        const relevant = context.relevantMemories.slice(0, MAX_RELEVANT_MEMORIES);

        for (const obs of relevant) {
          const icon = TYPE_ICONS[obs.type] || "📝";
          contextLines.push(`${icon} ${obs.summary}`);
        }
        contextLines.push("");
      }

      // Categorize by type for quick reference
      const byType = categorizeByType(context.recentObservations);
      if (Object.keys(byType).length > 1) {
        contextLines.push("## Quick Stats");
        const statParts: string[] = [];
        for (const [type, count] of Object.entries(byType)) {
          const icon = TYPE_ICONS[type] || "📝";
          statParts.push(`${icon} ${count} ${type}s`);
        }
        contextLines.push(statParts.join(" | "));
        contextLines.push("");
      }

      // Footer
      contextLines.push("---");
      contextLines.push(
        `💾 Memory file: \`.claude/mind.mv2\` | 📊 ${formatFileSize(stats.fileSize)}`
      );
      contextLines.push(
        "🔍 Search: Use `/mem search <query>` to find specific memories"
      );
      contextLines.push("</memvid-mind-context>");
    }

    // SessionStart hooks use hookSpecificOutput.additionalContext
    const output: any = {
      continue: true,
    };

    // If we have context to inject, add it via hookSpecificOutput
    if (contextLines.length > 0) {
      output.hookSpecificOutput = {
        hookEventName: "SessionStart",
        additionalContext: contextLines.join("\n"),
      };
    }

    writeOutput(output);
  } catch (error) {
    debug(`Error: ${error}`);
    // Don't block on errors - just continue without context
    writeOutput({ continue: true });
  }
}

/**
 * Categorize observations by type for stats
 */
function categorizeByType(observations: Observation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const obs of observations) {
    counts[obs.type] = (counts[obs.type] || 0) + 1;
  }
  return counts;
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

main();
