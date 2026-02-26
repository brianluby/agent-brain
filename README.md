<div align="center">

<img src="agent-brain.png" alt="Agent Brain" width="320" />

### Give your agents photographic memory.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<br />

**[Install in 30 seconds](#installation)** · [How it Works](#how-it-works) · [Commands](#commands) · 

</div>

<br />

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

### Agent

```bash
# One-time setup (if you haven't used GitHub plugins before)
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

```bash
# In Agent Code
/plugin add marketplace brianluby/Agent-brain
```

Then: `/plugins` → Installed → **mind** Enable Plugin → Restart.

Done.

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

**In Agent Code:**
```bash
/mind stats                       # memory statistics
/mind search "authentication"     # find past context
/mind ask "why did we choose X?"  # ask your memory
/mind recent                      # what happened lately
```

Or just ask naturally: *"mind stats"*, *"search my memory for auth bugs"*, etc.

## OpenCode Support

Memvid Mind now supports the same core memory lifecycle through a platform adapter model.

- Claude and OpenCode sessions can share project memory continuity.
- Unknown or incompatible platforms fail open (session continues, memory capture safely skips).
- Adapter contracts are SemVer-checked and validated through regression and contract tests.

<br />

## CLI (Optional)

For power users who want direct access to their memory file:

```bash
npm install -g memvid-cli
```

```bash
memvid stats .Agent/mind.mv2           # view memory stats
memvid find .Agent/mind.mv2 "auth"     # search memories
memvid ask .Agent/mind.mv2 "why JWT?"  # ask questions
memvid timeline .Agent/mind.mv2        # view timeline
```

[Full CLI reference →](https://docs.memvid.com/cli/cheat-sheet)

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

`rm .Agent/mind.mv2`

</details>

<br />

---

<div align="center">

Built on **[memvid](https://github.com/brianluby/memvid)** - the single-file memory engine

<br />

**If this saved you time, [star the repo](https://github.com/brianluby/Agent-brain)**

<br />

*Send me your `.mv2` file and I'll tell you what's wrong with your code. No context needed - I already know everything.*

</div>
