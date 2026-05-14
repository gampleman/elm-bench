import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { ProgressDisplay } from "../report/progress.js";
import type { BenchmarkResult, PortMessage } from "../report/types.js";

export interface BrowserRunnerOptions {
  browser: string;
  filter?: string;
  seed?: number;
}

export async function runInBrowser(
  compiledPath: string,
  options: BrowserRunnerOptions
): Promise<BenchmarkResult> {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    throw new Error(
      "Playwright is required for browser mode. Install it with: npm install playwright"
    );
  }

  const browserType = getBrowserType(playwright, options.browser);
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage();
  const progress = new ProgressDisplay();

  const compiledJs = fs.readFileSync(compiledPath, "utf8");
  const flags = JSON.stringify({ filter: options.filter || null, seed: options.seed || 42 });

  const html = `<!DOCTYPE html>
<html>
<head><title>Elm Benchmark</title></head>
<body>
<script>${compiledJs}</script>
<script>
  var app = Elm.Main.init({ flags: ${flags} });
  if (app.ports.reportResult) {
    app.ports.reportResult.subscribe(function(msg) {
      window.__benchmarkResult(JSON.stringify(msg));
    });
  }
  if (app.ports.reportProgress) {
    app.ports.reportProgress.subscribe(function(msg) {
      window.__benchmarkProgress(JSON.stringify(msg));
    });
  }
  if (app.ports.reportStructure) {
    app.ports.reportStructure.subscribe(function(msg) {
      window.__benchmarkStructure(JSON.stringify(msg));
    });
  }
</script>
</body>
</html>`;

  const htmlPath = path.join(path.dirname(compiledPath), "benchmark.html");
  fs.writeFileSync(htmlPath, html);

  return new Promise<BenchmarkResult>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      browser.close();
      reject(new Error("Benchmark timed out after 10 minutes"));
    }, 10 * 60 * 1000);

    await page.exposeFunction("__benchmarkStructure", (_msgStr: string) => {
      if (process.stdout.isTTY) {
        process.stdout.write(chalk.dim("  Warming up...\n"));
        progress.addExternalLines(1);
      }
    });

    await page.exposeFunction("__benchmarkProgress", (msgStr: string) => {
      const msg = JSON.parse(msgStr) as PortMessage;
      if (msg.type === "progress") {
        progress.update(msg.data as Record<string, unknown>);
      }
    });

    await page.exposeFunction("__benchmarkResult", (msgStr: string) => {
      clearTimeout(timeout);
      progress.finish();
      const msg = JSON.parse(msgStr) as PortMessage;
      if (msg.type === "result") {
        browser.close().then(() => resolve(msg.data as BenchmarkResult));
      } else {
        browser.close().then(() =>
          reject(new Error(`Unexpected message type: ${msg.type}`))
        );
      }
    });

    await page.goto(`file://${htmlPath}`);
  });
}

function getBrowserType(
  playwright: typeof import("playwright"),
  name: string
): import("playwright").BrowserType {
  switch (name.toLowerCase()) {
    case "chromium":
    case "chrome":
      return playwright.chromium;
    case "firefox":
      return playwright.firefox;
    case "webkit":
    case "safari":
      return playwright.webkit;
    default:
      throw new Error(
        `Unknown browser: ${name}. Supported: chromium, firefox, webkit`
      );
  }
}
