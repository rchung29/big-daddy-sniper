import { z } from "zod";

// ============ Helper Schemas ============

// Slot config
export const SlotConfigSchema = z.object({
    id: z.number().optional(),
    type: z.string(),
    token: z.string(),
    custom_config_name: z.string().nullable().optional(),
    is_visible: z.boolean().optional(),
}).passthrough();

// Slot date
export const SlotDateSchema = z.object({
    start: z.string(),
    end: z.string(),
}).passthrough();

// Slot payment
export const SlotPaymentSchema = z.object({
    is_paid: z.boolean().optional(),
    cancellation_fee: z.number().nullable().optional(),
    deposit_fee: z.number().nullable().optional(),
    service_charge: z.unknown().nullable().optional(), // Often percentage string or object
    venue_share: z.number().nullable().optional(),
    payment_structure: z.number().nullable().optional(),
    secs_cancel_cut_off: z.number().nullable().optional(),
    time_cancel_cut_off: z.unknown().nullable().optional(),
    secs_change_cut_off: z.number().nullable().optional(),
    time_change_cut_off: z.unknown().nullable().optional(),
    service_charge_options: z.array(z.unknown()).optional(),
}).passthrough();

// Full Slot schema
export const FindSlotSchema = z.object({
    availability: z.object({ id: z.number() }).passthrough(),
    config: SlotConfigSchema,
    date: SlotDateSchema,
    exclusive: z.object({ id: z.number().optional(), is_eligible: z.boolean().optional() }).passthrough().optional(),
    floorplan: z.object({ id: z.number().optional() }).passthrough().optional(),
    market: z.object({ date: z.object({ off: z.number(), on: z.number() }) }).passthrough().optional(),
    meta: z.object({
        size: z.object({ assumed: z.number().optional() }).passthrough(),
        type: z.object({ id: z.number().optional() }).passthrough().optional(),
    }).passthrough().optional(),
    payment: SlotPaymentSchema,
    shift: z.object({
        id: z.number().optional(),
        day: z.string().optional(),
        service: z.object({ type: z.object({ id: z.number().optional() }).passthrough() }).passthrough().optional(),
    }).passthrough().optional(),
    size: z.object({ min: z.number(), max: z.number() }).passthrough(),
    status: z.object({ id: z.number() }).passthrough(),
    table: z.object({ id: z.array(z.number()) }).passthrough().optional(),
    template: z.object({ id: z.number().nullable() }).passthrough(),
    time: z.object({ turn: z.object({ actual: z.number(), estimated: z.number() }) }).passthrough().optional(),
    quantity: z.number().optional(),
    display_config: z.object({
        color: z.object({ background: z.string().nullable(), font: z.string().nullable() }).passthrough(),
    }).passthrough().optional(),
    reservation_config: z.object({ badge: z.string().nullable() }).passthrough().optional(),
    gdc_perk: z.unknown().nullable().optional(),
    has_add_ons: z.boolean().optional(),

    // Additional fields from validation
    custom_config: z.object({
        object_id: z.unknown().nullable(),
        name: z.string().nullable(),
    }).passthrough().optional(),
    is_global_dining_access: z.boolean().optional(),
    id: z.unknown().nullable().optional(),
    lock: z.unknown().nullable().optional(),
    pacing: z.object({ beyond: z.boolean().optional() }).passthrough().optional(),
    score: z.object({ total: z.number().optional() }).passthrough().optional(),
}).passthrough();

// Template turn times
export const TemplateTurnTimeSchema = z.object({
    secs_amount: z.number(),
    size: z.object({ min: z.number(), max: z.number().nullable() }),
}).passthrough();

// Venue content info
export const VenueContentSchema = z.object({
    title: z.string().nullable().optional(),
    body: z.string().optional(),
    icon: z.object({
        url: z.string().optional(),
    }).passthrough().optional(),
    display: z.object({
        type: z.string().optional(),
    }).passthrough().optional(),
    locale: z.object({
        language: z.string().optional(),
    }).passthrough().optional(),
    name: z.string().optional(),
    attribution: z.object({
        name: z.string().optional(),
        image: z.string().optional(),
    }).passthrough().nullable().optional(),
    object_id: z.unknown().nullable().optional(),
}).passthrough();

// Template schema
export const FindTemplateSchema = z.object({
    id: z.number(),
    name: z.string(),
    images: z.array(z.string()).nullable().optional(),
    content: z.record(z.string(), z.unknown()).optional(), // Often has 'en-us' key
    turn_times: z.array(TemplateTurnTimeSchema).optional(),
    is_paid: z.boolean().optional(),
    is_default: z.number().optional(),
    is_event: z.number().optional(),
    is_pickup: z.number().optional(),
    venue_id: z.number().optional(),
    reservation_config: z.object({ type: z.string() }).passthrough().optional(),
    display_config: z.object({
        color: z.object({ background: z.string().nullable(), font: z.string().nullable() }).passthrough(),
    }).passthrough().optional(),
}).passthrough();

// Service Type Schema (e.g. Dinner, Lunch)
export const ServiceTypeSchema = z.object({
    // Often empty in samples, but lets allow recursing
}).passthrough();

// Venue collection schema
export const VenueCollectionSchema = z.object({
    id: z.number(),
    name: z.string(),
    collection_slug: z.string(),
    type_id: z.number().optional(),
    file_name: z.string().optional(),
    image: z.string().optional(),
    short_name: z.string().optional(),
    description: z.string().optional(),
}).passthrough();

// Notify options
export const VenueNotifyOptionSchema = z.object({
    service_type_id: z.number(),
    min_request_datetime: z.string(),
    max_request_datetime: z.string(),
    step_minutes: z.number(),
});

// Venue reopen info
export const VenueReopenSchema = z.object({
    date: z.string().nullable(),
});

// Pickups info
export const VenuePickupsSchema = z.object({
    slots: z.array(FindSlotSchema).optional(),
    service_types: z.record(z.string(), ServiceTypeSchema).optional(),
});

export const FindVenueSchema = z.object({
    id: z.object({
        resy: z.number(),
    }),
    venue_group: z.object({
        id: z.number(),
        name: z.string(),
        venues: z.array(z.number()),
    }).nullable().optional(),

    name: z.string(),
    type: z.string().optional(),
    url_slug: z.string(),

    rating: z.number().optional(),
    total_ratings: z.number().optional(),

    location: z.object({
        code: z.string(),
        name: z.string().optional(),
        url_slug: z.string().optional(),
        country: z.string().optional(),
        geo: z.object({
            lat: z.number(),
            lon: z.number(),
        }),
        locality: z.string().optional(),
        neighborhood: z.string().optional(),
        postal_code: z.string().optional(),
        region: z.string().optional(),
        time_zone: z.string().optional(),
        address_1: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
    }).passthrough(),

    feature_recaptcha: z.boolean().optional(),
    gda_concierge_booking: z.boolean().optional(),
    hide_allergy_question: z.boolean().optional(),
    hide_occasion_question: z.boolean().optional(),
    hide_special_request_question: z.boolean().optional(),
    hospitality_included: z.number().optional(),
    is_gdc: z.number().optional(),
    is_global_dining_access: z.boolean().optional(),
    is_global_dining_access_only: z.boolean().optional(),
    is_gns: z.number().optional(),
    is_rga: z.boolean().optional(),
    is_rga_only: z.boolean().optional(),
    requires_reservation_transfers: z.number().optional(),
    resy_select: z.number().optional(),
    tax_included: z.boolean().optional(),
    transaction_processor: z.string().optional(),
    currency_symbol: z.string().optional(),
    price_range: z.number().optional(),
    average_bill_size: z.number().optional(),
    top: z.boolean().optional(),
    favorite: z.boolean().nullable().optional(),
    supports_pickups: z.number().optional(),

    inventory: z.object({
        type: z.object({ id: z.number() }).passthrough()
    }).passthrough(),
    reopen: VenueReopenSchema.optional(),

    travel_time: z.object({
        distance: z.number().optional()
    }).passthrough().optional(),

    source: z.object({
        name: z.string().nullable().optional(),
        logo: z.string().nullable().optional(),
        terms_of_service: z.string().nullable().optional(),
        privacy_policy: z.string().nullable().optional(),
    }).passthrough().optional(),

    service_types: z.record(z.string(), ServiceTypeSchema).optional(),
    notify_options: z.array(VenueNotifyOptionSchema).optional(),

    ticket: z.object({
        average: z.number().optional(),
        average_str: z.string().optional(),
    }).passthrough().optional(),

    currency: z.object({
        code: z.string(),
        symbol: z.string(),
    }).passthrough().optional(),

    default_template: z.string().optional(),

    content: z.array(VenueContentSchema).optional(),
    responsive_images: z.object({
        originals: z.record(z.string(), z.object({ url: z.string() }).passthrough()).optional(),
        urls: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string()))).optional(),
        urls_by_resolution: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.string()))).optional(),
        file_names: z.array(z.string()).optional(),
        aspect_ratios: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    }).passthrough().optional(),

    collections: z.array(VenueCollectionSchema).optional(),

    payment_methods: z.array(z.unknown()).optional(),
    policies: z.record(z.string(), z.unknown()).optional(),
    allow_bypass_payment_method: z.number().optional(),

    // Detailed waitlist in venue object
    waitlist: z.object({
        available: z.number(),
        label: z.string(),
        current: z.unknown().nullable(),
    }).passthrough().optional(),

    events: z.array(z.unknown()).optional(),
});

export const FindResultsMetaSchema = z.object({
    offset: z.number().optional(),
    limit: z.number().nullable().optional(),
}).passthrough();

export const FindResultsSchema = z.object({
    venues: z.array(z.object({
        venue: FindVenueSchema,
        slots: z.array(FindSlotSchema),
        service_types: z.record(z.string(), ServiceTypeSchema).optional(),
        templates: z.record(z.string(), FindTemplateSchema),

        gating_errors: z.record(z.string(), z.unknown()).optional(),
        notifies: z.array(z.unknown()).optional(),
        events: z.array(z.unknown()).optional(),
        collections: z.array(VenueCollectionSchema).optional(),
        pickups: VenuePickupsSchema.optional(),

        waitlist: z.object({
            available: z.number(),
            label: z.string(),
            current: z.object({}).passthrough().nullable().optional(),
        }).passthrough().optional(),

    }).passthrough()),

    meta: FindResultsMetaSchema.optional(),
});

export const FindResponseSchema = z.object({
    query: z.object({
        day: z.string(),
        party_size: z.number(),
        time_filter: z.string().nullable().optional(),
    }).passthrough(),

    results: FindResultsSchema,

    bookmark: z.object({}).passthrough().nullable().optional(),
    meta: z.object({
        total: z.number().optional(),
        page: z.number().optional(),
        pages: z.number().optional(),
    }).passthrough().optional(),
    platinum_night: z.boolean().nullable().optional(),
});

export type FindResponse = z.infer<typeof FindResponseSchema>;

/**
 * Request params for find endpoint
 */
export interface FindParams {
    venue_id: number | string;
    day: string; // YYYY-MM-DD
    party_size: number;
    lat?: number;
    long?: number;
}
