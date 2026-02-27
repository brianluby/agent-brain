<div align="center">

<img src="agent-brain.png" alt="Agent Brain" width="320" />

### Give your agents photographic memory.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<br />

**[Install in 30 seconds](#installation)** · [How it Works](#how-it-works) · [Commands](#commands) · 

</div>

<br />

## Memvid Shoutout

Memvid's creative approach to data storage—encoding text in video frames and using decades of video codec R&D for superior compression—inspired me to fork their Claude Brain project into an agent-agnostic version. None of this would be possible without their dedication to open source. If you're working on AI memory, check them out at [github.com/memvid](https://github.com/memvid) —it's seriously clever engineering.

## The Problem

```
You: "Remember that auth bug we fixed?"
Agent 1: "I don't have memory of previous conversations."
Agent 2: "I did not work on this code yesterday.
You: "We spent 3 hours on it yesterday"
Agent 1: "I'd be happy to help debug from scratch!"
Agent 2: "Let me review the codebase to get an understanding" *sound of tokens burning*
```

**small context window. Zero memory between sessions.**

You're paying for a dory with a PhD.

<br />

## The Fix

```
You: "What did we decide about auth?"
Agent 1: "We chose JWT over sessions for your microservices.
        The refresh token issue - here's exactly what we fixed..."
Agent 2: " JWT overs sessions is a more secure implementation, Here is the code we fixed"
```

One file. All your agents remember everything.

<br />

## Installation

### Claude Code (Marketplace)

```bash
# Optional one-time setup (if GitHub plugin URLs fail)
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

```bash
# In Claude Code
/plugin add marketplace brianluby/Agent-brain
```

Then in Claude Code:

1. Open `/plugins`
2. Go to **Installed**
3. Enable **mind**
4. Restart Claude Code

On first run, memory is created at:

```bash
.agent-brain/mind.mv2
```

If you already have a legacy file at `.claude/mind.mv2`, migrate it safely to `.agent-brain/mind.mv2`:

```bash
if [ ! -f ".agent-brain/mind.mv2" ]; then
  mkdir -p ".agent-brain" && mv ".claude/mind.mv2" ".agent-brain/mind.mv2"
else
  echo "Destination .agent-brain/mind.mv2 already exists. Back up both .claude/mind.mv2 and .agent-brain/mind.mv2, then reconcile manually."
fi
```

### OpenCode

Add this plugin package to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@brianluby/agent-brain"]
}
```

Or use a local checkout while developing:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/agent-brain"]
}
```

Then restart OpenCode. The plugin will:

- inject memory context on the first message of each session
- capture tool outputs to persistent memory
- expose a `mind` tool (`search`, `ask`, `recent`, `stats`, `remember`)

Optional: install OpenCode slash commands globally for all projects:

```bash
mkdir -p ~/.config/opencode/commands
cp .opencode/commands/mind-*.md ~/.config/opencode/commands/
```

Project-local command files are already included in `.opencode/commands/`.

<br />

## How it Works

After install, Your Agent's memory lives in one file:

```
your-project/
└── .agent-brain/
    └── mind.mv2   # Agent's brain. That's it.
```

No database. No cloud. No API keys.

**What gets captured:**
- Session context, decisions, bugs, solutions
- Auto-injected at session start
- Searchable anytime

**Why one file?**
- `git commit` → version control Agent's brain
- `scp` → transfer anywhere
- Send to teammate → instant onboarding

<br />

## Commands

**In Claude Code:**
```bash
/mind stats                       # memory statistics
/mind search "authentication"     # find past context
/mind ask "why did we choose X?"  # ask your memory
/mind recent                      # what happened lately
```

**In OpenCode (slash commands):**
```bash
/mind-stats
/mind-search authentication
/mind-ask "why did we choose X?"
/mind-recent
/mind-remember "Project uses pnpm, not npm"
```

These are provided in `.opencode/commands/` for project-local usage.
To use them in every repo, copy them to `~/.config/opencode/commands/`.

Or just ask naturally: *"mind stats"*, *"search my memory for auth bugs"*, etc.

## OpenCode Support

Agent Brain supports the same core memory lifecycle through a platform adapter model.

- Claude and OpenCode sessions can share project memory continuity.
- Unknown or incompatible platforms fail open (session continues, memory capture safely skips).
- Adapter contracts are SemVer-checked and validated through regression and contract tests.
- OpenCode packaging is published through the npm package `@brianluby/agent-brain`.

<br />

## CLI (Optional)

No separate CLI install is required. Use the built-in memory commands in Claude Code (`/mind ...`) or OpenCode (`/mind-* ...`) for direct access.

<br />

## FAQ

<details>
<summary><b>How big is the file?</b></summary>

Empty: ~70KB. Grows ~1KB per memory. A year of use stays under 5MB.

</details>

<details>
<summary><b>Is it private?</b></summary>

100% local. Nothing leaves your machine. Ever.

</details>

<details>
<summary><b>How fast?</b></summary>

Sub-millisecond. Native Rust core. Searches 10K+ memories in <1ms.

</details>

<details>
<summary><b>Reset memory?</b></summary>

`rm .agent-brain/mind.mv2`

</details>

<br />

---

<div align="center">

Built as a local-first, single-file memory plugin for Claude Code and OpenCode.

<br />

**If this saved you time, [star the repo](https://github.com/brianluby/Agent-brain)**

<br />

*Send me your `.mv2` file and I'll tell you what's wrong with your code. No context needed - I already know everything.*

</div>
