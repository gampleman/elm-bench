import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";

export interface DependencyGraph {
  dependenciesOf(module: string): Set<string>;
  dependentsOf(module: string): Set<string>;
  transitiveDependentsOf(module: string): Set<string>;
  moduleForPath(filePath: string): string | null;
  rebuild(): Promise<void>;
}

export async function buildDependencyGraph(
  sourceDirs: string[],
  projectDir: string
): Promise<DependencyGraph> {
  const forward = new Map<string, Set<string>>();
  const inverse = new Map<string, Set<string>>();
  const pathToModule = new Map<string, string>();

  async function rebuild(): Promise<void> {
    forward.clear();
    inverse.clear();
    pathToModule.clear();

    for (const srcDir of sourceDirs) {
      const absDir = path.resolve(projectDir, srcDir);
      const files = await glob(["**/*.elm"], {
        cwd: absDir,
        absolute: true,
        ignore: ["**/elm-stuff/**"],
      });

      for (const file of files) {
        const relative = path.relative(absDir, file);
        const moduleName = relative
          .replace(/\.elm$/, "")
          .split(path.sep)
          .join(".");

        pathToModule.set(file, moduleName);

        const content = await fs.readFile(file, "utf8");
        const imports = parseImports(content);

        forward.set(moduleName, imports);
        for (const imp of imports) {
          if (!inverse.has(imp)) inverse.set(imp, new Set());
          inverse.get(imp)!.add(moduleName);
        }
      }
    }
  }

  await rebuild();

  return {
    dependenciesOf(module: string): Set<string> {
      return forward.get(module) ?? new Set();
    },

    dependentsOf(module: string): Set<string> {
      return inverse.get(module) ?? new Set();
    },

    transitiveDependentsOf(module: string): Set<string> {
      const result = new Set<string>();
      const queue = [module];

      while (queue.length > 0) {
        const current = queue.pop()!;
        const deps = inverse.get(current);
        if (!deps) continue;
        for (const dep of deps) {
          if (!result.has(dep)) {
            result.add(dep);
            queue.push(dep);
          }
        }
      }

      return result;
    },

    moduleForPath(filePath: string): string | null {
      const abs = path.resolve(filePath);
      return pathToModule.get(abs) ?? null;
    },

    rebuild,
  };
}

function parseImports(content: string): Set<string> {
  const imports = new Set<string>();
  const regex = /^import\s+([\w.]+)/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.add(match[1]);
  }
  return imports;
}
