import { isAbsolute, relative as pathRelative, resolve, sep } from "node:path";

export type MemoryPathMode = "legacy_first" | "platform_opt_in";

export interface MemoryPathPolicyInput {
  projectDir: string;
  platform: string;
  legacyRelativePath: string;
  platformRelativePath?: string;
  platformOptIn?: boolean;
}

export interface MemoryPathPolicyResult {
  mode: MemoryPathMode;
  memoryPath: string;
}

function defaultPlatformRelativePath(platform: string): string {
  const safePlatform = platform.replace(/[^a-z0-9_-]/gi, "-");
  return `.claude/mind-${safePlatform}.mv2`;
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
  if (input.platformOptIn) {
    const relativePath = input.platformRelativePath || defaultPlatformRelativePath(input.platform);
    return {
      mode: "platform_opt_in",
      memoryPath: resolveInsideProject(input.projectDir, relativePath),
    };
  }

  return {
    mode: "legacy_first",
    memoryPath: resolveInsideProject(input.projectDir, input.legacyRelativePath),
  };
}
