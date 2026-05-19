port module Benchmark.Runner.Node exposing (Model, Msg, run, runBench)

import Bench
import Benchmark exposing (Benchmark)
import Benchmark.Reporting as Reporting exposing (Report(..))
import Benchmark.Status as Status exposing (Status(..))
import Json.Decode as Decode
import Json.Encode as Encode
import Process
import Random
import Task
import Trend.Linear as Trend exposing (Quick, Trend)


type alias Model =
    { benchmark : Benchmark
    }


type Msg
    = Step Benchmark


{-| Run a Bench.Benchmark with optional filtering from flags.
-}
runBench : Bench.Benchmark -> Program Encode.Value Model Msg
runBench bench =
    Platform.worker
        { init = initBench bench
        , update = update
        , subscriptions = always Sub.none
        }


{-| Run a raw elm-explorations/benchmark Benchmark directly.
-}
run : Benchmark -> Program Encode.Value Model Msg
run benchmark =
    Platform.worker
        { init = \flags -> ( { benchmark = benchmark }, stepNext benchmark )
        , update = update
        , subscriptions = always Sub.none
        }


initBench : Bench.Benchmark -> Encode.Value -> ( Model, Cmd Msg )
initBench bench flags =
    let
        filterPattern =
            flags
                |> Decode.decodeValue (Decode.field "filter" (Decode.nullable Decode.string))
                |> Result.withDefault Nothing

        seed =
            flags
                |> Decode.decodeValue (Decode.field "seed" Decode.int)
                |> Result.withDefault 42
                |> Random.initialSeed

        filtered =
            case filterPattern of
                Just pattern ->
                    Bench.filter pattern bench

                Nothing ->
                    Just bench
    in
    case filtered of
        Nothing ->
            ( { benchmark = Bench.toInternalBenchmark seed bench }
            , reportError
                (Encode.object
                    [ ( "type", Encode.string "no-match" )
                    , ( "filter", Encode.string (filterPattern |> Maybe.withDefault "") )
                    ]
                )
            )

        Just filteredBench ->
            let
                benchmark =
                    Bench.toInternalBenchmark seed filteredBench
            in
            ( { benchmark = benchmark }
            , Cmd.batch
                [ reportStructure (Bench.encode filteredBench)
                , stepNext benchmark
                ]
            )


update : Msg -> Model -> ( Model, Cmd Msg )
update (Step b) model =
    if Benchmark.done b then
        ( { model | benchmark = b }
        , reportResult (encodeReport (Reporting.fromBenchmark b))
        )

    else
        ( { model | benchmark = b }
        , Cmd.batch
            [ reportProgress (encodeProgress b)
            , stepNext b
            ]
        )


stepNext : Benchmark -> Cmd Msg
stepNext benchmark =
    Process.sleep 0
        |> Task.andThen (\_ -> Benchmark.step benchmark)
        |> Task.perform Step



-- PORTS


port reportProgress : Encode.Value -> Cmd msg


port reportResult : Encode.Value -> Cmd msg


port reportError : Encode.Value -> Cmd msg


port reportStructure : Encode.Value -> Cmd msg



-- ENCODING


encodeProgress : Benchmark -> Encode.Value
encodeProgress benchmark =
    let
        report =
            Reporting.fromBenchmark benchmark
    in
    Encode.object
        [ ( "type", Encode.string "progress" )
        , ( "data", encodeReportProgress report )
        ]


encodeReportProgress : Report -> Encode.Value
encodeReportProgress report =
    case report of
        Single name status ->
            Encode.object
                [ ( "name", Encode.string name )
                , ( "progress", Encode.float (Status.progress status) )
                ]

        Series name entries ->
            Encode.object
                [ ( "name", Encode.string name )
                , ( "entries"
                  , entries
                        |> List.map
                            (\( entryName, status ) ->
                                Encode.object
                                    [ ( "name", Encode.string entryName )
                                    , ( "progress", Encode.float (Status.progress status) )
                                    ]
                            )
                        |> Encode.list identity
                  )
                ]

        Group name reports ->
            Encode.object
                [ ( "name", Encode.string name )
                , ( "children", Encode.list encodeReportProgress reports )
                ]


encodeReport : Report -> Encode.Value
encodeReport report =
    Encode.object
        [ ( "type", Encode.string "result" )
        , ( "data", encodeReportData report )
        ]


encodeReportData : Report -> Encode.Value
encodeReportData report =
    case report of
        Single name status ->
            Encode.object
                [ ( "kind", Encode.string "single" )
                , ( "name", Encode.string name )
                , ( "status", encodeStatus status )
                ]

        Series name entries ->
            Encode.object
                [ ( "kind", Encode.string "series" )
                , ( "name", Encode.string name )
                , ( "entries"
                  , entries
                        |> List.map
                            (\( entryName, status ) ->
                                Encode.object
                                    [ ( "name", Encode.string entryName )
                                    , ( "status", encodeStatus status )
                                    ]
                            )
                        |> Encode.list identity
                  )
                ]

        Group name reports ->
            Encode.object
                [ ( "kind", Encode.string "group" )
                , ( "name", Encode.string name )
                , ( "children", Encode.list encodeReportData reports )
                ]


encodeStatus : Status -> Encode.Value
encodeStatus status =
    case status of
        Success _ trend ->
            let
                slope =
                    (Trend.line trend).slope

                runsPerSecond =
                    if slope > 0 then
                        1000 / slope

                    else
                        0
            in
            Encode.object
                [ ( "status", Encode.string "success" )
                , ( "runsPerSecond", Encode.float runsPerSecond )
                , ( "goodnessOfFit", Encode.float (Trend.goodnessOfFit trend) )
                ]

        Failure _ ->
            Encode.object
                [ ( "status", Encode.string "failure" )
                , ( "error", Encode.string "Benchmark failed" )
                ]

        _ ->
            Encode.object
                [ ( "status", Encode.string "running" )
                , ( "progress", Encode.float (Status.progress status) )
                ]
