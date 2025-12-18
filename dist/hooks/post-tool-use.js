#!/usr/bin/env node
import { use, create } from '@memvid/sdk';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
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

// src/utils/compression.ts
var TARGET_COMPRESSED_SIZE = 2e3;
var COMPRESSION_THRESHOLD = 3e3;
function compressToolOutput(toolName, toolInput, output) {
  const originalSize = output.length;
  if (originalSize <= COMPRESSION_THRESHOLD) {
    return { compressed: output, wasCompressed: false, originalSize };
  }
  let compressed;
  switch (toolName) {
    case "Read":
      compressed = compressFileRead(toolInput, output);
      break;
    case "Bash":
      compressed = compressBashOutput(toolInput, output);
      break;
    case "Grep":
      compressed = compressGrepOutput(toolInput, output);
      break;
    case "Glob":
      compressed = compressGlobOutput(toolInput, output);
      break;
    case "Edit":
    case "Write":
      compressed = compressEditOutput(toolInput, output);
      break;
    default:
      compressed = compressGeneric(output);
  }
  return {
    compressed: truncateToTarget(compressed),
    wasCompressed: true,
    originalSize
  };
}
function compressFileRead(toolInput, output) {
  const filePath = toolInput?.file_path || "unknown";
  const fileName = filePath.split("/").pop() || "file";
  const lines = output.split("\n");
  const totalLines = lines.length;
  const imports = extractImports(output);
  const exports$1 = extractExports(output);
  const functions = extractFunctionSignatures(output);
  const classes = extractClassNames(output);
  const errors = extractErrorPatterns(output);
  const parts = [
    `\u{1F4C4} File: ${fileName} (${totalLines} lines)`
  ];
  if (imports.length > 0) {
    parts.push(`
\u{1F4E6} Imports: ${imports.slice(0, 10).join(", ")}${imports.length > 10 ? ` (+${imports.length - 10} more)` : ""}`);
  }
  if (exports$1.length > 0) {
    parts.push(`
\u{1F4E4} Exports: ${exports$1.slice(0, 10).join(", ")}${exports$1.length > 10 ? ` (+${exports$1.length - 10} more)` : ""}`);
  }
  if (functions.length > 0) {
    parts.push(`
\u26A1 Functions: ${functions.slice(0, 10).join(", ")}${functions.length > 10 ? ` (+${functions.length - 10} more)` : ""}`);
  }
  if (classes.length > 0) {
    parts.push(`
\u{1F3D7}\uFE0F Classes: ${classes.join(", ")}`);
  }
  if (errors.length > 0) {
    parts.push(`
\u26A0\uFE0F Errors/TODOs: ${errors.slice(0, 5).join("; ")}`);
  }
  const contextLines = [
    "\n--- First 10 lines ---",
    ...lines.slice(0, 10),
    "\n--- Last 5 lines ---",
    ...lines.slice(-5)
  ];
  parts.push(contextLines.join("\n"));
  return parts.join("");
}
function compressBashOutput(toolInput, output) {
  const command = toolInput?.command || "command";
  const shortCmd = command.split("\n")[0].slice(0, 100);
  const lines = output.split("\n");
  const errorLines = lines.filter(
    (l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed") || l.toLowerCase().includes("exception") || l.toLowerCase().includes("warning")
  );
  const successLines = lines.filter(
    (l) => l.toLowerCase().includes("success") || l.toLowerCase().includes("passed") || l.toLowerCase().includes("completed") || l.toLowerCase().includes("done")
  );
  const parts = [`\u{1F5A5}\uFE0F Command: ${shortCmd}`];
  if (errorLines.length > 0) {
    parts.push(`
\u274C Errors (${errorLines.length}):`);
    parts.push(errorLines.slice(0, 10).join("\n"));
  }
  if (successLines.length > 0) {
    parts.push(`
\u2705 Success indicators:`);
    parts.push(successLines.slice(0, 5).join("\n"));
  }
  parts.push(`
\u{1F4CA} Output: ${lines.length} lines total`);
  if (lines.length > 20) {
    parts.push("\n--- First 10 lines ---");
    parts.push(lines.slice(0, 10).join("\n"));
    parts.push("\n--- Last 5 lines ---");
    parts.push(lines.slice(-5).join("\n"));
  } else {
    parts.push("\n--- Full output ---");
    parts.push(lines.join("\n"));
  }
  return parts.join("");
}
function compressGrepOutput(toolInput, output) {
  const pattern = toolInput?.pattern || "pattern";
  const lines = output.split("\n").filter(Boolean);
  const files = /* @__PURE__ */ new Set();
  lines.forEach((line) => {
    const match = line.match(/^([^:]+):/);
    if (match) files.add(match[1]);
  });
  const parts = [
    `\u{1F50D} Grep: "${pattern.slice(0, 50)}"`,
    `\u{1F4C1} Found in ${files.size} files, ${lines.length} matches`
  ];
  if (files.size > 0) {
    parts.push(`
\u{1F4C2} Files: ${Array.from(files).slice(0, 15).join(", ")}${files.size > 15 ? ` (+${files.size - 15} more)` : ""}`);
  }
  parts.push("\n--- Top matches ---");
  parts.push(lines.slice(0, 10).join("\n"));
  if (lines.length > 10) {
    parts.push(`
... and ${lines.length - 10} more matches`);
  }
  return parts.join("");
}
function compressGlobOutput(toolInput, output) {
  const pattern = toolInput?.pattern || "pattern";
  let files = [];
  try {
    const parsed = JSON.parse(output);
    files = parsed.filenames || [];
  } catch {
    files = output.split("\n").filter(Boolean);
  }
  const byDir = {};
  files.forEach((f) => {
    const dir = f.split("/").slice(0, -1).join("/") || "/";
    const file = f.split("/").pop() || f;
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(file);
  });
  const parts = [
    `\u{1F4C2} Glob: "${pattern.slice(0, 50)}"`,
    `\u{1F4C1} Found ${files.length} files in ${Object.keys(byDir).length} directories`
  ];
  const topDirs = Object.entries(byDir).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  parts.push("\n--- Top directories ---");
  topDirs.forEach(([dir, dirFiles]) => {
    const shortDir = dir.split("/").slice(-3).join("/");
    parts.push(`${shortDir}/ (${dirFiles.length} files)`);
  });
  parts.push("\n--- Sample files ---");
  parts.push(files.slice(0, 15).map((f) => f.split("/").pop()).join(", "));
  return parts.join("");
}
function compressEditOutput(toolInput, output) {
  const filePath = toolInput?.file_path || "unknown";
  const fileName = filePath.split("/").pop() || "file";
  return [
    `\u270F\uFE0F Edited: ${fileName}`,
    `\u{1F4DD} Changes applied successfully`,
    output.slice(0, 500)
  ].join("\n");
}
function compressGeneric(output) {
  const lines = output.split("\n");
  if (lines.length <= 30) {
    return output;
  }
  return [
    `\u{1F4CA} Output: ${lines.length} lines`,
    "--- First 15 lines ---",
    ...lines.slice(0, 15),
    "--- Last 10 lines ---",
    ...lines.slice(-10)
  ].join("\n");
}
function extractImports(code) {
  const imports = [];
  const patterns = [
    /import\s+(?:{\s*([^}]+)\s*}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    /from\s+['"]([^'"]+)['"]\s+import/g,
    /require\s*\(['"]([^'"]+)['"]\)/g,
    /use\s+(\w+(?:::\w+)*)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      imports.push(match[3] || match[1] || match[2] || match[0]);
    }
  });
  return [...new Set(imports)];
}
function extractExports(code) {
  const exports$1 = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s*{\s*([^}]+)\s*}/g,
    /pub\s+(?:fn|struct|enum|trait|mod)\s+(\w+)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const names = (match[1] || "").split(",").map((s) => s.trim());
      exports$1.push(...names.filter(Boolean));
    }
  });
  return [...new Set(exports$1)];
}
function extractFunctionSignatures(code) {
  const functions = [];
  const patterns = [
    /(?:async\s+)?function\s+(\w+)/g,
    /(\w+)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /fn\s+(\w+)/g,
    /def\s+(\w+)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      functions.push(match[1]);
    }
  });
  return [...new Set(functions)];
}
function extractClassNames(code) {
  const classes = [];
  const patterns = [
    /class\s+(\w+)/g,
    /struct\s+(\w+)/g,
    /interface\s+(\w+)/g,
    /type\s+(\w+)\s*=/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      classes.push(match[1]);
    }
  });
  return [...new Set(classes)];
}
function extractErrorPatterns(code) {
  const errors = [];
  const lines = code.split("\n");
  lines.forEach((line) => {
    if (line.includes("TODO") || line.includes("FIXME") || line.includes("HACK") || line.includes("XXX") || line.includes("BUG")) {
      errors.push(line.trim().slice(0, 100));
    }
  });
  return errors.slice(0, 10);
}
function truncateToTarget(text) {
  if (text.length <= TARGET_COMPRESSED_SIZE) {
    return text;
  }
  return text.slice(0, TARGET_COMPRESSED_SIZE - 20) + "\n... (compressed)";
}
function getCompressionStats(originalSize, compressedSize) {
  const saved = originalSize - compressedSize;
  const ratio = originalSize / compressedSize;
  const savedPercent = (saved / originalSize * 100).toFixed(1);
  return { ratio, saved, savedPercent };
}

// src/hooks/post-tool-use.ts
var OBSERVED_TOOLS = /* @__PURE__ */ new Set([
  "Read",
  "Edit",
  "Write",
  "Update",
  // Claude Code may use Update for edits
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit"
]);
var MIN_OUTPUT_LENGTH = 50;
var ALWAYS_CAPTURE_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "Update", "NotebookEdit"]);
var MAX_OUTPUT_LENGTH = 2500;
async function main() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const { tool_name, tool_input, tool_response } = hookInput;
    debug(`Tool received: ${tool_name}`);
    if (!tool_name || !OBSERVED_TOOLS.has(tool_name)) {
      debug(`Skipping tool: ${tool_name} (not in OBSERVED_TOOLS)`);
      writeOutput({ continue: true });
      return;
    }
    const tool_output = typeof tool_response === "string" ? tool_response : JSON.stringify(tool_response, null, 2);
    const alwaysCapture = ALWAYS_CAPTURE_TOOLS.has(tool_name);
    if (!alwaysCapture && (!tool_output || tool_output.length < MIN_OUTPUT_LENGTH)) {
      writeOutput({ continue: true });
      return;
    }
    let effectiveOutput = tool_output || "";
    if (alwaysCapture && effectiveOutput.length < MIN_OUTPUT_LENGTH) {
      const filePath = tool_input?.file_path || "unknown file";
      const fileName = filePath.split("/").pop() || "file";
      effectiveOutput = `File modified: ${fileName}
Path: ${filePath}
Tool: ${tool_name}`;
    }
    if (effectiveOutput.includes("<system-reminder>") || effectiveOutput.includes("<memvid-mind-context>")) {
      writeOutput({ continue: true });
      return;
    }
    const { compressed, wasCompressed, originalSize } = compressToolOutput(
      tool_name,
      tool_input,
      effectiveOutput
    );
    if (wasCompressed) {
      const stats = getCompressionStats(originalSize, compressed.length);
      debug(`\u{1F5DC}\uFE0F Endless Mode: ${stats.savedPercent}% compression (${originalSize} \u2192 ${compressed.length} chars)`);
    }
    debug(`Capturing observation from ${tool_name}`);
    const mind = await getMind();
    const observationType = classifyObservationType(tool_name, compressed);
    const summary = generateSummary(tool_name, tool_input, effectiveOutput);
    const content = compressed.length > MAX_OUTPUT_LENGTH ? compressed.slice(0, MAX_OUTPUT_LENGTH) + "\n... (compressed)" : compressed;
    const metadata = extractMetadata(tool_name, tool_input);
    if (wasCompressed) {
      metadata.compressed = true;
      metadata.originalSize = originalSize;
      metadata.compressedSize = compressed.length;
    }
    await mind.remember({
      type: observationType,
      summary,
      content,
      tool: tool_name,
      metadata
    });
    debug(`Stored: [${observationType}] ${summary}${wasCompressed ? " (compressed)" : ""}`);
    writeOutput({ continue: true });
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
function generateSummary(toolName, toolInput, toolOutput) {
  switch (toolName) {
    case "Read": {
      const path = toolInput?.file_path;
      const fileName = path?.split("/").pop() || "file";
      const lines = toolOutput.split("\n").length;
      return `Read ${fileName} (${lines} lines)`;
    }
    case "Edit": {
      const path = toolInput?.file_path;
      const fileName = path?.split("/").pop() || "file";
      return `Edited ${fileName}`;
    }
    case "Write": {
      const path = toolInput?.file_path;
      const fileName = path?.split("/").pop() || "file";
      return `Created ${fileName}`;
    }
    case "Bash": {
      const cmd = toolInput?.command;
      const shortCmd = cmd?.split("\n")[0].slice(0, 50) || "command";
      const hasError = toolOutput.toLowerCase().includes("error") || toolOutput.toLowerCase().includes("failed");
      return hasError ? `Command failed: ${shortCmd}` : `Ran: ${shortCmd}`;
    }
    case "Grep": {
      const pattern = toolInput?.pattern;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} matches for "${pattern?.slice(0, 30)}"`;
    }
    case "Glob": {
      const pattern = toolInput?.pattern;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} files matching "${pattern?.slice(0, 30)}"`;
    }
    case "WebFetch":
    case "WebSearch": {
      const url = toolInput?.url || toolInput?.query;
      return `Fetched: ${url?.slice(0, 50)}`;
    }
    default:
      return `${toolName} completed`;
  }
}
function extractMetadata(toolName, toolInput) {
  const metadata = {};
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
        metadata.command = toolInput.command.slice(0, 200);
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
//# sourceMappingURL=post-tool-use.js.map
//# sourceMappingURL=post-tool-use.js.map