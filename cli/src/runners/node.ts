import vm from "node:vm";
import fs from "node:fs";
import chalk from "chalk";
import { ProgressDisplay } from "../report/progress.js";
import type { BenchmarkResult, PortMessage } from "../report/types.js";

export interface NodeRunnerOptions {
  filter?: string;
  seed?: number;
}

export async function runInNode(
  compiledPath: string,
  options: NodeRunnerOptions = {}
): Promise<BenchmarkResult> {
  const progress = new ProgressDisplay();
  const code = fs.readFileSync(compiledPath, "utf8");

  const sandbox: Record<string, unknown> = {
    performance: globalThis.performance,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const Elm = (sandbox as { Elm: ElmApp }).Elm;
  if (!Elm?.Main?.init) {
    throw new Error(
      "Compiled Elm code does not expose Elm.Main.init. Compilation may have failed."
    );
  }

  const flags = { filter: options.filter || null, seed: options.seed || 42 };
  const app = Elm.Main.init({ flags });

  return new Promise<BenchmarkResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Benchmark timed out after 10 minutes"));
    }, 10 * 60 * 1000);

    if (app.ports.reportError) {
      app.ports.reportError.subscribe((msg: unknown) => {
        clearTimeout(timeout);
        const error = msg as { type: string; filter?: string };
        if (error.type === "no-match") {
          reject(new Error(`No benchmarks matching "${error.filter}".`));
        } else {
          reject(new Error(`Benchmark error: ${JSON.stringify(msg)}`));
        }
      });
    }

    if (app.ports.reportStructure) {
      app.ports.reportStructure.subscribe(() => {
        if (process.stdout.isTTY) {
          process.stdout.write(chalk.dim("  Warming up...\n"));
          progress.addExternalLines(1);
        }
      });
    }

    if (app.ports.reportProgress) {
      app.ports.reportProgress.subscribe((msg: unknown) => {
        const message = msg as PortMessage;
        if (message.type === "progress") {
          progress.update(message.data as Record<string, unknown>);
        }
      });
    }

    if (app.ports.reportResult) {
      app.ports.reportResult.subscribe((msg: unknown) => {
        clearTimeout(timeout);
        progress.finish();
        const message = msg as PortMessage;
        if (message.type === "result") {
          resolve(message.data as BenchmarkResult);
        } else {
          reject(new Error(`Unexpected message type: ${message.type}`));
        }
      });
    } else {
      clearTimeout(timeout);
      reject(
        new Error(
          "reportResult port not found. The Elm runner module may not be compiled correctly."
        )
      );
    }
  });
}

interface ElmPort {
  subscribe: (callback: (value: unknown) => void) => void;
}

interface ElmApp {
  Main: {
    init: (config: { flags: unknown }) => {
      ports: {
        reportProgress?: ElmPort;
        reportResult?: ElmPort;
        reportStructure?: ElmPort;
        reportError?: ElmPort;
      };
    };
  };
}
