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
  passiveMonitor: {
    enabled: boolean;
    running: boolean;
    lastPollAt: Date | null;
    pollErrors: number;
    datesFound: number;
  };
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

  // Passive monitor status
  const passiveStatus = data.passiveMonitor.enabled
    ? data.passiveMonitor.running
      ? colors.green("ON")
      : colors.yellow("PAUSED")
    : colors.dim("OFF");

  // Stats lines
  const stats = [
    { label: "Passive", value: passiveStatus, isFormatted: true },
    { label: "Slots Found", value: String(data.totalSlotsFound), color: colors.white },
    { label: "Active", value: String(data.activeProcessors), color: colors.cyan },
    { label: "Success", value: String(data.successfulBookings), color: colors.green },
    { label: "Failed", value: String(data.failedBookings), color: colors.red },
    { label: "P.Errors", value: String(data.passiveMonitor.pollErrors), color: data.passiveMonitor.pollErrors > 0 ? colors.yellow : colors.dim },
  ];

  for (const stat of stats) {
    if (currentRow - startRow - 2 >= maxContentRows) break;

    const label = colors.dim(` ${stat.label}:`);
    const value = "isFormatted" in stat && stat.isFormatted
      ? stat.value
      : stat.color ? stat.color(stat.value) : stat.value;
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
