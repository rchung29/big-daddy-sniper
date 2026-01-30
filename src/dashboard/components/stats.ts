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
    hasErrors: boolean;
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

  // Passive monitor status: On / Erroring / Off
  let passiveStatus: string;
  if (!data.passiveMonitor?.enabled) {
    passiveStatus = colors.dim("OFF");
  } else if (data.passiveMonitor.hasErrors) {
    passiveStatus = colors.red("ERRORING");
  } else if (data.passiveMonitor.running) {
    passiveStatus = colors.green("ON");
  } else {
    passiveStatus = colors.yellow("PAUSED");
  }

  // Stats lines - each with label and pre-formatted value
  const stats: Array<{ label: string; value: string }> = [
    { label: "Passive", value: passiveStatus },
    { label: "Slots Found", value: colors.white(String(data.totalSlotsFound)) },
    { label: "Active", value: colors.cyan(String(data.activeProcessors)) },
    { label: "Success", value: colors.green(String(data.successfulBookings)) },
    { label: "Failed", value: colors.red(String(data.failedBookings)) },
  ];

  for (const stat of stats) {
    if (currentRow - startRow - 2 >= maxContentRows) break;

    const label = colors.dim(` ${stat.label}:`);
    const line = `${label} ${stat.value}`;

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
