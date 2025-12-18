#!/usr/bin/env node
import { use, create } from '@memvid/sdk';
import { existsSync } from 'fs';
import { basename, resolve, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { randomBytes } from 'crypto';

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
var MAX_RECENT_MEMORIES = 8;
var MAX_RELEVANT_MEMORIES = 5;
var TYPE_ICONS = {
  decision: "\u{1F3AF}",
  discovery: "\u{1F4A1}",
  problem: "\u26A0\uFE0F",
  solution: "\u2705",
  pattern: "\u{1F504}",
  warning: "\u{1F6A8}",
  success: "\u{1F389}",
  refactor: "\u{1F527}",
  bugfix: "\u{1F41B}",
  feature: "\u2728",
  observation: "\u{1F441}\uFE0F"
};
async function main() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    debug(`Session starting: ${hookInput.session_id}`);
    const mind = await getMind();
    const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectName = basename(projectDir);
    const context = await mind.getContext(projectName);
    const stats = await mind.stats();
    const contextLines = [];
    if (context.recentObservations.length > 0 || stats.totalObservations > 0) {
      contextLines.push("<memvid-mind-context>");
      contextLines.push(`# \u{1F9E0} Memory Bank: ${stats.totalObservations} memories`);
      contextLines.push("");
      contextLines.push("**IMPORTANT: When user asks about injected context, session start context, or what memories were loaded, show this FULL list below verbatim.**");
      contextLines.push("");
      if (context.recentObservations.length > 0) {
        contextLines.push("## Recent Activity");
        const fileEdits = context.recentObservations.filter(
          (obs) => obs.tool === "FileEdit" || obs.tool === "FileChanges" || obs.tool === "Edit" || obs.tool === "Write"
        );
        const otherObs = context.recentObservations.filter(
          (obs) => obs.tool !== "FileEdit" && obs.tool !== "FileChanges" && obs.tool !== "Bash" && !obs.summary.includes("Command:")
        );
        if (fileEdits.length > 0) {
          contextLines.push("### Files Edited");
          for (const obs of fileEdits.slice(0, 5)) {
            const timeAgo = formatTimestamp(obs.timestamp);
            contextLines.push(`\u{1F527} **${obs.summary}** _(${timeAgo})_`);
          }
          contextLines.push("");
        }
        if (otherObs.length > 0) {
          contextLines.push("### Other Activity");
          for (const obs of otherObs.slice(0, MAX_RECENT_MEMORIES - fileEdits.length)) {
            const icon = TYPE_ICONS[obs.type] || "\u{1F4DD}";
            const timeAgo = formatTimestamp(obs.timestamp);
            contextLines.push(`${icon} **${obs.summary}** _(${timeAgo})_`);
          }
          contextLines.push("");
        }
      }
      if (context.relevantMemories.length > 0) {
        contextLines.push(`## Relevant to "${projectName}"`);
        const relevant = context.relevantMemories.slice(0, MAX_RELEVANT_MEMORIES);
        for (const obs of relevant) {
          const icon = TYPE_ICONS[obs.type] || "\u{1F4DD}";
          contextLines.push(`${icon} ${obs.summary}`);
        }
        contextLines.push("");
      }
      const byType = categorizeByType(context.recentObservations);
      if (Object.keys(byType).length > 1) {
        contextLines.push("## Quick Stats");
        const statParts = [];
        for (const [type, count] of Object.entries(byType)) {
          const icon = TYPE_ICONS[type] || "\u{1F4DD}";
          statParts.push(`${icon} ${count} ${type}s`);
        }
        contextLines.push(statParts.join(" | "));
        contextLines.push("");
      }
      contextLines.push("---");
      contextLines.push(
        `\u{1F4BE} Memory file: \`.claude/mind.mv2\` | \u{1F4CA} ${formatFileSize(stats.fileSize)}`
      );
      contextLines.push(
        "\u{1F50D} Search: Use `/mem search <query>` to find specific memories"
      );
      contextLines.push("</memvid-mind-context>");
    }
    const output = {
      continue: true
    };
    if (contextLines.length > 0) {
      output.hookSpecificOutput = {
        hookEventName: "SessionStart",
        additionalContext: contextLines.join("\n")
      };
    }
    writeOutput(output);
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
function categorizeByType(observations) {
  const counts = {};
  for (const obs of observations) {
    counts[obs.type] = (counts[obs.type] || 0) + 1;
  }
  return counts;
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
main();
//# sourceMappingURL=session-start.js.map
//# sourceMappingURL=session-start.js.map