---
description: Manage Claude's persistent memory stored in .claude/mind.mv2
argument-hint: [action] [query]
allowed-tools: Read, Bash
---

# Mind Command

Interact with Claude's persistent memory stored in `.claude/mind.mv2`.

**CRITICAL: Use EXACT command syntax below. Do NOT add flags like --path that don't exist.**

## Actions

### stats (default)
```bash
memvid stats .claude/mind.mv2
```

### search [query]
```bash
memvid find .claude/mind.mv2 --query "QUERY_HERE"
```

### ask [question]
```bash
memvid ask .claude/mind.mv2 --question "QUESTION_HERE"
```

### recent
```bash
memvid timeline .claude/mind.mv2 --limit 20 --reverse
```

## Usage Examples

```
/mind stats           → memvid stats .claude/mind.mv2
/mind search auth     → memvid find .claude/mind.mv2 --query "auth"
/mind ask "Why React?" → memvid ask .claude/mind.mv2 --question "Why React?"
/mind recent          → memvid timeline .claude/mind.mv2 --limit 20 --reverse
```

## Response Format

When displaying results:
- Convert Unix timestamps to human-readable (Xm ago, Xh ago, Xd ago)
- Summarize key findings in a table when appropriate
- If file doesn't exist, say "No memories captured yet"
