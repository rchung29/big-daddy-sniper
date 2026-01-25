import * as fs from "fs";
import * as path from "path";
import type { ResyClient } from "../client";
import {
    CalendarResponseSchema,
    FindResponseSchema,
    DetailsResponseSchema,
    UserReservationsResponseSchema,
} from "../schemas";
import type { FindResponse } from "../schemas";
import { validateSchemaDeep, type SchemaValidationResult } from "./schema-validator";

const RESPONSES_DIR = path.join(import.meta.dir, "../../test-responses");

export interface TestConfig {
    authToken: string;
    venueId: number;
    partySize: number;
    targetDate: string; // YYYY-MM-DD
    paymentMethodId?: number;
}

export interface TestSuiteResult {
    timestamp: string;
    config: Omit<TestConfig, "authToken">;
    results: SchemaValidationResult[];
    summary: {
        passed: number;
        failed: number;
        totalUnknownFields: number;
        totalMissingFields: number;
    };
}

/**
 * Run validation tests against real Resy API
 */
export async function runSchemaTests(config: TestConfig): Promise<TestSuiteResult> {
    const results: SchemaValidationResult[] = [];

    // Ensure responses directory exists
    if (!fs.existsSync(RESPONSES_DIR)) {
        fs.mkdirSync(RESPONSES_DIR, { recursive: true });
    }

    console.log("\n🧪 Starting Resy SDK Schema Validation Tests\n");

    // Test 1: Calendar endpoint
    console.log("Testing GET /4/venue/calendar...");
    try {
        const calendarUrl = `https://api.resy.com/4/venue/calendar?venue_id=${config.venueId}&num_seats=${config.partySize}&start_date=${config.targetDate}&end_date=${getEndDate(config.targetDate, 30)}`;
        const calendarRaw = await fetchRaw(calendarUrl, config.authToken);
        saveResponse("calendar", calendarRaw);
        const calendarResult = validateSchemaDeep(CalendarResponseSchema, calendarRaw, "GET /4/venue/calendar");
        results.push(calendarResult);
        console.log(calendarResult.report);
    } catch (e) {
        console.error("Calendar test failed:", e);
    }

    // Test 2: Find endpoint
    let findRaw: FindResponse | null = null;
    console.log("Testing GET /4/find...");
    try {
        const findUrl = `https://api.resy.com/4/find?venue_id=${config.venueId}&day=${config.targetDate}&party_size=${config.partySize}&lat=0&long=0`;
        findRaw = await fetchRaw(findUrl, config.authToken) as FindResponse;
        saveResponse("find", findRaw);
        const findResult = validateSchemaDeep(FindResponseSchema, findRaw, "GET /4/find");
        results.push(findResult);
        console.log(findResult.report);

        // Test 3: Details endpoint (if slots available)
        const slot = findRaw?.results?.venues?.[0]?.slots?.[0];
        if (slot?.config?.token) {
            console.log("Testing GET /3/details...");
            const configToken = slot.config.token;
            const detailsUrl = `https://api.resy.com/3/details?day=${config.targetDate}&party_size=${config.partySize}&venue_id=${config.venueId}&config_id=${encodeURIComponent(configToken)}&x-resy-auth-token=${config.authToken}`;
            const detailsRaw = await fetchRaw(detailsUrl, config.authToken, false);
            saveResponse("details", detailsRaw);
            const detailsResult = validateSchemaDeep(DetailsResponseSchema, detailsRaw, "GET /3/details");
            results.push(detailsResult);
            console.log(detailsResult.report);
        } else {
            console.log("⚠️  Skipping /3/details - no available slots found");
        }
    } catch (e) {
        console.error("Find test failed:", e);
    }

    // Test 4: User reservations
    console.log("Testing GET /3/user/reservations...");
    try {
        const reservationsUrl = "https://api.resy.com/3/user/reservations?type=upcoming";
        const reservationsRaw = await fetchRaw(reservationsUrl, config.authToken);
        saveResponse("user_reservations", reservationsRaw);
        const reservationsResult = validateSchemaDeep(
            UserReservationsResponseSchema,
            reservationsRaw,
            "GET /3/user/reservations"
        );
        results.push(reservationsResult);
        console.log(reservationsResult.report);
    } catch (e) {
        console.error("User reservations test failed:", e);
    }

    // Generate summary
    const summary = {
        passed: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        totalUnknownFields: results.reduce((sum, r) => sum + r.discrepancies.filter((d) => d.type === "unknown").length, 0),
        totalMissingFields: results.reduce((sum, r) => sum + r.discrepancies.filter((d) => d.type === "missing").length, 0),
    };

    const suiteResult: TestSuiteResult = {
        timestamp: new Date().toISOString(),
        config: { venueId: config.venueId, partySize: config.partySize, targetDate: config.targetDate },
        results,
        summary,
    };

    // Save full report
    const reportPath = path.join(RESPONSES_DIR, `validation-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(suiteResult, null, 2));

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("TEST SUITE SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Passed: ${summary.passed}`);
    console.log(`❌ Failed: ${summary.failed}`);
    console.log(`🔍 Unknown fields to add: ${summary.totalUnknownFields}`);
    console.log(`⚠️  Missing fields (make optional): ${summary.totalMissingFields}`);
    console.log(`\n📁 Full report saved: ${reportPath}`);
    console.log(`📁 Raw responses saved: ${RESPONSES_DIR}/`);

    return suiteResult;
}

async function fetchRaw(url: string, authToken: string, includeAuth = true): Promise<unknown> {
    const headers: Record<string, string> = {
        Accept: "application/json, text/plain, */*",
        Authorization: 'ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"',
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    };

    if (includeAuth) {
        headers["X-Resy-Auth-Token"] = authToken;
        headers["X-Resy-Universal-Auth"] = authToken;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
        throw new Error(`Request failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
}

function saveResponse(endpoint: string, data: unknown): void {
    const filePath = path.join(RESPONSES_DIR, `${endpoint}-${Date.now()}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getEndDate(startDate: string, daysAhead: number): string {
    const date = new Date(startDate);
    date.setDate(date.getDate() + daysAhead);
    return date.toISOString().split("T")[0] as string;
}
