/**
 * Proxies Component
 *
 * Displays proxy status for monitoring and checkout pools.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import { colors, box, pad, renderProgressBar } from "../renderer";

export interface ProxiesData {
  monitoring: {
    available: number;
    rotationIndex: number;
  };
  checkout: {
    available: number;
    inUse: number;
    cooldown: number;
    total: number;
  };
}

/**
 * Render the proxies component
 */
export function renderProxies(
  buffer: ScreenBuffer,
  region: Region,
  data: ProxiesData
): void {
  const { startRow, startCol, width, height } = region;
  const innerWidth = width - 2;

  // Header
  const header = colors.bold(" PROXIES ");
  buffer.writeAt(startRow, startCol, box.vertical + header + " ".repeat(innerWidth - 9) + box.vertical);

  // Separator
  buffer.writeAt(
    startRow + 1,
    startCol,
    box.teeLeft + box.horizontal.repeat(innerWidth) + box.teeRight
  );

  let currentRow = startRow + 2;
  const maxContentRows = height - 3;

  // Monitoring proxies
  const monLabel = colors.cyan(" MONITORING");
  buffer.writeAt(currentRow, startCol, box.vertical + pad(monLabel, innerWidth) + box.vertical);
  currentRow++;

  if (currentRow - startRow - 2 < maxContentRows) {
    const monAvail = colors.white(` Available: ${data.monitoring.available}`);
    buffer.writeAt(currentRow, startCol, box.vertical + pad(monAvail, innerWidth) + box.vertical);
    currentRow++;
  }

  // Spacer
  if (currentRow - startRow - 2 < maxContentRows) {
    buffer.writeAt(currentRow, startCol, box.vertical + " ".repeat(innerWidth) + box.vertical);
    currentRow++;
  }

  // Checkout proxies
  if (currentRow - startRow - 2 < maxContentRows) {
    const coLabel = colors.cyan(" CHECKOUT POOL");
    buffer.writeAt(currentRow, startCol, box.vertical + pad(coLabel, innerWidth) + box.vertical);
    currentRow++;
  }

  // Checkout progress bar
  if (currentRow - startRow - 2 < maxContentRows) {
    const barWidth = Math.min(12, innerWidth - 15);
    const bar = renderProgressBar(data.checkout.available, data.checkout.total, barWidth);

    // Color the bar based on availability
    let coloredBar: string;
    const ratio = data.checkout.total > 0 ? data.checkout.available / data.checkout.total : 0;
    if (ratio > 0.5) {
      coloredBar = colors.green(bar);
    } else if (ratio > 0.2) {
      coloredBar = colors.yellow(bar);
    } else {
      coloredBar = colors.red(bar);
    }

    const barLine = ` [${coloredBar}] ${data.checkout.available}/${data.checkout.total}`;
    buffer.writeAt(currentRow, startCol, box.vertical + pad(barLine, innerWidth) + box.vertical);
    currentRow++;
  }

  // Checkout breakdown
  if (currentRow - startRow - 2 < maxContentRows) {
    const availPart = colors.green(`Avail: ${data.checkout.available}`);
    const usePart = colors.yellow(`Use: ${data.checkout.inUse}`);
    const cdPart = colors.red(`CD: ${data.checkout.cooldown}`);
    const breakdown = ` ${availPart}  ${usePart}  ${cdPart}`;
    buffer.writeAt(currentRow, startCol, box.vertical + pad(breakdown, innerWidth) + box.vertical);
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
