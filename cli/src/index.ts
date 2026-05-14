import fs from "node:fs/promises";
import { findProject } from "./project.js";
import { discoverBenchmarks, filterBenchmarks } from "./discover.js";
import { generate } from "./generate.js";
import { compile } from "./compile.js";
import { verifyBenchmarks } from "./verify.js";
import { runInNode } from "./runners/node.js";
import { formatConsoleOutput } from "./report/console.js";
import { formatJsonOutput } from "./report/json.js";
import type { BenchmarkResult } from "./report/types.js";


export interface RunOptions {
  globs: string[];
  filter?: string;
  targets: string[];
  reporter: string;
  compiler?: string;
  projectPath?: string;
  seed?: number;
  skipTest: boolean;
  optimize: boolean;
}

export async function run(options: RunOptions): Promise<void> {
  const project = await findProject(options.projectPath);

  const globs =
    options.globs.length > 0 && options.globs[0] !== "benchmarks/src/**/*.elm"
      ? options.globs
      : (project.elmJson["source-directories"] || ["src"]).map(
          (dir: string) => `${dir}/**/*.elm`
        );

  let benchmarks = await discoverBenchmarks(project.dir, globs);

  if (benchmarks.length === 0) {
    throw new Error(
      "No benchmark modules found. Ensure your .elm files expose values of type Benchmark or Bench.Benchmark."
    );
  }

  const hasBenchType = benchmarks.some((m) => m.benchmarkType === "bench");

  // For raw benchmarks, filter at module level. For Bench type, filtering
  // happens at runtime in Elm via Bench.filter (supports sub-benchmark names).
  if (options.filter && !hasBenchType) {
    benchmarks = filterBenchmarks(benchmarks, options.filter);
    if (benchmarks.length === 0) {
      throw new Error(
        `No benchmarks matching "${options.filter}".`
      );
    }
  }

  const generated = await generate(project, benchmarks);

  let compiledPath: string;
  try {
    if (!options.skipTest) {
      const passed = await verifyBenchmarks(generated, {
        compiler: options.compiler,
        filter: options.filter,
        seed: options.seed,
      });
      if (!passed) {
        throw new Error(
          "Benchmark verification failed. Fix the implementations above before benchmarking."
        );
      }
    }

    compiledPath = await compile(generated, {
      compiler: options.compiler,
      optimize: options.optimize,
    });
  } finally {
    await fs.writeFile(generated.elmJsonPath, generated.originalElmJson);
  }

  const targets = options.targets.length > 0 ? options.targets : ["node"];
  const allResults: Record<string, BenchmarkResult> = {};

  for (const target of targets) {
    console.log(`\nRunning benchmarks in ${target}...\n`);

    if (target === "node") {
      allResults[target] = await runInNode(compiledPath, { filter: options.filter, seed: options.seed });
    } else {
      const { runInBrowser } = await import("./runners/browser.js");
      allResults[target] = await runInBrowser(compiledPath, {
        browser: target,
        filter: options.filter,
        seed: options.seed,
      });
    }
  }

  if (options.reporter === "json") {
    formatJsonOutput(allResults);
  } else {
    await formatConsoleOutput(allResults);
  }
}
