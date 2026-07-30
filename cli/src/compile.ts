import path from "node:path";
import spawn from "cross-spawn";
import { resolveElmBinary } from "./elm-install.js";
import type { GeneratedProject } from "./generate.js";

export interface CompileOptions {
  compiler?: string;
  optimize: boolean;
}

export async function compile(
  generated: GeneratedProject,
  options: CompileOptions
): Promise<string> {
  const elmBinary = resolveElmBinary(options.compiler);
  const outputPath = path.join(generated.outputDir, "benchmark.js");

  const args = ["make", generated.mainElmPath, "--output", outputPath];
  if (options.optimize) {
    args.push("--optimize");
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(elmBinary, args, {
      cwd: generated.dir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Could not find Elm compiler at "${elmBinary}". Install it or use --compiler.`
          )
        );
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(outputPath);
      } else {
        reject(new Error(`Elm compilation failed:\n${stderr || stdout}`));
      }
    });
  });
}
