/**
 * Stats Component
 *
 * Displays booking statistics for the current session.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import type { DashboardState } from "../event-bridge";
import { colors, box, pad } from "../renderer";

export interface StatsData {
  activeProcessors: number;
  successfulBookings: number;
  failedBookings: number;
  totalSlotsFound: number;
  wafBlocks: number;
  rateLimits: number;
}

/**
 * Render the stats component
 */
export function renderStats(
  buffer: ScreenBuffer,
  region: Region,
  data: StatsData
): void {
  const { startRow, startCol, width, height } = region;
  const innerWidth = width - 2;

  // Header
  const header = colors.bold(" STATS ");
  buffer.writeAt(startRow, startCol, box.vertical + header + " ".repeat(innerWidth - 7) + box.vertical);

  // Separator
  buffer.writeAt(
    startRow + 1,
    startCol,
    box.teeLeft + box.horizontal.repeat(innerWidth) + box.teeRight
  );

  let currentRow = startRow + 2;
  const maxContentRows = height - 3;

  // Stats lines
  const stats = [
    { label: "Slots Found", value: data.totalSlotsFound, color: colors.white },
    { label: "Active", value: data.activeProcessors, color: colors.cyan },
    { label: "Success", value: data.successfulBookings, color: colors.green },
    { label: "Failed", value: data.failedBookings, color: colors.red },
    { label: "WAF Blocks", value: data.wafBlocks, color: colors.yellow },
    { label: "Rate Ltd", value: data.rateLimits, color: colors.magenta },
  ];

  for (const stat of stats) {
    if (currentRow - startRow - 2 >= maxContentRows) break;

    const label = colors.dim(` ${stat.label}:`);
    const value = stat.color(String(stat.value));
    const line = `${label} ${value}`;

    buffer.writeAt(currentRow, startCol, box.vertical + pad(line, innerWidth) + box.vertical);
    currentRow++;
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
