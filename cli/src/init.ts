import fs from "node:fs/promises";
import path from "node:path";
import { elmInstall, elmCompilerVersion } from "./elm-install.js";

export interface InitOptions {
  projectPath?: string;
  compiler?: string;
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

  // Match the compiler we'll actually be running: the Elm compiler refuses to
  // touch a project whose elm-version differs from its own, so hardcoding
  // 0.19.1 would break 0.19.2 users.
  const elmVersion = await elmCompilerVersion(options.compiler);

  // Create elm.json as an application
  const elmJson = {
    type: "application",
    "source-directories": sourceDirs,
    "elm-version": elmVersion,
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
  await elmInstall(benchmarksDir, "gampleman/elm-bench", options.compiler);
  await elmInstall(
    benchmarksDir,
    "elm-explorations/benchmark",
    options.compiler
  );

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

