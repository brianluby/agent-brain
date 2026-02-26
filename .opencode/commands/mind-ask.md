---
description: Ask Agent Brain a memory question
---

If `$ARGUMENTS` is empty, ask the user for a question.

Otherwise, use the `mind` tool with:

- `mode`: `"ask"`
- `query`: `$ARGUMENTS`

Then provide the answer and include 1-2 supporting memory points when available.
