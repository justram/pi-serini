import Ajv from "ajv";

export const piSearchAjv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
