# Phase 0 Research: Multi-Platform Adapter Support

## Decision 1: Use a versioned platform adapter contract

- Decision: Define a shared adapter contract with explicit SemVer `contractVersion`; accept same major, reject incompatible majors in fail-open mode.
- Rationale: This keeps core memory behavior stable while allowing additive adapter evolution without silent runtime breakage.
- Alternatives considered:
  - No explicit versioning (rejected: high compatibility risk).
  - Platform-local contract versions only (rejected: weak cross-platform guarantees).

## Decision 2: Preserve a single shared memory engine with cross-platform locking

- Decision: Keep one shared memory engine and enforce a single per-project write lock across all platform adapters.
- Rationale: Centralized locking prevents concurrent write corruption and preserves continuity when users switch platforms.
- Alternatives considered:
  - Last-write-wins (rejected: possible lost updates).
  - Per-platform memory files with async merge (rejected: fragmentation and merge complexity).

## Decision 3: Canonical project identity resolution

- Decision: Resolve project identity using platform project ID when available, otherwise fallback to canonical absolute project path.
- Rationale: This enables robust cross-platform recall while tolerating incomplete metadata from some platforms.
- Alternatives considered:
  - Path-only identity (rejected: weaker when symlinked/virtualized paths differ).
  - Platform-ID only with no fallback (rejected: drops continuity when ID is missing).

## Decision 4: Path policy remains legacy-first

- Decision: Default read/write remains legacy memory location; platform-specific paths are opt-in only.
- Rationale: Protects existing Claude users from migration regressions and avoids accidental memory splits.
- Alternatives considered:
  - Platform-first writes (rejected: potential hidden migration behavior).
  - Dual-write always (rejected: added complexity and conflict risk).

## Decision 5: Event-scope fail-open error handling

- Decision: On malformed input or adapter processing failure, skip only the failing event, record redacted diagnostics, and continue session flow.
- Rationale: Preserves user productivity while containing fault impact and maintaining observability.
- Alternatives considered:
  - Fail closed at session scope (rejected: breaks user workflow).
  - Disable adapter for remainder of session (rejected: unnecessarily drops valid subsequent events).

## Decision 6: Unsupported platform behavior

- Decision: For unknown/unsupported platforms, keep session running, disable memory capture for that session, and emit redacted warning diagnostics.
- Rationale: Prevents unsafe ingestion while preserving non-memory workflow continuity.
- Alternatives considered:
  - Generic fallback adapter (rejected: high schema mismatch risk).
  - Hard-stop initialization (rejected: violates fail-open objective).

## Decision 7: Diagnostic schema and retention

- Decision: Store only structured redacted diagnostics (`errorType`, `adapter`, `timestamp`, `fieldNames`) for 30 days.
- Rationale: Balances troubleshooting utility with privacy and storage control.
- Alternatives considered:
  - Full raw payload storage (rejected: privacy/security risk).
  - Minimal code-only diagnostics (rejected: poor debuggability).

## Decision 8: Performance target and validation

- Decision: Enforce memory-query SLO of p95 <= 2s for up to 100,000 entries per project and validate via representative workload tests.
- Rationale: Adds measurable non-functional acceptance criteria tied directly to planning and CI verification.
- Alternatives considered:
  - No explicit target (rejected: untestable performance outcome).
  - p95 <= 1s target (rejected: high risk without current benchmark evidence).

## Decision 9: Testing strategy for adapter architecture

- Decision: Add three layers of coverage: Claude regression baseline, per-adapter contract validation, and cross-platform continuity integration tests.
- Rationale: This combination directly protects existing behavior while validating portability and future adapter onboarding.
- Alternatives considered:
  - Unit tests only (rejected: insufficient contract-level confidence).
  - Manual smoke tests only (rejected: not scalable for regression prevention).

## Onboarding Drill Evidence (SC-004)

- Drill scope: Implement minimal example adapter without changing `src/core/mind.ts` shared rules.
- Start time: 2026-02-25T16:30:00Z
- End time: 2026-02-25T18:50:00Z
- Elapsed working time: 2h 20m (within 2 working days target)
- Contract validation result: PASS (`adapter-onboarding-contract.test.ts`, `adapter-versioning.test.ts`)
- Notes: Example adapter was added without modifying shared memory rules in `src/core/mind.ts`.
