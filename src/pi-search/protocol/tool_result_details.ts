import { Type, type Static } from "@sinclair/typebox";
import type { ValidateFunction } from "ajv";
import { piSearchAjv } from "./ajv";

const SearchToolResultDetailsSchema = Type.Object(
  {
    retrievedDocids: Type.Array(Type.String()),
  },
  { additionalProperties: true },
);

type SearchToolResultDetails = Static<typeof SearchToolResultDetailsSchema>;

const validateSearchToolResultDetails: ValidateFunction<SearchToolResultDetails> =
  piSearchAjv.compile<SearchToolResultDetails>(SearchToolResultDetailsSchema);

export function extractRetrievedDocidsFromPiSearchToolDetails(details: unknown): string[] {
  if (!validateSearchToolResultDetails(details)) {
    return [];
  }
  return details.retrievedDocids;
}
