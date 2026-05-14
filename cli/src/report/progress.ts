import chalk from "chalk";

interface ProgressEntry {
  name: string;
  progress: number;
}

interface ProgressNode {
  name?: string;
  progress?: number;
  entries?: ProgressEntry[];
  children?: ProgressNode[];
}

export class ProgressDisplay {
  private lastLineCount = 0;
  private isTTY: boolean;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingData: ProgressNode | null = null;
  private filter: string | undefined;

  constructor(filter?: string) {
    this.isTTY = process.stdout.isTTY ?? false;
    this.filter = filter?.toLowerCase();
  }

  addExternalLines(count: number): void {
    this.lastLineCount += count;
  }

  update(data: ProgressNode): void {
    if (!this.isTTY) return;

    this.pendingData = data;
    if (!this.throttleTimer) {
      this.flush();
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        if (this.pendingData) this.flush();
      }, 80);
    }
  }

  finish(): void {
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.isTTY && this.lastLineCount > 0) {
      process.stdout.write(`\x1b[${this.lastLineCount}A\x1b[0J`);
      this.lastLineCount = 0;
    }
  }

  private flush(): void {
    if (!this.pendingData) return;
    const lines = buildLines(this.pendingData);
    this.pendingData = null;

    if (this.lastLineCount > 0) {
      process.stdout.write(`\x1b[${this.lastLineCount}A\x1b[0J`);
    }

    const output = lines.join("\n") + "\n";
    process.stdout.write(output);
    this.lastLineCount = lines.length;
  }
}

function buildLines(node: ProgressNode): string[] {
  const lines: string[] = [];
  collectLines(node, [], lines);
  return lines;
}

function collectLines(node: ProgressNode, path: string[], lines: string[]): void {
  if (node.children) {
    // Check if this group contains scale-style children: singles named "impl (n=X)"
    const scaleGroup = tryCollectScaleGroup(node);
    if (scaleGroup) {
      const fullName = [...path, node.name || ""].filter(Boolean).join(" / ");
      const nameWidth = Math.max(...scaleGroup.map((e) => e.name.length)) + 2;
      lines.push(`  ${chalk.bold(fullName)}`);
      lines.push(chalk.dim(`  ${"─".repeat(55)}`));
      for (const entry of scaleGroup) {
        const bar = renderBar(entry.progress, 28);
        const pct = formatPct(entry.progress);
        lines.push(`  ${entry.name.padEnd(nameWidth)}${bar} ${pct}`);
      }
      lines.push("");
      return;
    }

    const newPath = node.name ? [...path, node.name] : path;
    for (const child of node.children) {
      collectLines(child, newPath, lines);
    }
  } else if (node.entries) {
    const fullName = [...path, node.name || ""].filter(Boolean).join(" / ");
    const nameWidth = Math.max(...node.entries.map((e) => e.name.length)) + 2;
    lines.push(`  ${chalk.bold(fullName)}`);
    lines.push(chalk.dim(`  ${"─".repeat(55)}`));
    for (const entry of node.entries) {
      const bar = renderBar(entry.progress, 28);
      const pct = formatPct(entry.progress);
      lines.push(`  ${entry.name.padEnd(nameWidth)}${bar} ${pct}`);
    }
    lines.push("");
  } else if (node.name !== undefined && node.progress !== undefined) {
    const fullName = [...path, node.name].filter(Boolean).join(" / ");
    const bar = renderBar(node.progress, 28);
    const pct = formatPct(node.progress);
    lines.push(`  ${chalk.bold(fullName)}`);
    lines.push(`  ${bar} ${pct}`);
    lines.push("");
  }
}

function tryCollectScaleGroup(node: ProgressNode): { name: string; progress: number }[] | null {
  if (!node.children) return null;

  const scalePattern = /^(.+?)\s*\(n=\d+\)$/;
  const isScale = node.children.every(
    (c) => c.name !== undefined && c.progress !== undefined && scalePattern.test(c.name)
  );
  if (!isScale || node.children.length === 0) return null;

  // Group by implementation name, average progress across sizes
  const implMap = new Map<string, number[]>();
  for (const child of node.children) {
    const match = child.name!.match(scalePattern);
    if (!match) continue;
    const implName = match[1];
    if (!implMap.has(implName)) implMap.set(implName, []);
    implMap.get(implName)!.push(child.progress!);
  }

  return [...implMap.entries()].map(([name, progresses]) => ({
    name,
    progress: progresses.reduce((a, b) => a + b, 0) / progresses.length,
  }));
}

function renderBar(progress: number, width: number): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  if (progress >= 1) {
    return chalk.green("█".repeat(width));
  }
  return chalk.green("█".repeat(filled)) + chalk.dim("░".repeat(empty));
}

function formatPct(progress: number): string {
  const pct = Math.round(progress * 100);
  if (pct >= 100) return chalk.green("done");
  return chalk.dim(`${pct.toString().padStart(3)}%`);
}
