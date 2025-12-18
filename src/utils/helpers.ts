/**
 * Memvid Mind - Utility Helpers
 */

import { randomBytes } from "node:crypto";

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Estimate token count for text (rough approximation)
 * ~4 characters per token for English text
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within token limit
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

/**
 * Format timestamp to human-readable string
 */
export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

/**
 * Parse JSON safely
 */
export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Read all stdin as string
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

/**
 * Write JSON to stdout and exit
 */
export function writeOutput(output: unknown): void {
  console.log(JSON.stringify(output));
}

/**
 * Log debug message to stderr
 */
export function debug(message: string): void {
  if (process.env.MEMVID_MIND_DEBUG === "1") {
    console.error(`[memvid-mind] ${message}`);
  }
}

/**
 * Extract key information from tool output
 */
export function extractKeyInfo(toolName: string, output: string): string {
  // Truncate very long outputs
  const maxLength = 2000;
  const truncated = output.length > maxLength
    ? output.slice(0, maxLength) + "\n... (truncated)"
    : output;

  // Tool-specific extraction
  switch (toolName) {
    case "Read":
      // Extract file summary from read output
      return extractFileReadSummary(truncated);
    case "Bash":
      // Extract command summary
      return extractBashSummary(truncated);
    case "Edit":
      // Extract edit summary
      return extractEditSummary(truncated);
    case "Grep":
    case "Glob":
      // Extract search summary
      return extractSearchSummary(truncated);
    default:
      return truncated;
  }
}

function extractFileReadSummary(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= 20) return output;
  return `${lines.slice(0, 10).join("\n")}\n... (${lines.length} lines total)`;
}

function extractBashSummary(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= 30) return output;
  return [
    ...lines.slice(0, 10),
    `... (${lines.length - 20} lines omitted)`,
    ...lines.slice(-10),
  ].join("\n");
}

function extractEditSummary(output: string): string {
  // Edits are usually compact, return as-is
  return output;
}

function extractSearchSummary(output: string): string {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length <= 20) return output;
  return [
    ...lines.slice(0, 15),
    `... and ${lines.length - 15} more results`,
  ].join("\n");
}

/**
 * Classify observation type from tool and output
 */
export function classifyObservationType(
  toolName: string,
  output: string
): "discovery" | "decision" | "problem" | "solution" | "pattern" | "warning" | "success" | "refactor" | "bugfix" | "feature" {
  const lowerOutput = output.toLowerCase();

  // Error detection
  if (
    lowerOutput.includes("error") ||
    lowerOutput.includes("failed") ||
    lowerOutput.includes("exception")
  ) {
    return "problem";
  }

  // Success detection
  if (
    lowerOutput.includes("success") ||
    lowerOutput.includes("passed") ||
    lowerOutput.includes("completed")
  ) {
    return "success";
  }

  // Warning detection
  if (lowerOutput.includes("warning") || lowerOutput.includes("deprecated")) {
    return "warning";
  }

  // Tool-based classification
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
      return "discovery";
    case "Edit":
      if (lowerOutput.includes("fix") || lowerOutput.includes("bug")) {
        return "bugfix";
      }
      return "refactor";
    case "Write":
      return "feature";
    default:
      return "discovery";
  }
}
