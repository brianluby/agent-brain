/**
 * Memvid Mind
 *
 * Give Claude photographic memory in ONE portable file.
 *
 * @packageDocumentation
 */

export { Mind, getMind, resetMind } from "./core/mind.js";
export type {
  Observation,
  ObservationType,
  ObservationMetadata,
  SessionSummary,
  InjectedContext,
  MindConfig,
  MindStats,
  MemorySearchResult,
  HookInput,
  HookOutput,
} from "./types.js";
export { DEFAULT_CONFIG } from "./types.js";
export {
  generateId,
  estimateTokens,
  truncateToTokens,
  formatTimestamp,
  safeJsonParse,
  readStdin,
  writeOutput,
  debug,
  extractKeyInfo,
  classifyObservationType,
} from "./utils/helpers.js";
export {
  getDefaultAdapterRegistry,
  resetDefaultAdapterRegistry,
  detectPlatform,
  detectPlatformFromEnv,
  processPlatformEvent,
  resolveProjectIdentityKey,
  resolveMemoryPathPolicy,
  createRedactedDiagnostic,
  validateAdapterContractVersion,
  SUPPORTED_ADAPTER_CONTRACT_MAJOR,
  claudeAdapter,
  opencodeAdapter,
  exampleAdapter,
  createAdapter,
} from "./platforms/index.js";
export type { ReadonlyAdapterRegistry } from "./platforms/index.js";
