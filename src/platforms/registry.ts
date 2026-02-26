import type { PlatformAdapter } from "./contract.js";

export interface ReadonlyAdapterRegistry {
  resolve(platform: string): PlatformAdapter | null;
  listPlatforms(): string[];
}

export class AdapterRegistry implements ReadonlyAdapterRegistry {
  private adapters = new Map<string, PlatformAdapter>();

  register(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  resolve(platform: string): PlatformAdapter | null {
    return this.adapters.get(platform) || null;
  }

  listPlatforms(): string[] {
    return [...this.adapters.keys()].sort();
  }
}
