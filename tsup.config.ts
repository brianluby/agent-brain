import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "hooks/session-start": "src/hooks/session-start.ts",
    "hooks/post-tool-use": "src/hooks/post-tool-use.ts",
    "hooks/stop": "src/hooks/stop.ts",
    // SDK-based scripts (no CLI dependency)
    "scripts/find": "src/scripts/find.ts",
    "scripts/ask": "src/scripts/ask.ts",
    "scripts/stats": "src/scripts/stats.ts",
    "scripts/timeline": "src/scripts/timeline.ts",
  },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts" } },
  clean: true,
  sourcemap: true,
  target: "node18",
  outDir: "dist",
  splitting: false,
  treeshake: true,
  minify: false,
  external: ["@memvid/sdk"],
  esbuildOptions(options) {
    // Add shebang only to hook files
    options.banner = {
      js: "",
    };
  },
});
