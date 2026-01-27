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
import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";

const RESY_API_BASE = "https://api.resy.com";
const RESY_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

export interface ResyClientConfig {
    authToken?: string;
    apiKey?: string;
    debug?: boolean;
    proxyUrl?: string;
}

/**
 * Type-safe Resy API client using Axios
 */
export class ResyClient {
    private authToken?: string;
    private apiKey: string;
    private debug: boolean;
    private proxyUrl?: string;
    private axiosInstance: AxiosInstance;

    constructor(config: ResyClientConfig = {}) {
        this.authToken = config.authToken;
        this.apiKey = config.apiKey ?? RESY_API_KEY;
        this.debug = config.debug ?? false;
        this.proxyUrl = config.proxyUrl;
        this.axiosInstance = this.createAxiosInstance();
    }

    /**
     * Create axios instance with proxy if configured
     */
    private createAxiosInstance(): AxiosInstance {
        const config: AxiosRequestConfig = {
            baseURL: RESY_API_BASE,
            timeout: 30000,
            // Don't throw on non-2xx status codes - we handle them manually
            validateStatus: () => true,
        };

        if (this.proxyUrl) {
            const agent = new HttpsProxyAgent(this.proxyUrl);
            config.httpsAgent = agent;
            config.httpAgent = agent;
        }

        return axios.create(config);
    }

    /**
     * Set proxy URL (recreates axios instance)
     */
    setProxyUrl(url: string | undefined): void {
        this.proxyUrl = url;
        this.axiosInstance = this.createAxiosInstance();
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
    private getHeaders(includeAuth = false): Record<string, string> {
        const headers: Record<string, string> = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `ResyAPI api_key="${this.apiKey}"`,
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        };

        if (includeAuth && this.authToken) {
            headers["X-Resy-Auth-Token"] = this.authToken;
            headers["X-Resy-Universal-Auth"] = this.authToken;
        }

        return headers;
    }

    /**
     * Helper to handle API responses and throw typed errors
     */
    private handleResponse<T>(status: number, data: any, errorMessage: string): T {
        if (status < 200 || status >= 300) {
            // Convert data to string for raw body logging
            const rawBody = typeof data === "string" ? data : JSON.stringify(data);

            // Extract code if present
            const apiCode = typeof data === "object" && data !== null ? data.code : undefined;

            throw new ResyAPIError(
                `${errorMessage}: ${status}`,
                status,
                apiCode,
                rawBody
            );
        }
        return data as T;
    }

    // ============ Booking Flow Endpoints ============

    /**
     * Step 1: Get calendar availability for a venue
     * GET /4/venue/calendar
     */
    async getCalendar(params: CalendarParams): Promise<CalendarResponse> {
        const response = await this.axiosInstance.get("/4/venue/calendar", {
            headers: this.getHeaders(true),
            params: {
                venue_id: params.venue_id,
                num_seats: params.num_seats,
                start_date: params.start_date,
                end_date: params.end_date,
            },
        });

        const data = this.handleResponse<any>(response.status, response.data, "Calendar request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(CalendarResponseSchema, data, "getCalendar")
            : CalendarResponseSchema.parse(data);
    }

    /**
     * Step 2: Find available time slots for a specific day
     * GET /4/find
     */
    async findSlots(params: FindParams): Promise<FindResponse> {
        const response = await this.axiosInstance.get("/4/find", {
            headers: this.getHeaders(true),
            params: {
                venue_id: params.venue_id,
                day: params.day,
                party_size: params.party_size,
                lat: params.lat ?? 0,
                long: params.long ?? 0,
            },
        });

        const data = this.handleResponse<any>(response.status, response.data, "Find request failed");

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

        const response = await this.axiosInstance.get("/3/details", {
            headers: this.getHeaders(false), // No auth headers needed when using query param
            params: {
                day: params.day,
                party_size: params.party_size,
                venue_id: params.venue_id,
                config_id: params.config_id,
                // CAPTCHA bypass: pass auth token as query param
                "x-resy-auth-token": this.authToken,
            },
        });

        const data = this.handleResponse<any>(response.status, response.data, "Details request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(DetailsResponseSchema.passthrough(), data, "getDetails")
            : DetailsResponseSchema.parse(data);
    }

    /**
     * Step 4: Book the reservation
     * POST /3/book
     */
    async bookReservation(params: BookParams): Promise<BookResponse> {
        const body = new URLSearchParams({
            book_token: params.book_token,
            struct_payment_method: JSON.stringify({ id: params.payment_method_id }),
            source_id: params.source_id ?? "resy.com-venue-details",
        });

        const response = await this.axiosInstance.post("/3/book", body.toString(), {
            headers: this.getHeaders(true),
        });

        const data = this.handleResponse<any>(response.status, response.data, "Book request failed");

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
        const response = await this.axiosInstance.get("/3/user/reservations", {
            headers: this.getHeaders(true),
            params: { type },
        });

        const data = this.handleResponse<any>(response.status, response.data, "Reservations request failed");

        return this.debug
            ? parseWithUnknownFieldDetection(UserReservationsResponseSchema.passthrough(), data, "getUserReservations")
            : UserReservationsResponseSchema.parse(data);
    }

    /**
     * Cancel a reservation
     * POST /3/cancel
     */
    async cancelReservation(params: CancelParams): Promise<void> {
        const body = new URLSearchParams({
            resy_token: params.resy_token,
        });

        const response = await this.axiosInstance.post("/3/cancel", body.toString(), {
            headers: this.getHeaders(true),
        });

        this.handleResponse<any>(response.status, response.data, "Cancel request failed");
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

        const response = await this.axiosInstance.post("/2/user/registration", body.toString(), {
            headers: this.getHeaders(false),
        });

        const data = this.handleResponse<any>(response.status, response.data, "Registration failed");

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
        const response = await this.axiosInstance.post("/3/stripe/setup_intent", null, {
            headers: this.getHeaders(true),
        });

        const data = this.handleResponse<any>(response.status, response.data, "Setup intent failed");
        return StripeSetupIntentResponseSchema.parse(data);
    }

    /**
     * Save payment method to account
     * POST /3/stripe/payment_method
     */
    async savePaymentMethod(params: StripePaymentMethodParams): Promise<void> {
        const body = new URLSearchParams({
            stripe_payment_method_id: params.stripe_payment_method_id,
        });

        const response = await this.axiosInstance.post("/3/stripe/payment_method", body.toString(), {
            headers: this.getHeaders(true),
        });

        this.handleResponse<any>(response.status, response.data, "Save payment method failed");
    }
}
