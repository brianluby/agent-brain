import { resolve } from "node:path";

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
  return `.claude/mind-${platform}.mv2`;
}

export function resolveMemoryPathPolicy(input: MemoryPathPolicyInput): MemoryPathPolicyResult {
  if (input.platformOptIn) {
    const relative = input.platformRelativePath || defaultPlatformRelativePath(input.platform);
    return {
      mode: "platform_opt_in",
      memoryPath: resolve(input.projectDir, relative),
    };
  }

  return {
    mode: "legacy_first",
    memoryPath: resolve(input.projectDir, input.legacyRelativePath),
  };
}
