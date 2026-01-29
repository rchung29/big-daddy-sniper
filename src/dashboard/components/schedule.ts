/**
 * Schedule Component
 *
 * Displays upcoming release windows grouped by time.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import type { ReleaseWindow } from "../../services/scheduler";
import { colors, box, pad, truncate, status } from "../renderer";

export interface ScheduleData {
  upcomingWindows: ReleaseWindow[];
  activeWindow: ReleaseWindow | null;
}

/**
 * Render the schedule component
 */
export function renderSchedule(
  buffer: ScreenBuffer,
  region: Region,
  data: ScheduleData
): void {
  const { startRow, startCol, width, height } = region;
  const innerWidth = width - 2;

  // Header
  const header = colors.bold(" SCHEDULE ");
  buffer.writeAt(startRow, startCol, box.vertical + header + " ".repeat(innerWidth - 10) + box.vertical);

  // Separator
  buffer.writeAt(
    startRow + 1,
    startCol,
    box.teeLeft + box.horizontal.repeat(innerWidth) + box.teeRight
  );

  let currentRow = startRow + 2;
  const maxContentRows = height - 3; // Header, separator, bottom border

  // Group windows by release time
  const { upcomingWindows, activeWindow } = data;

  if (upcomingWindows.length === 0 && !activeWindow) {
    const emptyMsg = colors.dim("  No upcoming windows");
    buffer.writeAt(currentRow, startCol, box.vertical + pad(emptyMsg, innerWidth) + box.vertical);
    currentRow++;
  } else {
    // Show active window first if exists
    if (activeWindow) {
      if (currentRow - startRow - 2 < maxContentRows) {
        const activeLabel = colors.brightGreen(status.active + " ACTIVE: " + activeWindow.releaseTime);
        buffer.writeAt(currentRow, startCol, box.vertical + " " + pad(activeLabel, innerWidth - 1) + box.vertical);
        currentRow++;

        // Show restaurants in active window
        for (const restaurant of activeWindow.restaurants.slice(0, 3)) {
          if (currentRow - startRow - 2 >= maxContentRows) break;
          const name = colors.green("    " + restaurant.name);
          buffer.writeAt(currentRow, startCol, box.vertical + pad(truncate(name, innerWidth - 1), innerWidth) + box.vertical);
          currentRow++;
        }

        if (activeWindow.restaurants.length > 3) {
          if (currentRow - startRow - 2 < maxContentRows) {
            const more = colors.dim(`    +${activeWindow.restaurants.length - 3} more`);
            buffer.writeAt(currentRow, startCol, box.vertical + pad(more, innerWidth) + box.vertical);
            currentRow++;
          }
        }
      }
    }

    // Show upcoming windows
    for (const window of upcomingWindows) {
      if (currentRow - startRow - 2 >= maxContentRows - 1) break;

      // Skip if this is the active window
      if (activeWindow && window.releaseTime === activeWindow.releaseTime) continue;

      // Window header: release time and target date
      const windowHeader = `${status.pending} ${window.releaseTime} - ${window.targetDate}`;
      const headerColored = colors.yellow(windowHeader);
      buffer.writeAt(currentRow, startCol, box.vertical + " " + pad(headerColored, innerWidth - 1) + box.vertical);
      currentRow++;

      // Show first few restaurants
      const maxRestaurants = 2;
      for (let i = 0; i < Math.min(window.restaurants.length, maxRestaurants); i++) {
        if (currentRow - startRow - 2 >= maxContentRows) break;
        const name = colors.dim("    - " + window.restaurants[i].name);
        buffer.writeAt(currentRow, startCol, box.vertical + pad(truncate(name, innerWidth - 1), innerWidth) + box.vertical);
        currentRow++;
      }

      if (window.restaurants.length > maxRestaurants) {
        if (currentRow - startRow - 2 < maxContentRows) {
          const more = colors.dim(`    +${window.restaurants.length - maxRestaurants} more`);
          buffer.writeAt(currentRow, startCol, box.vertical + pad(more, innerWidth) + box.vertical);
          currentRow++;
        }
      }
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
