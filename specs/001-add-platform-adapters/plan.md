# Implementation Plan: Multi-Platform Agent Support

**Branch**: `001-add-platform-adapters` | **Date**: 2026-02-25 | **Spec**: `specs/001-add-platform-adapters/spec.md`
**Input**: Feature specification from `specs/001-add-platform-adapters/spec.md`

## Summary

Introduce a platform-adapter architecture that preserves current Claude behavior while enabling OpenCode and future agentic tools to share a single memory engine. The implementation centers on a versioned adapter contract, platform-aware path and identity resolution, fail-open event handling, and regression plus contract tests to guarantee cross-platform memory continuity.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >= 18 (ESM)  
**Primary Dependencies**: `@memvid/sdk`, `proper-lockfile`, Node `fs/path`, `vitest`, `tsup`  
**Storage**: Local per-project `.mv2` memory file with legacy-first path policy and optional platform-specific opt-in path  
**Testing**: `vitest run` unit/regression tests + adapter contract tests + cross-platform continuity integration tests  
**Target Platform**: Local CLI hook runtime for Claude Code and OpenCode on macOS/Linux/Windows (Node runtime)  
**Project Type**: Single Node/TypeScript package with hook scripts and shared core library  
**Performance Goals**: Memory query p95 <= 2s at up to 100,000 entries per project; no startup regression for Claude baseline workflows  
**Constraints**: Per-project cross-platform write lock; fail-open per event; redacted diagnostics retained 30 days; SemVer major compatibility enforcement for adapters  
**Scale/Scope**: Claude parity + first OpenCode adapter in this feature; enable new adapter onboarding in <=2 working days without core rewrites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- Principle I (Adapter-First Architecture): PASS - plan centers adapter contract and platform isolation.
- Principle III (Backward Compatibility): PASS - Claude baseline parity is a primary scope and test target.
- Principle IV (Fail-Open Reliability): PASS - event-scope fail-open behavior is explicit in design and tasks.
- Principle V (Contract and Test-First Delivery): PASS - contracts plus regression/contract tests are included in artifacts and tasks.
- Principle VI (Local-First Privacy and Security): PASS - local storage and redacted diagnostics are explicitly required.
- Additional Constraints (quality gates): PASS - `lint`, `typecheck`, `test`, and `build` are required in final execution tasks.

## Project Structure

### Documentation (this feature)

```text
specs/001-add-platform-adapters/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── platform-adapter.openapi.yaml
└── tasks.md             # Generated later by /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── core/
│   └── mind.ts
├── platforms/
│   ├── adapters/
│   │   ├── claude.ts
│   │   ├── opencode.ts
│   │   └── example-adapter.ts
│   ├── contract.ts
│   ├── registry.ts
│   ├── pipeline.ts
│   ├── identity.ts
│   ├── path-policy.ts
│   ├── diagnostics.ts
│   ├── diagnostic-store.ts
│   ├── platform-detector.ts
│   └── events.ts
├── hooks/
│   ├── session-start.ts
│   ├── post-tool-use.ts
│   ├── stop.ts
│   └── smart-install.ts
├── scripts/
│   ├── ask.ts
│   ├── find.ts
│   ├── stats.ts
│   ├── timeline.ts
│   └── utils.ts
├── utils/
│   ├── compression.ts
│   ├── helpers.ts
│   └── memvid-lock.ts
├── __tests__/
│   ├── fixtures/
│   │   ├── platform-events.ts
│   │   └── cross-platform-keywords.json
│   ├── metrics/
│   │   ├── opencode-retrieval-rate.test.ts
│   │   └── cross-platform-recall-rate.test.ts
│   ├── platform-foundation.test.ts
│   ├── platform-failopen.test.ts
│   ├── opencode-adapter-contract.test.ts
│   ├── cross-platform-lock-contention.test.ts
│   ├── memory-query-performance.test.ts
│   ├── session-start-startup-regression.test.ts
│   ├── index.test.ts
│   └── mind-lock.test.ts
├── index.ts
└── types.ts

commands/
skills/
.claude-plugin/
.opencode/

dist/
```

Note: The test tree above is representative, not exhaustive; full coverage includes story-specific regression and continuity suites listed in `specs/001-add-platform-adapters/tasks.md`.

**Structure Decision**: Keep the existing single-package TypeScript structure and add adapter abstractions under `src/` (new adapter contract, platform registry, and per-platform adapters) while preserving current hook entrypoints and shared `src/core/mind.ts` engine.

## Phase 0 Output

- `research.md` captures decisions for adapter contract versioning, fail-open behavior, cross-platform identity, diagnostic policy, and performance validation.

## Phase 1 Output

- `data-model.md` defines platform adapter/domain entities, validation rules, and lifecycle transitions.
- `contracts/platform-adapter.openapi.yaml` defines internal contract endpoints for session lifecycle, event ingestion, and memory query actions.
- `quickstart.md` provides implementation and verification steps for Claude + OpenCode adapter flows.
- Agent context was updated via `.specify/scripts/bash/update-agent-context.sh opencode`.

## Complexity Tracking

No constitution violations requiring explicit exception tracking at this phase.
