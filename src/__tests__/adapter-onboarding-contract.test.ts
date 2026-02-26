import { describe, expect, it } from "vitest";
import { exampleAdapter } from "../platforms/adapters/example-adapter.js";

describe("adapter onboarding contract", () => {
  it("implements required adapter lifecycle methods", () => {
    expect(exampleAdapter.platform).toBe("example");
    expect(exampleAdapter.contractVersion).toBe("1.0.0");
    expect(exampleAdapter.normalizeSessionStart).toBeTypeOf("function");
    expect(exampleAdapter.normalizeToolObservation).toBeTypeOf("function");
    expect(exampleAdapter.normalizeSessionStop).toBeTypeOf("function");
  });
});
