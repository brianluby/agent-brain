# Agent Brain — Rust Rewrite Feature Roadmap

This roadmap defines the phased plan for rewriting **Agent Brain** (currently TypeScript/Node.js) into a native Rust implementation. Each phase builds on the previous one, and each milestone ends with a usable, testable deliverable. The goal is full feature parity with the TypeScript codebase.

---

## Current TypeScript Architecture (Reference)

| Layer | Key Files | Responsibility |
|-------|-----------|----------------|
| **Core Memory Engine** | `src/core/mind.ts` | Singleton `Mind` class — open, remember, search, ask, getContext, stats, saveSessionSummary |
| **Type System** | `src/types.ts` | Observation, ObservationType (10 variants), MindConfig, SessionSummary, InjectedContext, MindStats |
| **Platform Adapters** | `src/platforms/` | Adapter trait, registry, contract validation, event pipeline, project identity, path policy, diagnostics |
| **Claude Hooks** | `src/hooks/` | smart-install, session-start, post-tool-use, stop |
| **OpenCode Plugin** | `src/opencode/plugin.ts` | Chat hook, tool hook, native `mind` tool, session cleanup |
| **Compression** | `src/utils/compression.ts` | Tool-output compression (~20× reduction, ~500 token target) |
| **Concurrency** | `src/utils/memvid-lock.ts` | File locking with retry + exponential backoff |
| **CLI Scripts** | `src/scripts/` | find, ask, stats, timeline |
| **Tests** | `src/__tests__/` | 48 test files — unit, integration, cross-platform, performance |

---

## Phase 0 — Project Bootstrap

**Goal:** Establish the Rust workspace, CI, and foundational crates.

- [ ] Initialize a Cargo workspace with the following crate layout:
  ```
  agent-brain-rs/
  ├── Cargo.toml              # workspace root
  ├── crates/
  │   ├── core/               # memory engine (mind)
  │   ├── types/              # shared types & errors
  │   ├── platforms/          # adapter system
  │   ├── compression/        # tool-output compression
  │   ├── hooks/              # Claude Code hook binaries
  │   ├── cli/                # CLI scripts (find, ask, stats, timeline)
  │   └── opencode/           # OpenCode plugin adapter
  ├── tests/                  # integration / cross-crate tests
  └── README.md
  ```
- [ ] Set up CI (GitHub Actions): `cargo fmt --check`, `cargo clippy`, `cargo test`, `cargo build --release`
- [ ] Choose and pin Rust edition (2024) and MSRV policy
- [ ] Add workspace-level dependencies:
  - `serde` / `serde_json` — serialization
  - `thiserror` — error types
  - `tokio` — async runtime
  - `tracing` — structured logging (replaces `console.log` / `debug`)
  - `chrono` — timestamps
  - `uuid` — observation IDs
  - `clap` — CLI argument parsing
  - `semver` — contract version validation

### Parity target
Equivalent to: project scaffolding, `tsconfig.json`, `tsup.config.ts`, `package.json` scripts, `.github/` CI

---

## Phase 1 — Type System & Configuration (`crates/types`)

**Goal:** Port every shared type, making illegal states unrepresentable.

- [ ] `ObservationType` — enum with 10 variants: `Discovery`, `Decision`, `Problem`, `Solution`, `Pattern`, `Warning`, `Success`, `Refactor`, `Bugfix`, `Feature`
- [ ] `Observation` — struct with `observation_id`, `timestamp`, `obs_type`, `tool`, `summary`, `content`, `metadata`
- [ ] `ObservationMetadata` — struct with `files`, `platform`, `project_identity_key`, `compressed`, `session_id`, and extensible `extra: HashMap<String, serde_json::Value>`
- [ ] `SessionSummary` — struct with session-level aggregation fields
- [ ] `InjectedContext` — struct for context returned at session start
- [ ] `MindConfig` — struct with defaults:
  - `memory_path`: `.agent-brain/mind.mv2`
  - `max_context_observations`: 20
  - `max_context_tokens`: 2000
  - `auto_compress`: true
  - `min_confidence`: 0.6
  - `debug`: false
- [ ] `MindStats` — struct for stats output
- [ ] `HookInput` / `HookOutput` — structs matching the JSON hook protocol
- [ ] `AgentBrainError` — unified error enum using `thiserror`
- [ ] Environment variable resolution helper (`MEMVID_PLATFORM`, `MEMVID_MIND_DEBUG`, etc.)
- [ ] Unit tests for serialization round-trips and default values

### Parity target
Equivalent to: `src/types.ts`, config defaults in `src/core/mind.ts`, env-var handling

---

## Phase 2 — Core Memory Engine (`crates/core`)

**Goal:** Implement the `Mind` struct — the heart of the system.

### 2a — Storage Backend
- [ ] Define a `MemoryBackend` trait abstracting storage (read, write, search)
- [ ] Implement an initial **JSON-lines backend** (one JSON object per line in a `.jsonl` file) for development and testing
- [ ] Plan for a Memvid-compatible backend once Rust bindings or equivalent codec exist (feature-flagged)
- [ ] File-based backup management — keep 3 most recent backups, rotate on write
- [ ] Corrupted-file detection and recovery (checksum header or magic bytes)

### 2b — Mind API
- [ ] `Mind::open(config) -> Result<Mind>` — singleton-like initialization with file locking
- [ ] `mind.remember(obs_type, summary, content, metadata) -> Result<ObservationId>`
- [ ] `mind.search(query, limit) -> Result<Vec<Observation>>` — lexical/substring search
- [ ] `mind.ask(question) -> Result<String>` — search + format answer context
- [ ] `mind.get_context(query) -> Result<InjectedContext>` — retrieve recent/relevant observations up to token budget
- [ ] `mind.save_session_summary() -> Result<()>` — end-of-session aggregation
- [ ] `mind.stats() -> Result<MindStats>` — total count, session count, timespan, type breakdown
- [ ] Token estimation utility (port `estimateTokens` — character-based heuristic)

### 2c — Concurrency & Locking
- [ ] Cross-process file locking (port `memvid-lock.ts`)
  - Use `fs2` or `fd-lock` crate for advisory file locks
  - Retry with exponential backoff (matching TS behavior)
- [ ] Ensure `Mind` is `Send + Sync` safe for multi-threaded consumers
- [ ] Concurrent-writer regression tests (equivalent to `mind-lock.test.ts`)

### Parity target
Equivalent to: `src/core/mind.ts`, `src/utils/memvid-lock.ts`, `src/utils/helpers.ts`

---

## Phase 3 — Tool-Output Compression (`crates/compression`)

**Goal:** Port the intelligent compression system that reduces large tool outputs to ~500 tokens.

- [ ] Compression dispatcher — route by tool type: `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `WebFetch`, etc.
- [ ] **Read file compression** — extract imports, exports, function/class signatures, errors, first/last lines
- [ ] **Bash output compression** — highlight errors, success indicators, truncate middle
- [ ] **Grep result compression** — summarize file matches and top results
- [ ] **Glob result compression** — group files by directory, count per group
- [ ] **Edit operation compression** — track file path and change summary
- [ ] **Generic fallback** — head/tail truncation with `[...N lines omitted...]`
- [ ] Target budget: ~2000 characters (~500 tokens)
- [ ] Unit tests with representative tool outputs, verifying compression ratio ≥ 10×

### Parity target
Equivalent to: `src/utils/compression.ts` (431 lines)

---

## Phase 4 — Platform Adapter System (`crates/platforms`)

**Goal:** Port the multi-platform abstraction layer.

### 4a — Core Abstractions
- [ ] `PlatformAdapter` trait:
  - `name() -> &str`
  - `version() -> semver::Version`
  - `normalize_session_start(raw) -> Result<SessionStartEvent>`
  - `normalize_tool_observation(raw) -> Result<ToolObservationEvent>`
  - `normalize_session_stop(raw) -> Result<SessionStopEvent>`
- [ ] Event types: `SessionStartEvent`, `ToolObservationEvent`, `SessionStopEvent`
- [ ] `PlatformProjectContext` — project identification struct

### 4b — Contract Validation
- [ ] SemVer-based contract compatibility checking (port `contract.ts`)
- [ ] `ContractValidationResult` type
- [ ] Fail-open semantics — validation failures emit diagnostics but don't block

### 4c — Event Pipeline
- [ ] `Pipeline` — validate and process platform events through adapters (port `pipeline.ts`)
- [ ] Fail-open error handling throughout

### 4d — Adapters
- [ ] Claude Code adapter (port `adapters/claude.ts`)
- [ ] OpenCode adapter (port `adapters/opencode.ts`)
- [ ] `create_adapter` factory function
- [ ] Adapter registry with discovery and resolution

### 4e — Supporting Modules
- [ ] **Project Identity** (`identity.rs`) — resolve correct memory file per project using git remote, directory name, or explicit key
- [ ] **Path Policy** (`path_policy.rs`) — memory file path resolution with platform-specific overrides and legacy migration
- [ ] **Platform Detector** (`platform_detector.rs`) — detect Claude vs OpenCode vs custom from env vars and context
- [ ] **Diagnostics** (`diagnostics.rs` + `diagnostic_store.rs`) — severity levels, persistent diagnostic logging to `.claude/platform-diagnostics.json`, retention policy

### Parity target
Equivalent to: entire `src/platforms/` directory (contract, pipeline, registry, identity, path-policy, platform-detector, diagnostics, diagnostic-store, adapters)

---

## Phase 5 — Claude Code Hooks (`crates/hooks`)

**Goal:** Build the four hook binaries that Claude Code invokes as subprocess commands.

Each hook is a small binary that reads JSON from stdin and writes JSON to stdout.

### 5a — smart-install
- [ ] Detect missing dependencies
- [ ] Run install command (`cargo build` or equivalent)
- [ ] Track installation state with `.install-version` marker file
- [ ] Fail-open — never block session startup

### 5b — session-start
- [ ] Initialize `Mind` for the project
- [ ] Detect platform and memory location
- [ ] Inject recent context (observations, session summaries)
- [ ] Suggest migration from legacy `.claude/mind.mv2` path
- [ ] Show available commands/skills

### 5c — post-tool-use
- [ ] Capture observations after each tool execution
- [ ] Deduplication within 60-second window (hash of tool + summary)
- [ ] Compress large outputs using the compression crate
- [ ] Support all tool types: Read, Edit, Write, Bash, Grep, Glob, WebFetch, etc.
- [ ] Fail-open — never block tool execution

### 5d — stop
- [ ] Capture file modifications via `git diff`
- [ ] Generate session summary
- [ ] Store individual edits for searchability
- [ ] Graceful shutdown of mind instance

### 5e — hooks.json Manifest
- [ ] Generate `hooks.json` matching the Claude Code hook registration format
- [ ] Include binary paths, event types, and metadata

### Parity target
Equivalent to: `src/hooks/` (smart-install.ts, session-start.ts, post-tool-use.ts, stop.ts, hooks.json)

---

## Phase 6 — CLI Scripts (`crates/cli`)

**Goal:** Provide the same developer-facing CLI tools.

- [ ] `agent-brain find <pattern>` — search memories by pattern
- [ ] `agent-brain ask <question>` — question answering interface
- [ ] `agent-brain stats` — display memory statistics (total, sessions, timespan, types)
- [ ] `agent-brain timeline` — chronological memory view
- [ ] Shared CLI utilities (output formatting, color, table rendering)
- [ ] Use `clap` for argument parsing with subcommands
- [ ] Integration tests for each command

### Parity target
Equivalent to: `src/scripts/` (find.ts, ask.ts, stats.ts, timeline.ts, utils.ts)

---

## Phase 7 — OpenCode Plugin Adapter (`crates/opencode`)

**Goal:** Port the OpenCode plugin integration.

- [ ] Chat message hook — inject context into conversations
- [ ] Tool execution hook — capture observations from tool use
- [ ] Native `mind` tool with modes: `search`, `ask`, `recent`, `stats`, `remember`
- [ ] Session cleanup on deletion
- [ ] Deduplication with session-scoped call cache
- [ ] Plugin manifest and registration (adapt to whatever the Rust OpenCode plugin system requires, or build as a standalone binary that OpenCode invokes)

### Parity target
Equivalent to: `src/opencode/plugin.ts` (520 lines)

---

## Phase 8 — Plugin Packaging & Distribution

**Goal:** Make the Rust version installable and usable in the same way.

- [ ] `.claude-plugin/plugin.json` and `marketplace.json` manifests pointing to Rust binaries
- [ ] `skills/` directory with SKILL.md files (mind, memory)
- [ ] `commands/` directory with OpenCode slash command definitions (ask, search, recent, stats)
- [ ] Cross-platform release binaries (Linux x86_64, Linux aarch64, macOS x86_64, macOS aarch64, Windows x86_64)
- [ ] `install.sh` / `install.ps1` — download and configure for the user's platform
- [ ] Cargo publish as a crate (optional — primarily distributed as binaries)
- [ ] npm wrapper package that downloads the correct native binary (optional bridge strategy)

### Parity target
Equivalent to: `.claude-plugin/`, `skills/`, `commands/`, `package.json` distribution config

---

## Phase 9 — Testing & Quality

**Goal:** Match or exceed the TypeScript test suite coverage.

- [ ] **Unit tests** for every public API in each crate
- [ ] **Integration tests** — cross-crate workflows (remember → search → getContext cycle)
- [ ] **Platform tests** — adapter normalization, cross-platform event round-trips
- [ ] **Concurrency tests** — parallel writers, lock contention, recovery from stale locks
- [ ] **Performance benchmarks** — memory query latency, compression throughput, startup time
  - Target: faster than TypeScript version on all benchmarks
- [ ] **Compatibility tests** — read `.mv2` / `.jsonl` files written by TypeScript version
- [ ] **Fuzz testing** — malformed inputs to compression, hook JSON parsing, and search queries
- [ ] CI gates: `cargo fmt`, `cargo clippy -- -D warnings`, `cargo test`, `cargo bench`

### Parity target
Equivalent to: `src/__tests__/` (48 test files), plus Rust-specific quality improvements

---

## Phase 10 — Migration & Backwards Compatibility

**Goal:** Allow users to seamlessly switch from TypeScript to Rust.

- [ ] Memory file format reader for existing `.mv2` files (if Memvid SDK has a documented format, or via FFI to the JS SDK)
- [ ] Migration CLI: `agent-brain migrate` — converts legacy memory to Rust-native format
- [ ] Side-by-side mode: Rust reads memories written by TS version and vice versa (shared `.jsonl` or `.mv2`)
- [ ] Configuration migration — honor existing env vars and `.agent-brain/` directory structure
- [ ] Document breaking changes and migration steps

---

## Summary: Phase Dependencies

```
Phase 0 (Bootstrap)
  └─► Phase 1 (Types)
        ├─► Phase 2 (Core Engine)
        │     ├─► Phase 3 (Compression)
        │     │     └─► Phase 5 (Hooks) ──► Phase 8 (Packaging)
        │     └─► Phase 6 (CLI)
        └─► Phase 4 (Platform Adapters)
              ├─► Phase 5 (Hooks)
              └─► Phase 7 (OpenCode Plugin)

Phase 9 (Testing) runs continuously from Phase 1 onward
Phase 10 (Migration) runs after Phase 2 is stable
```

---

## Key Architectural Decisions for Rust

| Decision | Rationale |
|----------|-----------|
| **Cargo workspace with multiple crates** | Mirrors the TS module structure, enables independent compilation and testing |
| **Trait-based adapter system** | Rust traits replace TypeScript interfaces; enables static dispatch for performance |
| **`thiserror` for errors** | Type-safe error hierarchy replaces scattered `try/catch` |
| **`serde` for serialization** | Zero-copy JSON parsing, derives replace manual parsing |
| **`tokio` async runtime** | Async file I/O and potential future network operations |
| **`fs2` / `fd-lock` for file locking** | Cross-platform advisory locks replacing `proper-lockfile` |
| **Binary hooks (not scripts)** | Each hook compiles to a native binary — faster cold start than Node.js |
| **JSONL as initial storage format** | Simple, appendable, human-readable; upgrade path to Memvid later |
| **Feature flags for optional backends** | `--features memvid` to enable Memvid codec when bindings exist |

---

## Rust Advantages Over TypeScript Version

- **Startup time**: Native binaries start in <5ms vs ~200ms for Node.js — critical for hooks that run on every tool use
- **Memory safety**: No null/undefined errors, no uncaught promise rejections
- **Concurrency**: Fearless concurrency with Rust's ownership model vs manual locking
- **Single binary distribution**: No npm install, no node_modules, no version conflicts
- **Performance**: Compression and search operations will be significantly faster
- **Type safety**: Algebraic data types make illegal states unrepresentable at compile time
