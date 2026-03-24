import type { ErrorObject } from "ajv";

function formatValidationErrors(errors: ErrorObject[] | null | undefined): string {
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

function formatDetail(detail: string | ErrorObject[] | null | undefined): string {
  if (typeof detail === "string") {
    return detail;
  }
  return formatValidationErrors(detail);
}

export class PiSearchProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiSearchProtocolValidationError";
  }
}

export class PiSearchMalformedJsonError extends PiSearchProtocolValidationError {
  constructor(label: string, text: string, cause: unknown) {
    super(`Failed to parse ${label}: ${text}\n${String(cause)}`);
    this.name = "PiSearchMalformedJsonError";
  }
}

export class PiSearchInvalidToolArgumentsError extends PiSearchProtocolValidationError {
  constructor(label: string, detail: string | ErrorObject[] | null | undefined) {
    super(`Invalid ${label}: ${formatDetail(detail)}`);
    this.name = "PiSearchInvalidToolArgumentsError";
  }
}

export class PiSearchInvalidToolResultError extends PiSearchProtocolValidationError {
  constructor(label: string, detail: string | ErrorObject[] | null | undefined) {
    super(`Invalid ${label}: ${formatDetail(detail)}`);
    this.name = "PiSearchInvalidToolResultError";
  }
}

export class PiSearchToolExecutionError extends PiSearchProtocolValidationError {
  constructor(toolName: string, detail: string) {
    super(`${toolName} failed: ${detail}`);
    this.name = "PiSearchToolExecutionError";
  }
}
