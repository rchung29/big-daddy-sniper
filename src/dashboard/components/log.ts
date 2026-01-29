/**
 * Log Component
 *
 * Displays live action log with color-coded entries.
 * Ring buffer ensures fixed memory usage.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import type { LogEntry, LogLevel } from "../event-bridge";
import { colors, box, pad, truncate } from "../renderer";

export interface LogData {
  entries: LogEntry[];
}

/**
 * Format timestamp as HH:MM:SS
 */
function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Get color function for log level
 */
function getLevelColor(level: LogLevel): (s: string) => string {
  switch (level) {
    case "success":
      return colors.green;
    case "warn":
      return colors.yellow;
    case "error":
      return colors.red;
    case "info":
    default:
      return colors.white;
  }
}

/**
 * Format a log entry for display
 */
function formatLogEntry(entry: LogEntry, maxWidth: number): string {
  const timestamp = colors.dim(formatTimestamp(entry.timestamp));
  const colorFn = getLevelColor(entry.level);
  const message = colorFn(entry.message);

  const fullLine = `${timestamp} ${message}`;
  return truncate(fullLine, maxWidth);
}

/**
 * Render the log component
 */
export function renderLog(
  buffer: ScreenBuffer,
  region: Region,
  data: LogData
): void {
  const { startRow, startCol, width, height } = region;
  const innerWidth = width - 2;

  // Header
  const header = colors.bold(" LIVE LOG ");
  buffer.writeAt(startRow, startCol, box.vertical + header + " ".repeat(innerWidth - 10) + box.vertical);

  // Separator
  buffer.writeAt(
    startRow + 1,
    startCol,
    box.teeLeft + box.horizontal.repeat(innerWidth) + box.teeRight
  );

  let currentRow = startRow + 2;
  const maxContentRows = height - 3;

  const { entries } = data;

  if (entries.length === 0) {
    const emptyMsg = colors.dim("  Waiting for events...");
    buffer.writeAt(currentRow, startCol, box.vertical + pad(emptyMsg, innerWidth) + box.vertical);
    currentRow++;
  } else {
    // Show most recent entries (newest at bottom)
    const visibleEntries = entries.slice(-maxContentRows);

    for (const entry of visibleEntries) {
      if (currentRow - startRow - 2 >= maxContentRows) break;

      const formatted = formatLogEntry(entry, innerWidth - 1);
      buffer.writeAt(currentRow, startCol, box.vertical + " " + pad(formatted, innerWidth - 1) + box.vertical);
      currentRow++;
    }
  }

  // Fill remaining rows
  while (currentRow - startRow - 2 < maxContentRows) {
    buffer.writeAt(currentRow, startCol, box.vertical + " ".repeat(innerWidth) + box.vertical);
    currentRow++;
  }

  // Bottom border
  buffer.writeAt(
    startRow + height - 1,
    startCol,
    box.bottomLeft + box.horizontal.repeat(innerWidth) + box.bottomRight
  );
}
