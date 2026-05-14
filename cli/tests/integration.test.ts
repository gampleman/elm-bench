import { describe, it } from "node:test";
import assert from "node:assert";
import { execSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixtureProject = path.join(projectRoot, "test-fixture", "benchmarks", "elm.json");

function runCli(args: string): string {
  return execSync(`node ${path.join(projectRoot, "dist", "cli.js")} run ${args}`, {
    encoding: "utf8",
    timeout: 120_000,
    cwd: projectRoot,
  });
}

describe("elm-bench run (integration)", () => {
  it("runs benchmarks and produces results", () => {
    const output = runCli(`--project ${fixtureProject} --filter reversing`);
    assert.match(output, /List\.reverse/);
    assert.match(output, /runs\/s/);
    assert.match(output, /fastest/);
  });

  it("filters benchmarks by name", () => {
    const output = runCli(`--project ${fixtureProject} --filter reversing`);
    assert.match(output, /reversing/);
    assert.doesNotMatch(output, /sorting approaches/);
  });

  it("runs verification before benchmarking", () => {
    const output = runCli(`--project ${fixtureProject}`);
    assert.match(output, /All implementations produce consistent results/);
  });

  it("skips verification with --skip-test", () => {
    const output = runCli(`--project ${fixtureProject} --skip-test`);
    assert.doesNotMatch(output, /Verifying/);
  });

  it("outputs JSON with --reporter json", () => {
    const output = runCli(`--project ${fixtureProject} --filter reversing -r json`);
    const json = JSON.parse(output.slice(output.indexOf("{")));
    assert.ok(json.node);
    assert.strictEqual(json.node.kind, "group");
  });
});
