# Data Model: Multi-Platform Adapter Support

## Entity: PlatformAdapter

Description: Platform-specific integration that translates native runtime events into normalized memory operations.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `platform` | string | Yes | Unique adapter key (e.g., `claude`, `opencode`) |
| `contractVersion` | string | Yes | SemVer; major must match supported contract major |
| `capabilities` | string[] | Yes | Includes lifecycle handlers and metadata support flags |
| `status` | enum | Yes | `active`, `unsupported`, `disabled` |
| `diagnosticsEnabled` | boolean | Yes | Must remain true for redacted error observability |

## Entity: PlatformSession

Description: Runtime session abstraction across platforms.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `sessionId` | string | Yes | Platform-provided when available, else generated |
| `platform` | string | Yes | Must map to registered `PlatformAdapter.platform` |
| `projectIdentityKey` | string | Yes | Derived from platform project ID or canonical absolute path |
| `startedAt` | number | Yes | Unix epoch milliseconds |
| `endedAt` | number | No | Set on stop event |
| `state` | enum | Yes | `started`, `active`, `stopped`, `capture_disabled` |

## Entity: PlatformEvent

Description: Normalized event passed from adapter into shared memory engine.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `eventId` | string | Yes | Unique per event |
| `sessionId` | string | Yes | Must reference an existing `PlatformSession` |
| `platform` | string | Yes | Must reference an existing adapter |
| `eventType` | enum | Yes | `session_start`, `tool_observation`, `session_stop` |
| `timestamp` | number | Yes | Unix epoch milliseconds |
| `payload` | object | Yes | Adapter-normalized payload |
| `valid` | boolean | Yes | False indicates event skipped with diagnostics |

## Entity: Observation

Description: Persisted memory unit produced from valid tool/session activity.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `id` | string | Yes | Generated unique identifier |
| `timestamp` | number | Yes | Unix epoch milliseconds |
| `type` | enum | Yes | Existing observation taxonomy (`decision`, `bugfix`, etc.) |
| `summary` | string | Yes | Human-readable summary for search and context |
| `content` | string | Yes | Compressed/truncated as needed for storage limits |
| `tool` | string | No | Source tool name |
| `metadata` | object | No | Includes files, tags, `sessionId`, platform identifiers |

## Entity: SessionSummary

Description: Session-end aggregate memory record.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `id` | string | Yes | Uses session identifier |
| `startTime` | number | Yes | Unix epoch milliseconds |
| `endTime` | number | Yes | Unix epoch milliseconds |
| `observationCount` | number | Yes | Non-negative integer |
| `keyDecisions` | string[] | Yes | Trimmed to bounded length |
| `filesModified` | string[] | Yes | De-duplicated paths |
| `summary` | string | Yes | Session synopsis |

## Entity: MemoryPathPolicy

Description: Policy object that determines where memory is read/written.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `mode` | enum | Yes | `legacy_first` or `platform_opt_in` |
| `legacyPath` | string | Yes | Existing project memory path |
| `platformPath` | string | No | Used only when explicit opt-in enabled |
| `optInEnabled` | boolean | Yes | Guards platform-specific path writes |

## Entity: DiagnosticRecord

Description: Redacted diagnostic event emitted for malformed input, unsupported platforms, compatibility mismatches, or event-level adapter failures.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `diagnosticId` | string | Yes | Unique diagnostic identifier |
| `timestamp` | number | Yes | Unix epoch milliseconds |
| `platform` | string | Yes | Adapter/platform key |
| `errorType` | string | Yes | Categorized error class |
| `fieldNames` | string[] | No | Invalid or missing field names only |
| `severity` | enum | Yes | `warning` or `error` |
| `redacted` | boolean | Yes | Must be true |
| `expiresAt` | number | Yes | `timestamp + 30 days` retention policy |

## Relationships

- `PlatformAdapter (1) -> (N) PlatformSession`
- `PlatformSession (1) -> (N) PlatformEvent`
- `PlatformSession (1) -> (N) Observation`
- `PlatformSession (1) -> (0..1) SessionSummary`
- `PlatformEvent (0..1) -> (0..1) DiagnosticRecord` (for skipped/invalid events)
- `MemoryPathPolicy (1) -> (N) PlatformSession` (applies per project/session context)

## Identity and Uniqueness Rules

- Adapter uniqueness key: `platform`
- Session uniqueness key: `platform + sessionId`
- Event uniqueness key: `eventId`
- Project continuity key: `projectIdentityKey`
- Observation uniqueness key: `id`

## Lifecycle / State Transitions

`PlatformSession` transitions:

1. `started` -> `active` after successful session-start normalization
2. `active` -> `capture_disabled` when platform is unsupported or contract major mismatch is detected
3. `active` -> `stopped` on session-stop event
4. `capture_disabled` -> `stopped` on session-stop event

`PlatformEvent` transitions:

1. `received` -> `validated`
2. `validated` -> `processed` when normalization succeeds
3. `validated` -> `skipped` when required identity cannot be derived or adapter processing fails

## Scale Assumptions

- Per-project memory size target up to 100,000 entries.
- Query SLO: p95 <= 2s under representative workload.
- Diagnostics retained for 30 days only.
