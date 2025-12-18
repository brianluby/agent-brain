#!/usr/bin/env node
/**
 * Memvid Mind - Post Tool Use Hook
 *
 * Captures observations after each tool execution.
 * Uses ENDLESS MODE compression to store 20x more context.
 * Intelligently extracts key learnings and stores them for future sessions.
 */

import { getMind } from "../core/mind.js";
import {
  readStdin,
  writeOutput,
  debug,
  classifyObservationType,
} from "../utils/helpers.js";
import {
  compressToolOutput,
  getCompressionStats,
} from "../utils/compression.js";
import type { HookInput } from "../types.js";

// Tools worth capturing observations from
const OBSERVED_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "Update",  // Claude Code may use Update for edits
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit",
]);

// Minimum output length to consider capturing
const MIN_OUTPUT_LENGTH = 50;

// Tools that should ALWAYS be captured regardless of output length
const ALWAYS_CAPTURE_TOOLS = new Set(["Edit", "Write", "Update", "NotebookEdit"]);

// Maximum output length after compression
const MAX_OUTPUT_LENGTH = 2500;

async function main() {
  try {
    // Read hook input from stdin
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);

    const { tool_name, tool_input, tool_response } = hookInput;

    // Debug: Log all tool names to understand what we're receiving
    debug(`Tool received: ${tool_name}`);

    // Skip if not a tool we observe
    if (!tool_name || !OBSERVED_TOOLS.has(tool_name)) {
      debug(`Skipping tool: ${tool_name} (not in OBSERVED_TOOLS)`);
      writeOutput({ continue: true });
      return;
    }

    // Convert tool_response to string (it can be object or string)
    const tool_output = typeof tool_response === 'string'
      ? tool_response
      : JSON.stringify(tool_response, null, 2);

    // Skip if output is too short or missing (but ALWAYS capture file modifications)
    const alwaysCapture = ALWAYS_CAPTURE_TOOLS.has(tool_name);
    if (!alwaysCapture && (!tool_output || tool_output.length < MIN_OUTPUT_LENGTH)) {
      writeOutput({ continue: true });
      return;
    }

    // For file modifications with minimal output, create a descriptive content
    let effectiveOutput = tool_output || "";
    if (alwaysCapture && effectiveOutput.length < MIN_OUTPUT_LENGTH) {
      const filePath = tool_input?.file_path as string || "unknown file";
      const fileName = filePath.split("/").pop() || "file";
      effectiveOutput = `File modified: ${fileName}\nPath: ${filePath}\nTool: ${tool_name}`;
    }

    // Skip system reminders and internal content
    if (
      effectiveOutput.includes("<system-reminder>") ||
      effectiveOutput.includes("<memvid-mind-context>")
    ) {
      writeOutput({ continue: true });
      return;
    }

    // ENDLESS MODE: Compress large outputs to ~500 tokens
    const { compressed, wasCompressed, originalSize } = compressToolOutput(
      tool_name,
      tool_input,
      effectiveOutput
    );

    if (wasCompressed) {
      const stats = getCompressionStats(originalSize, compressed.length);
      debug(`🗜️ Endless Mode: ${stats.savedPercent}% compression (${originalSize} → ${compressed.length} chars)`);
    }

    debug(`Capturing observation from ${tool_name}`);

    // Initialize mind
    const mind = await getMind();

    // Extract and classify the observation
    const observationType = classifyObservationType(tool_name, compressed);

    // Generate a summary based on tool type
    const summary = generateSummary(tool_name, tool_input, effectiveOutput);

    // Use compressed content (already within limits)
    const content = compressed.length > MAX_OUTPUT_LENGTH
      ? compressed.slice(0, MAX_OUTPUT_LENGTH) + "\n... (compressed)"
      : compressed;

    // Extract metadata with compression flag
    const metadata = extractMetadata(tool_name, tool_input);
    if (wasCompressed) {
      metadata.compressed = true;
      metadata.originalSize = originalSize;
      metadata.compressedSize = compressed.length;
    }

    // Store the observation
    await mind.remember({
      type: observationType,
      summary,
      content,
      tool: tool_name,
      metadata,
    });

    debug(`Stored: [${observationType}] ${summary}${wasCompressed ? " (compressed)" : ""}`);

    // Continue without blocking
    writeOutput({ continue: true });
  } catch (error) {
    debug(`Error: ${error}`);
    // Don't block on errors
    writeOutput({ continue: true });
  }
}

/**
 * Generate a summary based on tool type and input
 */
function generateSummary(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  toolOutput: string
): string {
  switch (toolName) {
    case "Read": {
      const path = toolInput?.file_path as string;
      const fileName = path?.split("/").pop() || "file";
      const lines = toolOutput.split("\n").length;
      return `Read ${fileName} (${lines} lines)`;
    }

    case "Edit": {
      const path = toolInput?.file_path as string;
      const fileName = path?.split("/").pop() || "file";
      return `Edited ${fileName}`;
    }

    case "Write": {
      const path = toolInput?.file_path as string;
      const fileName = path?.split("/").pop() || "file";
      return `Created ${fileName}`;
    }

    case "Bash": {
      const cmd = toolInput?.command as string;
      const shortCmd = cmd?.split("\n")[0].slice(0, 50) || "command";
      const hasError =
        toolOutput.toLowerCase().includes("error") ||
        toolOutput.toLowerCase().includes("failed");
      return hasError ? `Command failed: ${shortCmd}` : `Ran: ${shortCmd}`;
    }

    case "Grep": {
      const pattern = toolInput?.pattern as string;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} matches for "${pattern?.slice(0, 30)}"`;
    }

    case "Glob": {
      const pattern = toolInput?.pattern as string;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} files matching "${pattern?.slice(0, 30)}"`;
    }

    case "WebFetch":
    case "WebSearch": {
      const url = (toolInput?.url as string) || (toolInput?.query as string);
      return `Fetched: ${url?.slice(0, 50)}`;
    }

    default:
      return `${toolName} completed`;
  }
}

/**
 * Extract metadata from tool input
 */
function extractMetadata(
  toolName: string,
  toolInput: Record<string, unknown> | undefined
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (!toolInput) return metadata;

  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      if (toolInput.file_path) {
        metadata.files = [toolInput.file_path];
      }
      break;

    case "Bash":
      if (toolInput.command) {
        metadata.command = (toolInput.command as string).slice(0, 200);
      }
      break;

    case "Grep":
    case "Glob":
      if (toolInput.pattern) {
        metadata.pattern = toolInput.pattern;
      }
      if (toolInput.path) {
        metadata.searchPath = toolInput.path;
      }
      break;
  }

  return metadata;
}

main();
