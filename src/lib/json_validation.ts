import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { Static, TSchema } from "@sinclair/typebox";

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});

function formatJsonValidationError(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) {
    return "schema validation failed without detailed errors.";
  }
  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      return `${path} ${error.message ?? "is invalid"}`.trim();
    })
    .join("; ");
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${text}\n${String(error)}`);
  }
}

export type JsonValidator<T> = {
  validate: (value: unknown, label: string) => T;
  parse: (text: string, label: string) => T;
};

export function createJsonValidator<TSchemaType extends TSchema>(
  schema: TSchemaType,
): JsonValidator<Static<TSchemaType>> {
  const validateFn: ValidateFunction<Static<TSchemaType>> =
    ajv.compile<Static<TSchemaType>>(schema);

  const validate = (value: unknown, label: string): Static<TSchemaType> => {
    if (validateFn(value)) {
      return value as Static<TSchemaType>;
    }
    throw new Error(`Invalid ${label}: ${formatJsonValidationError(validateFn.errors)}`);
  };

  return {
    validate,
    parse(text: string, label: string): Static<TSchemaType> {
      return validate(parseJsonText(text, label), label);
    },
  };
}
