import { z } from "zod";

/**
 * Inventory status for a date
 */
export const InventoryStatusSchema = z.object({
    reservation: z.enum(["available", "sold-out", "not available"]),
    event: z.enum(["available", "sold-out", "not available"]),
    "walk-in": z.enum(["available", "sold-out", "not available"]),
});

export type InventoryStatus = z.infer<typeof InventoryStatusSchema>;

/**
 * A single scheduled date in the calendar
 */
export const ScheduledDateSchema = z.object({
    date: z.string(), // YYYY-MM-DD format
    inventory: InventoryStatusSchema,
});

export type ScheduledDate = z.infer<typeof ScheduledDateSchema>;

/**
 * Response from GET /4/venue/calendar
 */
export const CalendarResponseSchema = z.object({
    scheduled: z.array(ScheduledDateSchema),
    last_calendar_day: z.string(), // YYYY-MM-DD format
});

export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;

/**
 * Request params for calendar endpoint
 */
export interface CalendarParams {
    venue_id: number | string;
    num_seats: number;
    start_date: string; // YYYY-MM-DD
    end_date: string; // YYYY-MM-DD
}
