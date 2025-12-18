import { use, create } from '@memvid/sdk';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { randomBytes } from 'crypto';

// src/core/mind.ts

// src/types.ts
var DEFAULT_CONFIG = {
  memoryPath: ".claude/mind.mv2",
  maxContextObservations: 20,
  maxContextTokens: 2e3,
  autoCompress: true,
  minConfidence: 0.6,
  debug: false
};
function generateId() {
  return randomBytes(8).toString("hex");
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}
function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = /* @__PURE__ */ new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 6e4);
  const diffHours = Math.floor(diffMs / 36e5);
  const diffDays = Math.floor(diffMs / 864e5);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
async function readStdin() {
  const chunks = [];
  return new Promise((resolve2, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
function writeOutput(output) {
  console.log(JSON.stringify(output));
}
function debug(message) {
  if (process.env.MEMVID_MIND_DEBUG === "1") {
    console.error(`[memvid-mind] ${message}`);
  }
}
function extractKeyInfo(toolName, output) {
  const maxLength = 2e3;
  const truncated = output.length > maxLength ? output.slice(0, maxLength) + "\n... (truncated)" : output;
  switch (toolName) {
    case "Read":
      return extractFileReadSummary(truncated);
    case "Bash":
      return extractBashSummary(truncated);
    case "Edit":
      return extractEditSummary(truncated);
    case "Grep":
    case "Glob":
      return extractSearchSummary(truncated);
    default:
      return truncated;
  }
}
function extractFileReadSummary(output) {
  const lines = output.split("\n");
  if (lines.length <= 20) return output;
  return `${lines.slice(0, 10).join("\n")}
... (${lines.length} lines total)`;
}
function extractBashSummary(output) {
  const lines = output.split("\n");
  if (lines.length <= 30) return output;
  return [
    ...lines.slice(0, 10),
    `... (${lines.length - 20} lines omitted)`,
    ...lines.slice(-10)
  ].join("\n");
}
function extractEditSummary(output) {
  return output;
}
function extractSearchSummary(output) {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length <= 20) return output;
  return [
    ...lines.slice(0, 15),
    `... and ${lines.length - 15} more results`
  ].join("\n");
}
function classifyObservationType(toolName, output) {
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes("error") || lowerOutput.includes("failed") || lowerOutput.includes("exception")) {
    return "problem";
  }
  if (lowerOutput.includes("success") || lowerOutput.includes("passed") || lowerOutput.includes("completed")) {
    return "success";
  }
  if (lowerOutput.includes("warning") || lowerOutput.includes("deprecated")) {
    return "warning";
  }
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

// src/core/mind.ts
var Mind = class _Mind {
  memvid;
  config;
  sessionId;
  initialized = false;
  constructor(memvid, config) {
    this.memvid = memvid;
    this.config = config;
    this.sessionId = generateId();
  }
  /**
   * Open or create a Mind instance
   */
  static async open(configOverrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const memoryPath = resolve(projectDir, config.memoryPath);
    const memoryDir = dirname(memoryPath);
    await mkdir(memoryDir, { recursive: true });
    const memvid = existsSync(memoryPath) ? await use("basic", memoryPath) : await create(memoryPath, "basic");
    const mind = new _Mind(memvid, config);
    mind.initialized = true;
    if (config.debug) {
      console.error(`[memvid-mind] Opened: ${memoryPath}`);
    }
    return mind;
  }
  /**
   * Remember an observation
   */
  async remember(input) {
    const observation = {
      id: generateId(),
      timestamp: Date.now(),
      type: input.type,
      tool: input.tool,
      summary: input.summary,
      content: input.content,
      metadata: {
        ...input.metadata,
        sessionId: this.sessionId
      }
    };
    const frameId = await this.memvid.put({
      title: `[${observation.type}] ${observation.summary}`,
      label: observation.type,
      text: observation.content,
      metadata: {
        observationId: observation.id,
        timestamp: observation.timestamp,
        tool: observation.tool,
        sessionId: this.sessionId,
        ...observation.metadata
      },
      tags: [observation.type, observation.tool].filter(Boolean)
    });
    if (this.config.debug) {
      console.error(`[memvid-mind] Remembered: ${observation.summary}`);
    }
    return frameId;
  }
  /**
   * Search memories by query
   */
  async search(query, limit = 10) {
    const results = await this.memvid.find(query, { k: limit });
    return (results.frames || []).map((frame) => ({
      observation: {
        id: frame.metadata?.observationId || frame.frame_id,
        timestamp: frame.metadata?.timestamp || 0,
        type: frame.label,
        tool: frame.metadata?.tool,
        summary: frame.title?.replace(/^\[.*?\]\s*/, "") || "",
        content: frame.text || "",
        metadata: frame.metadata
      },
      score: frame.score || 0,
      snippet: frame.snippet || frame.text?.slice(0, 200) || ""
    }));
  }
  /**
   * Ask the memory a question (with LLM-generated answer)
   */
  async ask(question) {
    const result = await this.memvid.ask(question, { k: 5 });
    return result.answer || "No relevant memories found.";
  }
  /**
   * Get context for session start
   */
  async getContext(query) {
    const timeline = await this.memvid.timeline({
      limit: this.config.maxContextObservations,
      reverse: true
    });
    const frames = Array.isArray(timeline) ? timeline : timeline.frames || [];
    const recentObservations = frames.map(
      (frame) => {
        let ts = frame.metadata?.timestamp || frame.timestamp || 0;
        if (ts > 0 && ts < 4102444800) {
          ts = ts * 1e3;
        }
        return {
          id: frame.metadata?.observationId || frame.frame_id,
          timestamp: ts,
          type: frame.label || frame.metadata?.type || "observation",
          tool: frame.metadata?.tool,
          summary: frame.title?.replace(/^\[.*?\]\s*/, "") || frame.preview?.slice(0, 100) || "",
          content: frame.text || frame.preview || "",
          metadata: frame.metadata
        };
      }
    );
    let relevantMemories = [];
    if (query) {
      const searchResults = await this.search(query, 10);
      relevantMemories = searchResults.map((r) => r.observation);
    }
    let tokenCount = 0;
    for (const obs of recentObservations) {
      const text = `[${obs.type}] ${obs.summary}`;
      const tokens = estimateTokens(text);
      if (tokenCount + tokens > this.config.maxContextTokens) break;
      tokenCount += tokens;
    }
    return {
      recentObservations,
      relevantMemories,
      sessionSummaries: [],
      // TODO: Implement session summaries
      tokenCount
    };
  }
  /**
   * Save a session summary
   */
  async saveSessionSummary(summary) {
    const sessionSummary = {
      id: this.sessionId,
      startTime: Date.now() - 36e5,
      // Approximate
      endTime: Date.now(),
      observationCount: 0,
      // TODO: Track this
      keyDecisions: summary.keyDecisions,
      filesModified: summary.filesModified,
      summary: summary.summary
    };
    return this.memvid.put({
      title: `Session Summary: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`,
      label: "session",
      text: JSON.stringify(sessionSummary, null, 2),
      metadata: sessionSummary,
      tags: ["session", "summary"]
    });
  }
  /**
   * Get memory statistics
   */
  async stats() {
    const stats = await this.memvid.stats();
    const timeline = await this.memvid.timeline({ limit: 1, reverse: false });
    const recentTimeline = await this.memvid.timeline({ limit: 1, reverse: true });
    const oldestFrames = Array.isArray(timeline) ? timeline : timeline.frames || [];
    const newestFrames = Array.isArray(recentTimeline) ? recentTimeline : recentTimeline.frames || [];
    return {
      totalObservations: stats.frame_count || 0,
      totalSessions: 0,
      // TODO: Count unique sessions
      oldestMemory: oldestFrames[0]?.metadata?.timestamp || oldestFrames[0]?.timestamp || 0,
      newestMemory: newestFrames[0]?.metadata?.timestamp || newestFrames[0]?.timestamp || 0,
      fileSize: stats.size_bytes || 0,
      topTypes: {}
      // TODO: Aggregate
    };
  }
  /**
   * Get the session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  /**
   * Get the memory file path
   */
  getMemoryPath() {
    return resolve(process.cwd(), this.config.memoryPath);
  }
  /**
   * Check if initialized
   */
  isInitialized() {
    return this.initialized;
  }
};
var mindInstance = null;
async function getMind(config) {
  if (!mindInstance) {
    mindInstance = await Mind.open(config);
  }
  return mindInstance;
}
function resetMind() {
  mindInstance = null;
}

export { DEFAULT_CONFIG, Mind, classifyObservationType, debug, estimateTokens, extractKeyInfo, formatTimestamp, generateId, getMind, readStdin, resetMind, safeJsonParse, truncateToTokens, writeOutput };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map