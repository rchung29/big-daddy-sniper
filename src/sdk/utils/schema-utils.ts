import { z } from "zod";

/**
 * Parse data with a schema and log any unknown fields (like Pydantic's extra="allow")
 * This helps discover undocumented API fields that should be added to schemas
 */
export function parseWithUnknownFieldDetection<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    data: unknown,
    context?: string
): z.infer<T> {
    // Use passthrough to allow extra fields through
    const passthroughSchema = schema.passthrough();
    const result = passthroughSchema.parse(data);

    // Detect unknown fields
    if (typeof data === "object" && data !== null) {
        const knownKeys = new Set(Object.keys(schema.shape));
        const dataKeys = Object.keys(data);
        const unknownKeys = dataKeys.filter((key) => !knownKeys.has(key));

        if (unknownKeys.length > 0) {
            console.warn(
                `[resy-sdk]${context ? ` ${context}:` : ""} Unknown fields detected:`,
                unknownKeys.map((key) => ({
                    key,
                    value: (data as Record<string, unknown>)[key],
                }))
            );
        }
    }

    return result as z.infer<T>;
}

/**
 * Create a "strict mode" parser that throws on unknown fields
 */
export function parseStrict<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    data: unknown
): z.infer<T> {
    return schema.strict().parse(data) as z.infer<T>;
}

/**
 * Helper to compare schemas against actual data and report differences
 */
export function analyzeSchemaCompleteness<T extends z.ZodObject<z.ZodRawShape>>(
    schema: T,
    data: unknown
): {
    knownFields: string[];
    unknownFields: string[];
    missingFields: string[];
} {
    const schemaKeys = new Set(Object.keys(schema.shape));
    const dataKeys = new Set(
        typeof data === "object" && data !== null ? Object.keys(data) : []
    );

    const knownFields = [...schemaKeys].filter((k) => dataKeys.has(k));
    const unknownFields = [...dataKeys].filter((k) => !schemaKeys.has(k));
    const missingFields = [...schemaKeys].filter((k) => !dataKeys.has(k));

    return { knownFields, unknownFields, missingFields };
}
