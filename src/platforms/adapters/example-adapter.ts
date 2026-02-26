import { createAdapter } from "./create-adapter.js";

/**
 * Example minimal adapter scaffold for future platform onboarding.
 * This adapter is intentionally not registered by default.
 *
 * To create a new adapter for your platform, use:
 *   export const myAdapter = createAdapter("my-platform");
 * Then register it via AdapterRegistry.register(myAdapter).
 */
export const exampleAdapter = createAdapter("example");
