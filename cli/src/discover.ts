import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";

export type BenchmarkType = "bench" | "raw";

export interface BenchmarkModule {
  filePath: string;
  moduleName: string;
  exposedBenchmarks: string[];
  benchmarkType: BenchmarkType;
}

export async function discoverBenchmarks(
  projectDir: string,
  globs: string[]
): Promise<BenchmarkModule[]> {
  const files = await glob(globs, { cwd: projectDir, absolute: true });
  const modules: BenchmarkModule[] = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const mod = parseModule(content, filePath, projectDir);
    if (mod && mod.exposedBenchmarks.length > 0) {
      modules.push(mod);
    }
  }

  return modules.sort((a, b) => a.moduleName.localeCompare(b.moduleName));
}

export function filterBenchmarks(
  modules: BenchmarkModule[],
  pattern: string
): BenchmarkModule[] {
  const lower = pattern.toLowerCase();
  const result: BenchmarkModule[] = [];

  for (const mod of modules) {
    // If the module name matches, include all its benchmarks
    if (mod.moduleName.toLowerCase().includes(lower)) {
      result.push(mod);
      continue;
    }

    // Otherwise filter individual benchmark values by name
    const matching = mod.exposedBenchmarks.filter((name) =>
      name.toLowerCase().includes(lower)
    );
    if (matching.length > 0) {
      result.push({ ...mod, exposedBenchmarks: matching });
    }
  }

  return result;
}

function parseModule(
  content: string,
  filePath: string,
  projectDir: string
): BenchmarkModule | null {
  const moduleMatch = content.match(
    /^(?:port\s+)?module\s+([\w.]+)\s+exposing\s*\(([^)]+)\)/m
  );
  if (!moduleMatch) return null;

  const moduleName = moduleMatch[1];
  const exposingClause = moduleMatch[2].trim();

  const exposedNames =
    exposingClause === ".."
      ? findAllBenchmarkAnnotations(content)
      : findExposedBenchmarkAnnotations(content, exposingClause);

  if (exposedNames.length === 0) return null;

  const usesBench =
    /Bench\.Benchmark/.test(content) || /^import Bench\b/m.test(content);
  const benchmarkType: BenchmarkType = usesBench ? "bench" : "raw";

  return { filePath, moduleName, exposedBenchmarks: exposedNames, benchmarkType };
}

function findAllBenchmarkAnnotations(content: string): string[] {
  return findBenchmarkTypeAnnotations(content);
}

function findExposedBenchmarkAnnotations(
  content: string,
  exposingClause: string
): string[] {
  const exposedNames = exposingClause
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /^[a-z]/.test(s));

  const allBenchmarks = findBenchmarkTypeAnnotations(content);
  return allBenchmarks.filter((name) => exposedNames.includes(name));
}

function findBenchmarkTypeAnnotations(content: string): string[] {
  const benchmarkNames: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    // Match: value : Benchmark, value : Benchmark.Benchmark, value : Bench.Benchmark
    const match = line.match(
      /^(\w+)\s*:\s*(?:Benchmark\.Benchmark|Benchmark|Bench\.Benchmark)\s*$/
    );
    if (match) {
      benchmarkNames.push(match[1]);
    }
  }

  return benchmarkNames;
}
