import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import spawn from "cross-spawn";

export interface InitOptions {
  projectPath?: string;
}

export async function init(options: InitOptions): Promise<void> {
  const baseDir = options.projectPath
    ? path.resolve(options.projectPath)
    : process.cwd();

  const benchmarksDir = path.join(baseDir, "benchmarks");
  const srcDir = path.join(benchmarksDir, "src");
  const elmJsonPath = path.join(benchmarksDir, "elm.json");

  // Check if benchmarks directory already exists
  try {
    await fs.access(elmJsonPath);
    throw new Error(
      `benchmarks/elm.json already exists in ${baseDir}. Nothing to do.`
    );
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw err;
    }
  }

  await fs.mkdir(srcDir, { recursive: true });

  // Detect parent project's source directories
  const sourceDirs: string[] = ["src"];
  const parentElmJsonPath = path.join(baseDir, "elm.json");
  try {
    const parentElmJson = JSON.parse(
      await fs.readFile(parentElmJsonPath, "utf8")
    );
    const parentSourceDirs: string[] =
      parentElmJson["source-directories"] || ["src"];
    for (const dir of parentSourceDirs) {
      const relative = path.relative(benchmarksDir, path.resolve(baseDir, dir));
      if (!sourceDirs.includes(relative)) {
        sourceDirs.push(relative);
      }
    }
  } catch {
    // No parent elm.json found, that's fine
  }

  // Create elm.json as an application
  const elmJson = {
    type: "application",
    "source-directories": sourceDirs,
    "elm-version": "0.19.1",
    dependencies: {
      direct: {
        "elm/core": "1.0.5",
        "elm/json": "1.1.4",
      },
      indirect: {},
    },
    "test-dependencies": {
      direct: {},
      indirect: {},
    },
  };

  await fs.writeFile(elmJsonPath, JSON.stringify(elmJson, null, 4) + "\n");

  // Install gampleman/elm-bench and its peer dependency
  await elmJsonInstall(benchmarksDir, "gampleman/elm-bench");
  await elmJsonInstall(benchmarksDir, "elm-explorations/benchmark");

  // Create starter Benchmarks.elm
  const benchmarksElm = `module Benchmarks exposing (suite)

import Bench exposing (Benchmark)


suite : Benchmark
suite =
    Bench.describe "My Benchmarks"
        [ Bench.benchmark "example" <|
            \\_ -> List.range 1 100
        ]
`;

  await fs.writeFile(path.join(srcDir, "Benchmarks.elm"), benchmarksElm);

  console.log(`\nInitialized benchmarks project:`);
  console.log(`  benchmarks/elm.json`);
  console.log(`  benchmarks/src/Benchmarks.elm`);
  console.log(`\nRun \`elm-bench run\` to execute your benchmarks.`);
}

function resolveElmJson(): string {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("elm-json/bin/elm-json");
  } catch {
    return "elm-json";
  }
}

async function elmJsonInstall(
  projectDir: string,
  pkg: string
): Promise<void> {
  const elmJsonBin = resolveElmJson();
  return new Promise((resolve, reject) => {
    const proc = spawn(elmJsonBin, ["install", "--yes", pkg], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`elm-json install ${pkg} failed: ${stderr}`));
    });

    proc.on("error", (err) => {
      reject(
        new Error(`Could not run elm-json. Is it installed? (${err.message})`)
      );
    });
  });
}
