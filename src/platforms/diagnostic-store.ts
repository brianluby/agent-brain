import { generateId } from "../utils/helpers.js";
import {
  DIAGNOSTIC_RETENTION_DAYS,
  type AdapterDiagnostic,
  type DiagnosticSeverity,
} from "./diagnostics.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateDiagnosticInput {
  platform: string;
  errorType: string;
  fieldNames?: string[];
  severity?: DiagnosticSeverity;
  now?: number;
}

function sanitizeFieldNames(fieldNames: string[] | undefined): string[] | undefined {
  if (!fieldNames || fieldNames.length === 0) {
    return undefined;
  }
  return [...new Set(fieldNames)].slice(0, 20);
}

// TODO: FR-012/FR-016 — This module creates diagnostic records in memory but does
// not persist them to disk. Implement a DiagnosticPersistence layer that appends
// records to a JSON file and prunes entries older than DIAGNOSTIC_RETENTION_DAYS.
export function createRedactedDiagnostic(input: CreateDiagnosticInput): AdapterDiagnostic {
  const timestamp = input.now ?? Date.now();
  return {
    diagnosticId: generateId(),
    timestamp,
    platform: input.platform,
    errorType: input.errorType,
    fieldNames: sanitizeFieldNames(input.fieldNames),
    severity: input.severity ?? "warning",
    redacted: true,
    retentionDays: DIAGNOSTIC_RETENTION_DAYS,
    expiresAt: timestamp + (DIAGNOSTIC_RETENTION_DAYS * DAY_MS),
  };
}
