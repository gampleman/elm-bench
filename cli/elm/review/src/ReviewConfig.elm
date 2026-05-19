module ReviewConfig exposing (config)

import NoDocComments
import NoUnused.CustomTypeConstructorArgs
import NoUnused.CustomTypeConstructors
import NoUnused.Parameters
import NoUnused.Patterns
import NoUnused.Variables
import Review.Rule exposing (Rule)


config : List Rule
config =
    [ NoDocComments.rule
    , NoUnused.Variables.rule
    , NoUnused.Parameters.rule
    , NoUnused.Patterns.rule
    , NoUnused.CustomTypeConstructors.rule []
    , NoUnused.CustomTypeConstructorArgs.rule
    ]
