# elm-bench

A complete benchmarking toolkit for Elm. Define benchmarks with automatic correctness verification, run them headlessly across multiple JS engines, and get rich terminal output with scaling charts.

## The Experience

**Define benchmarks with a clean API:**

```elm
module MyBenchmarks exposing (suite)

import Bench exposing (Benchmark)

suite : Benchmark
suite =
    Bench.describe "Array.Extra"
        [ Bench.rank "mapToList"
            (\mapToList -> mapToList negate myArray)
            [ ( "with foldr", MapToList.withFoldr )
            , ( "with toIndexedList", MapToList.withListMap )
            ]
        , Bench.scale "mapToList across sizes"
            [ 10, 100, 1000, 10000 ]
            (\n -> Array.fromList (List.range 1 n))
            [ ( "with foldr", MapToList.withFoldr negate )
            , ( "with toIndexedList", MapToList.withListMap negate )
            ]
        ]
```

**Run with a single command:**

```
$ elm-bench run --filter mapToList
```

**Get verification first, then results:**

```
Verifying benchmark correctness...

  ✓ All implementations produce consistent results

Running benchmarks in node...

Benchmark Results

  Array.Extra / mapToList
  ───────────────────────────────────────────────────────
  with foldr                980,124 runs/s      (99.9%)     fastest
  with Array.toIndexedList  535,891 runs/s      (99.8%)     1.83x slower
```

**See how algorithms scale with input size:**

```
  Array.Extra / mapToList across sizes

   30.2M ┼──╮───╮
   17.5M ┤  ╰─────╮─────╮
   10.1M ┤        ╰─────╮────╮
    5.8M ┤             ╰────╮────╮
    3.4M ┤                  ╰────╮────╮
    1.9M ┤                       ╰────╮────╮
    1.1M ┤                            ╰────╮────╮
  651.3K ┤                                 ╰────╮───╮
  376.5K ┤                                      ╰───╮───╮
  217.6K ┤                                          ╰───╮───╮
  125.8K ┤                                              ╰───╮──╮
   72.7K ┤                                                  ╰──╮──╮
   42.0K ┤                                                     ╰──╮──╮
   24.3K ┤                                                        ╰──╮──╮
   14.0K ┤                                                           ╰──╮──
    8.1K ┤                                                              ╰──╮
    4.7K ┤                                                                 ╰
         (log scale)
      n= 1              10                            500  1000         10000

  ━━ with foldr  (30.2M → 9.8K runs/s)
  ━━ with Array.toIndexedList  (23.0M → 4.7K runs/s)
```

In terminals with inline image support (iTerm2, WezTerm, Ghostty, VS Code), a full-color PNG chart is rendered instead.

**Compare across JavaScript engines:**

```
$ elm-bench run -t node -t chromium -t firefox --filter mapToList

  Array.Extra / indexedMapToList
                         node              chromium          firefox
  ────────────────────────────────────────────────────────────────────
  with Array.foldr       608,609 runs/s    712,445 runs/s    838,702 runs/s
  with Array.indexedMap  527,083 runs/s    634,221 runs/s    671,752 runs/s
  with List.indexedMap   384,174 runs/s    445,890 runs/s    339,777 runs/s
  with toIndexedList     302,367 runs/s    356,112 runs/s    330,534 runs/s
```

When rankings differ across targets, entries are highlighted in green (ranked higher than first target) or red (ranked lower) — immediately surfacing cross-engine performance characteristics.

## Installation

```bash
cd my-project/benchmarks
npm install elm-bench
elm-json install gampleman/elm-bench
```

## Key Features

### Automatic Correctness Verification

`Bench.rank`, `Bench.compare`, and `Bench.scale` automatically verify that all implementations produce the same result before benchmarking begins. This runs via `elm-test-rs` in seconds and catches broken optimizations before you waste time on misleading benchmark results.

```
Verifying benchmark correctness...

  ✗ Benchmark verification failed!

  Some implementations produce different results:

    ↓ Array.Extra / reverse
    ✗ with List.reverse should match with push
        Array.fromList [100,99,...,1]
        ╷
        │ Expect.equal
        ╵
        Array.fromList [1,2,...,100]
```

Use `Bench.skipEqualityCheck` for cases where implementations intentionally differ (e.g. different valid orderings).

### Filtering

Only run what you need:

```bash
elm-bench run --filter mapToList
```

Filtering happens at the Elm level before benchmarks execute — so even with hundreds of benchmarks in your suite, filtered runs are fast.

### Fuzzer-Based Inputs

Use `elm-explorations/test` fuzzers for randomized benchmark input:

```elm
Bench.rankFuzz "mapToList"
    (Fuzz.array (Fuzz.intRange 1 1000))
    (\mapToList array -> mapToList negate array)
    [ ( "with foldr", MapToList.withFoldr )
    , ( "with toIndexedList", MapToList.withListMap )
    ]
```

The same fuzzer is used for both the correctness check (fuzz test) and to generate the benchmark input (seeded deterministically via `--seed`).

### Multi-Target Execution

Compare across JavaScript engines to ensure optimizations are consistent:

```bash
elm-bench run -t node -t chromium -t firefox
```

Requires Playwright for browser targets: `npm install playwright`.

### Scaling Analysis

Understand algorithmic complexity with `Bench.scale`:

```elm
Bench.scale "sorting"
    [ 10, 100, 1000, 10000 ]
    (\n -> List.range 1 n |> List.reverse)
    [ ( "List.sort", List.sort )
    , ( "mergeSort", mergeSort )
    ]
```

Results are rendered as a chart with log-scale detection.

## CLI Reference

```
elm-bench run [options] [globs...]

Options:
  -f, --filter <pattern>   Only run benchmarks matching pattern
  -t, --target <name>      Execution target (repeatable): node, chromium, firefox, webkit
  -r, --reporter <format>  Output: console (default), json
  --compiler <path>        Path to elm binary
  --project <path>         Path to benchmarks elm.json
  --seed <number>          Random seed for fuzz-based inputs
  --skip-test              Skip correctness verification
  --no-optimize            Disable --optimize (for debugging)
```

## Elm API Quick Reference

### Comparing Implementations

| Function | Description |
|----------|-------------|
| `Bench.rank` | Compare N implementations with shared runner. Verifies correctness. |
| `Bench.compare` | Compare two implementations. Verifies correctness. |
| `Bench.series` | Compare N implementations without verification. |
| `Bench.benchmark` | Measure a single function. |

### Scaling

| Function | Description |
|----------|-------------|
| `Bench.scale` | Run at multiple input sizes with static data generation. |
| `Bench.scaleFuzz` | Run at multiple input sizes with fuzzer-based generation. |

### Fuzzer Variants

| Function | Description |
|----------|-------------|
| `Bench.rankFuzz` | Like `rank` with fuzzer-generated input. |
| `Bench.compareFuzz` | Like `compare` with fuzzer-generated input. |

### Utilities

| Function | Description |
|----------|-------------|
| `Bench.describe` | Group benchmarks. |
| `Bench.skipEqualityCheck` | Disable automatic verification. |

## Project Structure

```
elm-bench/
├── elm.json                  # Elm package (gampleman/elm-bench)
├── src/Bench.elm             # The benchmarking library
├── review/                   # elm-review configuration
├── cli/                      # npm package (elm-bench CLI)
│   ├── package.json
│   ├── bin/elm-bench.js
│   ├── src/                  # TypeScript source
│   ├── elm/                  # Headless runner (Platform.worker)
│   └── tests/
└── .github/workflows/ci.yml
```

## Requirements

- Node.js >= 18
- Elm 0.19.1 (bundled with CLI)
- For browser targets: `npm install playwright`
