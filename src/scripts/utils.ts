/**
 * Shared utilities for Memvid Mind scripts
 */

import { existsSync, mkdirSync, unlinkSync, renameSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { resolveMemoryPathPolicy } from "../platforms/path-policy.js";
import { detectPlatformFromEnv } from "../platforms/platform-detector.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CreateFn = (path: string, kind: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UseFn = (kind: any, path: string) => Promise<any>;

/**
 * Create a fresh memory file at the given path
 */
export async function createFreshMemory(
  memoryPath: string,
  create: CreateFn
): Promise<void> {
  const memoryDir = dirname(memoryPath);
  mkdirSync(memoryDir, { recursive: true });
  await create(memoryPath, "basic");
}

/**
 * Check if an error indicates a corrupted or incompatible memory file
 */
export function isCorruptedMemoryError(error: unknown): boolean {
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  return (
    errorMessage.includes("Deserialization") ||
    errorMessage.includes("UnexpectedVariant") ||
    errorMessage.includes("Invalid") ||
    errorMessage.includes("corrupt") ||
    errorMessage.includes("version mismatch") ||
    errorMessage.includes("validation failed") ||
    errorMessage.includes("unable to recover") ||
    errorMessage.includes("table of contents")
  );
}

/**
 * Handle corrupted memory file by backing it up and creating a fresh one
 */
export async function handleCorruptedMemory(
  memoryPath: string,
  create: CreateFn
): Promise<void> {
  console.log(
    "⚠️  Memory file is corrupted or incompatible. Creating fresh memory..."
  );
  // Backup corrupted file
  const backupPath = `${memoryPath}.backup-${Date.now()}`;
  try {
    renameSync(memoryPath, backupPath);
    console.log(`   Old file backed up to: ${backupPath}`);
  } catch {
    try {
      unlinkSync(memoryPath);
    } catch {
      // Ignore unlink errors
    }
  }
  await createFreshMemory(memoryPath, create);
}

/**
 * Open a memory file, handling corruption by creating fresh memory if needed
 * Returns the opened memvid instance, or null if memory was recreated (caller should exit)
 */
export async function openMemorySafely(
  memoryPath: string,
  use: UseFn,
  create: CreateFn
): Promise<{ memvid: unknown; isNew: boolean }> {
  // Auto-create if doesn't exist
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    await createFreshMemory(memoryPath, create);
    return { memvid: null, isNew: true };
  }

  // Try to open, handle corrupted files
  try {
    const memvid = await use("basic", memoryPath);
    return { memvid, isNew: false };
  } catch (openError: unknown) {
    if (isCorruptedMemoryError(openError)) {
      await handleCorruptedMemory(memoryPath, create);
      return { memvid: null, isNew: true };
    }
    // Re-throw other errors
    throw openError;
  }
}

export interface ScriptMemoryPathResult {
  memoryPath: string;
  migrationPrompt?: string;
}

export function resolveScriptMemoryPath(projectDir: string): ScriptMemoryPathResult {
  const pathPolicy = resolveMemoryPathPolicy({
    projectDir,
    platform: detectPlatformFromEnv(),
    defaultRelativePath: ".agent-brain/mind.mv2",
    legacyRelativePaths: [".claude/mind.mv2"],
    platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
    platformOptIn: process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1",
  });

  if (!pathPolicy.migrationSuggestion) {
    return { memoryPath: pathPolicy.memoryPath };
  }

  const fromDisplay = relative(projectDir, pathPolicy.migrationSuggestion.fromPath) || basename(pathPolicy.migrationSuggestion.fromPath);
  const toDisplay = relative(projectDir, pathPolicy.migrationSuggestion.toPath) || basename(pathPolicy.migrationSuggestion.toPath);
  return {
    memoryPath: pathPolicy.memoryPath,
    migrationPrompt: `mkdir -p "${dirname(toDisplay)}" && mv "${fromDisplay}" "${toDisplay}"`,
  };
}
