import {
    CalendarResponseSchema,
    FindResponseSchema,
    DetailsResponseSchema,
    BookResponseSchema,
    BookResponseExtendedSchema,
    UserReservationsResponseSchema,
    UserRegistrationResponseSchema,
    StripeSetupIntentResponseSchema,
} from "./schemas";
import type {
    CalendarParams,
    CalendarResponse,
    FindParams,
    FindResponse,
    DetailsParams,
    DetailsResponse,
    BookParams,
    BookResponse,
    UserReservationsResponse,
    CancelParams,
    RegistrationParams,
    UserRegistrationResponse,
    StripeSetupIntentResponse,
    StripePaymentMethodParams,
} from "./schemas";
import { parseWithUnknownFieldDetection } from "./utils/schema-utils";
import { ResyAPIError } from "./errors";

const RESY_API_BASE = "https://api.resy.com";
const RESY_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

export interface ResyClientConfig {
    authToken?: string;
    apiKey?: string;
    debug?: boolean;
    proxyUrl?: string;
}

/**
 * Type-safe Resy API client
 */
export class ResyClient {
    private authToken?: string;
    private apiKey: string;
    private debug: boolean;
    private proxyUrl?: string;

    constructor(config: ResyClientConfig = {}) {
        this.authToken = config.authToken;
        this.apiKey = config.apiKey ?? RESY_API_KEY;
        this.debug = config.debug ?? false;
        this.proxyUrl = config.proxyUrl;
    }

    /**
     * Set proxy URL (can be updated after construction)
     */
    setProxyUrl(url: string | undefined): void {
        this.proxyUrl = url;
    }

    /**
     * Get fetch options with proxy if configured (Bun native proxy support)
     */
    private getFetchOptions(options: RequestInit): RequestInit {
        if (this.proxyUrl) {
            return { ...options, proxy: this.proxyUrl } as RequestInit;
        }
        return options;
    }

    /**
     * Set auth token (can be updated after construction)
     */
    setAuthToken(token: string): void {
        this.authToken = token;
    }

    /**
     * Build headers for requests
     */
    private getHeaders(includeAuth = false): Headers {
        const headers = new Headers({
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `ResyAPI api_key="${this.apiKey}"`,
            "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        });

        if (includeAuth && this.authToken) {
            headers.set("X-Resy-Auth-Token", this.authToken);
            headers.set("X-Resy-Universal-Auth", this.authToken);
        }

        return headers;
    }



    // ... previous imports ...

    /**
     * Helper to handle API responses and throw typed errors
     */
    private async handleResponse(response: Response, errorMessage: string): Promise<any> {
        if (!response.ok) {
            // Read body as text first (can only read once)
            const rawBody = await response.text();

            // Try to parse as JSON for code extraction
            let parsed: any = null;
            try {
                parsed = rawBody ? JSON.parse(rawBody) : null;
            } catch {
                // Not JSON, that's fine
            }

            // Extract code if present
            const apiCode = parsed?.code;

            throw new ResyAPIError(
                `${errorMessage}: ${response.status}`,
                response.status,
                apiCode,
                rawBody  // Pass full raw body for logging
            );
        }
        return response.json();
    }

    // ============ Booking Flow Endpoints ============

    /**
     * Step 1: Get calendar availability for a venue
     * GET /4/venue/calendar
     */
    async getCalendar(params: CalendarParams): Promise<CalendarResponse> {
        const url = new URL(`${RESY_API_BASE}/4/venue/calendar`);
        url.searchParams.set("venue_id", String(params.venue_id));
        url.searchParams.set("num_seats", String(params.num_seats));
        url.searchParams.set("start_date", params.start_date);
        url.searchParams.set("end_date", params.end_date);

        const response = await fetch(url.toString(), this.getFetchOptions({
            method: "GET",
            headers: this.getHeaders(true),
        }));

        const data = await this.handleResponse(response, "Calendar request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(CalendarResponseSchema, data, "getCalendar")
            : CalendarResponseSchema.parse(data);
    }

    /**
     * Step 2: Find available time slots for a specific day
     * GET /4/find
     */
    async findSlots(params: FindParams): Promise<FindResponse> {
        const url = new URL(`${RESY_API_BASE}/4/find`);
        url.searchParams.set("venue_id", String(params.venue_id));
        url.searchParams.set("day", params.day);
        url.searchParams.set("party_size", String(params.party_size));
        url.searchParams.set("lat", String(params.lat ?? 0));
        url.searchParams.set("long", String(params.long ?? 0));

        const response = await fetch(url.toString(), this.getFetchOptions({
            method: "GET",
            headers: this.getHeaders(true),
        }));

        const data = await this.handleResponse(response, "Find request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(FindResponseSchema.passthrough(), data, "findSlots")
            : FindResponseSchema.parse(data);
    }

    /**
     * Step 3: Get details and book_token for a specific slot
     * GET /3/details
     * 
     * NOTE: This uses the CAPTCHA-bypass method by passing auth token as query param
     */
    async getDetails(params: DetailsParams): Promise<DetailsResponse> {
        if (!this.authToken) {
            throw new Error("Auth token required for getDetails");
        }

        const url = new URL(`${RESY_API_BASE}/3/details`);
        url.searchParams.set("day", params.day);
        url.searchParams.set("party_size", String(params.party_size));
        url.searchParams.set("venue_id", String(params.venue_id));
        url.searchParams.set("config_id", params.config_id);
        // CAPTCHA bypass: pass auth token as query param
        url.searchParams.set("x-resy-auth-token", this.authToken);

        const response = await fetch(url.toString(), this.getFetchOptions({
            method: "GET",
            headers: this.getHeaders(false), // No auth headers needed when using query param
        }));

        const data = await this.handleResponse(response, "Details request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(DetailsResponseSchema.passthrough(), data, "getDetails")
            : DetailsResponseSchema.parse(data);
    }

    /**
     * Step 4: Book the reservation
     * POST /3/book
     */
    async bookReservation(params: BookParams): Promise<BookResponse> {
        const response = await fetch(`${RESY_API_BASE}/3/book`, this.getFetchOptions({
            method: "POST",
            headers: this.getHeaders(true),
            body: new URLSearchParams({
                book_token: params.book_token,
                struct_payment_method: JSON.stringify({ id: params.payment_method_id }),
                source_id: params.source_id ?? "resy.com-venue-details",
            }),
        }));

        const data = await this.handleResponse(response, "Book request failed");

        // Handle both response formats
        const extended = BookResponseExtendedSchema.parse(data);
        if (extended.reservation_id && extended.resy_token) {
            return { reservation_id: extended.reservation_id, resy_token: extended.resy_token };
        }
        if (extended.specs) {
            return { reservation_id: extended.specs.reservation_id, resy_token: extended.specs.resy_token };
        }

        return BookResponseSchema.parse(data);
    }

    // ============ User Management Endpoints ============

    /**
     * Get user's reservations
     * GET /3/user/reservations
     */
    async getUserReservations(type: "upcoming" | "past" = "upcoming"): Promise<UserReservationsResponse> {
        const url = new URL(`${RESY_API_BASE}/3/user/reservations`);
        url.searchParams.set("type", type);

        const response = await fetch(url.toString(), this.getFetchOptions({
            method: "GET",
            headers: this.getHeaders(true),
        }));

        const data = await this.handleResponse(response, "Reservations request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(UserReservationsResponseSchema.passthrough(), data, "getUserReservations")
            : UserReservationsResponseSchema.parse(data);
    }

    /**
     * Cancel a reservation
     * POST /3/cancel
     */
    async cancelReservation(params: CancelParams): Promise<void> {
        const response = await fetch(`${RESY_API_BASE}/3/cancel`, this.getFetchOptions({
            method: "POST",
            headers: this.getHeaders(true),
            body: new URLSearchParams({
                resy_token: params.resy_token,
            }),
        }));

        await this.handleResponse(response, "Cancel request failed");
    }

    /**
     * Register a new user account
     * POST /2/user/registration
     * 
     * NOTE: Requires CAPTCHA token
     */
    async registerUser(params: RegistrationParams): Promise<UserRegistrationResponse> {
        const body = new URLSearchParams({
            first_name: params.first_name,
            last_name: params.last_name,
            mobile_number: params.mobile_number,
            em_address: params.em_address,
            password: params.password,
            captcha_token: params.captcha_token,
            policies_accept: String(params.policies_accept ?? 1),
            complete: String(params.complete ?? 1),
            device_type_id: String(params.device_type_id ?? 3),
            device_token: params.device_token ?? crypto.randomUUID(),
            marketing_opt_in: String(params.marketing_opt_in ?? 0),
            isNonUS: String(params.isNonUS ?? 0),
        });

        const response = await fetch(`${RESY_API_BASE}/2/user/registration`, this.getFetchOptions({
            method: "POST",
            headers: this.getHeaders(false),
            body,
        }));

        const data = await this.handleResponse(response, "Registration failed");

        return this.debug
            ? parseWithUnknownFieldDetection(UserRegistrationResponseSchema.passthrough(), data, "registerUser")
            : UserRegistrationResponseSchema.parse(data);
    }

    // ============ Payment Endpoints ============

    /**
     * Create Stripe setup intent for adding payment method
     * POST /3/stripe/setup_intent
     */
    async createStripeSetupIntent(): Promise<StripeSetupIntentResponse> {
        const response = await fetch(`${RESY_API_BASE}/3/stripe/setup_intent`, this.getFetchOptions({
            method: "POST",
            headers: this.getHeaders(true),
        }));

        const data = await this.handleResponse(response, "Setup intent failed");
        return StripeSetupIntentResponseSchema.parse(data);
    }

    /**
     * Save payment method to account
     * POST /3/stripe/payment_method
     */
    async savePaymentMethod(params: StripePaymentMethodParams): Promise<void> {
        const response = await fetch(`${RESY_API_BASE}/3/stripe/payment_method`, this.getFetchOptions({
            method: "POST",
            headers: this.getHeaders(true),
            body: new URLSearchParams({
                stripe_payment_method_id: params.stripe_payment_method_id,
            }),
        }));

        await this.handleResponse(response, "Save payment method failed");
    }
}
