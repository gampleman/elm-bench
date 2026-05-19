import path from "node:path";
import { findProject } from "./project.js";
import { discoverBenchmarks, filterBenchmarks } from "./discover.js";
import { generate } from "./generate.js";
import { compile } from "./compile.js";
import { verifyBenchmarks } from "./verify.js";
import { runInNode } from "./runners/node.js";
import { formatConsoleOutput } from "./report/console.js";
import { formatJsonOutput } from "./report/json.js";
import { formatMarkdownOutput } from "./report/markdown.js";
import { buildDependencyGraph } from "./deps.js";
import { startWatching } from "./watch.js";
import type { BenchmarkResult } from "./report/types.js";
import type { GeneratedProject } from "./generate.js";
import type { BenchmarkModule } from "./discover.js";


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
  watch?: boolean;
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

  const compiledPath = await compile(generated, {
    compiler: options.compiler,
    optimize: options.optimize,
  });

  const seed = options.seed ?? Math.floor(Math.random() * 2147483647);
  const resolvedOptions = { ...options, seed };

  const targets = options.targets.length > 0 ? options.targets : ["node"];
  const allResults = await runBenchmarks(compiledPath, targets, resolvedOptions);

  if (options.reporter === "json") {
    formatJsonOutput(allResults);
  } else if (options.reporter === "markdown") {
    formatMarkdownOutput(allResults);
  } else {
    await formatConsoleOutput(allResults);
  }

  if (options.watch) {
    await watchLoop(project, generated, benchmarks, allResults, targets, resolvedOptions);
  }
}

async function runBenchmarks(
  compiledPath: string,
  targets: string[],
  options: RunOptions
): Promise<Record<string, BenchmarkResult>> {
  const allResults: Record<string, BenchmarkResult> = {};

  console.log(`\nSeed: ${options.seed}  (reproduce with --seed ${options.seed})\n`);

  for (const target of targets) {
    console.log(`Running benchmarks in ${target}...\n`);

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

  return allResults;
}

async function watchLoop(
  project: { dir: string; elmJson: { "source-directories": string[] } },
  generated: GeneratedProject,
  benchmarks: BenchmarkModule[],
  lastResults: Record<string, BenchmarkResult>,
  targets: string[],
  options: RunOptions
): Promise<void> {
  const sourceDirs = project.elmJson["source-directories"] || ["src"];
  const depGraph = await buildDependencyGraph(sourceDirs, project.dir);

  const benchmarkModules = new Set(benchmarks.map((b) => b.moduleName));

  const watchPaths = sourceDirs.map((dir) => path.resolve(project.dir, dir));

  console.log("\nWatching for changes... (Ctrl+C to exit)\n");

  const watcher = startWatching({
    paths: watchPaths,
    debounceMs: 300,
    async onChange(changedPath) {
      const changedModule = depGraph.moduleForPath(changedPath);
      if (!changedModule) return;

      const affected = depGraph.transitiveDependentsOf(changedModule);
      affected.add(changedModule);

      const affectedBenchmarks = [...affected].filter((m) =>
        benchmarkModules.has(m)
      );

      // If no benchmark modules are affected but the changed module IS a
      // benchmark module, still re-run
      if (affectedBenchmarks.length === 0 && benchmarkModules.has(changedModule)) {
        affectedBenchmarks.push(changedModule);
      }

      if (affectedBenchmarks.length === 0) {
        // Changed file doesn't affect any benchmarks, skip
        return;
      }

      try {
        const compiledPath = await compile(generated, {
          compiler: options.compiler,
          optimize: options.optimize,
        });

        const freshResults = await runBenchmarks(compiledPath, targets, options);

        // Merge fresh results into last results
        for (const [target, result] of Object.entries(freshResults)) {
          lastResults[target] = result;
        }

        if (options.reporter === "json") {
          formatJsonOutput(lastResults);
        } else {
          await formatConsoleOutput(lastResults);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${message}`);
      }

      console.log("\nWatching for changes... (Ctrl+C to exit)\n");
    },
  });

  const cleanup = () => {
    watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep the process alive
  await new Promise<void>(() => {});
}
