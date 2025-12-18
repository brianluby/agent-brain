#!/usr/bin/env node
import { use, create } from '@memvid/sdk';
import { constants, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { access, readFile, mkdir } from 'fs/promises';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

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
var MIN_OBSERVATIONS_FOR_SUMMARY = 3;
async function captureFileChanges(mind) {
  try {
    const memoryPath = mind.getMemoryPath();
    const workDir = memoryPath.replace(/\/\.claude\/.*$/, "");
    const allChangedFiles = [];
    let gitDiffContent = "";
    try {
      const diffNames = execSync("git diff --name-only HEAD 2>/dev/null || git diff --name-only", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 5e3
      }).trim();
      const stagedNames = execSync("git diff --cached --name-only 2>/dev/null || true", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 5e3
      }).trim();
      const gitFiles = [.../* @__PURE__ */ new Set([
        ...diffNames.split("\n").filter(Boolean),
        ...stagedNames.split("\n").filter(Boolean)
      ])];
      allChangedFiles.push(...gitFiles);
      if (gitFiles.length > 0) {
        try {
          gitDiffContent = execSync("git diff HEAD --stat 2>/dev/null | head -50", {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 1e4
          }).trim();
        } catch {
        }
      }
    } catch {
    }
    try {
      const recentFiles = execSync(
        `find . -maxdepth 5 -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" -o -name "*.json" -o -name "*.py" -o -name "*.rs" \\) -mmin -60 ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.next/*" ! -path "*/target/*" 2>/dev/null | head -50`,
        {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 15e3
        }
      ).trim();
      const recentFilesList = recentFiles.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
      for (const file of recentFilesList) {
        if (!allChangedFiles.includes(file)) {
          allChangedFiles.push(file);
        }
      }
    } catch {
    }
    if (allChangedFiles.length === 0) {
      debug("No file changes detected");
      return;
    }
    debug(`Capturing ${allChangedFiles.length} changed files`);
    const contentParts = [`## Files Modified This Session

${allChangedFiles.map((f) => `- ${f}`).join("\n")}`];
    if (gitDiffContent) {
      contentParts.push(`
## Git Changes Summary
\`\`\`
${gitDiffContent}
\`\`\``);
    }
    await mind.remember({
      type: "refactor",
      summary: `Session edits: ${allChangedFiles.length} file(s) modified`,
      content: contentParts.join("\n"),
      tool: "FileChanges",
      metadata: {
        files: allChangedFiles,
        fileCount: allChangedFiles.length,
        captureMethod: "git-diff-plus-recent"
      }
    });
    for (const file of allChangedFiles) {
      const fileName = file.split("/").pop() || file;
      const isImportant = /^(README|CHANGELOG|package\.json|Cargo\.toml|\.env)/i.test(fileName);
      if (isImportant) {
        await mind.remember({
          type: "refactor",
          summary: `Modified ${fileName}`,
          content: `File edited: ${file}
This file was modified during the session.`,
          tool: "FileEdit",
          metadata: {
            files: [file],
            fileName
          }
        });
        debug(`Stored individual edit: ${fileName}`);
      }
    }
    debug(`Stored file changes: ${allChangedFiles.length} files`);
  } catch (error) {
    debug(`Failed to capture file changes: ${error}`);
  }
}
async function main() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    debug(`Session stopping: ${hookInput.session_id}`);
    const mind = await getMind();
    const stats = await mind.stats();
    await captureFileChanges(mind);
    let transcriptContent = "";
    if (hookInput.transcript_path) {
      try {
        await access(hookInput.transcript_path, constants.R_OK);
        transcriptContent = await readFile(hookInput.transcript_path, "utf-8");
      } catch {
      }
    }
    const context = await mind.getContext();
    const sessionObservations = context.recentObservations.filter(
      (obs) => obs.metadata?.sessionId === mind.getSessionId()
    );
    if (sessionObservations.length >= MIN_OBSERVATIONS_FOR_SUMMARY) {
      const summary = generateSessionSummary(
        sessionObservations,
        transcriptContent
      );
      await mind.saveSessionSummary(summary);
      debug(
        `Session summary saved: ${summary.keyDecisions.length} decisions, ${summary.filesModified.length} files`
      );
    }
    debug(
      `Session complete. Total memories: ${stats.totalObservations}, File: ${mind.getMemoryPath()}`
    );
    const output = {
      continue: true
    };
    writeOutput(output);
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
function generateSessionSummary(observations, transcript) {
  const keyDecisions = [];
  const filesModified = /* @__PURE__ */ new Set();
  for (const obs of observations) {
    if (obs.type === "decision" || obs.summary.toLowerCase().includes("chose") || obs.summary.toLowerCase().includes("decided")) {
      keyDecisions.push(obs.summary);
    }
    const files = obs.metadata?.files;
    if (files) {
      files.forEach((f) => filesModified.add(f));
    }
  }
  if (transcript) {
    const filePatterns = [
      /(?:Read|Edit|Write)[^"]*"([^"]+)"/g,
      /file_path["\s:]+([^\s"]+)/g
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
  const typeCounts = {};
  for (const obs of observations) {
    typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
  }
  const summaryParts = [];
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
  const summary = summaryParts.length > 0 ? summaryParts.join(". ") + "." : `Session with ${observations.length} observations.`;
  return {
    keyDecisions: keyDecisions.slice(0, 10),
    filesModified: Array.from(filesModified).slice(0, 20),
    summary
  };
}
main();
//# sourceMappingURL=stop.js.map
//# sourceMappingURL=stop.js.map