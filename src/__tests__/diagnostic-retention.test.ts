import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRedactedDiagnostic,
  listPersistedDiagnostics,
  resetDiagnosticPersistenceForTests,
} from "../platforms/diagnostic-store.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function createTempDiagnosticPath() {
  const dir = mkdtempSync(join(tmpdir(), "memvid-diagnostics-"));
  return { dir, path: join(dir, "diagnostics.json") };
}

describe("diagnostic retention", () => {
  it("sets 30-day retention metadata", () => {
    const now = Date.now();
    const diagnostic = createRedactedDiagnostic({
      platform: "claude",
      errorType: "malformed_payload",
      now,
    });

    expect(diagnostic.retentionDays).toBe(30);
    expect(diagnostic.expiresAt).toBe(now + (30 * DAY_MS));
    expect(diagnostic.redacted).toBe(true);
  });

  it("persists diagnostics and prunes expired records", () => {
    const { dir, path } = createTempDiagnosticPath();
    const previousPath = process.env.MEMVID_DIAGNOSTIC_PATH;

    try {
      process.env.MEMVID_DIAGNOSTIC_PATH = path;
      resetDiagnosticPersistenceForTests();

      const now = Date.now();
      createRedactedDiagnostic({
        platform: "claude",
        errorType: "expired",
        now: now - (31 * DAY_MS),
      });
      const fresh = createRedactedDiagnostic({
        platform: "opencode",
        errorType: "fresh",
        now,
      });

      const inMemory = listPersistedDiagnostics();
      expect(inMemory).toHaveLength(1);
      expect(inMemory[0].diagnosticId).toBe(fresh.diagnosticId);

      const fromDisk = JSON.parse(readFileSync(path, "utf-8")) as Array<{ errorType: string }>;
      expect(fromDisk).toHaveLength(1);
      expect(fromDisk[0].errorType).toBe("fresh");
    } finally {
      if (previousPath === undefined) {
        delete process.env.MEMVID_DIAGNOSTIC_PATH;
      } else {
        process.env.MEMVID_DIAGNOSTIC_PATH = previousPath;
      }
      resetDiagnosticPersistenceForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads existing diagnostics on startup and removes stale entries", () => {
    const { dir, path } = createTempDiagnosticPath();
    const previousPath = process.env.MEMVID_DIAGNOSTIC_PATH;

    try {
      const now = Date.now();
      const expired = {
        diagnosticId: "expired-id",
        timestamp: now - (32 * DAY_MS),
        platform: "claude",
        errorType: "expired",
        severity: "warning",
        redacted: true,
        retentionDays: 30,
        expiresAt: now - DAY_MS,
      };
      const active = {
        diagnosticId: "active-id",
        timestamp: now,
        platform: "claude",
        errorType: "active",
        severity: "warning",
        redacted: true,
        retentionDays: 30,
        expiresAt: now + (30 * DAY_MS),
      };
      writeFileSync(path, JSON.stringify([expired, active], null, 2), "utf-8");

      process.env.MEMVID_DIAGNOSTIC_PATH = path;
      resetDiagnosticPersistenceForTests();

      const loaded = listPersistedDiagnostics();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].diagnosticId).toBe("active-id");

      const fromDisk = JSON.parse(readFileSync(path, "utf-8")) as Array<{ diagnosticId: string }>;
      expect(fromDisk).toHaveLength(1);
      expect(fromDisk[0].diagnosticId).toBe("active-id");
    } finally {
      if (previousPath === undefined) {
        delete process.env.MEMVID_DIAGNOSTIC_PATH;
      } else {
        process.env.MEMVID_DIAGNOSTIC_PATH = previousPath;
      }
      resetDiagnosticPersistenceForTests();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
