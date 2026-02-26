#!/usr/bin/env node
/**
 * Memvid Mind - Stop Hook
 *
 * AUTO SESSION SUMMARY
 * Runs when Claude session ends.
 * Generates an intelligent session summary for future reference.
 *
 * WORKAROUND: Since PostToolUse doesn't fire for Edit operations (Claude Code bug),
 * we capture git diff at session end to record all file modifications.
 */

import { getMind } from "../core/mind.js";
import { readStdin, writeOutput, debug } from "../utils/helpers.js";
import type { HookInput, HookOutput } from "../types.js";
import {
  detectPlatform,
  getDefaultAdapterRegistry,
  processPlatformEvent,
} from "../platforms/index.js";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Minimum observations to generate a session summary
const MIN_OBSERVATIONS_FOR_SUMMARY = 3;

/**
 * Capture file modifications at session end
 * WORKAROUND for Claude Code bug: PostToolUse hooks don't fire for Edit operations
 *
 * Captures both:
 * 1. Git tracked files that changed (git diff)
 * 2. Recently modified files in untracked directories (find -mmin)
 */
async function captureFileChanges(mind: Awaited<ReturnType<typeof getMind>>) {
  try {
    // Get the working directory from the mind's memory path
    const memoryPath = mind.getMemoryPath();
    const workDir = dirname(dirname(memoryPath));

    const allChangedFiles: string[] = [];
    let gitDiffContent = "";

    // 1. Get git tracked changes (staged and unstaged)
    // Use shorter timeouts to avoid blocking session end
    try {
      const diffNames = execSync("git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || echo ''", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const stagedNames = execSync("git diff --cached --name-only 2>/dev/null || echo ''", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      const gitFiles = [...new Set([
        ...diffNames.split("\n").filter(Boolean),
        ...stagedNames.split("\n").filter(Boolean),
      ])];

      allChangedFiles.push(...gitFiles);

      // Get git diff stat for tracked files
      if (gitFiles.length > 0) {
        try {
          gitDiffContent = execSync("git diff HEAD --stat 2>/dev/null | head -30", {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 3000,
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
        } catch {
          // Ignore
        }
      }
    } catch {
      // Not a git repo or git not available - continue to find recent files
    }

    // 2. Find recently modified files (last 30 minutes) in common code directories
    // This catches changes in untracked directories
    // Use -maxdepth to limit search and exclude common large dirs for speed
    // Reduced timeout and scope to avoid hanging
    try {
      const recentFiles = execSync(
        `find . -maxdepth 4 -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" -o -name "*.json" -o -name "*.py" -o -name "*.rs" \\) -mmin -30 ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.next/*" ! -path "*/target/*" 2>/dev/null | head -30`,
        {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      ).trim();

      const recentFilesList = recentFiles.split("\n").filter(Boolean).map(f => f.replace(/^\.\//, ""));

      // Add files not already in the list
      for (const file of recentFilesList) {
        if (!allChangedFiles.includes(file)) {
          allChangedFiles.push(file);
        }
      }
    } catch {
      // find command failed, continue with what we have
    }

    if (allChangedFiles.length === 0) {
      debug("No file changes detected");
      return;
    }

    debug(`Capturing ${allChangedFiles.length} changed files`);

    // Build content summary
    const contentParts = [`## Files Modified This Session\n\n${allChangedFiles.map(f => `- ${f}`).join("\n")}`];

    if (gitDiffContent) {
      contentParts.push(`\n## Git Changes Summary\n\`\`\`\n${gitDiffContent}\n\`\`\``);
    }

    // Store the changes as a memory
    await mind.remember({
      type: "refactor",
      summary: `Session edits: ${allChangedFiles.length} file(s) modified`,
      content: contentParts.join("\n"),
      tool: "FileChanges",
      metadata: {
        files: allChangedFiles,
        fileCount: allChangedFiles.length,
        captureMethod: "git-diff-plus-recent",
      },
    });

    // Also store individual entries for important file types (README, config, etc.)
    // so they're searchable by name
    for (const file of allChangedFiles) {
      const fileName = file.split("/").pop() || file;
      const isImportant = /^(README|CHANGELOG|package\.json|Cargo\.toml|\.env)/i.test(fileName);

      if (isImportant) {
        await mind.remember({
          type: "refactor",
          summary: `Modified ${fileName}`,
          content: `File edited: ${file}\nThis file was modified during the session.`,
          tool: "FileEdit",
          metadata: {
            files: [file],
            fileName,
          },
        });
        debug(`Stored individual edit: ${fileName}`);
      }
    }

    debug(`Stored file changes: ${allChangedFiles.length} files`);
  } catch (error) {
    debug(`Failed to capture file changes: ${error}`);
  }
}

export async function runStopHook(): Promise<void> {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);

    debug(`Session stopping: ${hookInput.session_id}`);

    const platform = detectPlatform(hookInput);
    const adapter = getDefaultAdapterRegistry().resolve(platform);
    if (!adapter) {
      debug(`Unsupported platform at stop hook: ${platform}`);
      writeOutput({ continue: true });
      return;
    }

    const normalizedStop = adapter.normalizeSessionStop(hookInput);
    const pipelineResult = processPlatformEvent(normalizedStop);
    if (pipelineResult.skipped) {
      debug(`Skipping stop processing: ${pipelineResult.reason}`);
      writeOutput({ continue: true });
      return;
    }

    // Initialize mind
    const mind = await getMind();
    const stats = await mind.stats();

    // WORKAROUND: Capture file changes since PostToolUse doesn't fire for Edit
    await captureFileChanges(mind);

    // Try to read the transcript for richer summary
    let transcriptContent = "";
    if (hookInput.transcript_path) {
      try {
        await access(hookInput.transcript_path, constants.R_OK);
        transcriptContent = await readFile(hookInput.transcript_path, "utf-8");
      } catch {
        // Transcript not available, that's ok
      }
    }

    // Get recent observations from this session
    const context = await mind.getContext();
    const sessionObservations = context.recentObservations.filter(
      (obs) => obs.metadata?.sessionId === mind.getSessionId()
    );

    // Generate session summary if we have enough observations
    if (sessionObservations.length >= MIN_OBSERVATIONS_FOR_SUMMARY) {
      const summary = generateSessionSummary(
        sessionObservations,
        transcriptContent
      );

      // Save the session summary
      await mind.saveSessionSummary(summary);

      debug(
        `Session summary saved: ${summary.keyDecisions.length} decisions, ${summary.filesModified.length} files`
      );
    }

    debug(
      `Session complete. Total memories: ${stats.totalObservations}, File: ${mind.getMemoryPath()}`
    );

    // Continue without blocking
    const output: HookOutput = {
      continue: true,
    };

    writeOutput(output);
  } catch (error) {
    debug(`Error: ${error}`);
    // Don't block on errors
    writeOutput({ continue: true });
  }
}

/**
 * Generate a session summary from observations
 */
function generateSessionSummary(
  observations: Array<{
    type: string;
    summary: string;
    content: string;
    metadata?: { files?: string[]; sessionId?: string; [key: string]: unknown };
  }>,
  transcript: string
): {
  keyDecisions: string[];
  filesModified: string[];
  summary: string;
} {
  // Extract key decisions
  const keyDecisions: string[] = [];
  const filesModified = new Set<string>();

  for (const obs of observations) {
    // Track decisions
    if (
      obs.type === "decision" ||
      obs.summary.toLowerCase().includes("chose") ||
      obs.summary.toLowerCase().includes("decided")
    ) {
      keyDecisions.push(obs.summary);
    }

    // Track files from metadata
    const files = obs.metadata?.files as string[] | undefined;
    if (files) {
      files.forEach((f) => filesModified.add(f));
    }
  }

  // Extract file paths from transcript if available
  if (transcript) {
    const filePatterns = [
      /(?:Read|Edit|Write)[^"]*"([^"]+)"/g,
      /file_path["\s:]+([^\s"]+)/g,
    ];

    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(transcript)) !== null) {
        const path = match[1];
        if (path && !path.includes("node_modules") && !path.startsWith(".")) {
          filesModified.add(path);
        }
      }
    }
  }

  // Generate summary based on observation types
  const typeCounts: Record<string, number> = {};
  for (const obs of observations) {
    typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
  }

  const summaryParts: string[] = [];

  if (typeCounts.feature) {
    summaryParts.push(`Added ${typeCounts.feature} feature(s)`);
  }
  if (typeCounts.bugfix) {
    summaryParts.push(`Fixed ${typeCounts.bugfix} bug(s)`);
  }
  if (typeCounts.refactor) {
    summaryParts.push(`Refactored ${typeCounts.refactor} item(s)`);
  }
  if (typeCounts.discovery) {
    summaryParts.push(`Made ${typeCounts.discovery} discovery(ies)`);
  }
  if (typeCounts.problem) {
    summaryParts.push(`Encountered ${typeCounts.problem} problem(s)`);
  }
  if (typeCounts.solution) {
    summaryParts.push(`Found ${typeCounts.solution} solution(s)`);
  }

  const summary =
    summaryParts.length > 0
      ? summaryParts.join(". ") + "."
      : `Session with ${observations.length} observations.`;

  return {
    keyDecisions: keyDecisions.slice(0, 10),
    filesModified: Array.from(filesModified).slice(0, 20),
    summary,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runStopHook();
}
