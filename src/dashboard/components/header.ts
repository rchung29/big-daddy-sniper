/**
 * Header Component
 *
 * Title bar with application name and current time.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import { colors, formatTime, box, pad } from "../renderer";

/**
 * Render the header component
 */
export function renderHeader(buffer: ScreenBuffer, region: Region): void {
  const { startRow, startCol, width } = region;

  // Title
  const title = colors.bold(colors.cyan(" RESY SNIPER "));

  // Current time in EST
  const time = formatTime() + " EST";
  const timeStr = colors.dim(time);

  // Calculate positions
  const titleLen = 13; // " RESY SNIPER "
  const timeLen = time.length;
  const padding = width - titleLen - timeLen - 2;

  // Row 1: Title + Time
  buffer.writeAt(startRow, startCol, title);
  buffer.writeAt(startRow, startCol + titleLen + padding, timeStr);

  // Row 2: Separator line
  const separator = colors.dim(box.horizontal.repeat(width));
  buffer.writeAt(startRow + 1, startCol, separator);
}
