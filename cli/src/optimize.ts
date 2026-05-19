import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import spawn from "cross-spawn";
import { findProject } from "./project.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REVIEW_CONFIG_PATH = path.resolve(__dirname, "..", "elm", "review");

export interface OptimizeOptions {
  target: string;
  add?: string;
  args: string[];
  projectPath?: string;
}

export async function optimize(options: OptimizeOptions): Promise<void> {
  const dotIndex = options.target.lastIndexOf(".");
  if (dotIndex === -1) {
    throw new Error(
      `Invalid target "${options.target}". Expected Module.function format (e.g. MyModule.myFun).`
    );
  }

  const moduleName = options.target.slice(0, dotIndex);
  const functionName = options.target.slice(dotIndex + 1);

  const project = await findProject(options.projectPath);
  const sourceDirs = project.elmJson["source-directories"] || ["src"];

  const sourceFile = await findModuleSource(moduleName, sourceDirs, project.dir);
  if (!sourceFile) {
    throw new Error(
      `Could not find source file for module "${moduleName}" in source directories: ${sourceDirs.join(", ")}`
    );
  }

  const sourceContent = await fs.readFile(sourceFile, "utf8");

  // Determine the benchmarks source directory
  const benchmarksSrcDir = path.join(project.dir, sourceDirs[0]);

  if (options.add) {
    await addVariant(
      moduleName,
      functionName,
      options.add,
      sourceContent,
      benchmarksSrcDir,
      project.dir
    );
  } else {
    await createInitialScaffold(
      moduleName,
      functionName,
      options.args,
      sourceContent,
      benchmarksSrcDir,
      project.dir
    );
  }
}

async function createInitialScaffold(
  moduleName: string,
  functionName: string,
  args: string[],
  sourceContent: string,
  benchmarksSrcDir: string,
  projectDir: string
): Promise<void> {
  const baselineModName = variantModuleName(moduleName, functionName, "Baseline");
  const optimizedModName = variantModuleName(moduleName, functionName, "Optimized");

  const baselinePath = moduleNameToPath(baselineModName, benchmarksSrcDir);
  const optimizedPath = moduleNameToPath(optimizedModName, benchmarksSrcDir);

  // Check if baseline already exists
  try {
    await fs.access(baselinePath);
    throw new Error(
      `${baselinePath} already exists. Use --add <name> to add a new variant.`
    );
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  // Create module copies
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.mkdir(path.dirname(optimizedPath), { recursive: true });

  await writeModuleCopy(sourceContent, moduleName, baselineModName, functionName, baselinePath);
  await writeModuleCopy(sourceContent, moduleName, optimizedModName, functionName, optimizedPath);

  // Run elm-review cleanup on both
  await runElmReviewCleanup(projectDir, baselinePath);
  await runElmReviewCleanup(projectDir, optimizedPath);

  // Generate or update Benchmarks.elm
  const benchmarksPath = path.join(benchmarksSrcDir, "Benchmarks.elm");
  await generateBenchmarkEntry(
    benchmarksPath,
    functionName,
    args,
    [
      { name: "Baseline", moduleName: baselineModName },
      { name: "Optimized", moduleName: optimizedModName },
    ]
  );

  console.log(`\nCreated optimization scaffold:`);
  console.log(`  ${path.relative(projectDir, baselinePath)} (baseline - do not modify)`);
  console.log(`  ${path.relative(projectDir, optimizedPath)} (optimize this one)`);
  console.log(`  ${path.relative(projectDir, benchmarksPath)}`);
  console.log(`\nRun \`elm-bench run --watch\` to benchmark your changes.`);
}

async function addVariant(
  moduleName: string,
  functionName: string,
  variantName: string,
  sourceContent: string,
  benchmarksSrcDir: string,
  projectDir: string
): Promise<void> {
  const baselinePath = moduleNameToPath(
    variantModuleName(moduleName, functionName, "Baseline"),
    benchmarksSrcDir
  );

  try {
    await fs.access(baselinePath);
  } catch {
    throw new Error(
      `No existing optimization found for "${moduleName}.${functionName}". Run without --add first to create the initial scaffold.`
    );
  }

  const variantModName = variantModuleName(moduleName, functionName, variantName);
  const variantPath = moduleNameToPath(variantModName, benchmarksSrcDir);

  try {
    await fs.access(variantPath);
    throw new Error(`${variantPath} already exists.`);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  await fs.mkdir(path.dirname(variantPath), { recursive: true });
  await writeModuleCopy(sourceContent, moduleName, variantModName, functionName, variantPath);
  await runElmReviewCleanup(projectDir, variantPath);

  // Update Benchmarks.elm to add the new variant
  const benchmarksPath = path.join(benchmarksSrcDir, "Benchmarks.elm");
  await addVariantToBenchmark(benchmarksPath, functionName, variantName, variantModName);

  console.log(`\nAdded variant "${variantName}":`);
  console.log(`  ${path.relative(projectDir, variantPath)}`);
  console.log(`\nRun \`elm-bench run --watch\` to benchmark your changes.`);
}

function variantModuleName(
  moduleName: string,
  functionName: string,
  variant: string
): string {
  const capitalizedFn = functionName[0].toUpperCase() + functionName.slice(1);
  return `${moduleName}.${capitalizedFn}.${variant}`;
}

function moduleNameToPath(moduleName: string, srcDir: string): string {
  return path.join(srcDir, ...moduleName.split(".")) + ".elm";
}

async function findModuleSource(
  moduleName: string,
  sourceDirs: string[],
  projectDir: string
): Promise<string | null> {
  const relPath = moduleName.split(".").join(path.sep) + ".elm";

  for (const dir of sourceDirs) {
    const fullPath = path.join(projectDir, dir, relPath);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // Not in this directory
    }
  }

  return null;
}

async function writeModuleCopy(
  sourceContent: string,
  originalModuleName: string,
  newModuleName: string,
  functionName: string,
  outputPath: string
): Promise<void> {
  let content = sourceContent;

  // Find the module declaration and replace it entirely.
  // We need to handle multi-line exposing lists with nested parens like Type(..)
  const moduleStart = content.match(
    /^((?:port\s+)?module\s+)[\w.]+\s+exposing\s*\(/m
  );
  if (moduleStart) {
    const startIndex = moduleStart.index!;
    const parenStart = content.indexOf("(", startIndex + moduleStart[1].length);
    let depth = 1;
    let i = parenStart + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === "(") depth++;
      else if (content[i] === ")") depth--;
      i++;
    }
    // Replace everything from start to end of exposing with new header
    content =
      `module ${newModuleName} exposing (${functionName})` +
      content.slice(i);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content);
}

function resolveElmReview(): string {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("elm-review/bin/elm-review");
  } catch {
    return "elm-review";
  }
}

function resolveElmFormat(): string {
  try {
    const require = createRequire(import.meta.url);
    return require.resolve("elm-format/bin/elm-format");
  } catch {
    return "elm-format";
  }
}

async function runElmReviewCleanup(
  projectDir: string,
  filePath: string
): Promise<void> {
  const elmReviewBin = resolveElmReview();
  const elmFormatBin = resolveElmFormat();
  const relativePath = path.relative(projectDir, filePath);

  return new Promise((resolve) => {
    const proc = spawn(
      elmReviewBin,
      [
        relativePath,
        "--config",
        REVIEW_CONFIG_PATH,
        "--fix-all-without-prompt",
        "--elm-format-path",
        elmFormatBin,
      ],
      {
        cwd: projectDir,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    proc.on("close", () => {
      resolve();
    });

    proc.on("error", () => {
      resolve();
    });
  });
}

interface VariantEntry {
  name: string;
  moduleName: string;
}

async function generateBenchmarkEntry(
  benchmarksPath: string,
  functionName: string,
  args: string[],
  variants: VariantEntry[]
): Promise<void> {
  const runnerArg =
    args.length > 0
      ? args.join(" ")
      : `Debug.todo "provide input"`;

  const runnerLambda = `(\\${functionName}_ -> ${functionName}_ ${runnerArg})`;

  const implementationLines = variants
    .map((v) => `( "${v.name}", ${v.moduleName}.${functionName} )`)

  const implementations = implementationLines
    .map((line, i) => (i === 0 ? `[ ${line}` : `, ${line}`))
    .join("\n        ");

  const imports = variants.map((v) => `import ${v.moduleName}`).join("\n");

  const benchmarkValue = `
${functionName} : Benchmark
${functionName} =
    Bench.rank "${functionName}"
        ${runnerLambda}
        ${implementations}
        ]`;

  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(benchmarksPath, "utf8");
  } catch {
    // File doesn't exist
  }

  if (existingContent) {
    // Add imports if not present
    let updated = existingContent;
    for (const v of variants) {
      const importLine = `import ${v.moduleName}`;
      if (!updated.includes(importLine)) {
        const importMatches = updated.match(/^import .+$/gm);
        if (importMatches) {
          const lastImport = importMatches[importMatches.length - 1];
          const lastImportIndex = updated.lastIndexOf(lastImport);
          updated =
            updated.slice(0, lastImportIndex + lastImport.length) +
            `\n${importLine}` +
            updated.slice(lastImportIndex + lastImport.length);
        }
      }
    }

    // Add value name to exposing list
    const exposingMatch = updated.match(
      /^((?:port\s+)?module\s+[\w.]+\s+exposing\s*\()([^)]*)\)/m
    );
    if (exposingMatch) {
      const currentExposing = exposingMatch[2].trim();
      if (!currentExposing.split(/\s*,\s*/).includes(functionName)) {
        const newExposing = currentExposing
          ? `${currentExposing}, ${functionName}`
          : functionName;
        updated = updated.replace(
          /^((?:port\s+)?module\s+[\w.]+\s+exposing\s*\()[^)]*\)/m,
          `$1${newExposing})`
        );
      }
    }

    // Append the benchmark value
    updated = updated.trimEnd() + "\n\n" + benchmarkValue.trim() + "\n";

    await fs.writeFile(benchmarksPath, updated);
  } else {
    // Create new file
    const content = `module Benchmarks exposing (${functionName})

import Bench exposing (Benchmark)
${imports}

${benchmarkValue.trim()}
`;
    await fs.mkdir(path.dirname(benchmarksPath), { recursive: true });
    await fs.writeFile(benchmarksPath, content);
  }
}

async function addVariantToBenchmark(
  benchmarksPath: string,
  functionName: string,
  variantName: string,
  variantModuleName: string
): Promise<void> {
  let content: string;
  try {
    content = await fs.readFile(benchmarksPath, "utf8");
  } catch {
    throw new Error(
      `${benchmarksPath} not found. Run without --add first to create the initial scaffold.`
    );
  }

  // Add import if not present
  const importLine = `import ${variantModuleName}`;
  if (!content.includes(importLine)) {
    // Insert after the last import line
    const importLines = content.match(/^import .+$/gm);
    if (importLines) {
      const lastImport = importLines[importLines.length - 1];
      const lastImportIndex = content.lastIndexOf(lastImport);
      content =
        content.slice(0, lastImportIndex + lastImport.length) +
        `\n${importLine}` +
        content.slice(lastImportIndex + lastImport.length);
    }
  }

  // Find the rank implementation list for this function and add the new entry
  // We look for the closing ] of the list in the rank block for this function
  const rankPattern = new RegExp(
    `(Bench\\.rank "${functionName}"[\\s\\S]*?)(\\n        \\])`,
    "m"
  );

  const match = content.match(rankPattern);
  if (match) {
    const newEntry = `\n        , ( "${variantName}", ${variantModuleName}.${functionName} )`;
    content = content.replace(rankPattern, `$1${newEntry}$2`);
  } else {
    throw new Error(
      `Could not find Bench.rank "${functionName}" in ${benchmarksPath}. ` +
        `Is the benchmark file in the expected format?`
    );
  }

  await fs.writeFile(benchmarksPath, content);
}
