import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import spawn from "cross-spawn";
import chalk from "chalk";
import type { GeneratedProject } from "./generate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VerifyOptions {
  compiler?: string;
  filter?: string;
  seed?: number;
}

export async function verifyBenchmarks(
  generated: GeneratedProject,
  options: VerifyOptions = {}
): Promise<boolean> {
  if (!generated.testElmPath) return true;

  console.log(chalk.dim("Verifying benchmark correctness...\n"));

  const elmTestRsBin = findElmTestRs();
  const elmCompiler = options.compiler || findElmCompiler();

  const args = [
    generated.testElmPath,
    "--compiler", elmCompiler,
    "--fuzz", "10",
    "--report", "console",
  ];

  if (options.filter) {
    args.push("--filter", options.filter);
  }

  if (options.seed !== undefined) {
    args.push("--seed", String(options.seed));
  }

  return new Promise((resolve) => {
    const proc = spawn(elmTestRsBin, args, {
      cwd: generated.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(
          chalk.yellow(
            "  elm-test-rs not found, skipping verification. Install with: npm install elm-test-rs\n"
          )
        );
        resolve(true);
      } else {
        console.log(chalk.yellow(`  Verification skipped: ${err.message}\n`));
        resolve(true);
      }
    });

    proc.on("close", (code) => {
      if (resolved) return;
      resolved = true;

      const noTests = /Running 0 tests/.test(stdout) || /no tests found/i.test(stderr);
      if (code === 0 || noTests) {
        if (noTests) {
          console.log(chalk.dim("  No correctness checks to run\n"));
        } else {
          console.log(chalk.green("  ✓ All implementations produce consistent results\n"));
        }
        resolve(true);
      } else {
        console.log(chalk.red("  ✗ Benchmark verification failed!\n"));
        console.log(chalk.red("  Some implementations produce different results:\n"));
        const lines = stdout.split("\n");
        for (const line of lines) {
          if (line.trim()) {
            console.log(`    ${line}`);
          }
        }
        if (stderr.trim() && !stderr.includes("Compilation")) {
          console.log(stderr);
        }
        console.log("");
        resolve(false);
      }
    });
  });
}

function findElmTestRs(): string {
  const localBin = path.resolve(__dirname, "..", "node_modules", ".bin", "elm-test-rs");
  if (fs.existsSync(localBin)) return localBin;
  const localDirect = path.resolve(__dirname, "..", "node_modules", "elm-test-rs", "elm-test-rs.js");
  if (fs.existsSync(localDirect)) return localDirect;
  return "elm-test-rs";
}

function findElmCompiler(): string {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("elm/bin/elm");
  } catch {
    return "elm";
  }
}
