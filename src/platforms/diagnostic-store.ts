import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { generateId } from "../utils/helpers.js";
import {
  DIAGNOSTIC_RETENTION_DAYS,
  type AdapterDiagnostic,
  type DiagnosticSeverity,
} from "./diagnostics.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DIAGNOSTIC_FILE_NAME = "platform-diagnostics.json";
const TEST_DIAGNOSTIC_FILE_NAME = `memvid-platform-diagnostics-${process.pid}.json`;

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

function resolveDiagnosticStorePath(): string {
  const explicitPath = process.env.MEMVID_DIAGNOSTIC_PATH?.trim();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (explicitPath) {
    return resolve(projectDir, explicitPath);
  }

  if (process.env.VITEST) {
    return resolve(tmpdir(), TEST_DIAGNOSTIC_FILE_NAME);
  }

  return resolve(projectDir, ".claude", DIAGNOSTIC_FILE_NAME);
}

function isDiagnosticRecord(value: unknown): value is AdapterDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.diagnosticId === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.platform === "string" &&
    typeof record.errorType === "string" &&
    (record.fieldNames === undefined || Array.isArray(record.fieldNames)) &&
    (record.severity === "warning" || record.severity === "error") &&
    record.redacted === true &&
    typeof record.retentionDays === "number" &&
    typeof record.expiresAt === "number"
  );
}

function pruneExpired(records: AdapterDiagnostic[], now = Date.now()): AdapterDiagnostic[] {
  return records.filter((record) => record.expiresAt > now);
}

class DiagnosticPersistence {
  readonly filePath: string;
  private records: AdapterDiagnostic[];

  constructor(filePath: string) {
    this.filePath = filePath;
    this.records = this.loadFromDisk();
  }

  append(record: AdapterDiagnostic, now = Date.now()): void {
    const next = pruneExpired([...this.records, record], now);
    this.records = next;
    this.persist(next);
  }

  list(now = Date.now()): AdapterDiagnostic[] {
    const pruned = pruneExpired(this.records, now);
    if (pruned.length !== this.records.length) {
      this.records = pruned;
      this.persist(pruned);
    }
    return [...pruned];
  }

  private loadFromDisk(): AdapterDiagnostic[] {
    if (!existsSync(this.filePath)) {
      return [];
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8").trim();
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      const validRecords = parsed.filter(isDiagnosticRecord);
      const pruned = pruneExpired(validRecords);
      if (pruned.length !== validRecords.length) {
        this.persist(pruned);
      }
      return pruned;
    } catch {
      return [];
    }
  }

  private persist(records: AdapterDiagnostic[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, this.filePath);
  }
}

let persistence: DiagnosticPersistence | null = null;
let persistenceFilePath: string | null = null;
let warnedPathChange = false;

function getDiagnosticPersistence(): DiagnosticPersistence {
  const resolvedPath = resolveDiagnosticStorePath();

  if (!persistence) {
    persistence = new DiagnosticPersistence(resolvedPath);
    persistenceFilePath = resolvedPath;
    warnedPathChange = false;
    return persistence;
  }

  if (persistenceFilePath && persistenceFilePath !== resolvedPath && !warnedPathChange) {
    warnedPathChange = true;
    console.error(
      `[memvid-mind] Diagnostic store path changed from "${persistenceFilePath}" to "${resolvedPath}" after initialization; continuing with the original path.`
    );
  }

  return persistence;
}

export function resetDiagnosticPersistenceForTests(): void {
  persistence = null;
  persistenceFilePath = null;
  warnedPathChange = false;
}

export function listPersistedDiagnostics(now = Date.now()): AdapterDiagnostic[] {
  return getDiagnosticPersistence().list(now);
}

export function createRedactedDiagnostic(input: CreateDiagnosticInput): AdapterDiagnostic {
  const timestamp = input.now ?? Date.now();
  const diagnostic: AdapterDiagnostic = {
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

  try {
    getDiagnosticPersistence().append(diagnostic);
  } catch {
    // Fail-open: never block event processing on diagnostic persistence failures.
  }

  return diagnostic;
}
