import type { HookInput } from "../../types.js";

export const claudeSessionStartFixture: HookInput = {
  session_id: "claude-session-1",
  platform: "claude",
  contract_version: "1.0.0",
  cwd: "/tmp/project-alpha",
  hook_event_name: "SessionStart",
};

export const claudeToolFixture: HookInput = {
  session_id: "claude-session-1",
  platform: "claude",
  contract_version: "1.0.0",
  cwd: "/tmp/project-alpha",
  tool_name: "Read",
  tool_input: { file_path: "/tmp/project-alpha/src/index.ts" },
  tool_response: "const value = 1;\nconsole.log(value);",
};

export const opencodeToolFixture: HookInput = {
  session_id: "opencode-session-1",
  platform: "opencode",
  contract_version: "1.0.0",
  project_id: "project-alpha",
  cwd: "/tmp/project-alpha",
  tool_name: "Bash",
  tool_input: { command: "npm test" },
  tool_response: "PASS tests/index.test.ts",
};

export const unsupportedPlatformFixture: HookInput = {
  session_id: "other-session-1",
  platform: "unknown-platform",
  contract_version: "1.0.0",
  cwd: "/tmp/project-alpha",
};
