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
