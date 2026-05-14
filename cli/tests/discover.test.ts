import { describe, it } from "node:test";
import assert from "node:assert";
import { discoverBenchmarks, filterBenchmarks } from "../src/discover.js";
import path from "node:path";

const fixtureDir = path.resolve(import.meta.dirname, "..", "test-fixture", "benchmarks");

describe("discoverBenchmarks", () => {
  it("finds Bench.Benchmark values by type annotation", async () => {
    const modules = await discoverBenchmarks(fixtureDir, ["src/**/*.elm"]);
    assert.strictEqual(modules.length, 1);
    assert.strictEqual(modules[0].moduleName, "ExampleBenchmarks");
    assert.deepStrictEqual(modules[0].exposedBenchmarks, ["suite"]);
    assert.strictEqual(modules[0].benchmarkType, "bench");
  });
});

describe("filterBenchmarks", () => {
  it("filters by module name", () => {
    const modules = [
      { filePath: "a.elm", moduleName: "Array.Extra", exposedBenchmarks: ["suite"], benchmarkType: "bench" as const },
      { filePath: "b.elm", moduleName: "List.Extra", exposedBenchmarks: ["suite"], benchmarkType: "bench" as const },
    ];
    const result = filterBenchmarks(modules, "Array");
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].moduleName, "Array.Extra");
  });

  it("filters by variable name", () => {
    const modules = [
      { filePath: "a.elm", moduleName: "Benchmarks", exposedBenchmarks: ["arraySuite", "listSuite"], benchmarkType: "bench" as const },
    ];
    const result = filterBenchmarks(modules, "array");
    assert.strictEqual(result.length, 1);
    assert.deepStrictEqual(result[0].exposedBenchmarks, ["arraySuite"]);
  });

  it("returns empty array when nothing matches", () => {
    const modules = [
      { filePath: "a.elm", moduleName: "Foo", exposedBenchmarks: ["bar"], benchmarkType: "bench" as const },
    ];
    const result = filterBenchmarks(modules, "nonexistent");
    assert.strictEqual(result.length, 0);
  });
});
