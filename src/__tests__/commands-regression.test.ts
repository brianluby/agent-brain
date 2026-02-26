import { describe, expect, it } from "vitest";

describe("command export regression", () => {
  it("keeps key memory exports available", async () => {
    const exports = await import("../index.js");
    expect(exports.DEFAULT_CONFIG).toBeDefined();
    expect(exports.getDefaultAdapterRegistry).toBeTypeOf("function");
    expect(exports.detectPlatform).toBeTypeOf("function");
  });
});
