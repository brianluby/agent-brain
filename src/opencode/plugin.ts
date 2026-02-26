import { existsSync, statSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { getMind } from "../core/mind.js";
import { type ObservationType } from "../types.js";
import { classifyObservationType } from "../utils/helpers.js";
import { compressToolOutput } from "../utils/compression.js";
import {
  getDefaultAdapterRegistry,
  processPlatformEvent,
  resolveMemoryPathPolicy,
} from "../platforms/index.js";

const OBSERVED_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "Update",
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "Task",
]);

const ALWAYS_CAPTURE_TOOLS = new Set(["Edit", "Write", "Update"]);
const MIN_OUTPUT_LENGTH = 50;
const MAX_OUTPUT_LENGTH = 2500;
const MAX_SESSION_CACHE_SIZE = 500;
const MAX_CALL_CACHE_PER_SESSION = 1000;

const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  edit: "Edit",
  write: "Write",
  update: "Update",
  apply_patch: "Update",
  bash: "Bash",
  grep: "Grep",
  glob: "Glob",
  webfetch: "WebFetch",
  task: "Task",
};

const seenSessionIntro = new Set<string>();
const processedToolCallsBySession = new Map<string, Set<string>>();

function addToLimitedSet(set: Set<string>, key: string, maxSize: number): void {
  if (set.has(key)) {
    set.delete(key);
  }

  set.add(key);

  while (set.size > maxSize) {
    const oldest = set.values().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    set.delete(oldest);
  }
}

function touchSessionCallCache(sessionID: string): Set<string> {
  const existing = processedToolCallsBySession.get(sessionID);
  if (existing) {
    processedToolCallsBySession.delete(sessionID);
    processedToolCallsBySession.set(sessionID, existing);
    return existing;
  }

  const callSet = new Set<string>();
  processedToolCallsBySession.set(sessionID, callSet);
  while (processedToolCallsBySession.size > MAX_SESSION_CACHE_SIZE) {
    const oldestSessionID = processedToolCallsBySession.keys().next().value;
    if (typeof oldestSessionID !== "string") {
      break;
    }
    processedToolCallsBySession.delete(oldestSessionID);
  }
  return callSet;
}

function toCanonicalToolName(toolID: string): string | null {
  return TOOL_NAME_MAP[toolID.toLowerCase()] || null;
}

function toToolInput(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return undefined;
  }
  return args as Record<string, unknown>;
}

function toToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output === undefined || output === null) {
    return "";
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function summarizeTool(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  rawOutput: string
): string {
  switch (toolName) {
    case "Read": {
      const path = (toolInput?.filePath as string | undefined) || "file";
      const fileName = path.split("/").pop() || "file";
      return `Read ${fileName}`;
    }
    case "Edit":
    case "Update": {
      const path = (toolInput?.filePath as string | undefined) || "file";
      const fileName = path.split("/").pop() || "file";
      return `Edited ${fileName}`;
    }
    case "Write": {
      const path = (toolInput?.filePath as string | undefined) || "file";
      const fileName = path.split("/").pop() || "file";
      return `Created ${fileName}`;
    }
    case "Bash": {
      const cmd = (toolInput?.command as string | undefined) || "command";
      const hasError = /error|failed|exception/i.test(rawOutput);
      return hasError ? `Command failed: ${cmd.slice(0, 60)}` : `Ran: ${cmd.slice(0, 60)}`;
    }
    case "Grep":
      return `Searched pattern: ${String(toolInput?.pattern || "").slice(0, 40)}`;
    case "Glob":
      return `Matched files: ${String(toolInput?.pattern || "").slice(0, 40)}`;
    case "WebFetch":
      return `Fetched: ${String(toolInput?.url || "").slice(0, 60)}`;
    default:
      return `${toolName} completed`;
  }
}

function extractMetadata(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  projectIdentityKey: string
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    platform: "opencode",
    projectIdentityKey,
  };

  if (!toolInput) {
    return metadata;
  }

  const filePath = toolInput.filePath || toolInput.file_path;
  if (
    typeof filePath === "string" &&
    (toolName === "Read" || toolName === "Edit" || toolName === "Write" || toolName === "Update")
  ) {
    metadata.files = [filePath];
  }

  if (toolName === "Bash" && typeof toolInput.command === "string") {
    metadata.command = toolInput.command.slice(0, 200);
  }

  if ((toolName === "Grep" || toolName === "Glob") && typeof toolInput.pattern === "string") {
    metadata.pattern = toolInput.pattern;
  }

  return metadata;
}

function getUserPromptText(parts: Part[]): string {
  return parts
    .filter((part): part is Part & { type: "text"; text: string } => {
      return part.type === "text" && typeof (part as { text?: unknown }).text === "string";
    })
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function buildMigrationCommand(projectDir: string, fromPath: string, toPath: string): string {
  const fromDisplay = relative(projectDir, fromPath) || basename(fromPath);
  const toDisplay = relative(projectDir, toPath) || basename(toPath);
  return `mkdir -p "${dirname(toDisplay)}" && mv "${fromDisplay}" "${toDisplay}"`;
}

function buildInjectedContext(options: {
  projectDir: string;
  memoryPath: string;
  memoryExists: boolean;
  fileSizeKB: number;
  recent: Array<{ type: string; summary: string }>;
  relevant: Array<{ type: string; summary: string }>;
  migrationCommand?: string;
}): string {
  const lines: string[] = [];
  lines.push("<agent-brain-context>");
  lines.push("# Agent Brain Memory Context");
  lines.push("");
  lines.push(`Project: ${basename(options.projectDir)}`);
  lines.push(`Platform: opencode`);
  lines.push(`Memory: ${relative(options.projectDir, options.memoryPath) || basename(options.memoryPath)}${options.memoryExists ? ` (${options.fileSizeKB} KB)` : ""}`);

  if (options.migrationCommand) {
    lines.push("");
    lines.push("Legacy memory file detected.");
    lines.push(`Move it to the platform-agnostic path with: ${options.migrationCommand}`);
  }

  if (options.recent.length > 0) {
    lines.push("");
    lines.push("Recent memory highlights:");
    for (const item of options.recent.slice(0, 6)) {
      lines.push(`- [${item.type}] ${item.summary}`);
    }
  }

  if (options.relevant.length > 0) {
    lines.push("");
    lines.push("Relevant memories for this prompt:");
    for (const item of options.relevant.slice(0, 4)) {
      lines.push(`- [${item.type}] ${item.summary}`);
    }
  }

  lines.push("");
  lines.push("Use these memories as background context while responding.");
  lines.push("</agent-brain-context>");
  return lines.join("\n");
}

export const AgentBrainOpenCodePlugin: Plugin = async ({ directory, project }) => {
  return {
    "chat.message": async (input, output) => {
      if (seenSessionIntro.has(input.sessionID)) {
        return;
      }
      addToLimitedSet(seenSessionIntro, input.sessionID, MAX_SESSION_CACHE_SIZE);

      const pathPolicy = resolveMemoryPathPolicy({
        projectDir: directory,
        platform: "opencode",
        defaultRelativePath: ".agent-brain/mind.mv2",
        legacyRelativePaths: [".claude/mind.mv2"],
        platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
        platformOptIn: process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1",
      });

      const memoryExists = existsSync(pathPolicy.memoryPath);
      let fileSizeKB = 0;
      if (memoryExists) {
        try {
          fileSizeKB = Math.round(statSync(pathPolicy.memoryPath).size / 1024);
        } catch {
          fileSizeKB = 0;
        }
      }

      const query = getUserPromptText(output.parts);
      const mind = await getMind();
      const context = await mind.getContext(query || undefined);

      const migrationCommand = pathPolicy.migrationSuggestion
        ? buildMigrationCommand(
          directory,
          pathPolicy.migrationSuggestion.fromPath,
          pathPolicy.migrationSuggestion.toPath
        )
        : undefined;

      const injected = buildInjectedContext({
        projectDir: directory,
        memoryPath: pathPolicy.memoryPath,
        memoryExists,
        fileSizeKB,
        recent: context.recentObservations.map((obs) => ({
          type: obs.type,
          summary: obs.summary,
        })),
        relevant: context.relevantMemories.map((obs) => ({
          type: obs.type,
          summary: obs.summary,
        })),
        migrationCommand,
      });

      const part: Part = {
        id: `agent-brain-context-${Date.now()}`,
        type: "text",
        text: injected,
        sessionID: input.sessionID,
        messageID: output.message.id,
      } as Part;

      output.parts.unshift(part);
    },

    "tool.execute.after": async (input, output) => {
      const sessionCallCache = touchSessionCallCache(input.sessionID);
      if (sessionCallCache.has(input.callID)) {
        return;
      }

      const canonicalToolName = toCanonicalToolName(input.tool);
      if (!canonicalToolName || !OBSERVED_TOOLS.has(canonicalToolName)) {
        return;
      }

      const registry = getDefaultAdapterRegistry();
      const adapter = registry.resolve("opencode");
      if (!adapter) {
        return;
      }

      const hookInput = {
        session_id: input.sessionID,
        platform: "opencode",
        contract_version: "1.0.0",
        project_id: project.id,
        cwd: directory,
        tool_name: canonicalToolName,
        tool_input: toToolInput(input.args),
        tool_response: output.output,
        tool_use_id: input.callID,
      };

      const normalized = adapter.normalizeToolObservation(hookInput);
      if (!normalized) {
        return;
      }

      const processed = processPlatformEvent(normalized);
      if (processed.skipped || !processed.projectIdentityKey) {
        return;
      }

      const rawOutput = toToolOutput(output.output);
      const alwaysCapture = ALWAYS_CAPTURE_TOOLS.has(canonicalToolName);
      if (!alwaysCapture && rawOutput.length < MIN_OUTPUT_LENGTH) {
        return;
      }

      if (rawOutput.includes("<agent-brain-context>") || rawOutput.includes("<memvid-mind-context>")) {
        return;
      }

      const toolInput = toToolInput(input.args);
      const { compressed, wasCompressed, originalSize } = compressToolOutput(
        canonicalToolName,
        toolInput,
        rawOutput
      );

      const content = compressed.length > MAX_OUTPUT_LENGTH
        ? `${compressed.slice(0, MAX_OUTPUT_LENGTH)}\n... (truncated${wasCompressed ? ", compressed" : ""})`
        : compressed;

      const metadata = extractMetadata(
        canonicalToolName,
        toolInput,
        processed.projectIdentityKey
      );

      if (wasCompressed) {
        metadata.compressed = true;
        metadata.originalSize = originalSize;
        metadata.compressedSize = compressed.length;
      }

      const mind = await getMind();
      await mind.remember({
        type: classifyObservationType(canonicalToolName, content),
        summary: summarizeTool(canonicalToolName, toolInput, rawOutput),
        content,
        tool: canonicalToolName,
        metadata,
      });

      addToLimitedSet(sessionCallCache, input.callID, MAX_CALL_CACHE_PER_SESSION);
    },

    tool: {
      mind: tool({
        description: "Query and store Agent Brain memories",
        args: {
          mode: tool.schema
            .enum(["search", "ask", "recent", "stats", "remember"])
            .describe("Operation to perform"),
          query: tool.schema.string().optional().describe("Search query or question"),
          limit: tool.schema.number().optional().describe("Result limit"),
          type: tool.schema
            .enum([
              "discovery",
              "decision",
              "problem",
              "solution",
              "pattern",
              "warning",
              "success",
              "refactor",
              "bugfix",
              "feature",
            ])
            .optional()
            .describe("Observation type for remember mode"),
          summary: tool.schema.string().optional().describe("Short memory summary"),
          content: tool.schema.string().optional().describe("Detailed memory content"),
        },
        async execute(args) {
          const mind = await getMind();
          const limit = args.limit && args.limit > 0 ? Math.min(args.limit, 25) : 10;

          if (args.mode === "search") {
            if (!args.query) {
              return JSON.stringify({ success: false, error: "query is required for search" });
            }
            const results = await mind.search(args.query, limit);
            return JSON.stringify({
              success: true,
              mode: "search",
              query: args.query,
              count: results.length,
              results: results.map((item) => ({
                score: item.score,
                summary: item.observation.summary,
                type: item.observation.type,
                tool: item.observation.tool,
              })),
            });
          }

          if (args.mode === "ask") {
            if (!args.query) {
              return JSON.stringify({ success: false, error: "query is required for ask" });
            }
            const answer = await mind.ask(args.query);
            return JSON.stringify({ success: true, mode: "ask", answer });
          }

          if (args.mode === "recent") {
            const context = await mind.getContext();
            return JSON.stringify({
              success: true,
              mode: "recent",
              count: Math.min(context.recentObservations.length, limit),
              observations: context.recentObservations.slice(0, limit).map((obs) => ({
                type: obs.type,
                summary: obs.summary,
                tool: obs.tool,
                timestamp: obs.timestamp,
              })),
            });
          }

          if (args.mode === "stats") {
            const stats = await mind.stats();
            return JSON.stringify({ success: true, mode: "stats", stats });
          }

          if (args.mode === "remember") {
            if (!args.summary || !args.content) {
              return JSON.stringify({
                success: false,
                error: "summary and content are required for remember",
              });
            }

            const observationType: ObservationType = args.type || "discovery";
            const id = await mind.remember({
              type: observationType,
              summary: args.summary,
              content: args.content,
              tool: "mind",
              metadata: {
                platform: "opencode",
                source: "manual",
              },
            });

            return JSON.stringify({ success: true, mode: "remember", id });
          }

          return JSON.stringify({
            success: false,
            error: `Unsupported mode: ${String(args.mode)}`,
          });
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") {
        return;
      }

      const eventData = event.properties as { info?: { id?: string } };
      const sessionID = eventData.info?.id;
      if (!sessionID) {
        return;
      }

      seenSessionIntro.delete(sessionID);
      processedToolCallsBySession.delete(sessionID);
    },
  };
};

export default AgentBrainOpenCodePlugin;
