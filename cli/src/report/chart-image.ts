import { createCanvas } from "canvas";
import type { BenchmarkResult, BenchmarkSuccess } from "./types.js";

interface ScaleDataPoint {
  size: number;
  runsPerSecond: number;
}

interface ScaleSeries {
  name: string;
  points: ScaleDataPoint[];
}

const COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#ef4444", // red
  "#eab308", // yellow
  "#a855f7", // purple
  "#06b6d4", // cyan
];

export function renderScaleChartImage(result: BenchmarkResult): Buffer | null {
  if (result.kind !== "group") return null;

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

  if (seriesMap.size === 0) return null;

  const allSeries: ScaleSeries[] = [];
  for (const [name, points] of seriesMap) {
    points.sort((a, b) => a.size - b.size);
    allSeries.push({ name, points });
  }

  return drawChart(allSeries);
}

function drawChart(allSeries: ScaleSeries[]): Buffer {
  const width = 700;
  const height = 400;
  const padding = { top: 30, right: 30, bottom: 60, left: 80 };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#1e1e2e";
  ctx.fillRect(0, 0, width, height);

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  // Determine scales
  const allRps = allSeries.flatMap((s) => s.points.map((p) => p.runsPerSecond));
  const rpsMin = Math.min(...allRps);
  const rpsMax = Math.max(...allRps);
  const useLogY = rpsMax / rpsMin > 10;

  const sizes = allSeries[0].points.map((p) => p.size);
  const sizeMin = sizes[0];
  const sizeMax = sizes[sizes.length - 1];
  const useLogX = sizeMax / sizeMin > 10;

  const toX = (size: number): number => {
    const val = useLogX ? Math.log10(size) : size;
    const min = useLogX ? Math.log10(sizeMin) : sizeMin;
    const max = useLogX ? Math.log10(sizeMax) : sizeMax;
    return padding.left + ((val - min) / (max - min)) * plotW;
  };

  const toY = (rps: number): number => {
    const val = useLogY ? Math.log10(rps) : rps;
    const min = useLogY ? Math.log10(rpsMin) : rpsMin;
    const max = useLogY ? Math.log10(rpsMax) : rpsMax;
    return padding.top + plotH - ((val - min) / (max - min)) * plotH;
  };

  // Grid lines
  ctx.strokeStyle = "#333355";
  ctx.lineWidth = 0.5;
  const yTicks = generateTicks(rpsMin, rpsMax, useLogY, 6);
  for (const tick of yTicks) {
    const y = toY(tick);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
  }

  // Y-axis labels
  ctx.fillStyle = "#a0a0b0";
  ctx.font = "11px monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tick of yTicks) {
    const y = toY(tick);
    ctx.fillText(formatCompact(tick), padding.left - 8, y);
  }

  // X-axis labels
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const size of sizes) {
    const x = toX(size);
    ctx.fillText(String(size), x, height - padding.bottom + 8);
  }

  // X-axis title
  ctx.fillStyle = "#808090";
  ctx.font = "12px monospace";
  ctx.fillText("n", width / 2, height - 15);

  // Y-axis title
  ctx.save();
  ctx.translate(15, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("runs/s" + (useLogY ? " (log)" : ""), 0, 0);
  ctx.restore();

  // Draw series
  for (let si = 0; si < allSeries.length; si++) {
    const s = allSeries[si];
    const color = COLORS[si % COLORS.length];

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i < s.points.length; i++) {
      const x = toX(s.points[i].size);
      const y = toY(s.points[i].runsPerSecond);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Data points
    ctx.fillStyle = color;
    for (const p of s.points) {
      const x = toX(p.size);
      const y = toY(p.runsPerSecond);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Legend
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const legendY = padding.top + 10;
  for (let i = 0; i < allSeries.length; i++) {
    const color = COLORS[i % COLORS.length];
    const y = legendY + i * 20;
    ctx.fillStyle = color;
    ctx.fillRect(padding.left + 10, y - 2, 16, 4);
    ctx.fillStyle = "#d0d0e0";
    ctx.fillText(allSeries[i].name, padding.left + 32, y);
  }

  return canvas.toBuffer("image/png");
}

function generateTicks(min: number, max: number, log: boolean, count: number): number[] {
  if (log) {
    const logMin = Math.floor(Math.log10(min));
    const logMax = Math.ceil(Math.log10(max));
    const ticks: number[] = [];
    for (let exp = logMin; exp <= logMax; exp++) {
      ticks.push(Math.pow(10, exp));
    }
    return ticks;
  }

  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(0) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "K";
  return Math.round(n).toString();
}

export function displayInlineImage(png: Buffer): void {
  const b64 = png.toString("base64");
  const osc = `\x1b]1337;File=inline=1;width=auto;preserveAspectRatio=1:${b64}\x07`;
  process.stdout.write(osc + "\n");
}
