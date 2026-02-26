import {
  createEventId,
  type SessionStartEvent,
  type SessionStopEvent,
  type ToolObservationEvent,
} from "../events.js";
import type { PlatformAdapter } from "../contract.js";
import type { HookInput } from "../../types.js";

const CONTRACT_VERSION = "1.0.0";

export function createAdapter(platform: string): PlatformAdapter {
  function projectContext(input: HookInput) {
    return {
      platformProjectId: input.project_id,
      canonicalPath: input.cwd,
      cwd: input.cwd,
    };
  }

  return {
    platform,
    contractVersion: CONTRACT_VERSION,

    normalizeSessionStart(input: HookInput): SessionStartEvent {
      return {
        eventId: createEventId(),
        eventType: "session_start",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          hookEventName: input.hook_event_name,
          permissionMode: input.permission_mode,
          transcriptPath: input.transcript_path,
        },
      };
    },

    normalizeToolObservation(input: HookInput): ToolObservationEvent | null {
      if (!input.tool_name) return null;
      return {
        eventId: createEventId(),
        eventType: "tool_observation",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          toolName: input.tool_name,
          toolInput: input.tool_input,
          toolResponse: input.tool_response,
        },
      };
    },

    normalizeSessionStop(input: HookInput): SessionStopEvent {
      return {
        eventId: createEventId(),
        eventType: "session_stop",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          transcriptPath: input.transcript_path,
        },
      };
    },
  };
}
