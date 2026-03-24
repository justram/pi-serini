import type { Static, TSchema } from "@sinclair/typebox";
import type { ValidateFunction } from "ajv";
import { piSearchAjv } from "./ajv";
import { PiSearchInvalidToolResultError, PiSearchMalformedJsonError } from "./errors";
import {
  ReadDocumentPayloadSchema,
  RenderSearchResultsPayloadSchema,
  SearchPayloadSchema,
} from "./schemas";

function createProtocolParser<TSchemaType extends TSchema>(
  schema: TSchemaType,
): (text: string, label: string) => Static<TSchemaType> {
  const validate: ValidateFunction<Static<TSchemaType>> =
    piSearchAjv.compile<Static<TSchemaType>>(schema);

  return (text: string, label: string): Static<TSchemaType> => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      throw new PiSearchMalformedJsonError(label, text, error);
    }
    if (validate(value)) {
      return value as Static<TSchemaType>;
    }
    throw new PiSearchInvalidToolResultError(label, validate.errors);
  };
}

const parseSearchPayloadText = createProtocolParser(SearchPayloadSchema);
const parseRenderSearchResultsPayloadText = createProtocolParser(RenderSearchResultsPayloadSchema);
const parseReadDocumentPayloadText = createProtocolParser(ReadDocumentPayloadSchema);

export function parseSearchPayload(text: string) {
  return parseSearchPayloadText(text.trim(), "BM25 search response");
}

export function parseRenderSearchResultsPayload(text: string) {
  return parseRenderSearchResultsPayloadText(text.trim(), "BM25 render_search_results response");
}

export function parseReadDocumentPayload(text: string) {
  return parseReadDocumentPayloadText(text.trim(), "BM25 read_document response");
}
