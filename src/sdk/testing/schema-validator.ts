import { z } from "zod";

export interface FieldDiscrepancy {
    path: string;
    type: "unknown" | "missing" | "type_mismatch";
    actual?: unknown;
    expected?: string;
}

export interface SchemaValidationResult {
    success: boolean;
    endpoint: string;
    timestamp: string;
    data: unknown;
    parsed?: unknown;
    zodErrors?: string[];
    discrepancies: FieldDiscrepancy[];
    report: string;
}

/**
 * Deep analyze an object against a Zod schema to find all discrepancies
 */
export function validateSchemaDeep<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    data: unknown,
    endpoint: string,
    path = ""
): SchemaValidationResult {
    const timestamp = new Date().toISOString();
    const discrepancies: FieldDiscrepancy[] = [];
    const zodErrors: string[] = [];

    // Try to parse with passthrough to allow unknown fields
    let parsed: unknown;

    try {
        // First, try strict parsing to catch errors
        const strictResult = schema.safeParse(data);
        if (!strictResult.success) {
            // Zod 4 uses .issues instead of .errors
            for (const issue of strictResult.error.issues) {
                zodErrors.push(`${issue.path.join(".")}: ${issue.message}`);
            }
        }

        // Parse with passthrough for the actual data
        parsed = schema.passthrough().parse(data);
    } catch (e) {
        if (e instanceof z.ZodError) {
            for (const issue of e.issues) {
                zodErrors.push(`${issue.path.join(".")}: ${issue.message}`);
            }
        } else {
            throw e;
        }
    }

    // Find unknown fields recursively
    if (typeof data === "object" && data !== null) {
        findUnknownFields(schema, data as Record<string, unknown>, path, discrepancies);
    }

    // Generate human-readable report
    const report = generateReport(endpoint, discrepancies, zodErrors);

    return {
        success: discrepancies.length === 0 && zodErrors.length === 0,
        endpoint,
        timestamp,
        data,
        parsed,
        zodErrors: zodErrors.length > 0 ? zodErrors : undefined,
        discrepancies,
        report,
    };
}

function findUnknownFields(
    schema: z.ZodObject<z.ZodRawShape>,
    data: Record<string, unknown>,
    basePath: string,
    discrepancies: FieldDiscrepancy[]
): void {
    const schemaKeys = new Set(Object.keys(schema.shape));

    for (const key of Object.keys(data)) {
        const fullPath = basePath ? `${basePath}.${key}` : key;

        if (!schemaKeys.has(key)) {
            discrepancies.push({
                path: fullPath,
                type: "unknown",
                actual: data[key],
            });
        } else {
            // Recurse into nested objects
            const fieldSchema = schema.shape[key];
            const fieldValue = data[key];

            if (fieldValue !== null && typeof fieldValue === "object" && fieldSchema) {
                const unwrapped = unwrapSchema(fieldSchema as z.ZodTypeAny);

                if (unwrapped instanceof z.ZodObject) {
                    findUnknownFields(
                        unwrapped as z.ZodObject<z.ZodRawShape>,
                        fieldValue as Record<string, unknown>,
                        fullPath,
                        discrepancies
                    );
                } else if (unwrapped instanceof z.ZodArray) {
                    // Get array element type - use type property in Zod 4
                    const elementSchema = (unwrapped as z.ZodArray<z.ZodTypeAny>).element;
                    if (Array.isArray(fieldValue) && elementSchema instanceof z.ZodObject) {
                        fieldValue.forEach((item, index) => {
                            if (typeof item === "object" && item !== null) {
                                findUnknownFields(
                                    elementSchema as z.ZodObject<z.ZodRawShape>,
                                    item as Record<string, unknown>,
                                    `${fullPath}[${index}]`,
                                    discrepancies
                                );
                            }
                        });
                    }
                }
            }
        }
    }

    // Check for missing required fields
    for (const key of schemaKeys) {
        const fullPath = basePath ? `${basePath}.${key}` : key;
        if (!(key in data)) {
            const fieldSchema = schema.shape[key];
            // Only report if not optional
            if (fieldSchema && !isOptional(fieldSchema as z.ZodTypeAny)) {
                discrepancies.push({
                    path: fullPath,
                    type: "missing",
                    expected: "required field",
                });
            }
        }
    }
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
        // Zod 4: use .unwrap() method
        return unwrapSchema(schema.unwrap() as z.ZodTypeAny);
    }
    return schema;
}

function isOptional(schema: z.ZodTypeAny): boolean {
    return schema instanceof z.ZodOptional || schema instanceof z.ZodNullable;
}

function generateReport(
    endpoint: string,
    discrepancies: FieldDiscrepancy[],
    zodErrors: string[]
): string {
    const lines: string[] = [];
    lines.push(`\n${"=".repeat(60)}`);
    lines.push(`SCHEMA VALIDATION REPORT: ${endpoint}`);
    lines.push(`${"=".repeat(60)}\n`);

    if (discrepancies.length === 0 && zodErrors.length === 0) {
        lines.push("✅ Schema matches API response perfectly!\n");
        return lines.join("\n");
    }

    // Unknown fields (fields in API but not in schema)
    const unknownFields = discrepancies.filter((d) => d.type === "unknown");
    if (unknownFields.length > 0) {
        lines.push(`\n🔍 UNKNOWN FIELDS (${unknownFields.length}) - Add these to schema:`);
        lines.push("-".repeat(50));
        for (const field of unknownFields) {
            const valueType = getValueType(field.actual);
            const sampleValue = getSampleValue(field.actual);
            lines.push(`  ${field.path}: ${valueType}`);
            lines.push(`    Sample: ${sampleValue}`);
        }
    }

    // Missing fields (fields in schema but not in API)
    const missingFields = discrepancies.filter((d) => d.type === "missing");
    if (missingFields.length > 0) {
        lines.push(`\n⚠️  MISSING FIELDS (${missingFields.length}) - Make these optional:`);
        lines.push("-".repeat(50));
        for (const field of missingFields) {
            lines.push(`  ${field.path}: expected ${field.expected}`);
        }
    }

    // Zod validation errors
    if (zodErrors.length > 0) {
        lines.push(`\n❌ VALIDATION ERRORS (${zodErrors.length}):`);
        lines.push("-".repeat(50));
        for (const error of zodErrors) {
            lines.push(`  ${error}`);
        }
    }

    // Generate Zod schema suggestions for unknown fields
    if (unknownFields.length > 0) {
        lines.push(`\n📝 SUGGESTED ZOD ADDITIONS:`);
        lines.push("-".repeat(50));
        lines.push("```typescript");
        for (const field of unknownFields) {
            const zodType = inferZodType(field.actual);
            const fieldName = field.path.split(".").pop() || field.path;
            lines.push(`  ${fieldName}: ${zodType},`);
        }
        lines.push("```");
    }

    lines.push(`\n${"=".repeat(60)}\n`);
    return lines.join("\n");
}

function getValueType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) {
        if (value.length === 0) return "array (empty)";
        return `array<${getValueType(value[0])}>`;
    }
    if (typeof value === "object") return "object";
    return typeof value;
}

function getSampleValue(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") {
        return value.length > 50 ? `"${value.slice(0, 50)}..."` : `"${value}"`;
    }
    if (typeof value === "object") {
        const str = JSON.stringify(value);
        return str.length > 80 ? `${str.slice(0, 80)}...` : str;
    }
    return String(value);
}

function inferZodType(value: unknown): string {
    if (value === null) return "z.null()";
    if (value === undefined) return "z.undefined()";
    if (typeof value === "string") return "z.string()";
    if (typeof value === "number") return "z.number()";
    if (typeof value === "boolean") return "z.boolean()";
    if (Array.isArray(value)) {
        if (value.length === 0) return "z.array(z.unknown())";
        return `z.array(${inferZodType(value[0])})`;
    }
    if (typeof value === "object") return "z.object({...}).passthrough()";
    return "z.unknown()";
}
