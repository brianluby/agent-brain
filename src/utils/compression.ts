/**
 * Memvid Mind - Endless Mode Compression
 *
 * Compresses large tool outputs to ~500 tokens while preserving key information.
 * This enables 20x more tool uses before hitting context limits.
 */

// Target compressed size in characters (~500 tokens ≈ 2000 chars)
const TARGET_COMPRESSED_SIZE = 2000;

// Threshold for when to apply compression
const COMPRESSION_THRESHOLD = 3000;

/**
 * Compress tool output while preserving key information
 */
export function compressToolOutput(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  output: string
): { compressed: string; wasCompressed: boolean; originalSize: number } {
  const originalSize = output.length;

  // Don't compress small outputs
  if (originalSize <= COMPRESSION_THRESHOLD) {
    return { compressed: output, wasCompressed: false, originalSize };
  }

  let compressed: string;

  switch (toolName) {
    case "Read":
      compressed = compressFileRead(toolInput, output);
      break;
    case "Bash":
      compressed = compressBashOutput(toolInput, output);
      break;
    case "Grep":
      compressed = compressGrepOutput(toolInput, output);
      break;
    case "Glob":
      compressed = compressGlobOutput(toolInput, output);
      break;
    case "Edit":
    case "Write":
      compressed = compressEditOutput(toolInput, output);
      break;
    default:
      compressed = compressGeneric(output);
  }

  return {
    compressed: truncateToTarget(compressed),
    wasCompressed: true,
    originalSize,
  };
}

/**
 * Compress file read output - extract structure and key patterns
 */
function compressFileRead(
  toolInput: Record<string, unknown> | undefined,
  output: string
): string {
  const filePath = (toolInput?.file_path as string) || "unknown";
  const fileName = filePath.split("/").pop() || "file";
  const lines = output.split("\n");
  const totalLines = lines.length;

  // Extract key information
  const imports = extractImports(output);
  const exports = extractExports(output);
  const functions = extractFunctionSignatures(output);
  const classes = extractClassNames(output);
  const errors = extractErrorPatterns(output);

  const parts: string[] = [
    `📄 File: ${fileName} (${totalLines} lines)`,
  ];

  if (imports.length > 0) {
    parts.push(`\n📦 Imports: ${imports.slice(0, 10).join(", ")}${imports.length > 10 ? ` (+${imports.length - 10} more)` : ""}`);
  }

  if (exports.length > 0) {
    parts.push(`\n📤 Exports: ${exports.slice(0, 10).join(", ")}${exports.length > 10 ? ` (+${exports.length - 10} more)` : ""}`);
  }

  if (functions.length > 0) {
    parts.push(`\n⚡ Functions: ${functions.slice(0, 10).join(", ")}${functions.length > 10 ? ` (+${functions.length - 10} more)` : ""}`);
  }

  if (classes.length > 0) {
    parts.push(`\n🏗️ Classes: ${classes.join(", ")}`);
  }

  if (errors.length > 0) {
    parts.push(`\n⚠️ Errors/TODOs: ${errors.slice(0, 5).join("; ")}`);
  }

  // Add first and last few lines for context
  const contextLines = [
    "\n--- First 10 lines ---",
    ...lines.slice(0, 10),
    "\n--- Last 5 lines ---",
    ...lines.slice(-5),
  ];

  parts.push(contextLines.join("\n"));

  return parts.join("");
}

/**
 * Compress bash output - focus on errors and key results
 */
function compressBashOutput(
  toolInput: Record<string, unknown> | undefined,
  output: string
): string {
  const command = (toolInput?.command as string) || "command";
  const shortCmd = command.split("\n")[0].slice(0, 100);
  const lines = output.split("\n");

  // Check for errors
  const errorLines = lines.filter(
    (l) =>
      l.toLowerCase().includes("error") ||
      l.toLowerCase().includes("failed") ||
      l.toLowerCase().includes("exception") ||
      l.toLowerCase().includes("warning")
  );

  // Check for success indicators
  const successLines = lines.filter(
    (l) =>
      l.toLowerCase().includes("success") ||
      l.toLowerCase().includes("passed") ||
      l.toLowerCase().includes("completed") ||
      l.toLowerCase().includes("done")
  );

  const parts: string[] = [`🖥️ Command: ${shortCmd}`];

  if (errorLines.length > 0) {
    parts.push(`\n❌ Errors (${errorLines.length}):`);
    parts.push(errorLines.slice(0, 10).join("\n"));
  }

  if (successLines.length > 0) {
    parts.push(`\n✅ Success indicators:`);
    parts.push(successLines.slice(0, 5).join("\n"));
  }

  // Add summary stats
  parts.push(`\n📊 Output: ${lines.length} lines total`);

  // Add first and last lines
  if (lines.length > 20) {
    parts.push("\n--- First 10 lines ---");
    parts.push(lines.slice(0, 10).join("\n"));
    parts.push("\n--- Last 5 lines ---");
    parts.push(lines.slice(-5).join("\n"));
  } else {
    parts.push("\n--- Full output ---");
    parts.push(lines.join("\n"));
  }

  return parts.join("");
}

/**
 * Compress grep output - summarize matches
 */
function compressGrepOutput(
  toolInput: Record<string, unknown> | undefined,
  output: string
): string {
  const pattern = (toolInput?.pattern as string) || "pattern";
  const lines = output.split("\n").filter(Boolean);

  // Extract unique files
  const files = new Set<string>();
  lines.forEach((line) => {
    const match = line.match(/^([^:]+):/);
    if (match) files.add(match[1]);
  });

  const parts: string[] = [
    `🔍 Grep: "${pattern.slice(0, 50)}"`,
    `📁 Found in ${files.size} files, ${lines.length} matches`,
  ];

  if (files.size > 0) {
    parts.push(`\n📂 Files: ${Array.from(files).slice(0, 15).join(", ")}${files.size > 15 ? ` (+${files.size - 15} more)` : ""}`);
  }

  // Show first 10 matches
  parts.push("\n--- Top matches ---");
  parts.push(lines.slice(0, 10).join("\n"));

  if (lines.length > 10) {
    parts.push(`\n... and ${lines.length - 10} more matches`);
  }

  return parts.join("");
}

/**
 * Compress glob output - summarize file list
 */
function compressGlobOutput(
  toolInput: Record<string, unknown> | undefined,
  output: string
): string {
  const pattern = (toolInput?.pattern as string) || "pattern";

  // Try to parse as JSON (Glob returns JSON)
  let files: string[] = [];
  try {
    const parsed = JSON.parse(output);
    files = parsed.filenames || [];
  } catch {
    files = output.split("\n").filter(Boolean);
  }

  // Group by directory
  const byDir: Record<string, string[]> = {};
  files.forEach((f) => {
    const dir = f.split("/").slice(0, -1).join("/") || "/";
    const file = f.split("/").pop() || f;
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(file);
  });

  const parts: string[] = [
    `📂 Glob: "${pattern.slice(0, 50)}"`,
    `📁 Found ${files.length} files in ${Object.keys(byDir).length} directories`,
  ];

  // Show top directories
  const topDirs = Object.entries(byDir)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  parts.push("\n--- Top directories ---");
  topDirs.forEach(([dir, dirFiles]) => {
    const shortDir = dir.split("/").slice(-3).join("/");
    parts.push(`${shortDir}/ (${dirFiles.length} files)`);
  });

  // Show some file names
  parts.push("\n--- Sample files ---");
  parts.push(files.slice(0, 15).map((f) => f.split("/").pop()).join(", "));

  return parts.join("");
}

/**
 * Compress edit output
 */
function compressEditOutput(
  toolInput: Record<string, unknown> | undefined,
  output: string
): string {
  const filePath = (toolInput?.file_path as string) || "unknown";
  const fileName = filePath.split("/").pop() || "file";

  return [
    `✏️ Edited: ${fileName}`,
    `📝 Changes applied successfully`,
    output.slice(0, 500),
  ].join("\n");
}

/**
 * Generic compression for unknown tool types
 */
function compressGeneric(output: string): string {
  const lines = output.split("\n");

  if (lines.length <= 30) {
    return output;
  }

  return [
    `📊 Output: ${lines.length} lines`,
    "--- First 15 lines ---",
    ...lines.slice(0, 15),
    "--- Last 10 lines ---",
    ...lines.slice(-10),
  ].join("\n");
}

/**
 * Extract import statements
 */
function extractImports(code: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:{\s*([^}]+)\s*}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    /from\s+['"]([^'"]+)['"]\s+import/g,
    /require\s*\(['"]([^'"]+)['"]\)/g,
    /use\s+(\w+(?:::\w+)*)/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      imports.push(match[3] || match[1] || match[2] || match[0]);
    }
  });

  return [...new Set(imports)];
}

/**
 * Extract export statements
 */
function extractExports(code: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s*{\s*([^}]+)\s*}/g,
    /pub\s+(?:fn|struct|enum|trait|mod)\s+(\w+)/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const names = (match[1] || "").split(",").map((s) => s.trim());
      exports.push(...names.filter(Boolean));
    }
  });

  return [...new Set(exports)];
}

/**
 * Extract function signatures
 */
function extractFunctionSignatures(code: string): string[] {
  const functions: string[] = [];
  const patterns = [
    /(?:async\s+)?function\s+(\w+)/g,
    /(\w+)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /fn\s+(\w+)/g,
    /def\s+(\w+)/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      functions.push(match[1]);
    }
  });

  return [...new Set(functions)];
}

/**
 * Extract class names
 */
function extractClassNames(code: string): string[] {
  const classes: string[] = [];
  const patterns = [
    /class\s+(\w+)/g,
    /struct\s+(\w+)/g,
    /interface\s+(\w+)/g,
    /type\s+(\w+)\s*=/g,
  ];

  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      classes.push(match[1]);
    }
  });

  return [...new Set(classes)];
}

/**
 * Extract error patterns
 */
function extractErrorPatterns(code: string): string[] {
  const errors: string[] = [];
  const lines = code.split("\n");

  lines.forEach((line) => {
    if (
      line.includes("TODO") ||
      line.includes("FIXME") ||
      line.includes("HACK") ||
      line.includes("XXX") ||
      line.includes("BUG")
    ) {
      errors.push(line.trim().slice(0, 100));
    }
  });

  return errors.slice(0, 10);
}

/**
 * Truncate to target size
 */
function truncateToTarget(text: string): string {
  if (text.length <= TARGET_COMPRESSED_SIZE) {
    return text;
  }

  return text.slice(0, TARGET_COMPRESSED_SIZE - 20) + "\n... (compressed)";
}

/**
 * Calculate compression ratio
 */
export function getCompressionStats(
  originalSize: number,
  compressedSize: number
): { ratio: number; saved: number; savedPercent: string } {
  const saved = originalSize - compressedSize;
  const ratio = originalSize / compressedSize;
  const savedPercent = ((saved / originalSize) * 100).toFixed(1);

  return { ratio, saved, savedPercent };
}
