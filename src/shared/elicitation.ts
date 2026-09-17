// MCP form elicitations use an object of primitive fields, not tool/user-input questions.
export type ElicitationField = {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  enumNames?: string[];
  oneOf?: { const: string; title?: string }[];
  anyOf?: { const: string; title?: string }[];
  items?: ElicitationField;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  format?: string;
};
export type ElicitationSchema = {
  type: string;
  properties: Record<string, ElicitationField>;
  required?: string[];
};
export function elicitationOptions(field?: ElicitationField) {
  if (!field) return undefined;
  return (
    field.oneOf ||
    field.anyOf ||
    field.enum?.map((value, i) => ({
      const: value,
      title: field.enumNames?.[i] || value,
    }))
  );
}
export function elicitationContent(schema: ElicitationSchema, input: unknown) {
  if (
    schema?.type !== "object" ||
    !schema.properties ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  )
    throw new Error(
      "This permission form is not supported. Open it in the host agent interface.",
    );
  const values = input as Record<string, unknown>;
  const content: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(schema.properties)) {
    const value = values[name];
    if (value === undefined) {
      if (schema.required?.includes(name))
        throw new Error(`Complete ${field.title || name}.`);
      continue;
    }
    let valid = false;
    if (field.type === "string" && typeof value === "string") {
      const options = elicitationOptions(field);
      valid =
        (!options || options.some((o) => o.const === value)) &&
        value.length >= (field.minLength ?? 0) &&
        value.length <= (field.maxLength ?? Infinity);
    } else if (
      (field.type === "number" || field.type === "integer") &&
      typeof value === "number"
    ) {
      valid =
        Number.isFinite(value) &&
        (field.type !== "integer" || Number.isInteger(value)) &&
        value >= (field.minimum ?? -Infinity) &&
        value <= (field.maximum ?? Infinity);
    } else if (field.type === "boolean") valid = typeof value === "boolean";
    else if (field.type === "array" && Array.isArray(value)) {
      const options = field.items && elicitationOptions(field.items);
      valid =
        Boolean(options) &&
        value.every((v) => options!.some((o) => o.const === v)) &&
        new Set(value).size === value.length &&
        value.length >= (field.minItems ?? 0) &&
        value.length <= (field.maxItems ?? Infinity);
    }
    if (!valid) throw new Error(`Check ${field.title || name}.`);
    content[name] = value;
  }
  return content;
}
