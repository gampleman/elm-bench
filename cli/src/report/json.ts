import type { BenchmarkResult } from "./types.js";

export function formatJsonOutput(
  results: Record<string, BenchmarkResult>
): void {
  console.log(JSON.stringify(results, null, 2));
}
