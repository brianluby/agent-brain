import { existsSync } from "node:fs";
import { isAbsolute, relative as pathRelative, resolve, sep } from "node:path";

export type MemoryPathMode = "legacy_first" | "platform_opt_in";

export interface MemoryPathPolicyInput {
  projectDir: string;
  platform: string;
  defaultRelativePath: string;
  platformRelativePath?: string;
  platformOptIn?: boolean;
  legacyRelativePaths?: string[];
}

export interface MemoryMigrationSuggestion {
  fromPath: string;
  toPath: string;
}

export interface MemoryPathPolicyResult {
  mode: MemoryPathMode;
  memoryPath: string;
  canonicalPath: string;
  migrationSuggestion?: MemoryMigrationSuggestion;
}

function defaultPlatformRelativePath(platform: string): string {
  const safePlatform = platform.replace(/[^a-z0-9_-]/gi, "-");
  return `.agent-brain/mind-${safePlatform}.mv2`;
}

function resolveInsideProject(projectDir: string, candidatePath: string): string {
  if (isAbsolute(candidatePath)) {
    return resolve(candidatePath);
  }
  const root = resolve(projectDir);
  const resolved = resolve(root, candidatePath);
  const rel = pathRelative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Resolved memory path must stay inside projectDir");
  }
  return resolved;
}

export function resolveMemoryPathPolicy(input: MemoryPathPolicyInput): MemoryPathPolicyResult {
  const mode: MemoryPathMode = input.platformOptIn ? "platform_opt_in" : "legacy_first";
  const canonicalRelativePath = input.platformOptIn
    ? input.platformRelativePath || defaultPlatformRelativePath(input.platform)
    : input.defaultRelativePath;
  const canonicalPath = resolveInsideProject(input.projectDir, canonicalRelativePath);

  if (existsSync(canonicalPath)) {
    return {
      mode,
      memoryPath: canonicalPath,
      canonicalPath,
    };
  }

  const fallbackPaths = (input.legacyRelativePaths || [])
    .map((relativePath) => resolveInsideProject(input.projectDir, relativePath));

  for (const fallbackPath of fallbackPaths) {
    if (existsSync(fallbackPath)) {
      return {
        mode,
        memoryPath: fallbackPath,
        canonicalPath,
        migrationSuggestion: {
          fromPath: fallbackPath,
          toPath: canonicalPath,
        },
      };
    }
  }

  if (input.platformOptIn) {
    return {
      mode: "platform_opt_in",
      memoryPath: canonicalPath,
      canonicalPath,
    };
  }

  return {
    mode: "legacy_first",
    memoryPath: canonicalPath,
    canonicalPath,
  };
}
