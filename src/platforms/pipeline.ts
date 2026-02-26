import {
  SUPPORTED_ADAPTER_CONTRACT_MAJOR,
  validateAdapterContractVersion,
} from "./contract.js";
import { createRedactedDiagnostic } from "./diagnostic-store.js";
import type { AdapterDiagnostic } from "./diagnostics.js";
import type { PlatformEvent } from "./events.js";
import { resolveProjectIdentityKey } from "./identity.js";

export interface ProcessPlatformEventResult {
  skipped: boolean;
  reason?: string;
  projectIdentityKey?: string;
  diagnostic?: AdapterDiagnostic;
}

function skipWithDiagnostic(
  platform: string,
  errorType: string,
  fieldNames?: string[]
): ProcessPlatformEventResult {
  // TODO: FR-012/FR-016 — Diagnostics are created but not yet persisted.
  // Implement DiagnosticPersistence to write records to disk and enforce
  // the 30-day retention window (DIAGNOSTIC_RETENTION_DAYS expiry).
  return {
    skipped: true,
    reason: errorType,
    diagnostic: createRedactedDiagnostic({
      platform,
      errorType,
      fieldNames,
      severity: "warning",
    }),
  };
}

export function processPlatformEvent(
  event: PlatformEvent
): ProcessPlatformEventResult {
  const contractValidation = validateAdapterContractVersion(
    event.contractVersion,
    SUPPORTED_ADAPTER_CONTRACT_MAJOR
  );
  if (!contractValidation.compatible) {
    return skipWithDiagnostic(event.platform, contractValidation.reason ?? "incompatible_contract", ["contractVersion"]);
  }

  const identity = resolveProjectIdentityKey(event.projectContext);
  if (!identity.key) {
    return skipWithDiagnostic(event.platform, "missing_project_identity", [
      "platformProjectId",
      "canonicalPath",
      "cwd",
    ]);
  }

  return {
    skipped: false,
    projectIdentityKey: identity.key,
  };
}
