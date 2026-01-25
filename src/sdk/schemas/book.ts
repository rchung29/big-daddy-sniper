import { z } from "zod";

/**
 * Response from POST /3/book
 * The actual reservation confirmation
 */
export const BookResponseSchema = z.object({
    reservation_id: z.number(),
    resy_token: z.string(),
});

export type BookResponse = z.infer<typeof BookResponseSchema>;

/**
 * Extended book response that may include additional details
 */
export const BookResponseExtendedSchema = z.object({
    reservation_id: z.number().optional(),
    resy_token: z.string().optional(),
    specs: z.object({
        reservation_id: z.number(),
        resy_token: z.string(),
    }).optional(),
});

export type BookResponseExtended = z.infer<typeof BookResponseExtendedSchema>;

/**
 * Request body for booking endpoint
 */
export interface BookParams {
    book_token: string;
    payment_method_id: number;
    source_id?: string; // e.g., "resy.com-venue-details"
}

/**
 * Struct for payment method (as JSON string in request)
 */
export interface StructPaymentMethod {
    id: number;
}
