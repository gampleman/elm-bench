module Bench exposing
    ( Benchmark, benchmark, compare, rank, describe, scale, series
    , compareFuzz, rankFuzz, scaleFuzz
    , sampleFuzzer
    , skipEqualityCheck
    , filter
    , toInternalBenchmark, toInternalTest, encode
    )

{-| A benchmarking library designed for the `elm-bench` CLI runner.

Provides a richer API than `elm-explorations/benchmark` with:

  - **Automatic correctness checks** — `compare`, `rank`, and `scale` verify
    that all implementations produce the same result before benchmarking.
  - **Fuzzer-based inputs** — generate random test data using `elm-explorations/test` fuzzers.
  - **Scaling analysis** — measure how algorithms perform at different input sizes.
  - **Filtering** — the CLI can run a subset of benchmarks by name.


# Creating Benchmarks

@docs Benchmark, benchmark, compare, rank, describe, scale, series


# Fuzzer Variants

These use fuzzers from `elm-explorations/test` to generate random input data.
The fuzzer is sampled once per benchmark run (seeded deterministically) and all
fuzzers receive the same seed for the run (this makes debugging possible),
however input will vary across runs (unless you run with the same `--seed`
argument).

@docs compareFuzz, rankFuzz, scaleFuzz

@docs sampleFuzzer


# Correctness Verification

`compare`, `rank`, and `scale` automatically verify that all implementations
produce the same result. Use `skipEqualityCheck` to opt out.

@docs skipEqualityCheck


# Filtering

@docs filter


# For Runners

These are used internally by the CLI runner. You shouldn't need them directly.

@docs toInternalBenchmark, toInternalTest, encode

-}

import Benchmark
import Expect
import Fuzz exposing (Fuzzer)
import Json.Encode as Encode
import Random
import Test exposing (Test)
import Test.Runner


type alias PrepThunk =
    Random.Seed -> () -> ()


{-| A benchmark definition. Can be a single measurement, a comparison of
multiple implementations, a scaling analysis, or a named group.
-}
type Benchmark
    = Single String (() -> ())
    | Rank String (Maybe Test) (List { name : String, run : PrepThunk })
    | Group String (List Benchmark)
    | Scale String (Maybe Test) (List { name : String, size : Int, run : PrepThunk })



-- CREATING BENCHMARKS


{-| Benchmark a single function.

    benchmark "List.map" <|
        \_ -> List.map ((+) 1) (List.range 1 100)

-}
benchmark : String -> (() -> a) -> Benchmark
benchmark name fn =
    Single name (\_ -> fn () |> always ())


{-| Compare two implementations. Automatically verifies they produce the
same result before benchmarking.

    compare "reversing"
        ( "List.reverse", \_ -> List.reverse data )
        ( "List.foldl (::)", \_ -> List.foldl (::) [] data )

-}
compare :
    String
    -> ( String, () -> a )
    -> ( String, () -> a )
    -> Benchmark
compare name ( name1, fn1 ) ( name2, fn2 ) =
    Rank name
        (Just
            (Test.test (name ++ ": " ++ name1 ++ " should match " ++ name2)
                (\() ->
                    fn1 () |> Expect.equal (fn2 ())
                )
            )
        )
        [ { name = name1, run = \_ -> \_ -> fn1 () |> always () }
        , { name = name2, run = \_ -> \_ -> fn2 () |> always () }
        ]


{-| Compare multiple implementations with a shared runner function.
Automatically verifies that all implementations produce the same result.

    rank "mapToList"
        (\mapToList -> mapToList negate ints1To100)
        [ ( "with foldr", Array.Extra.MapToList.withFoldr )
        , ( "with toIndexedList", Array.Extra.MapToList.withListMap )
        ]

-}
rank : String -> (f -> a) -> List ( String, f ) -> Benchmark
rank name runner implementations =
    Rank name
        (if List.length implementations > 1 then
            List.map2
                (\( aName, aImpl ) ( bName, bImpl ) ->
                    Test.test (aName ++ " should match " ++ bName) <|
                        \() ->
                            runner aImpl
                                |> Expect.equal
                                    (runner bImpl)
                )
                implementations
                (List.drop 1 implementations)
                |> Test.describe name
                |> Just

         else
            Nothing
        )
        (implementations
            |> List.map
                (\( implName, impl ) ->
                    { name = implName
                    , run = \_ -> \_ -> runner impl |> always ()
                    }
                )
        )


{-| Organize benchmarks into a named group.

    describe "Array.Extra"
        [ rank "mapToList" ...
        , rank "filterMap" ...
        ]

-}
describe : String -> List Benchmark -> Benchmark
describe =
    Group


{-| Run multiple implementations at different input sizes. Useful for
understanding algorithmic complexity. Automatically verifies correctness
at each size.

    scale "sorting"
        [ 10, 100, 1000 ]
        (\n -> List.range 1 n |> List.reverse)
        [ ( "List.sort", List.sort )
        , ( "mergeSort", mergeSort )
        ]

-}
scale :
    String
    -> List Int
    -> (Int -> input)
    -> List ( String, input -> a )
    -> Benchmark
scale name sizes dataGen implementations =
    Scale name
        (if List.length implementations > 1 then
            List.map
                (\size ->
                    let
                        data =
                            dataGen size
                    in
                    List.map2
                        (\( aName, aImpl ) ( bName, bImpl ) ->
                            Test.test (aName ++ " should match " ++ bName) <|
                                \() ->
                                    aImpl data
                                        |> Expect.equal
                                            (bImpl data)
                        )
                        implementations
                        (List.drop 1 implementations)
                        |> Test.describe ("N=" ++ String.fromInt size)
                )
                sizes
                |> Test.describe name
                |> Just

         else
            Nothing
        )
        (implementations
            |> List.concatMap
                (\( implName, impl ) ->
                    List.map
                        (\size ->
                            let
                                data =
                                    dataGen size
                            in
                            { size = size
                            , name = implName
                            , run = \_ -> \_ -> impl data |> always ()
                            }
                        )
                        sizes
                )
        )


{-| A simple series of named benchmarks. Does not verify equality
(use `rank` if you want correctness checks).

    series "approaches"
        [ ( "List.sort", \_ -> List.sort data )
        , ( "List.sortBy identity", \_ -> List.sortBy identity data )
        ]

-}
series : String -> List ( String, () -> a ) -> Benchmark
series name entries =
    Rank name
        Nothing
        (entries
            |> List.map
                (\( entryName, fn ) ->
                    { name = entryName
                    , run = \_ -> \_ -> fn () |> always ()
                    }
                )
        )



-- FUZZER VARIANTS


runFuzzer : Fuzzer input -> (input -> a) -> Random.Seed -> (() -> ())
runFuzzer fuzzer fn seed =
    let
        dataResult =
            Random.step (Test.Runner.fuzz fuzzer) seed
                |> Tuple.first
                |> Result.map Tuple.first
    in
    case dataResult of
        Ok data ->
            \() -> fn data |> always ()

        Err _ ->
            \() -> ()


{-| Like `compare`, but generates input from a fuzzer. The fuzzer is also
used for the correctness check (fuzz test).

    compareFuzz "reversing"
        (Fuzz.list Fuzz.int)
        ( "List.reverse", List.reverse )
        ( "List.foldl (::)", List.foldl (::) [] )

-}
compareFuzz :
    String
    -> Fuzzer input
    -> ( String, input -> a )
    -> ( String, input -> a )
    -> Benchmark
compareFuzz name fuzzer ( name1, fn1 ) ( name2, fn2 ) =
    Rank name
        (Just
            (Test.fuzz fuzzer
                (name ++ ": " ++ name1 ++ " should match " ++ name2)
                (\input ->
                    fn1 input |> Expect.equal (fn2 input)
                )
            )
        )
        [ { name = name1, run = runFuzzer fuzzer fn1 }
        , { name = name2, run = runFuzzer fuzzer fn2 }
        ]


{-| Like `rank`, but generates input from a fuzzer.

    rankFuzz "mapToList"
        (Fuzz.array Fuzz.int)
        (\mapToList array -> mapToList negate array)
        [ ( "with foldr", Array.Extra.MapToList.withFoldr )
        , ( "with toIndexedList", Array.Extra.MapToList.withListMap )
        ]

-}
rankFuzz : String -> Fuzzer input -> (f -> input -> a) -> List ( String, f ) -> Benchmark
rankFuzz name fuzzer runner implementations =
    Rank name
        (if List.length implementations > 1 then
            List.map2
                (\( aName, aImpl ) ( bName, bImpl ) ->
                    Test.fuzz fuzzer (aName ++ " should match " ++ bName) <|
                        \data ->
                            runner aImpl data
                                |> Expect.equal
                                    (runner bImpl data)
                )
                implementations
                (List.drop 1 implementations)
                |> Test.describe name
                |> Just

         else
            Nothing
        )
        (implementations
            |> List.map
                (\( implName, impl ) ->
                    { name = implName
                    , run = runFuzzer fuzzer (runner impl)
                    }
                )
        )


{-| Like `scale`, but generates input from a size-dependent fuzzer.

    scaleFuzz "sorting"
        [ 10, 100, 1000 ]
        (\n -> Fuzz.listOfLength n Fuzz.int)
        [ ( "List.sort", List.sort )
        , ( "mergeSort", mergeSort )
        ]

-}
scaleFuzz :
    String
    -> List Int
    -> (Int -> Fuzzer input)
    -> List ( String, input -> a )
    -> Benchmark
scaleFuzz name sizes dataGen implementations =
    Scale name
        (if List.length implementations > 1 then
            List.map
                (\size ->
                    let
                        dataFuzzer =
                            dataGen size
                    in
                    List.map2
                        (\( aName, aImpl ) ( bName, bImpl ) ->
                            Test.fuzz dataFuzzer (aName ++ " should match " ++ bName) <|
                                \data ->
                                    aImpl data
                                        |> Expect.equal
                                            (bImpl data)
                        )
                        implementations
                        (List.drop 1 implementations)
                        |> Test.describe ("N=" ++ String.fromInt size)
                )
                sizes
                |> Test.describe name
                |> Just

         else
            Nothing
        )
        (implementations
            |> List.concatMap
                (\( implName, impl ) ->
                    List.map
                        (\size ->
                            let
                                dataFuzzer =
                                    dataGen size
                            in
                            { size = size
                            , name = implName
                            , run = runFuzzer dataFuzzer impl
                            }
                        )
                        sizes
                )
        )



-- CORRECTNESS VERIFICATION


{-| Disable the automatic equality check for a benchmark. Use this when
implementations intentionally produce different results (e.g. different
orderings that are both valid).

    rank "set operations"
        (\toList -> toList mySet)
        [ ( "Set.toList", Set.toList )
        , ( "custom", customToList ) -- different order, both valid
        ]
        |> skipEqualityCheck

-}
skipEqualityCheck : Benchmark -> Benchmark
skipEqualityCheck bench =
    case bench of
        Single _ _ ->
            bench

        Rank name _ v ->
            Rank name Nothing v

        Group name items ->
            Group name (List.map skipEqualityCheck items)

        Scale name _ v ->
            Scale name Nothing v



-- FILTERING


{-| Filter benchmarks by name (case-insensitive substring match).
Groups are kept if any child matches. Returns `Nothing` if nothing matches.
-}
filter : String -> Benchmark -> Maybe Benchmark
filter pattern bench =
    let
        lowerPattern =
            String.toLower pattern

        matches name =
            String.contains lowerPattern (String.toLower name)
    in
    case bench of
        Single name _ ->
            if matches name then
                Just bench

            else
                Nothing

        Rank name _ _ ->
            if matches name then
                Just bench

            else
                Nothing

        Scale name _ _ ->
            if matches name then
                Just bench

            else
                Nothing

        Group name children ->
            if matches name then
                Just bench

            else
                let
                    filtered =
                        List.filterMap (filter pattern) children
                in
                if List.isEmpty filtered then
                    Nothing

                else
                    Just (Group name filtered)


{-| Sample a fuzzer with a specific seed. Use this in `elm repl` to reproduce
the exact input that was used during a benchmark run.

When you see unexpected results from a fuzz-based benchmark, copy the seed
from the benchmark output and run in `elm repl`:

    > import Bench
    > import Fuzz
    > Bench.sampleFuzzer 1234567 (Fuzz.list Fuzz.int)
    [3, -7, 42, ...] : List Int

This gives you the exact value the fuzzer produced during that run.

(We cannot print the value in the benchmark run, since unlike elm-test, elm-bench
runs in `--optimize` mode and so doesn't have access to `Debug.log`.)

-}
sampleFuzzer : Int -> Fuzzer a -> Maybe a
sampleFuzzer seedInt fuzzer =
    let
        seed =
            Random.initialSeed seedInt
    in
    Random.step (Test.Runner.fuzz fuzzer) seed
        |> Tuple.first
        |> Result.toMaybe
        |> Maybe.map Tuple.first



-- FOR RUNNERS


{-| Extract the correctness test from a benchmark tree. The CLI runner
executes this before benchmarking to catch broken implementations early.
-}
toInternalTest : Benchmark -> Maybe Test.Test
toInternalTest bench =
    case bench of
        Single _ _ ->
            Nothing

        Rank _ test _ ->
            test

        Group name children ->
            case List.filterMap toInternalTest children of
                [] ->
                    Nothing

                tests ->
                    Just (Test.describe name tests)

        Scale _ test _ ->
            test


{-| Convert to `elm-explorations/benchmark`'s Benchmark type for execution.
The seed is used to generate deterministic fuzzer-based input.
-}
toInternalBenchmark : Random.Seed -> Benchmark -> Benchmark.Benchmark
toInternalBenchmark seed bench =
    case bench of
        Single name fn ->
            Benchmark.benchmark name fn

        Rank name _ entries ->
            Benchmark.scale name
                (entries |> List.map (\e -> ( e.name, e.run seed )))

        Group name children ->
            Benchmark.describe name
                (children |> List.map (toInternalBenchmark seed))

        Scale scaleName _ implementations ->
            Benchmark.describe scaleName
                (implementations
                    |> List.map
                        (\{ name, size, run } ->
                            Benchmark.benchmark
                                (name ++ " (n=" ++ String.fromInt size ++ ")")
                                (run seed)
                        )
                )


{-| Encode the benchmark tree structure as JSON. Used by the CLI to
understand the tree shape for filtering and display.
-}
encode : Benchmark -> Encode.Value
encode bench =
    case bench of
        Single name _ ->
            Encode.object
                [ ( "type", Encode.string "single" )
                , ( "name", Encode.string name )
                ]

        Rank name maybeTest entries ->
            Encode.object
                [ ( "type", Encode.string "rank" )
                , ( "name", Encode.string name )
                , ( "hasTest", Encode.bool (maybeTest /= Nothing) )
                , ( "entries", Encode.list (\e -> Encode.string e.name) entries )
                ]

        Group name children ->
            Encode.object
                [ ( "type", Encode.string "group" )
                , ( "name", Encode.string name )
                , ( "children", Encode.list encode children )
                ]

        Scale scaleName maybeTest implementations ->
            Encode.object
                [ ( "type", Encode.string "scale" )
                , ( "name", Encode.string scaleName )
                , ( "hasTest", Encode.bool (maybeTest /= Nothing) )
                , ( "implementations"
                  , Encode.list
                        (\{ name, size } ->
                            Encode.object
                                [ ( "name", Encode.string name )
                                , ( "size", Encode.int size )
                                ]
                        )
                        implementations
                  )
                ]
