---
description: Save a manual memory note into Agent Brain
---

If `$ARGUMENTS` is empty, ask the user what they want to remember.

Otherwise, use the `mind` tool with:

- `mode`: `"remember"`
- `type`: `"discovery"`
- `summary`: a short one-line summary of `$ARGUMENTS`
- `content`: `$ARGUMENTS`

Then confirm the memory was saved.
