# Feature Specification: Multi-Platform Agent Support

**Feature Branch**: `001-add-platform-adapters`  
**Created**: 2026-02-25  
**Status**: Draft  
**Input**: User description: "Add support for OpenCode and future agentic coding tools by introducing platform adapters while preserving current Claude behavior."

## Clarifications

### Session 2026-02-25

- Q: How should concurrent writes from multiple platforms to the same project memory be handled? → A: Use a single per-project write lock across all platforms (serialize writes).
- Q: What should be the canonical cross-platform project identity key for memory continuity? → A: Use platform project ID when present, otherwise fallback to canonical absolute project path.
- Q: What diagnostic detail should be recorded for malformed platform inputs? → A: Store structured error metadata only (error type, adapter, timestamp, field names), with sensitive values redacted.
- Q: How should adapter event-handling failures be handled during an active session? → A: Fail open per event: skip the failing event, record redacted diagnostics, and continue processing later events.
- Q: When legacy and platform-specific memory paths both exist, which path policy should be the default? → A: Legacy-first by default; use platform-specific path only with explicit user opt-in.
- Q: How should unknown or unsupported platforms be handled at runtime? → A: Run user session normally, disable memory capture for that session, and record redacted diagnostics with a warning.
- Q: How should missing required session metadata be handled per event? → A: Derive from runtime context when possible; if project identity remains unknown, skip that event and log redacted diagnostics.
- Q: What should be the memory query latency target at scale? → A: p95 <= 2s for up to 100k entries per project.
- Q: How long should redacted adapter diagnostics be retained? → A: 30 days.
- Q: How should adapter contract compatibility be versioned and enforced? → A: Use SemVer contract versioning; accept same major version and reject incompatible major versions with fail-open diagnostics.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Existing Claude Experience (Priority: P1)

As a current Claude plugin user, I can continue using memory features exactly as before during and after the platform migration, so I do not lose reliability or history while the product expands to new tools.

**Why this priority**: Existing users are already in production workflows, and regressions would immediately reduce trust and block adoption of any broader platform strategy.

**Independent Test**: Can be fully tested by running a Claude session end-to-end (session start context, tool-use capture, stop summary, memory search/ask/recent/stats) and confirming behavior matches current baseline.

**Acceptance Scenarios**:

1. **Given** an existing project with prior memory history, **When** a Claude session starts after this feature, **Then** prior memory context is still available and usable.
2. **Given** a Claude session that reads/edits files and runs commands, **When** the session ends, **Then** new observations and summaries are still persisted and searchable.
3. **Given** a Claude-only user, **When** they upgrade, **Then** no additional setup steps are required for standard memory workflows.

---

### User Story 2 - Enable OpenCode Memory Workflows (Priority: P2)

As an OpenCode user, I can use the same core memory capabilities (capture, recall, query, and recent timeline) so the product provides consistent value outside Claude.

**Why this priority**: OpenCode support is the first expansion target and proves the adapter model works beyond a single agent platform.

**Independent Test**: Can be fully tested by running OpenCode-compatible session flows that create memories and then retrieve them through search and question workflows.

**Acceptance Scenarios**:

1. **Given** an OpenCode session with meaningful tool activity, **When** the session progresses and ends, **Then** observations are captured and persisted in the shared memory store.
2. **Given** stored memory created via OpenCode, **When** the user runs recall/query operations, **Then** relevant historical context is returned.
3. **Given** a user switching between Claude and OpenCode on the same project, **When** they query memory, **Then** they can retrieve cross-session context regardless of originating platform.

---

### User Story 3 - Faster Onboarding for Future Platforms (Priority: P3)

As a maintainer, I can add a new agent platform by implementing a defined adapter contract instead of changing core memory logic, so future integrations are lower-risk and faster.

**Why this priority**: This reduces long-term maintenance cost and prevents repeated platform-specific changes from destabilizing core behavior.

**Independent Test**: Can be tested by implementing a minimal mock platform adapter and verifying it can resolve project context, process events, and store/retrieve memory without core rewrites.

**Acceptance Scenarios**:

1. **Given** a new platform with compatible event inputs, **When** a maintainer implements the adapter contract, **Then** core memory operations work without changing shared memory engine behavior.
2. **Given** adapter documentation and examples, **When** a maintainer starts a new integration, **Then** required responsibilities and expected outputs are clear.

### Edge Cases

- Missing required session metadata is derived from runtime context where possible; if project identity remains unknown, that event is skipped and redacted diagnostics are recorded.
- For unknown or unsupported platforms, user sessions continue normally, memory capture is disabled for that session, and redacted diagnostics are recorded with a warning.
- When legacy and platform-specific memory paths both exist, default read/write behavior remains legacy-first; platform-specific path is used only with explicit user opt-in.
- When two different platforms write to memory concurrently for the same project, writes are serialized through a single shared per-project lock.
- If adapter handling fails for an event, memory processing fails open at event scope: skip that event, record redacted diagnostics, and continue with subsequent events.
- For malformed platform inputs, diagnostics include only structured metadata (error type, adapter, timestamp, and field names) with sensitive values redacted.
- If an adapter declares an incompatible contract major version, memory capture for that adapter input is skipped and a redacted compatibility warning is recorded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a platform adapter contract that defines how integrations handle session-start, tool-observation capture, session-stop behavior, and project/path resolution.
- **FR-002**: The system MUST keep a single shared memory engine and shared lock/compression behavior that is reused by every platform adapter, including a single per-project write lock shared across platforms to serialize writes.
- **FR-003**: The system MUST preserve existing Claude workflows and user-visible outcomes for startup context, observation capture, session summaries, and memory query commands.
- **FR-004**: The system MUST provide an OpenCode integration that supports the same core user outcomes as Claude for capture, recall, and memory querying.
- **FR-005**: The system MUST support platform-aware memory path resolution with legacy-first default behavior (read/write existing project memory locations) and use platform-specific paths only when explicitly opted in by the user.
- **FR-006**: The system MUST fail open at event scope for malformed or adapter-failing platform input by skipping only the failing event and continuing later event processing.
- **FR-012**: The system MUST record malformed-input diagnostics as redacted structured metadata including error type, adapter, timestamp, and invalid/missing field names.
- **FR-007**: The system MUST isolate platform-specific behavior from shared core behavior so new platform integrations can be added without rewriting existing core memory rules.
- **FR-008**: The system MUST define and publish integration guidance that describes adapter responsibilities, required inputs, expected outputs, and failure behavior.
- **FR-009**: The system MUST include automated regression coverage for shared memory behavior and contract-level behavior for each supported platform adapter.
- **FR-010**: The system MUST support cross-platform memory continuity so users can retrieve relevant history even when sessions originate from different supported agents.
- **FR-011**: The system MUST resolve project identity for cross-platform memory continuity by using a platform-provided project ID when present, and otherwise falling back to canonical absolute project path.
- **FR-013**: The system MUST handle unknown or unsupported platforms in fail-open mode by allowing normal user session flow, disabling memory capture for that session, and recording a redacted diagnostic warning.
- **FR-014**: The system MUST resolve missing required session metadata from runtime context when available before event processing; if project identity still cannot be resolved, the system MUST skip only that event and record redacted diagnostics.
- **FR-015**: The system MUST meet a memory query latency target of p95 <= 2 seconds for projects with up to 100,000 memory entries.
- **FR-016**: The system MUST retain redacted adapter diagnostic records for 30 days.
- **FR-017**: The system MUST version the shared adapter contract using Semantic Versioning, accept adapter implementations matching the supported major version, and reject incompatible major versions in fail-open mode with redacted diagnostics.

### Assumptions

- Claude remains the default and must stay fully supported during and after this migration phase.
- OpenCode is the first non-Claude integration and serves as the reference pattern for later adapters.
- Existing memory files should remain readable and preferred unless a user explicitly opts into a different location strategy.
- Platform adapters may vary in payload shape, but each can provide enough information to produce meaningful observations.

### Dependencies

- Access to stable event inputs from each target platform (Claude, OpenCode, and future tools).
- Existing memory engine behavior remains stable and reusable by all adapters.
- Documentation updates are published alongside adapter contract updates.

### Key Entities *(include if feature involves data)*

- **Platform Adapter**: A platform-specific integration unit that translates native platform events into normalized memory operations and outputs.
- **Platform Event**: A normalized representation of session or tool activity used to capture observations consistently across platforms.
- **Memory Path Policy**: Rules that determine where project memory is stored, including backward-compatible fallback behavior.
- **Project Identity Key**: Canonical key used for cross-platform memory continuity, resolved from platform project ID when available, otherwise canonical absolute project path.
- **Adapter Contract Validation Set**: A set of expected behaviors used to verify that each adapter delivers required outcomes and fail-open handling.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of baseline Claude memory scenarios (startup context, capture, stop summary, search/ask/recent/stats) continue to pass after migration.
- **SC-002**: In the pilot validation dataset (>=10 projects and >=200 OpenCode sessions collected across >=14 days), at least 95% of OpenCode sessions with qualifying tool activity (>=3 captured tool events including at least 1 file-modifying or command-execution event) produce retrievable memory entries.
- **SC-003**: At least 90% of cross-platform recall checks (memory written in one supported platform, queried in another) return relevant history for the same project, where relevance means at least 1 of the top 5 results matches the expected validation keyword set for that check, sourced from `src/__tests__/fixtures/cross-platform-keywords.json` and maintained by plugin maintainers.
- **SC-004**: During a time-boxed onboarding drill, maintainers can deliver a minimal new platform integration using the adapter contract and documentation within 2 working days, pass contract validation tests, and avoid changes to shared memory engine rules in `src/core/mind.ts`.
- **SC-005**: Memory query operations meet p95 latency <= 2 seconds for project memory stores up to 100,000 entries under a representative workload profile of 100 queries per run (70 search, 20 ask, 10 recent/stats) after one warm-up run on a local Node.js 18 test environment.
- **SC-006**: Diagnostic retention policy enforcement tests confirm redacted adapter diagnostics expire within 30 days.
