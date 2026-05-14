import fs from "node:fs/promises";
import path from "node:path";

export interface ElmJson {
  type: "application" | "package";
  "source-directories": string[];
  dependencies: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  dir: string;
  elmJsonPath: string;
  elmJson: ElmJson;
}

export async function findProject(projectPath?: string): Promise<Project> {
  if (projectPath) {
    const resolved = path.resolve(projectPath);
    const stat = await fs.stat(resolved);
    const elmJsonPath = stat.isDirectory()
      ? path.join(resolved, "elm.json")
      : resolved;
    const dir = path.dirname(elmJsonPath);
    const elmJson = JSON.parse(await fs.readFile(elmJsonPath, "utf8"));
    return { dir, elmJsonPath, elmJson };
  }

  // Walk up from cwd looking for benchmarks/elm.json or elm.json
  let current = process.cwd();
  while (true) {
    const benchmarksElmJson = path.join(current, "benchmarks", "elm.json");
    try {
      const elmJson = JSON.parse(await fs.readFile(benchmarksElmJson, "utf8"));
      return {
        dir: path.join(current, "benchmarks"),
        elmJsonPath: benchmarksElmJson,
        elmJson,
      };
    } catch {}

    const elmJsonPath = path.join(current, "elm.json");
    try {
      const elmJson = JSON.parse(await fs.readFile(elmJsonPath, "utf8"));
      return { dir: current, elmJsonPath, elmJson };
    } catch {}

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Could not find elm.json. Use --project to specify its location."
  );
}
