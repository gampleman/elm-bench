import path from "node:path";
import { createRequire } from "node:module";
import spawn from "cross-spawn";

/**
 * Resolve the Elm compiler binary. Prefers an explicit --compiler path, then
 * the `elm` npm package bundled with us, and finally whatever is on PATH.
 */
export function resolveElmBinary(compiler?: string): string {
  if (compiler) {
    return path.resolve(compiler);
  }
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("elm/bin/elm");
  } catch {
    return "elm";
  }
}

/**
 * Ask the Elm compiler what version it is, e.g. "0.19.1" or "0.19.2".
 * Falls back to "0.19.1" if the compiler can't be run or prints something
 * unexpected.
 */
export async function elmCompilerVersion(compiler?: string): Promise<string> {
  const elmBinary = resolveElmBinary(compiler);

  return new Promise((resolve) => {
    const proc = spawn(elmBinary, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("error", () => resolve("0.19.1"));

    proc.on("close", () => {
      const match = stdout.trim().match(/^\d+\.\d+\.\d+/);
      resolve(match ? match[0] : "0.19.1");
    });
  });
}

/**
 * Add a package to a project's elm.json using the Elm compiler itself.
 *
 * We deliberately use `elm install` rather than `elm-json install` here:
 * elm-json is unmaintained and rejects any project whose elm-version isn't
 * 0.19.1, which made elm-bench unusable on Elm 0.19.2 (issue #1).
 *
 * `elm install` has no --yes flag, so we answer its interactive
 * "Would you like me to update your elm.json accordingly? [Y/n]" prompt by
 * writing to stdin. It is a no-op (exit 0) when the package is already a
 * direct dependency.
 */
export async function elmInstall(
  projectDir: string,
  pkg: string,
  compiler?: string
): Promise<void> {
  const elmBinary = resolveElmBinary(compiler);

  return new Promise((resolve, reject) => {
    const proc = spawn(elmBinary, ["install", pkg], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // Confirm the "update your elm.json?" prompt. The compiler often exits
    // without reading stdin at all (e.g. "It is already installed!"), so
    // swallow the resulting EPIPE rather than letting it crash us.
    proc.stdin?.on("error", () => {});
    proc.stdin?.end("y\n");

    proc.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Could not find the Elm compiler at "${elmBinary}". Install it or use --compiler.`
          )
        );
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `elm install ${pkg} failed:\n${(stderr || stdout).trim()}`
          )
        );
      }
    });
  });
}
