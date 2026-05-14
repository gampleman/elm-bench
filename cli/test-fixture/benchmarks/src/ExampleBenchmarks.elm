module ExampleBenchmarks exposing (suite)

import Bench exposing (Benchmark)


suite : Benchmark
suite =
    Bench.describe "List operations"
        [ Bench.benchmark "List.map" <|
            \_ -> List.map (\x -> x + 1) (List.range 1 100)
        , Bench.rank "reversing"
            (\reverse -> reverse (List.range 1 100))
            [ ( "List.reverse", List.reverse )
            , ( "List.foldl (::)", List.foldl (::) [] )
            ]
        , Bench.series "sorting approaches"
            [ ( "List.sort", \_ -> List.sort (List.range 100 1) )
            , ( "List.sortBy identity", \_ -> List.sortBy identity (List.range 100 1) )
            , ( "List.sortWith compare", \_ -> List.sortWith Basics.compare (List.range 100 1) )
            ]
        ]
