import {
  elicitationOptions,
  type ElicitationSchema,
} from "../shared/elicitation";

export function ElicitationFields({
  schema,
  values,
  onChange,
}: {
  schema: ElicitationSchema;
  values: Record<string, any>;
  onChange: (name: string, value: unknown) => void;
}) {
  return Object.entries(schema.properties || {}).map(([name, field]) => {
    const options = elicitationOptions(
      field.type === "array" ? field.items : field,
    );
    const required = schema.required?.includes(name);
    const value = values[name];
    return (
      <label key={name}>
        {field.title || name}
        {required ? " *" : ""}
        {field.description && <small>{field.description}</small>}
        {options ? (
          <select
            multiple={field.type === "array"}
            required={required}
            value={value ?? (field.type === "array" ? [] : "")}
            onChange={(e) =>
              onChange(
                name,
                field.type === "array"
                  ? Array.from(e.target.selectedOptions, (o) => o.value)
                  : e.target.value,
              )
            }
          >
            {field.type !== "array" && <option value="">Choose…</option>}
            {options.map((o) => (
              <option key={o.const} value={o.const}>
                {o.title || o.const}
              </option>
            ))}
          </select>
        ) : field.type === "boolean" ? (
          <select
            required={required}
            value={value === undefined ? "" : String(value)}
            onChange={(e) =>
              onChange(
                name,
                e.target.value === "" ? undefined : e.target.value === "true",
              )
            }
          >
            <option value="">Choose…</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : ["string", "number", "integer"].includes(field.type) ? (
          <input
            required={required}
            type={
              field.type === "string"
                ? {
                    email: "email",
                    uri: "url",
                    date: "date",
                    "date-time": "datetime-local",
                  }[field.format || ""] || "text"
                : "number"
            }
            step={field.type === "integer" ? 1 : "any"}
            min={field.minimum}
            max={field.maximum}
            minLength={field.minLength}
            maxLength={field.maxLength}
            value={value ?? ""}
            onChange={(e) =>
              onChange(
                name,
                e.target.value === ""
                  ? undefined
                  : field.type === "string"
                    ? e.target.value
                    : Number(e.target.value),
              )
            }
          />
        ) : (
          <span>Open this form in the host agent interface.</span>
        )}
      </label>
    );
  });
}
