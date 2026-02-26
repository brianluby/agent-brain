import type { HookInput } from "../types.js";
import type {
  SessionStartEvent,
  SessionStopEvent,
  ToolObservationEvent,
} from "./events.js";

export const SUPPORTED_ADAPTER_CONTRACT_MAJOR = 1;

const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

export interface ContractValidationResult {
  compatible: boolean;
  supportedMajor: number;
  adapterMajor: number | null;
  reason?: string;
}

export function parseContractMajor(version: string): number | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

export function validateAdapterContractVersion(
  version: string,
  supportedMajor = SUPPORTED_ADAPTER_CONTRACT_MAJOR
): ContractValidationResult {
  const adapterMajor = parseContractMajor(version);
  if (adapterMajor === null) {
    return {
      compatible: false,
      supportedMajor,
      adapterMajor: null,
      reason: "invalid_contract_version",
    };
  }

  if (adapterMajor !== supportedMajor) {
    return {
      compatible: false,
      supportedMajor,
      adapterMajor,
      reason: "incompatible_contract_major",
    };
  }

  return {
    compatible: true,
    supportedMajor,
    adapterMajor,
  };
}

export interface PlatformAdapter {
  platform: string;
  contractVersion: string;
  normalizeSessionStart(input: HookInput): SessionStartEvent;
  normalizeToolObservation(input: HookInput): ToolObservationEvent | null;
  normalizeSessionStop(input: HookInput): SessionStopEvent;
}
