// Hand-written types for the generated schemaValidator.js next to it.
export interface SchemaError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export declare const validate: {
  (data: unknown): boolean;
  errors?: SchemaError[] | null;
};
export default validate;
