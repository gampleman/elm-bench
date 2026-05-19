module NoDocComments exposing (rule)

{-| Remove doc comments from declarations and modules.
-}

import Elm.Syntax.Declaration as Declaration exposing (Declaration(..))
import Elm.Syntax.Node as Node exposing (Node(..))
import Review.Fix as Fix
import Review.Rule as Rule exposing (Rule)


rule : Rule
rule =
    Rule.newModuleRuleSchema "NoDocComments" ()
        |> Rule.withSimpleCommentsVisitor commentsVisitor
        |> Rule.withSimpleDeclarationVisitor declarationVisitor
        |> Rule.fromModuleRuleSchema


commentsVisitor : List (Node String) -> List (Rule.Error {})
commentsVisitor comments =
    List.filterMap
        (\(Node range comment) ->
            if String.startsWith "{-" comment then
                Just
                    (Rule.errorWithFix
                        { message = "Remove block comment"
                        , details = [ "Block comments are not needed in generated benchmark files." ]
                        }
                        range
                        [ Fix.removeRange range ]
                    )

            else
                Nothing
        )
        comments


declarationVisitor : Node Declaration -> List (Rule.Error {})
declarationVisitor (Node _ declaration) =
    case declaration of
        FunctionDeclaration function ->
            case function.documentation of
                Just (Node range _) ->
                    [ Rule.errorWithFix
                        { message = "Remove doc comment"
                        , details = [ "Doc comments are not needed in generated benchmark files." ]
                        }
                        range
                        [ Fix.removeRange range ]
                    ]

                Nothing ->
                    []

        AliasDeclaration typeAlias ->
            case typeAlias.documentation of
                Just (Node range _) ->
                    [ Rule.errorWithFix
                        { message = "Remove doc comment"
                        , details = [ "Doc comments are not needed in generated benchmark files." ]
                        }
                        range
                        [ Fix.removeRange range ]
                    ]

                Nothing ->
                    []

        CustomTypeDeclaration customType ->
            case customType.documentation of
                Just (Node range _) ->
                    [ Rule.errorWithFix
                        { message = "Remove doc comment"
                        , details = [ "Doc comments are not needed in generated benchmark files." ]
                        }
                        range
                        [ Fix.removeRange range ]
                    ]

                Nothing ->
                    []

        _ ->
            []
