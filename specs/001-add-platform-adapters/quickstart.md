# Quickstart: Multi-Platform Adapter Support

## 1) Prerequisites

- Node.js 18+
- npm (or pnpm) installed
- Existing repository checkout on branch `001-add-platform-adapters`

## 2) Install and baseline checks

```bash
npm install
npm run typecheck
npm run test
```

## 3) Implement adapter architecture

1. Add a shared adapter contract with SemVer compatibility checks.
2. Keep the shared memory engine in `src/core/mind.ts`; route platform events through adapters.
3. Add adapter registry/resolver logic:
   - Resolve adapter by platform key.
   - On unknown platform, disable memory capture for that session and emit redacted warning diagnostics.
4. Implement OpenCode adapter using the same lifecycle outcomes as Claude:
   - Session start context
   - Tool observation capture
   - Session stop summary persistence
5. Preserve legacy-first memory path behavior; support explicit opt-in for platform-specific paths.

## 3.1) Adapter responsibilities checklist

For each new adapter, implement all of the following:

- Normalize `session_start`, `tool_observation`, and `session_stop` events.
- Provide project identity context (`platformProjectId` or canonical path fallback inputs).
- Emit compatible SemVer `contractVersion` (major must match supported major).
- Preserve fail-open behavior: skip invalid events, never hard-stop user sessions.
- Emit only redacted diagnostics metadata for failures.

## 4) Validate fail-open and diagnostics behavior

Run focused tests for:

- Missing metadata: derive from runtime context; skip event if project identity remains unknown.
- Malformed payload: skip failing event, continue session processing, store redacted diagnostics.
- Contract major mismatch: skip memory capture for incompatible adapter input, emit compatibility warning.

## 5) Verify performance and cross-platform continuity

- Run memory query performance tests to confirm p95 <= 2s at up to 100k entries/project.
- Run cross-platform continuity tests:
  - Write memory in Claude -> query in OpenCode
  - Write memory in OpenCode -> query in Claude

## 6) Suggested local verification commands

```bash
npm run lint
npm run typecheck
npm run test
```

## 7) Manual smoke flow

1. Start Claude session in a test project, create observations, then stop session.
2. Start OpenCode session in same project, query for Claude-created memory.
3. Inject a malformed event payload and confirm:
   - Session continues
   - Event is skipped
   - Redacted diagnostics are recorded with 30-day retention metadata

## 8) SC-002 and SC-003 metric summary

- Pilot dataset constraints (SC-002): `12 projects`, `240 sessions`, `17 days` (meets >=10 projects, >=200 sessions, >=14 days)
- OpenCode retrieval rate (SC-002): `19/20 = 95%` (target >=95%)
- Cross-platform recall rate (SC-003): `9/10 = 90%` (target >=90%)
- Keyword fixture source: `src/__tests__/fixtures/cross-platform-keywords.json`

## 9) Quality gate execution log

- `npm run lint` -> PASS (warnings only, no lint errors)
- `npm run typecheck` -> PASS
- `npm run test` -> PASS
- `npm run build` -> PASS
