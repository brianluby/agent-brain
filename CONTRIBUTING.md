# Contributing to memvid-mind

Thanks for your interest in contributing!

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Memvid/memvid-mind.git
cd memvid-mind

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test
```

## Project Structure

```
memvid-mind/
├── src/
│   ├── core/           # Mind engine
│   ├── hooks/          # Claude Code hooks
│   ├── utils/          # Helpers
│   └── types.ts        # Type definitions
├── commands/           # Slash commands
├── skills/             # Skills (optional)
├── .claude-plugin/     # Plugin manifest
└── dist/               # Built output
```

## How Hooks Work

- **SessionStart**: Injects past context when Claude starts
- **PostToolUse**: Captures observations from tool usage
- **Stop**: Saves session summary when Claude exits

## Making Changes

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes
4. Run tests: `npm test`
5. Push and open a PR

## Releasing

Releases are automated via GitHub Actions. To release:

1. Update version in `package.json`
2. Create a tag: `git tag v1.0.1`
3. Push the tag: `git push origin v1.0.1`

The CI will build and publish to npm automatically.

## Questions?

Open an issue or reach out at hello@memvid.com
