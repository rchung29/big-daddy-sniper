/**
 * Screen Layout Calculator
 *
 * Calculates regions for the dashboard layout based on terminal size.
 * Layout is responsive - adjusts to terminal dimensions.
 */

/**
 * A rectangular region on screen (1-indexed)
 */
export interface Region {
  startRow: number;
  startCol: number;
  width: number;
  height: number;
}

/**
 * All dashboard regions
 */
export interface DashboardLayout {
  // Full screen
  screen: Region;

  // Header bar
  header: Region;

  // Upper panels (side by side)
  schedule: Region;
  proxies: Region;

  // Lower panels (side by side)
  accounts: Region;
  stats: Region;

  // Log panel (full width bottom)
  log: Region;
}

/**
 * Minimum terminal size for dashboard
 */
export const MIN_WIDTH = 60;
export const MIN_HEIGHT = 20;

/**
 * Fixed heights
 */
const HEADER_HEIGHT = 2;
const LOG_RATIO = 0.3; // 30% of remaining height

/**
 * Calculate layout from terminal dimensions
 */
export function calculateLayout(width: number, height: number): DashboardLayout {
  // Enforce minimum
  const w = Math.max(width, MIN_WIDTH);
  const h = Math.max(height, MIN_HEIGHT);

  // Screen region
  const screen: Region = {
    startRow: 1,
    startCol: 1,
    width: w,
    height: h,
  };

  // Header: top 2 rows
  const header: Region = {
    startRow: 1,
    startCol: 1,
    width: w,
    height: HEADER_HEIGHT,
  };

  // Remaining height after header
  const contentHeight = h - HEADER_HEIGHT;

  // Log panel: bottom 30%
  const logHeight = Math.max(4, Math.floor(contentHeight * LOG_RATIO));
  const log: Region = {
    startRow: h - logHeight + 1,
    startCol: 1,
    width: w,
    height: logHeight,
  };

  // Middle section height (between header and log)
  const middleHeight = contentHeight - logHeight;

  // Upper panels: 55% of middle
  const upperHeight = Math.max(4, Math.floor(middleHeight * 0.55));

  // Lower panels: remaining
  const lowerHeight = Math.max(3, middleHeight - upperHeight);

  // Column widths (left panel slightly wider)
  const leftWidth = Math.floor(w * 0.55);
  const rightWidth = w - leftWidth;

  // Upper left: Schedule
  const schedule: Region = {
    startRow: HEADER_HEIGHT + 1,
    startCol: 1,
    width: leftWidth,
    height: upperHeight,
  };

  // Upper right: Proxies
  const proxies: Region = {
    startRow: HEADER_HEIGHT + 1,
    startCol: leftWidth + 1,
    width: rightWidth,
    height: upperHeight,
  };

  // Lower left: Accounts
  const accounts: Region = {
    startRow: HEADER_HEIGHT + upperHeight + 1,
    startCol: 1,
    width: leftWidth,
    height: lowerHeight,
  };

  // Lower right: Stats
  const stats: Region = {
    startRow: HEADER_HEIGHT + upperHeight + 1,
    startCol: leftWidth + 1,
    width: rightWidth,
    height: lowerHeight,
  };

  return {
    screen,
    header,
    schedule,
    proxies,
    accounts,
    stats,
    log,
  };
}

/**
 * Get terminal size with fallback
 */
export function getTerminalSize(): { width: number; height: number } {
  const columns = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  return { width: columns, height: rows };
}

/**
 * Check if terminal is large enough for dashboard
 */
export function isTerminalSufficient(): boolean {
  const { width, height } = getTerminalSize();
  return width >= MIN_WIDTH && height >= MIN_HEIGHT;
}
