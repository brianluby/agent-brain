import { resolve } from "node:path";
import type { PlatformProjectContext } from "./events.js";

export type ProjectIdentitySource =
  | "platform_project_id"
  | "canonical_path"
  | "unresolved";

export interface ProjectIdentityResolution {
  key: string | null;
  source: ProjectIdentitySource;
  canonicalPath?: string;
}

export function resolveCanonicalProjectPath(
  context: PlatformProjectContext
): string | undefined {
  if (context.canonicalPath) {
    return resolve(context.canonicalPath);
  }
  if (context.cwd) {
    return resolve(context.cwd);
  }
  return undefined;
}

export function resolveProjectIdentityKey(
  context: PlatformProjectContext
): ProjectIdentityResolution {
  if (context.platformProjectId && context.platformProjectId.trim().length > 0) {
    return {
      key: context.platformProjectId.trim(),
      source: "platform_project_id",
      canonicalPath: resolveCanonicalProjectPath(context),
    };
  }

  const canonicalPath = resolveCanonicalProjectPath(context);
  if (canonicalPath) {
    return {
      key: canonicalPath,
      source: "canonical_path",
      canonicalPath,
    };
  }

  return {
    key: null,
    source: "unresolved",
  };
}
