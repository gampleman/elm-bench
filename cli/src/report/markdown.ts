import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isScaleResult } from "./chart.js";
import { renderScaleChartImage } from "./chart-image.js";
import type {
  BenchmarkResult,
  SeriesEntry,
} from "./types.js";

const RESULTS_DIR = "bench-results";

export function formatMarkdownOutput(
  results: Record<string, BenchmarkResult>
): void {
  const environments = Object.keys(results);
  const lines: string[] = [];
  let chartIndex = 0;

  if (environments.length > 1) {
    for (const env of environments) {
      lines.push(`## ${env}`);
      lines.push("");
      const [formatted, nextIdx] = formatResult(results[env], chartIndex);
      lines.push(...formatted);
      lines.push("");
      chartIndex = nextIdx;
    }
  } else {
    const [formatted] = formatResult(results[environments[0]], chartIndex);
    lines.push(...formatted);
  }

  console.log(lines.join("\n"));
}

function formatResult(result: BenchmarkResult, chartIndex: number): [string[], number] {
  const lines: string[] = [];
  const flat = flattenResults(result, []);

  for (const { path: p, result: r } of flat) {
    if (r.kind === "group" && isScaleResult(r)) {
      const [scaleLines, nextIdx] = formatScaleSection(p, r, chartIndex);
      lines.push(...scaleLines);
      chartIndex = nextIdx;
    } else if (r.kind === "series") {
      lines.push(...formatSeriesTable(p, r));
    } else if (r.kind === "single") {
      lines.push(...formatSingle(p, r));
    }
  }

  return [lines, chartIndex];
}

function formatSeriesTable(
  path: string[],
  result: BenchmarkResult & { kind: "series" }
): string[] {
  const lines: string[] = [];
  const heading = [...path, result.name].filter(Boolean).join(" / ");
  lines.push(`### ${heading}`);
  lines.push("");
  lines.push("| Implementation | Runs/s | Comparison |");
  lines.push("|:---|---:|:---|");

  const successEntries = result.entries.filter(
    (e) => e.status.status === "success"
  ) as (SeriesEntry & { status: { status: "success"; runsPerSecond: number; goodnessOfFit: number } })[];

  if (successEntries.length === 0) {
    lines.push("| *(all failed)* | | |");
    lines.push("");
    return lines;
  }

  const sorted = [...successEntries].sort(
    (a, b) => b.status.runsPerSecond - a.status.runsPerSecond
  );
  const fastest = sorted[0].status.runsPerSecond;

  for (const entry of sorted) {
    const rps = formatRps(entry.status.runsPerSecond);
    const ratio = fastest / entry.status.runsPerSecond;
    const comparison = ratio === 1 ? "**fastest**" : `${ratio.toFixed(2)}x slower`;
    lines.push(`| ${entry.name} | ${rps} | ${comparison} |`);
  }

  lines.push("");
  return lines;
}

function formatScaleSection(
  p: string[],
  result: BenchmarkResult & { kind: "group" },
  chartIndex: number
): [string[], number] {
  const lines: string[] = [];
  const heading = [...p, result.name].filter(Boolean).join(" / ");
  lines.push(`### ${heading}`);
  lines.push("");

  const png = renderScaleChartImage(result);
  if (png) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    const slug = heading.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    const filename = `${slug}-${chartIndex}.png`;
    const filePath = path.join(RESULTS_DIR, filename);
    writeFileSync(filePath, png);
    lines.push(`![${heading}](${RESULTS_DIR}/${filename})`);
    lines.push("");
    chartIndex++;
  }

  lines.push("<details>");
  lines.push("<summary>Raw data</summary>");
  lines.push("");
  const tableLines = formatScaleTable(p, result);
  for (const line of tableLines) lines.push(line);
  lines.push("");
  lines.push("</details>");
  lines.push("");
  return [lines, chartIndex];
}

function formatScaleTable(
  p: string[],
  result: BenchmarkResult & { kind: "group" }
): string[] {
  const lines: string[] = [];

  // Collect all implementations and sizes
  const implementations = new Map<string, Map<number, number>>();
  const sizes: number[] = [];
  const sizePattern = /^(.+?)\s*\(n=(\d+)\)$/;

  for (const child of result.children) {
    if (child.kind === "single" && child.status.status === "success") {
      const match = child.name.match(sizePattern);
      if (match) {
        const impl = match[1];
        const size = parseInt(match[2], 10);
        if (!implementations.has(impl)) implementations.set(impl, new Map());
        implementations.get(impl)!.set(size, child.status.runsPerSecond);
        if (!sizes.includes(size)) sizes.push(size);
      }
    }
  }

  sizes.sort((a, b) => a - b);

  // Build table
  const header = `| Implementation | ${sizes.map((s) => `n=${s}`).join(" | ")} |`;
  const separator = `|:---|${sizes.map(() => "---:").join("|")}|`;
  lines.push(header);
  lines.push(separator);

  for (const [impl, data] of implementations) {
    const cells = sizes.map((s) => {
      const rps = data.get(s);
      return rps ? formatRps(rps) : "—";
    });
    lines.push(`| ${impl} | ${cells.join(" | ")} |`);
  }

  lines.push("");
  return lines;
}

function formatSingle(
  path: string[],
  result: BenchmarkResult & { kind: "single" }
): string[] {
  const lines: string[] = [];
  const name = [...path, result.name].filter(Boolean).join(" / ");

  if (result.status.status === "success") {
    lines.push(`- **${name}**: ${formatRps(result.status.runsPerSecond)} runs/s`);
  } else if (result.status.status === "failure") {
    lines.push(`- **${name}**: FAILED — ${result.status.error}`);
  }

  return lines;
}

function formatRps(rps: number): string {
  return Math.round(rps).toLocaleString("en-US");
}

function flattenResults(result: BenchmarkResult, path: string[]): { path: string[]; result: BenchmarkResult }[] {
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
