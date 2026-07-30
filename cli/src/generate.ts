import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { elmInstall } from "./elm-install.js";
import type { Project } from "./project.js";
import type { BenchmarkModule } from "./discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELM_RUNNER_SRC = path.resolve(__dirname, "..", "elm", "src");

export interface GeneratedProject {
  dir: string;
  outputDir: string;
  mainElmPath: string;
  testElmPath: string | null;
  elmJsonPath: string;
}

export async function generate(
  project: Project,
  benchmarks: BenchmarkModule[],
  compiler?: string
): Promise<GeneratedProject> {
  const genDir = path.join(project.dir, "elm-stuff", "node-benchmark-runner");
  const srcDir = path.join(genDir, "src");
  await fs.mkdir(srcDir, { recursive: true });

  const mainElmPath = path.join(srcDir, "Main.elm");
  const elmJsonPath = path.join(genDir, "elm.json");

  await generateElmJson(project, genDir, elmJsonPath, compiler);
  await generateMainElm(benchmarks, mainElmPath);

  const usesBench = benchmarks.some((mod) => mod.benchmarkType === "bench");
  let testElmPath: string | null = null;
  if (usesBench) {
    testElmPath = path.join(srcDir, "BenchmarkVerification.elm");
    await generateTestElm(benchmarks, testElmPath);
  }

  return { dir: genDir, outputDir: genDir, mainElmPath, testElmPath, elmJsonPath };
}

async function generateElmJson(
  project: Project,
  genDir: string,
  elmJsonPath: string,
  compiler?: string
): Promise<void> {
  if (project.elmJson.type !== "application") {
    throw new Error(
      "Only application-type elm.json is supported for benchmarks."
    );
  }

  // Start from user's elm.json but write our copy into genDir
  const elmJson = JSON.parse(await fs.readFile(project.elmJsonPath, "utf8"));

  // Rewrite source-directories relative to genDir, excluding any that point
  // into the genDir itself (avoids conflicts with our generated files)
  const userSourceDirs: string[] = elmJson["source-directories"] || ["src"];
  const sourceDirs: string[] = [];
  for (const dir of userSourceDirs) {
    const abs = path.resolve(project.dir, dir);
    const rel = path.relative(genDir, abs);
    if (rel === "" || rel === "src" || !rel.startsWith("..")) continue;
    sourceDirs.push(rel);
  }

  // Add the runner source and genDir itself
  const runnerSrcRelative = path.relative(genDir, ELM_RUNNER_SRC);
  if (!sourceDirs.includes(runnerSrcRelative)) {
    sourceDirs.push(runnerSrcRelative);
  }
  sourceDirs.push("src");

  elmJson["source-directories"] = sourceDirs;
  await fs.writeFile(elmJsonPath, JSON.stringify(elmJson, null, 4));

  // Install any missing dependencies into our generated elm.json.
  // elm/json goes first: the compiler refuses to work on an application that
  // lacks it, so `elm install` for anything else would fail until it's there.
  const deps = (elmJson.dependencies as { direct?: Record<string, string> })?.direct || {};
  const needed: string[] = [];
  if (!deps["elm/json"]) needed.push("elm/json");
  if (!deps["elm/random"]) needed.push("elm/random");
  if (!deps["BrianHicks/elm-trend"]) needed.push("BrianHicks/elm-trend");
  if (!deps["elm-explorations/test"]) needed.push("elm-explorations/test");
  if (!deps["elm-explorations/benchmark"]) needed.push("elm-explorations/benchmark");

  for (const pkg of needed) {
    await elmInstall(genDir, pkg, compiler);
  }
}

async function generateMainElm(
  benchmarks: BenchmarkModule[],
  outputPath: string
): Promise<void> {
  const usesBench = benchmarks.some((mod) => mod.benchmarkType === "bench");

  const imports = benchmarks.map((mod) => `import ${mod.moduleName}`);

  const suiteExpressions = benchmarks.map((mod) => {
    if (mod.exposedBenchmarks.length === 1) {
      return `        ${mod.moduleName}.${mod.exposedBenchmarks[0]}`;
    }
    const describeModule = usesBench ? "Bench.describe" : "Benchmark.describe";
    const entries = mod.exposedBenchmarks
      .map((name) => `            ${mod.moduleName}.${name}`)
      .join("\n        , ");
    return `        ${describeModule} "${mod.moduleName}"\n            [ ${entries}\n            ]`;
  });

  let mainElm: string;

  if (usesBench) {
    const describeRoot = benchmarks.length === 1 && benchmarks[0].exposedBenchmarks.length === 1
      ? suiteExpressions[0].trim()
      : `Bench.describe "Benchmarks"\n        [ ${suiteExpressions.join("\n        , ")}\n        ]`;

    mainElm = `module Main exposing (main)

import Bench
import Benchmark.Runner.Node as Runner
import Json.Encode
${imports.join("\n")}


main : Program Json.Encode.Value Runner.Model Runner.Msg
main =
    ${describeRoot}
        |> Runner.runBench
`;
  } else {
    const describeRoot = benchmarks.length === 1 && benchmarks[0].exposedBenchmarks.length === 1
      ? suiteExpressions[0].trim()
      : `Benchmark.describe "Benchmarks"\n        [ ${suiteExpressions.join("\n        , ")}\n        ]`;

    mainElm = `module Main exposing (main)

import Benchmark
import Benchmark.Runner.Node as Runner
import Json.Encode
${imports.join("\n")}


main : Program Json.Encode.Value Runner.Model Runner.Msg
main =
    ${describeRoot}
        |> Runner.run
`;
  }

  await fs.writeFile(outputPath, mainElm);
}

async function generateTestElm(
  benchmarks: BenchmarkModule[],
  outputPath: string
): Promise<void> {
  const imports = benchmarks.map((mod) => `import ${mod.moduleName}`);

  const suiteExpressions = benchmarks.map((mod) => {
    if (mod.exposedBenchmarks.length === 1) {
      return `            ${mod.moduleName}.${mod.exposedBenchmarks[0]}`;
    }
    const entries = mod.exposedBenchmarks
      .map((name) => `                ${mod.moduleName}.${name}`)
      .join("\n            , ");
    return `            Bench.describe "${mod.moduleName}"\n                [ ${entries}\n                ]`;
  });

  const testElm = `module BenchmarkVerification exposing (suite)

import Bench
import Expect
import Test exposing (Test)
${imports.join("\n")}


suite : Test
suite =
    let
        benchmarks =
            Bench.describe "Benchmarks"
                [ ${suiteExpressions.join("\n                , ")}
                ]
    in
    case Bench.toInternalTest benchmarks of
        Just test ->
            test

        Nothing ->
            Test.test "no verification needed" (\\_ -> Expect.pass)
`;

  await fs.writeFile(outputPath, testElm);
}
