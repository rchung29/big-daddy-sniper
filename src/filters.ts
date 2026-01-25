/**
 * Filter configuration for slot matching
 */
export interface FilterConfig {
  id: string;
  party_size: number;
  time_window: {
    start: string;
    end: string;
  };
  table_types?: string[];
  target_dates: string[];
}

/**
 * Parse a time string "HH:mm" into minutes since midnight
 */
function parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

/**
 * Parse a Resy time slot into minutes since midnight
 * Supports: "7:30 PM", "19:30", "2026-02-04 19:30:00"
 */
export function parseSlotTime(slotTime: string): number {
    // Handle datetime format like "2026-02-04 12:00:00"
    const matchDatetime = slotTime.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (matchDatetime) {
        const hours = parseInt(matchDatetime[1], 10);
        const minutes = parseInt(matchDatetime[2], 10);
        return hours * 60 + minutes;
    }

    // Handle 12-hour format like "7:30 PM"
    const match12h = slotTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12h) {
        let hours = parseInt(match12h[1], 10);
        const minutes = parseInt(match12h[2], 10);
        const period = match12h[3].toUpperCase();

        if (period === "PM" && hours !== 12) {
            hours += 12;
        } else if (period === "AM" && hours === 12) {
            hours = 0;
        }

        return hours * 60 + minutes;
    }

    // Handle 24-hour format like "19:30"
    const match24h = slotTime.match(/^(\d{1,2}):(\d{2})$/);
    if (match24h) {
        const hours = parseInt(match24h[1], 10);
        const minutes = parseInt(match24h[2], 10);
        return hours * 60 + minutes;
    }

    throw new Error(`Unable to parse time: ${slotTime}`);
}

/**
 * Check if a slot time falls within the configured time window
 */
export function isTimeInWindow(
    slotTime: string,
    window: { start: string; end: string }
): boolean {
    const slotMinutes = parseSlotTime(slotTime);
    const startMinutes = parseTimeToMinutes(window.start);
    const endMinutes = parseTimeToMinutes(window.end);

    // Handle overnight windows (e.g., 22:00 to 02:00)
    if (endMinutes < startMinutes) {
        return slotMinutes >= startMinutes || slotMinutes <= endMinutes;
    }

    return slotMinutes >= startMinutes && slotMinutes <= endMinutes;
}

/**
 * Check if a slot's table type matches the configured filter
 * If no table types are configured, all types are accepted
 */
export function matchesTableType(
    slotType: string | undefined,
    allowedTypes: string[] | undefined
): boolean {
    if (!allowedTypes || allowedTypes.length === 0) {
        return true;
    }
    if (!slotType) {
        return false;
    }
    return allowedTypes.some(
        (allowed) => slotType.toLowerCase().includes(allowed.toLowerCase())
    );
}

export interface SlotInfo {
    config_id: string;
    time: string;
    type?: string;
}

/**
 * Filter slots based on filter configuration
 */
export function filterSlots(
    slots: SlotInfo[],
    filterConfig: FilterConfig
): SlotInfo[] {
    return slots.filter((slot) => {
        // Check time window
        if (!isTimeInWindow(slot.time, filterConfig.time_window)) {
            return false;
        }

        // Check table type
        if (!matchesTableType(slot.type, filterConfig.table_types)) {
            return false;
        }

        return true;
    });
}
