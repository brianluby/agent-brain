---
description: Search Agent Brain memories by query
---

If `$ARGUMENTS` is empty, ask the user for a search query.

Otherwise, use the `mind` tool with:

- `mode`: `"search"`
- `query`: `$ARGUMENTS`
- `limit`: `10`

Then return the top matches with type and summary.
