# Agent Brain Constitution

## Core Principles

### I. Adapter-First Architecture

- Platform-specific behavior MUST live behind a typed adapter contract.
- Shared memory engine behavior MUST remain platform-agnostic and reusable.
- New platform support MUST be added by implementing adapters, not by forking core logic.

### II. TypeScript and Node Runtime Standard

- Production and test code MUST use TypeScript on Node.js >= 18 with ESM conventions.
- Public module surfaces MUST be strongly typed; avoid untyped exports except where external SDK boundaries require narrowing.

### III. Backward Compatibility for Existing Claude Workflows

- Changes MUST preserve baseline Claude user outcomes for session start context, capture, stop summary, and memory commands.
- Migration work MUST default to legacy-safe behavior unless a user explicitly opts into new behavior.

### IV. Fail-Open Reliability

- Hook and adapter failures MUST fail open at event scope: skip only the failing event and continue session flow.
- Unsupported or incompatible adapter inputs MUST never hard-stop user sessions.

### V. Contract and Test-First Delivery

- Contract changes MUST be defined before implementation tasks are finalized.
- Required behavior is complete only when targeted tests pass and regressions remain green.
- Must-Have requirements and acceptance criteria MUST map to executable tasks.

### VI. Local-First Privacy and Security

- Memory data MUST remain local-first unless a feature explicitly defines and approves a different trust boundary.
- Diagnostics MUST be redacted by default and MUST NOT persist sensitive payload values.
- Security requirements from SEC artifacts (when present) MUST map to implementation tasks.

### VII. Measurable Performance and Operational Quality

- Performance requirements MUST use measurable targets (for example p95 latency) and testable validation.
- Non-functional requirements for reliability, observability, and retention MUST be represented in tasks when in scope.

### VIII. Dependency and Simplicity Discipline

- Reuse existing project patterns and dependencies before adding new libraries.
- New dependencies MUST include requirement-level justification in planning artifacts.

## Additional Constraints

- Implementation-ready quality gates: `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.
- Feature artifacts (`spec.md`, `plan.md`, `tasks.md`) MUST stay mutually consistent on scope, terminology, and acceptance behavior.
- Task lists MUST preserve story-level independence and explicit file-path traceability.

## Development Workflow

1. Clarify requirements and resolve high-impact ambiguities.
2. Produce implementation plan and design artifacts.
3. Generate tasks with explicit requirement and acceptance coverage.
4. Implement incrementally by story, validating each story independently.
5. Run quality gates before merge.

## Governance

- This constitution governs all feature-level specs, plans, tasks, and implementation decisions in this repository.
- Constitution conflicts are resolved by updating feature artifacts to comply.
- Weakening constitutional requirements requires a separate explicit constitution amendment.
- Amendments MUST include rationale, affected principles, version bump rationale, and migration impact on active features.

**Version**: 2.0.0 | **Ratified**: 2026-02-21 | **Last Amended**: 2026-02-25
