export const DIAGNOSTIC_RETENTION_DAYS = 30;

export type DiagnosticSeverity = "warning" | "error";

export interface AdapterDiagnostic {
  diagnosticId: string;
  timestamp: number;
  platform: string;
  errorType: string;
  fieldNames?: string[];
  severity: DiagnosticSeverity;
  redacted: true;
  retentionDays: number;
  expiresAt: number;
}
