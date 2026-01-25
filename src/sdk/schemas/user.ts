import { z } from "zod";

// ============ User Reservations Schema ============

/**
 * Party member in a reservation
 * Note: Guest party members (not the booker) may have null values
 */
export const PartyMemberSchema = z.object({
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    user: z.object({
        em_address: z.string(),
    }).nullable(),
});

/**
 * Venue info in reservation
 */
export const ReservationVenueSchema = z.object({
    id: z.number(),
    name: z.string().optional(),
});

/**
 * Share link info
 */
export const ShareSchema = z.object({
    link: z.string(),
});

/**
 * Cancellation info for a reservation
 */
export const ReservationCancellationSchema = z.object({
    date_refund_cut_off: z.string().nullable().optional(),
});

/**
 * A single reservation
 */
export const ReservationSchema = z.object({
    resy_token: z.string(),
    venue: ReservationVenueSchema,
    day: z.string(), // YYYY-MM-DD
    time_slot: z.string(), // e.g., "7:00 PM"
    num_seats: z.number(),
    party: z.array(PartyMemberSchema),
    share: ShareSchema,
    cancellation: ReservationCancellationSchema.nullable().optional(),
});

export type Reservation = z.infer<typeof ReservationSchema>;

/**
 * Venues dictionary in user reservations response
 */
export const VenuesMapSchema = z.record(z.string(), z.object({
    name: z.string(),
}));

/**
 * Pagination metadata for reservations response
 */
export const ReservationsMetadataSchema = z.object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
});

/**
 * Response from GET /3/user/reservations
 */
export const UserReservationsResponseSchema = z.object({
    reservations: z.array(ReservationSchema.passthrough()),
    venues: VenuesMapSchema,
    // NEW: Added from validation report
    metadata: ReservationsMetadataSchema.optional(),
});

export type UserReservationsResponse = z.infer<typeof UserReservationsResponseSchema>;

// ============ Cancel Reservation Schema ============

/**
 * Response from POST /3/cancel
 */
export const CancelResponseSchema = z.object({
    // Usually just returns success status
}).passthrough();

export type CancelResponse = z.infer<typeof CancelResponseSchema>;

/**
 * Request params for cancel endpoint
 */
export interface CancelParams {
    resy_token: string;
}

// ============ User Registration Schema ============

/**
 * Response from POST /2/user/registration
 */
export const UserRegistrationResponseSchema = z.object({
    user: z.object({
        token: z.string(),
        id: z.number().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        em_address: z.string().optional(),
    }),
});

export type UserRegistrationResponse = z.infer<typeof UserRegistrationResponseSchema>;

/**
 * Request params for registration
 */
export interface RegistrationParams {
    first_name: string;
    last_name: string;
    mobile_number: string; // e.g., "+12145557505"
    em_address: string;
    password: string;
    captcha_token: string;
    // Optional fields
    policies_accept?: number; // 1
    complete?: number; // 1
    device_type_id?: number; // 3 = web
    device_token?: string; // UUID
    marketing_opt_in?: number;
    isNonUS?: number;
}

// ============ Stripe Setup Intent Schema ============

/**
 * Response from POST /3/stripe/setup_intent
 */
export const StripeSetupIntentResponseSchema = z.object({
    client_secret: z.string(),
});

export type StripeSetupIntentResponse = z.infer<typeof StripeSetupIntentResponseSchema>;

/**
 * Response from POST /3/stripe/payment_method
 */
export const StripePaymentMethodResponseSchema = z.object({
    // Response structure TBD based on actual response
}).passthrough();

export type StripePaymentMethodResponse = z.infer<typeof StripePaymentMethodResponseSchema>;

export interface StripePaymentMethodParams {
    stripe_payment_method_id: string;
}
