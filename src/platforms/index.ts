import { AdapterRegistry } from "./registry.js";
import type { ReadonlyAdapterRegistry } from "./registry.js";
import { claudeAdapter, opencodeAdapter } from "./adapters/index.js";

export * from "./contract.js";
export * from "./diagnostics.js";
export * from "./diagnostic-store.js";
export * from "./events.js";
export * from "./identity.js";
export * from "./path-policy.js";
export * from "./pipeline.js";
export * from "./platform-detector.js";
export type { ReadonlyAdapterRegistry } from "./registry.js";
export { AdapterRegistry } from "./registry.js";
export * from "./adapters/index.js";

let defaultRegistry: AdapterRegistry | null = null;

export function getDefaultAdapterRegistry(): ReadonlyAdapterRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new AdapterRegistry();
    defaultRegistry.register(claudeAdapter);
    defaultRegistry.register(opencodeAdapter);
  }

  return defaultRegistry;
}

export function resetDefaultAdapterRegistry(): void {
  defaultRegistry = null;
}
