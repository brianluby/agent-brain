import type { HookInput } from "../types.js";

function normalizePlatform(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function detectPlatformFromEnv(): string {
  const explicitFromEnv = normalizePlatform(process.env.MEMVID_PLATFORM);
  if (explicitFromEnv) {
    return explicitFromEnv;
  }

  if (process.env.OPENCODE === "1" || process.env.OPENCODE_SESSION === "1") {
    return "opencode";
  }

  return "claude";
}

export function detectPlatform(input: HookInput): string {
  const explicitFromHook = normalizePlatform(input.platform);
  if (explicitFromHook) {
    return explicitFromHook;
  }

  return detectPlatformFromEnv();
}
