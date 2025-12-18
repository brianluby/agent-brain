# memvid-mind

[![Claude Memory](https://memvid.com/api/badge/Memvid/memvid-mind)](https://memvid.com)
[![npm version](https://img.shields.io/npm/v/memvid-mind.svg)](https://www.npmjs.com/package/memvid-mind)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Give Claude Code a memory. One file. That's it.

```bash
claude plugin install memvid-mind
```

---

## The problem

```
You: "Hey Claude, remember when we fixed that auth bug?"

Claude: "I don't have memory of previous conversations."

You: "We literally spent 3 hours on this yesterday"

Claude: "I'd be happy to help you debug it from scratch!"
```

200K context window. Zero memory between sessions. You're paying for a goldfish with a PhD.

---

## The fix

After you install, Claude remembers everything in one file:

```
your-project/
└── .claude/
    └── mind.mv2   # Claude's brain. ~4MB. That's it.
```

Next session:

```
You: "What did we decide about the auth system?"

Claude: "Last week we chose JWT over sessions because..."
```

---

## What it actually does

**On session start:** Loads relevant context from past sessions

**While you work:** Captures what Claude learns (file structures, decisions, bugs, fixes)

**On session end:** Saves a summary

No config. No database. No background service. Just one file that you can:
- `git commit` (version control your Claude's memory)
- `scp` to another machine (it just works)
- Share with teammates (instant context transfer)

---

## Endless Mode

Claude hits context limits fast when reading big files. This compresses tool outputs ~20x so you can actually finish what you started.

```
Before:  Read file (8K) + Edit (4K) + Bash (12K) = 24K tokens gone
After:   Read file (400) + Edit (200) + Bash (600) = 1.2K tokens
```

It keeps the important stuff (errors, structure, key functions) and drops the noise.

---

## Commands

```bash
/mind search "authentication"     # find past context
/mind ask "why postgres?"         # ask your memory
/mind recent                      # what happened lately
/mind stats                       # how much is stored
```

---

## vs claude-mem

claude-mem uses SQLite + Chroma + a background service on port 37777.

This uses one file. No dependencies beyond the native SDK.

| | memvid-mind | claude-mem |
|---|---|---|
| Storage | 1 file | SQLite + Chroma |
| Background process | No | Yes (port 37777) |
| Portable | Yes | No |
| Setup | `plugin install` | Complex |

---

## FAQ

**How big does the file get?**
~1KB per memory. 1000 memories ≈ 1MB.

**Privacy?**
Everything stays on your machine. Nothing uploaded.

**Does it slow things down?**
No. Native Rust core. Sub-millisecond operations.

**Reset memories?**
Delete `.claude/mind.mv2` or run `/mind clear`.

---

## Memory Badge

Show off Claude's learnings in your README:

```markdown
[![Claude Memory](https://memvid.com/api/badge/YOUR-USERNAME/YOUR-REPO)](https://memvid.com)
```

**Styles:**
```markdown
<!-- flat (default) -->
![](https://memvid.com/api/badge/user/repo)

<!-- flat-square -->
![](https://memvid.com/api/badge/user/repo?style=flat-square)

<!-- for-the-badge (large) -->
![](https://memvid.com/api/badge/user/repo?style=for-the-badge)

<!-- with size info -->
![](https://memvid.com/api/badge/user/repo?style=plastic)
```

The badge updates automatically when you push your `.claude/mind.mv2` file.

---

## Config (optional)

Most people don't need this. But if you want:

```json
// .memvid-mind.json
{
  "memoryPath": ".claude/mind.mv2",
  "maxContextObservations": 20,
  "endlessMode": true
}
```

---

MIT License

Built on [memvid](https://github.com/memvid/memvid) - the single-file memory engine.
