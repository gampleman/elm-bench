import asciichart from "asciichart";
import chalk from "chalk";
import type { BenchmarkResult, BenchmarkSuccess } from "./types.js";

interface ScaleDataPoint {
  size: number;
  runsPerSecond: number;
}

interface ScaleSeries {
  name: string;
  points: ScaleDataPoint[];
}

const SERIES_COLORS = [
  asciichart.blue,
  asciichart.green,
  asciichart.red,
  asciichart.yellow,
  asciichart.magenta,
  asciichart.cyan,
];

const CHALK_COLORS = [chalk.blue, chalk.green, chalk.red, chalk.yellow, chalk.magenta, chalk.cyan];

export function isScaleResult(result: BenchmarkResult): boolean {
  if (result.kind !== "group") return false;
  return result.children.some(
    (c) => c.kind === "single" && /\(n=\d+\)$/.test(c.name)
  );
}

export function renderScaleChart(result: BenchmarkResult): string[] {
  if (result.kind !== "group") return [];

  const seriesMap = new Map<string, ScaleDataPoint[]>();

  for (const child of result.children) {
    if (child.kind !== "single") continue;
    if (child.status.status !== "success") continue;

    const match = child.name.match(/^(.+?)\s*\(n=(\d+)\)$/);
    if (!match) continue;

    const [, implName, sizeStr] = match;
    const size = parseInt(sizeStr, 10);
    const rps = (child.status as BenchmarkSuccess).runsPerSecond;

    if (!seriesMap.has(implName)) {
      seriesMap.set(implName, []);
    }
    seriesMap.get(implName)!.push({ size, runsPerSecond: rps });
  }

  if (seriesMap.size === 0) return [];

  const allSeries: ScaleSeries[] = [];
  for (const [name, points] of seriesMap) {
    points.sort((a, b) => a.size - b.size);
    allSeries.push({ name, points });
  }

  const lines: string[] = [];
  lines.push("");

  const sizes = allSeries[0].points.map((p) => p.size);
  const numPoints = sizes.length;

  // Determine whether to use log scale: if data spans > 1 order of magnitude
  const allRps = allSeries.flatMap((s) => s.points.map((p) => p.runsPerSecond));
  const rpsMin = Math.min(...allRps);
  const rpsMax = Math.max(...allRps);
  const useLogY = rpsMax / rpsMin > 10;

  const toYSpace = (rps: number) =>
    useLogY ? Math.log10(rps) : rps;
  const fromYSpace = (val: number) =>
    useLogY ? Math.pow(10, val) : val;

  // Distribute columns proportionally in x-space (log or linear)
  const totalChartCols = 70;
  const sizeMin = sizes[0];
  const sizeMax = sizes[sizes.length - 1];
  const useLogX = sizeMax / sizeMin > 10;

  const toXSpace = (size: number) => useLogX ? Math.log10(size) : size;
  const xMin = toXSpace(sizeMin);
  const xMax = toXSpace(sizeMax);

  // Compute the column position for each real data point
  const pointColumns = sizes.map((s) =>
    Math.round(((toXSpace(s) - xMin) / (xMax - xMin)) * (totalChartCols - 1))
  );

  // Build chart data by interpolating between real points to fill all columns
  const chartData = allSeries.map((s) => {
    const result: number[] = new Array(totalChartCols);
    const yVals = s.points.map((p) => toYSpace(p.runsPerSecond));

    for (let col = 0; col < totalChartCols; col++) {
      // Find which segment this column falls in
      let segIdx = 0;
      while (segIdx < pointColumns.length - 1 && pointColumns[segIdx + 1] <= col) segIdx++;

      if (col <= pointColumns[0]) {
        result[col] = yVals[0];
      } else if (col >= pointColumns[pointColumns.length - 1]) {
        result[col] = yVals[yVals.length - 1];
      } else {
        const colStart = pointColumns[segIdx];
        const colEnd = pointColumns[segIdx + 1];
        const t = (col - colStart) / (colEnd - colStart);
        result[col] = yVals[segIdx] + t * (yVals[segIdx + 1] - yVals[segIdx]);
      }
    }
    return result;
  });
  const colors = allSeries.map((_, i) => SERIES_COLORS[i % SERIES_COLORS.length]);

  const chart = asciichart.plot(chartData, {
    height: 16,
    colors,
    format: (val: number) => formatCompact(fromYSpace(val)).padStart(8),
  });

  lines.push(chart);
  if (useLogY) {
    lines.push(chalk.dim("         (log scale)"));
  }

  // The first data point is rendered at the axis char position (┼)
  const firstLine = chart.split("\n")[0];
  let axisCol = 0;
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === "┼" || firstLine[i] === "┤") {
      axisCol = i;
      break;
    }
  }

  // Position size labels under their corresponding data points
  const labels: Array<{ pos: number; text: string }> = [];
  for (let i = 0; i < numPoints; i++) {
    labels.push({ pos: axisCol + pointColumns[i], text: String(sizes[i]) });
  }

  // Build the label line, skipping overlaps
  let xAxis = " ".repeat(Math.max(0, axisCol - 3)) + chalk.dim("n= ");
  let cursor = axisCol;
  for (const { pos, text } of labels) {
    if (pos >= cursor) {
      xAxis += " ".repeat(pos - cursor) + text;
      cursor = pos + text.length;
    }
  }
  lines.push(xAxis);
  lines.push("");

  // Legend
  for (let i = 0; i < allSeries.length; i++) {
    const color = CHALK_COLORS[i % CHALK_COLORS.length];
    const s = allSeries[i];
    const fastest = s.points[0];
    const slowest = s.points[s.points.length - 1];
    lines.push(
      `  ${color("━━")} ${s.name}  (${formatCompact(fastest.runsPerSecond)} → ${formatCompact(slowest.runsPerSecond)} runs/s)`
    );
  }
  lines.push("");

  return lines;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return Math.round(n).toString();
}
