import { Command } from "commander";
import { run } from "./index.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require(path.join(__dirname, "..", "package.json"));

const program = new Command();

program
  .name("elm-bench")
  .description("CLI runner for Elm benchmarks")
  .version(pkg.version);

const runCmd = program
  .command("run", { isDefault: true })
  .description("Run benchmarks")
  .argument("[globs...]", "Benchmark files")
  .option("-f, --filter <pattern>", "Only run benchmarks matching pattern")
  .option(
    "-t, --target <name>",
    "Execution target (repeatable): node, chromium, firefox, webkit",
    (val: string, acc: string[]) => [...acc, val],
    [] as string[]
  )
  .option(
    "-r, --reporter <format>",
    "Output format: console, json",
    "console"
  )
  .option("--compiler <path>", "Path to elm binary")
  .option("--project <path>", "Path to benchmarks elm.json")
  .option("--seed <number>", "Random seed for fuzz tests and fuzzer-based inputs")
  .option("--skip-test", "Skip correctness verification before benchmarking")
  .option("--no-optimize", "Disable --optimize flag")
  .action(async (globs: string[], options) => {
    try {
      await run({
        globs,
        filter: options.filter,
        targets: options.target,
        reporter: options.reporter,
        compiler: options.compiler,
        projectPath: options.project,
        seed: options.seed ? parseInt(options.seed, 10) : undefined,
        skipTest: options.skipTest ?? false,
        optimize: options.optimize,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}`);
      process.exit(1);
    }
  });

program.parse();
