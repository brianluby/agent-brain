import { generateId } from "../utils/helpers.js";

export type PlatformEventType = "session_start" | "tool_observation" | "session_stop";

export interface PlatformProjectContext {
  platformProjectId?: string;
  canonicalPath?: string;
  cwd?: string;
}

export interface PlatformEventBase {
  eventId: string;
  eventType: PlatformEventType;
  platform: string;
  contractVersion: string;
  sessionId: string;
  timestamp: number;
  projectContext: PlatformProjectContext;
}

export interface SessionStartPayload {
  hookEventName?: string;
  permissionMode?: string;
  transcriptPath?: string;
}

export interface ToolObservationPayload {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResponse?: unknown;
}

export interface SessionStopPayload {
  transcriptPath?: string;
}

export interface SessionStartEvent extends PlatformEventBase {
  eventType: "session_start";
  payload: SessionStartPayload;
}

export interface ToolObservationEvent extends PlatformEventBase {
  eventType: "tool_observation";
  payload: ToolObservationPayload;
}

export interface SessionStopEvent extends PlatformEventBase {
  eventType: "session_stop";
  payload: SessionStopPayload;
}

export type PlatformEvent = SessionStartEvent | ToolObservationEvent | SessionStopEvent;

export function createEventId(): string {
  return generateId();
}
