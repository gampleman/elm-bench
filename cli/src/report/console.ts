import chalk from "chalk";
import { isScaleResult, renderScaleChart } from "./chart.js";
import { renderScaleChartImage, displayInlineImage } from "./chart-image.js";
import type {
  BenchmarkResult,
  BenchmarkStatus,
  SeriesEntry,
} from "./types.js";

let _terminalGraphics: { iterm2: boolean; kitty: boolean; sixel: boolean } | null = null;

async function getTerminalGraphics() {
  if (_terminalGraphics !== null) return _terminalGraphics;
  try {
    const stg = await import("supports-terminal-graphics");
    _terminalGraphics = stg.default.stdout;
  } catch {
    _terminalGraphics = { iterm2: false, kitty: false, sixel: false };
  }
  return _terminalGraphics;
}

export async function formatConsoleOutput(
  results: Record<string, BenchmarkResult>
): Promise<void> {
  const environments = Object.keys(results);
  const isMultiEnv = environments.length > 1;

  console.log(chalk.bold("\nBenchmark Results\n"));

  if (isMultiEnv) {
    await formatMultiEnvironment(results, environments);
  } else {
    await formatSingleEnvironment(results[environments[0]]);
  }
}

async function formatSingleEnvironment(result: BenchmarkResult): Promise<void> {
  const flat = flattenResults(result, []);
  let totalBenchmarks = 0;
  const graphics = await getTerminalGraphics();
  const supportsImages = graphics.iterm2 || graphics.kitty;

  for (const { path, result: r } of flat) {
    if (r.kind === "group" && isScaleResult(r) && supportsImages) {
      console.log(`  ${chalk.bold(formatPath(path, r.name))}`);
      const png = renderScaleChartImage(r);
      if (png) {
        displayInlineImage(png);
      } else {
        const chartLines = renderScaleChart(r);
        for (const line of chartLines) console.log(line);
      }
      totalBenchmarks += countBenchmarks(r);
    } else {
      printBenchmarkResult(path, r);
      totalBenchmarks += countBenchmarks(r);
    }
  }

  console.log(chalk.dim("  " + "═".repeat(55)));
  console.log(chalk.dim(`  ${totalBenchmarks} benchmarks completed\n`));
}

async function formatMultiEnvironment(
  results: Record<string, BenchmarkResult>,
  environments: string[]
): Promise<void> {
  const graphics = await getTerminalGraphics();
  const supportsImages = graphics.iterm2 || graphics.kitty;
  const primaryEnv = environments[0];
  const primaryFlat = flattenResults(results[primaryEnv], []);
  let totalBenchmarks = 0;

  const colWidth = 18;
  const allNames = primaryFlat.flatMap(({ result: r }) =>
    r.kind === "series" ? r.entries.map((e) => e.name) : []
  );
  const nameWidth = Math.max(20, ...allNames.map((n) => n.length)) + 2;

  const header =
    "  " +
    "".padEnd(nameWidth) +
    environments.map((e) => chalk.bold(e.padEnd(colWidth))).join("");
  console.log(header);
  console.log(chalk.dim("  " + "─".repeat(nameWidth + environments.length * colWidth)));

  for (const { path, result: r } of primaryFlat) {
    if (r.kind === "group" && isScaleResult(r)) {
      console.log(`\n  ${chalk.bold(formatPath(path, r.name))}`);
      for (const env of environments) {
        const envResult = findMatchingResult(results[env], path, r.name);
        if (envResult && envResult.kind === "group" && isScaleResult(envResult)) {
          console.log(chalk.dim(`\n    ${env}:`));
          if (supportsImages) {
            const png = renderScaleChartImage(envResult);
            if (png) {
              displayInlineImage(png);
            } else {
              const chartLines = renderScaleChart(envResult);
              for (const line of chartLines) console.log(`  ${line}`);
            }
          } else {
            const chartLines = renderScaleChart(envResult);
            for (const line of chartLines) console.log(`  ${line}`);
          }
        }
      }
      totalBenchmarks += countBenchmarks(r);
    } else if (r.kind === "series") {
      console.log(`\n  ${chalk.bold(formatPath(path, r.name))}`);
      console.log(
        chalk.dim(`  ${"".padEnd(nameWidth)}${environments.map((e) => e.padEnd(colWidth)).join("")}`)
      );
      console.log(chalk.dim("  " + "─".repeat(nameWidth + environments.length * colWidth)));
      const primaryRanking = rankEntries(r.entries);

      for (const entryName of primaryRanking) {
        let line = `  ${entryName.padEnd(nameWidth)}`;

        for (const env of environments) {
          const envResult = findMatchingResult(results[env], path, r.name);
          if (envResult && envResult.kind === "series") {
            const envEntry = envResult.entries.find(
              (e) => e.name === entryName
            );
            if (envEntry && envEntry.status.status === "success") {
              const envRanking = rankEntries(envResult.entries);
              const primaryRank = primaryRanking.indexOf(entryName);
              const envRank = envRanking.indexOf(entryName);

              let formatted = formatRunsPerSecond(
                envEntry.status.runsPerSecond
              ).padEnd(colWidth);

              if (env !== primaryEnv) {
                if (envRank < primaryRank) {
                  formatted = chalk.green(formatted);
                } else if (envRank > primaryRank) {
                  formatted = chalk.red(formatted);
                }
              }
              line += formatted;
            } else {
              line += "—".padEnd(colWidth);
            }
          } else {
            line += "—".padEnd(colWidth);
          }
        }
        console.log(line);
      }
      totalBenchmarks += r.entries.length;
    } else if (r.kind === "single") {
      console.log(`\n  ${chalk.bold(formatPath(path, r.name))}`);
      let line = `  ${"".padEnd(nameWidth)}`;
      for (const env of environments) {
        const envResult = findMatchingResult(results[env], path, r.name);
        if (envResult && envResult.kind === "single" && envResult.status.status === "success") {
          line += formatRunsPerSecond(envResult.status.runsPerSecond).padEnd(colWidth);
        } else {
          line += "—".padEnd(colWidth);
        }
      }
      console.log(line);
      totalBenchmarks++;
    }
  }

  console.log(
    chalk.dim(
      `\n  ${"═".repeat(nameWidth + environments.length * colWidth)}`
    )
  );
  console.log(
    chalk.dim(
      `  ${totalBenchmarks} benchmarks × ${environments.length} environments completed\n`
    )
  );
}

function printBenchmarkResult(path: string[], result: BenchmarkResult): void {
  if (result.kind === "group" && isScaleResult(result)) {
    console.log(`  ${chalk.bold(formatPath(path, result.name))}`);
    const chartLines = renderScaleChart(result);
    for (const line of chartLines) {
      console.log(line);
    }
    return;
  }

  if (result.kind === "single") {
    const name = formatPath(path, result.name);
    if (result.status.status === "success") {
      const rps = formatRunsPerSecond(result.status.runsPerSecond);
      const gof = formatGoodnessOfFit(result.status.goodnessOfFit);
      console.log(`  ${chalk.bold(name)}`);
      console.log(`  ${rps}   ${gof}\n`);
    } else if (result.status.status === "failure") {
      console.log(`  ${chalk.bold(name)}`);
      console.log(`  ${chalk.red("FAILED")}: ${result.status.error}\n`);
    }
  } else if (result.kind === "series") {
    console.log(`  ${chalk.bold(formatPath(path, result.name))}`);
    console.log(chalk.dim(`  ${"─".repeat(55)}`));

    const successEntries = result.entries.filter(
      (e) => e.status.status === "success"
    ) as (SeriesEntry & { status: { status: "success"; runsPerSecond: number; goodnessOfFit: number } })[];

    if (successEntries.length === 0) {
      console.log(chalk.red("  All entries failed\n"));
      return;
    }

    const sorted = [...successEntries].sort(
      (a, b) => b.status.runsPerSecond - a.status.runsPerSecond
    );
    const fastest = sorted[0].status.runsPerSecond;
    const nameWidth = Math.max(...sorted.map((e) => e.name.length)) + 2;

    for (const entry of sorted) {
      const rps = formatRunsPerSecond(entry.status.runsPerSecond);
      const gof = formatGoodnessOfFit(entry.status.goodnessOfFit);
      const ratio = fastest / entry.status.runsPerSecond;
      const comparison =
        ratio === 1
          ? chalk.green("fastest")
          : chalk.yellow(`${ratio.toFixed(2)}x slower`);
      console.log(
        `  ${entry.name.padEnd(nameWidth)}${rps.padEnd(20)}${gof}  ${comparison}`
      );
    }
    console.log("");
  }
}

function formatRunsPerSecond(rps: number): string {
  return Math.round(rps).toLocaleString() + " runs/s";
}

function formatGoodnessOfFit(gof: number): string {
  const pct = `(${(gof * 100).toFixed(1)}%)`.padEnd(10);
  if (gof >= 0.99) return chalk.green(pct);
  if (gof >= 0.95) return chalk.yellow(pct);
  return chalk.red(pct);
}

function formatPath(path: string[], name: string): string {
  return [...path, name].join(" / ");
}

interface FlatEntry {
  path: string[];
  result: BenchmarkResult;
}

function flattenResults(result: BenchmarkResult, path: string[]): FlatEntry[] {
  if (result.kind === "group") {
    if (isScaleResult(result)) {
      return [{ path, result }];
    }
    return result.children.flatMap((child) =>
      flattenResults(child, [...path, result.name])
    );
  }
  return [{ path, result }];
}

function countBenchmarks(result: BenchmarkResult): number {
  if (result.kind === "single") return 1;
  if (result.kind === "series") return result.entries.length;
  return result.children.reduce((acc, c) => acc + countBenchmarks(c), 0);
}

function rankEntries(entries: SeriesEntry[]): string[] {
  return [...entries]
    .filter((e) => e.status.status === "success")
    .sort((a, b) => {
      if (a.status.status !== "success" || b.status.status !== "success")
        return 0;
      return b.status.runsPerSecond - a.status.runsPerSecond;
    })
    .map((e) => e.name);
}

function findMatchingResult(
  root: BenchmarkResult,
  path: string[],
  name: string
): BenchmarkResult | null {
  const flat = flattenResults(root, []);
  const match = flat.find(
    (f) =>
      f.result.name === name &&
      f.path.length === path.length &&
      f.path.every((p, i) => p === path[i])
  );
  return match?.result || null;
}
