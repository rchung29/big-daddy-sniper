import { z } from "zod";

/**
 * Response from GET /3/details
 * This endpoint returns the book_token needed to complete a reservation
 */
export const DetailsBookTokenSchema = z.object({
    value: z.string(),
    date_expires: z.string(), // ISO datetime
});

// Cancellation policy info
export const DetailsCancellationSchema = z.object({
    fee: z.object({
        amount: z.number().optional(),
        currency: z.string().optional(),
        display: z.unknown().optional(), // Can be string or object
    }).nullable().optional(),
    refund: z.object({
        date_cut_off: z.string().nullable(),
    }).nullable().optional(),
    other_fee: z.unknown().nullable().optional(),
    // NEW: Fields from validation report
    credit: z.object({
        date_cut_off: z.string().nullable(),
    }).optional(),
    display: z.object({
        policy: z.array(z.string()),
    }).optional(),
}).passthrough();

// Change policy info
export const DetailsChangeSchema = z.object({
    date_cut_off: z.string().nullable(),
});

// Config info
export const DetailsConfigSchema = z.object({
    add_ons: z.unknown().nullable(),
    double_confirmation: z.array(z.string()).nullable().optional(),
    // NEW: Fields from validation report
    features: z.unknown().nullable().optional(),
    menu_items: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).nullable().optional(),
    service_charge_options: z.unknown().nullable().optional(),
}).passthrough();

// Locale info
export const DetailsLocaleSchema = z.object({
    currency: z.string(),
});

// Payment amounts breakdown
export const DetailsPaymentAmountsSchema = z.object({
    items: z.array(z.record(z.string(), z.unknown())).optional(), // Changed to record to allow recursion
    reservation_charge: z.number().optional(),
    subtotal: z.number().optional(),
    add_ons: z.number().optional(),
    quantity: z.number().optional(),
    resy_fee: z.number().optional(),
    service_charge: z.unknown().nullable().optional(),
    tax: z.number().optional(),
    total: z.number().optional(),
    // NEW: Fields from validation report
    service_fee: z.number().optional(),
    surcharge: z.number().optional(),
    price_per_unit: z.number().optional(),
}).passthrough();

// Payment config
export const DetailsPaymentConfigSchema = z.object({
    type: z.string(),
}).passthrough();

// Payment display info
export const DetailsPaymentDisplaySchema = z.object({
    balance: z.object({
        value: z.string(),
        modifier: z.string(),
    }).optional(),
    buy: z.object({
        action: z.string(),
        after_modifier: z.string(),
        before_modifier: z.string(),
        init: z.string(),
        value: z.string(),
    }).optional(),
    description: z.array(z.string()).optional(),
}).passthrough();

// Payment option
export const DetailsPaymentOptionSchema = z.object({
    amounts: z.object({
        price_per_unit: z.number(),
        resy_fee: z.number(),
        service_fee: z.number(),
        service_charge: z.unknown().nullable(),
        tax: z.number(),
        total: z.number(),
    }).passthrough().optional(),
    cancellation_fee: z.number().nullable().optional(),
    deposit_fee: z.number().nullable().optional(),
    is_pay_by_invoice: z.boolean().optional(),
    requires_transaction: z.boolean().optional(),
    type: z.string().optional(),
}).passthrough();

// Full payment schema with new fields
export const DetailsPaymentSchema = z.object({
    cancellation: DetailsCancellationSchema.optional(),
    required: z.boolean().optional(),
    deposit: z.object({
        amount: z.number(),
        currency: z.string(),
        display: z.string(),
    }).nullable().optional(),
    // NEW: Fields from validation report
    amounts: DetailsPaymentAmountsSchema.optional(),
    comp: z.boolean().optional(),
    config: DetailsPaymentConfigSchema.optional(),
    display: DetailsPaymentDisplaySchema.optional(),
    options: z.array(DetailsPaymentOptionSchema).optional(),
});

// Venue location info
export const DetailsVenueLocationSchema = z.object({
    address_1: z.string().optional(),
    address_2: z.string().nullable().optional(),
    code: z.string().optional(),
    country: z.string().optional(),
    cross_street_1: z.string().optional(),
    cross_street_2: z.string().nullable().optional(),
    id: z.number().optional(),
    latitude: z.number().optional(),
    locality: z.string().optional(),
    longitude: z.number().optional(),
    neighborhood: z.string().optional(),
    postal_code: z.string().optional(),
    region: z.string().optional(),
}).passthrough();

// Venue contact info
export const DetailsVenueContactSchema = z.object({
    phone_number: z.string().optional(),
}).passthrough();

// Venue rater info
export const DetailsVenueRaterSchema = z.object({
    name: z.string().optional(),
    scale: z.number().optional(),
    score: z.number().optional(),
    total: z.number().optional(),
}).passthrough();

// Venue source info
export const DetailsVenueSourceSchema = z.object({
    name: z.string().nullable().optional(),
    logo: z.string().nullable().optional(),
    terms_of_service: z.string().nullable().optional(),
    privacy_policy: z.string().nullable().optional(),
}).passthrough();

// Venue content info
export const DetailsVenueContentSchema = z.object({
    attribution: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    display: z.object({
        type: z.string().optional(),
    }).optional(),
    icon: z.object({
        url: z.string().nullable().optional(),
    }).nullable().optional(),
    locale: z.object({
        language: z.string().optional(),
    }).nullable().optional(),
    name: z.string().optional(),
    title: z.string().nullable().optional(),
    enhanced_body: z.string().nullable().optional(),
}).passthrough();

// Venue info in details response  
export const DetailsVenueSchema = z.object({
    config: z.object({
        allow_bypass_payment_method: z.number(),
        allow_multiple_resys: z.number().optional(),
        enable_invite: z.number().optional(),
        // NEW: Fields from validation report
        enable_resypay: z.number().optional(),
        hospitality_included: z.number().optional(),
    }).passthrough().optional(),
    content: z.array(DetailsVenueContentSchema).optional(),
    images: z.array(z.string()).optional(),
    name: z.string().optional(),
    // NEW: Fields from validation report
    location: DetailsVenueLocationSchema.optional(),
    contact: DetailsVenueContactSchema.optional(),
    rater: z.array(DetailsVenueRaterSchema).optional(),
    source: DetailsVenueSourceSchema.optional(),
}).passthrough();

// Viewers count
export const DetailsViewersSchema = z.object({
    total: z.number(),
});

// User schema with all fields optional
export const DetailsUserSchema = z.object({
    em_address: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    mobile_number: z.string().optional(),
    payment_methods: z.array(z.object({
        id: z.number(),
        is_default: z.boolean().optional(),
        display: z.string().optional(),
        type: z.string().optional(),
    })).nullable().optional(),
});

export const DetailsResponseSchema = z.object({
    book_token: DetailsBookTokenSchema,
    payment: DetailsPaymentSchema.optional(),
    user: DetailsUserSchema.optional(),
    // NEW: Fields from validation report
    cancellation: DetailsCancellationSchema.optional(),
    change: DetailsChangeSchema.optional(),
    config: DetailsConfigSchema.optional(),
    locale: DetailsLocaleSchema.optional(),
    venue: DetailsVenueSchema.optional(),
    viewers: DetailsViewersSchema.optional(),
});

export type DetailsResponse = z.infer<typeof DetailsResponseSchema>;

/**
 * Request params for details endpoint
 * Note: Uses x-resy-auth-token as query param to bypass CAPTCHA
 */
export interface DetailsParams {
    day: string; // YYYY-MM-DD
    party_size: number;
    venue_id: number | string;
    config_id: string; // The config.token from find endpoint
}
