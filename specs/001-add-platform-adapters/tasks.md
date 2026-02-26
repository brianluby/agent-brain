# Tasks: Multi-Platform Agent Support

**Input**: Design documents from `specs/001-add-platform-adapters/`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Tests are included because the specification explicitly requires automated regression and contract coverage.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All task descriptions include exact file paths

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish adapter module skeleton and shared planning assets.

- [x] T001 Create adapter module directories and barrel exports in `src/platforms/index.ts` and `src/platforms/adapters/index.ts`
- [x] T002 Define shared adapter contract types and SemVer helpers in `src/platforms/contract.ts`
- [x] T003 [P] Add normalized platform event/session type definitions in `src/platforms/events.ts`
- [x] T004 [P] Add diagnostic record types and retention constants in `src/platforms/diagnostics.ts`
- [x] T005 [P] Add multi-platform test fixtures for Claude/OpenCode payloads in `src/__tests__/fixtures/platform-events.ts`
- [x] T006 Update public exports for new adapter modules in `src/index.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build shared runtime foundations that block all user stories until complete.

**⚠️ CRITICAL**: No user story work starts before this phase completes.

- [x] T007 Implement adapter registry and unsupported-platform fail-open resolution in `src/platforms/registry.ts`
- [x] T008 Implement project identity key resolver (platform ID -> canonical path fallback) in `src/platforms/identity.ts`
- [x] T009 Implement legacy-first memory path policy with explicit opt-in override in `src/platforms/path-policy.ts`
- [x] T010 Integrate path policy and project identity resolution into memory initialization in `src/core/mind.ts`
- [x] T011 Implement redacted diagnostic persistence with 30-day expiry metadata in `src/platforms/diagnostic-store.ts`
- [x] T012 Implement event ingestion pipeline (validate -> normalize -> accept/skip) in `src/platforms/pipeline.ts`
- [x] T013 [P] Add foundational tests for contract versioning, identity fallback, and path policy in `src/__tests__/platform-foundation.test.ts`
- [x] T014 [P] Add fail-open behavior tests for malformed input and unsupported platforms in `src/__tests__/platform-failopen.test.ts`

**Checkpoint**: Foundation complete - user stories can proceed.

---

## Phase 3: User Story 1 - Preserve Existing Claude Experience (Priority: P1) 🎯 MVP

**Goal**: Keep Claude workflows and user-visible memory outcomes unchanged while routing through adapters.

**Independent Test**: Run a Claude end-to-end session (session start context, tool capture, stop summary, search/ask/recent/stats) and verify baseline parity.

### Tests for User Story 1

- [x] T015 [P] [US1] Add Claude session-start context regression test in `src/__tests__/claude-session-start.test.ts`
- [x] T016 [P] [US1] Add Claude tool observation capture regression test in `src/__tests__/claude-post-tool-use.test.ts`
- [x] T017 [P] [US1] Add Claude stop-hook summary and file-change regression test in `src/__tests__/claude-stop.test.ts`
- [x] T018 [P] [US1] Add memory command regression tests for search/ask/recent/stats in `src/__tests__/commands-regression.test.ts`

### Implementation for User Story 1

- [x] T019 [US1] Implement Claude adapter using shared contract lifecycle in `src/platforms/adapters/claude.ts`
- [x] T020 [US1] Refactor session-start hook to dispatch through adapter registry in `src/hooks/session-start.ts`
- [x] T021 [US1] Refactor post-tool-use hook to emit normalized events via pipeline in `src/hooks/post-tool-use.ts`
- [x] T022 [US1] Refactor stop hook to use adapter pipeline and fail-open diagnostics in `src/hooks/stop.ts`
- [x] T023 [US1] Preserve backward-compatible legacy-first defaults for Claude memory path behavior in `src/core/mind.ts`
- [x] T024 [US1] Update Claude hook manifest wording for adapter runtime behavior in `src/hooks/hooks.json`

**Checkpoint**: US1 remains fully functional and independently testable.

---

## Phase 4: User Story 2 - Enable OpenCode Memory Workflows (Priority: P2)

**Goal**: Provide OpenCode support for capture, recall, query, and cross-platform continuity with Claude.

**Independent Test**: Run OpenCode lifecycle events to create memory, then verify recall/query and Claude<->OpenCode continuity on the same project.

### Tests for User Story 2

- [x] T025 [P] [US2] Add OpenCode adapter lifecycle contract tests in `src/__tests__/opencode-adapter-contract.test.ts`
- [x] T026 [P] [US2] Add continuity integration test for Claude-write/OpenCode-query in `src/__tests__/cross-platform-claude-to-opencode.test.ts`
- [x] T027 [P] [US2] Add continuity integration test for OpenCode-write/Claude-query in `src/__tests__/cross-platform-opencode-to-claude.test.ts`

### Implementation for User Story 2

- [x] T028 [US2] Implement OpenCode adapter with normalized event mapping in `src/platforms/adapters/opencode.ts`
- [x] T029 [US2] Implement runtime platform detection and adapter selection helper in `src/platforms/platform-detector.ts`
- [x] T030 [US2] Integrate platform detection into session-start processing in `src/hooks/session-start.ts`
- [x] T031 [US2] Integrate platform detection into tool-use and stop flows in `src/hooks/post-tool-use.ts` and `src/hooks/stop.ts`
- [x] T032 [US2] Document OpenCode setup and usage workflow in `README.md`

**Checkpoint**: US2 works independently and preserves cross-platform memory continuity.

---

## Phase 5: User Story 3 - Faster Onboarding for Future Platforms (Priority: P3)

**Goal**: Make new platform integration low-risk by enforcing adapter contract guidance, compatibility checks, and onboarding examples.

**Independent Test**: Implement a minimal mock adapter against the contract and verify lifecycle processing without core memory rewrites.

### Tests for User Story 3

- [x] T033 [P] [US3] Add minimal mock-adapter contract compliance test in `src/__tests__/adapter-onboarding-contract.test.ts`
- [x] T034 [P] [US3] Add incompatible contract-major fail-open test in `src/__tests__/adapter-versioning.test.ts`

### Implementation for User Story 3

- [x] T035 [US3] Add adapter implementation responsibilities and onboarding flow in `specs/001-add-platform-adapters/quickstart.md`
- [x] T036 [US3] Add example minimal adapter scaffold in `src/platforms/adapters/example-adapter.ts`
- [x] T037 [US3] Enforce major-version compatibility checks in adapter contract validator in `src/platforms/contract.ts`
- [x] T038 [US3] Align lifecycle contract documentation and schemas in `specs/001-add-platform-adapters/contracts/platform-adapter.openapi.yaml`
- [x] T039 [US3] Execute a time-boxed onboarding drill for a minimal adapter and record elapsed-time + pass/fail evidence in `specs/001-add-platform-adapters/research.md`

**Checkpoint**: US3 onboarding flow is independently testable with a mock adapter.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final cross-story quality, performance, and readiness checks.

- [x] T040 [P] Add memory query performance regression test (p95 <= 2s @ 100k entries) in `src/__tests__/memory-query-performance.test.ts`
- [x] T041 [P] Add diagnostic retention policy enforcement test (30-day expiry) in `src/__tests__/diagnostic-retention.test.ts`
- [x] T042 [P] Add cross-platform lock contention test for concurrent writes in `src/__tests__/cross-platform-lock-contention.test.ts`
- [x] T043 [P] Add Claude session-start startup regression test in `src/__tests__/session-start-startup-regression.test.ts`
- [x] T044 [P] Define cross-platform validation keyword fixtures for recall scoring in `src/__tests__/fixtures/cross-platform-keywords.json`
- [x] T045 [P] Add OpenCode retrieval-rate metrics test with >=95% threshold assertion in `src/__tests__/metrics/opencode-retrieval-rate.test.ts`
- [x] T046 [P] Add cross-platform recall-rate metrics test with >=90% threshold assertion using keyword fixtures in `src/__tests__/metrics/cross-platform-recall-rate.test.ts`
- [x] T047 Update migration/release notes for adapter architecture in `README.md` and `specs/001-add-platform-adapters/research.md`
- [x] T048 Run quickstart validation and record SC-002/SC-003 metric summary and verification notes in `specs/001-add-platform-adapters/quickstart.md`
- [x] T049 Run `npm run lint`, `npm run typecheck`, and `npm run test`; record results in `specs/001-add-platform-adapters/quickstart.md`
- [x] T050 Run `npm run build` and record build verification notes in `specs/001-add-platform-adapters/quickstart.md`
- [x] T051 Validate SC-002 pilot dataset constraints (>=10 projects, >=200 sessions, >=14 days) and record evidence in `specs/001-add-platform-adapters/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks all user stories
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2 and coordinated sequencing with US1 hook refactor tasks (`T020`-`T022`) unless hook integration is isolated first
- **Phase 5 (US3)**: Depends on Phase 2 and benefits from US1/US2 adapter patterns
- **Phase 6 (Polish)**: Depends on completion of selected user stories

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories after foundation
- **US2 (P2)**: Functionally independent after foundation, but requires coordination with US1 for shared hook files (`src/hooks/session-start.ts`, `src/hooks/post-tool-use.ts`, `src/hooks/stop.ts`)
- **US3 (P3)**: No hard product dependency, but should leverage completed adapter scaffolding from US1/US2

### Within Each User Story

- Write tests first and confirm they fail before implementation
- Implement adapter/domain models before hook wiring
- Implement hook wiring before cross-platform integration assertions
- Complete story checkpoint validation before moving to lower priority

### Dependency Graph

- `Phase1 -> Phase2 -> US1 -> Phase6`
- `Phase2 -> US1 hook refactor stabilization (T020-T022) -> US2 -> Phase6`
- `Phase2 -> US3 -> Phase6`

---

## Parallel Execution Examples

### User Story 1

```bash
# Parallel regression tests for Claude parity
T015, T016, T017, T018

# Parallel-safe implementation split
T019 and T023
```

### User Story 2

```bash
# Parallel continuity and contract tests
T025, T026, T027

# Parallel implementation split
T028 and T029
```

### User Story 3

```bash
# Parallel onboarding/version tests
T033, T034

# Parallel implementation split
T035 and T036
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational)
3. Complete Phase 3 (US1)
4. Validate Claude baseline parity end-to-end

### Incremental Delivery

1. Deliver MVP with US1
2. Add US2 and validate cross-platform continuity
3. Add US3 to finalize future adapter onboarding path
4. Execute Phase 6 quality/performance hardening

### Parallel Team Strategy

1. Team aligns on Phase 1 + Phase 2 together
2. After foundation:
   - Engineer A: US1 parity tasks
   - Engineer B: US2 OpenCode tasks
   - Engineer C: US3 onboarding tasks
3. Merge stories after independent checkpoints pass

---

## Notes

- `[P]` tasks are parallelizable and avoid same-file conflicts where possible
- `[USx]` labels provide story traceability for independent delivery
- Each story defines independent validation criteria for release gating
