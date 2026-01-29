/**
 * Proxies Component
 *
 * Displays proxy status for datacenter and ISP pools.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import { colors, box, pad, renderProgressBar } from "../renderer";

export interface ProxiesData {
  datacenter: {
    available: number;
    rotationIndex: number;
  };
  isp: {
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

  // Datacenter proxies
  const dcLabel = colors.cyan(" DATACENTER");
  buffer.writeAt(currentRow, startCol, box.vertical + pad(dcLabel, innerWidth) + box.vertical);
  currentRow++;

  if (currentRow - startRow - 2 < maxContentRows) {
    const dcAvail = colors.white(` Available: ${data.datacenter.available}`);
    buffer.writeAt(currentRow, startCol, box.vertical + pad(dcAvail, innerWidth) + box.vertical);
    currentRow++;
  }

  // Spacer
  if (currentRow - startRow - 2 < maxContentRows) {
    buffer.writeAt(currentRow, startCol, box.vertical + " ".repeat(innerWidth) + box.vertical);
    currentRow++;
  }

  // ISP proxies
  if (currentRow - startRow - 2 < maxContentRows) {
    const ispLabel = colors.cyan(" ISP POOL");
    buffer.writeAt(currentRow, startCol, box.vertical + pad(ispLabel, innerWidth) + box.vertical);
    currentRow++;
  }

  // ISP progress bar
  if (currentRow - startRow - 2 < maxContentRows) {
    const barWidth = Math.min(12, innerWidth - 15);
    const bar = renderProgressBar(data.isp.available, data.isp.total, barWidth);

    // Color the bar based on availability
    let coloredBar: string;
    const ratio = data.isp.total > 0 ? data.isp.available / data.isp.total : 0;
    if (ratio > 0.5) {
      coloredBar = colors.green(bar);
    } else if (ratio > 0.2) {
      coloredBar = colors.yellow(bar);
    } else {
      coloredBar = colors.red(bar);
    }

    const barLine = ` [${coloredBar}] ${data.isp.available}/${data.isp.total}`;
    buffer.writeAt(currentRow, startCol, box.vertical + pad(barLine, innerWidth) + box.vertical);
    currentRow++;
  }

  // ISP breakdown
  if (currentRow - startRow - 2 < maxContentRows) {
    const availPart = colors.green(`Avail: ${data.isp.available}`);
    const usePart = colors.yellow(`Use: ${data.isp.inUse}`);
    const cdPart = colors.red(`CD: ${data.isp.cooldown}`);
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
