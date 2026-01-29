/**
 * ANSI Escape Code Primitives
 *
 * Low-level terminal rendering utilities using raw ANSI escape codes.
 * No dependencies - direct stdout writes for maximum performance.
 */

// ANSI escape sequences
const ESC = "\x1b";
const CSI = `${ESC}[`;

/**
 * Cursor movement and screen control
 */
export const cursor = {
  hide: () => process.stdout.write(`${CSI}?25l`),
  show: () => process.stdout.write(`${CSI}?25h`),
  moveTo: (row: number, col: number) =>
    process.stdout.write(`${CSI}${row};${col}H`),
  moveToOrigin: () => process.stdout.write(`${CSI}H`),
  saveCursor: () => process.stdout.write(`${CSI}s`),
  restoreCursor: () => process.stdout.write(`${CSI}u`),
};

/**
 * Screen control
 */
export const screen = {
  clear: () => process.stdout.write(`${CSI}2J`),
  clearLine: () => process.stdout.write(`${CSI}2K`),
  clearToEnd: () => process.stdout.write(`${CSI}J`),
  alternateBuffer: () => process.stdout.write(`${CSI}?1049h`),
  mainBuffer: () => process.stdout.write(`${CSI}?1049l`),
};

/**
 * Colors (8-color basic palette for maximum compatibility)
 */
export const colors = {
  // Foreground
  black: (s: string) => `${CSI}30m${s}${CSI}39m`,
  red: (s: string) => `${CSI}31m${s}${CSI}39m`,
  green: (s: string) => `${CSI}32m${s}${CSI}39m`,
  yellow: (s: string) => `${CSI}33m${s}${CSI}39m`,
  blue: (s: string) => `${CSI}34m${s}${CSI}39m`,
  magenta: (s: string) => `${CSI}35m${s}${CSI}39m`,
  cyan: (s: string) => `${CSI}36m${s}${CSI}39m`,
  white: (s: string) => `${CSI}37m${s}${CSI}39m`,

  // Bright foreground
  brightBlack: (s: string) => `${CSI}90m${s}${CSI}39m`,
  brightRed: (s: string) => `${CSI}91m${s}${CSI}39m`,
  brightGreen: (s: string) => `${CSI}92m${s}${CSI}39m`,
  brightYellow: (s: string) => `${CSI}93m${s}${CSI}39m`,
  brightBlue: (s: string) => `${CSI}94m${s}${CSI}39m`,
  brightMagenta: (s: string) => `${CSI}95m${s}${CSI}39m`,
  brightCyan: (s: string) => `${CSI}96m${s}${CSI}39m`,
  brightWhite: (s: string) => `${CSI}97m${s}${CSI}39m`,

  // Background
  bgBlack: (s: string) => `${CSI}40m${s}${CSI}49m`,
  bgRed: (s: string) => `${CSI}41m${s}${CSI}49m`,
  bgGreen: (s: string) => `${CSI}42m${s}${CSI}49m`,
  bgYellow: (s: string) => `${CSI}43m${s}${CSI}49m`,
  bgBlue: (s: string) => `${CSI}44m${s}${CSI}49m`,
  bgMagenta: (s: string) => `${CSI}45m${s}${CSI}49m`,
  bgCyan: (s: string) => `${CSI}46m${s}${CSI}49m`,
  bgWhite: (s: string) => `${CSI}47m${s}${CSI}49m`,

  // Styles
  bold: (s: string) => `${CSI}1m${s}${CSI}22m`,
  dim: (s: string) => `${CSI}2m${s}${CSI}22m`,
  italic: (s: string) => `${CSI}3m${s}${CSI}23m`,
  underline: (s: string) => `${CSI}4m${s}${CSI}24m`,
  inverse: (s: string) => `${CSI}7m${s}${CSI}27m`,

  // Reset
  reset: `${CSI}0m`,
};

/**
 * Box drawing characters (Unicode)
 */
export const box = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeLeft: "├",
  teeRight: "┤",
  teeTop: "┬",
  teeBottom: "┴",
  cross: "┼",

  // Double line
  doubleTopLeft: "╔",
  doubleTopRight: "╗",
  doubleBottomLeft: "╚",
  doubleBottomRight: "╝",
  doubleHorizontal: "═",
  doubleVertical: "║",
};

/**
 * Progress bar symbols
 */
export const progress = {
  filled: "█",
  partial: "▓",
  light: "░",
  empty: " ",
};

/**
 * Status indicators
 */
export const status = {
  success: "●",
  warning: "◐",
  error: "○",
  active: "◉",
  pending: "○",
};

/**
 * Render a progress bar
 */
export function renderProgressBar(
  current: number,
  total: number,
  width: number = 10
): string {
  if (total === 0) return progress.light.repeat(width);

  const ratio = Math.min(current / total, 1);
  const filled = Math.floor(ratio * width);
  const empty = width - filled;

  return progress.filled.repeat(filled) + progress.light.repeat(empty);
}

/**
 * Strip ANSI codes from string (for length calculation)
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Get visible length of string (excluding ANSI codes)
 */
export function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Pad string to width (accounting for ANSI codes)
 */
export function pad(str: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const visible = visibleLength(str);
  if (visible >= width) return str;

  const padding = width - visible;

  switch (align) {
    case "right":
      return " ".repeat(padding) + str;
    case "center": {
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return " ".repeat(left) + str + " ".repeat(right);
    }
    default:
      return str + " ".repeat(padding);
  }
}

/**
 * Truncate string to width (accounting for ANSI codes)
 */
export function truncate(str: string, maxWidth: number, suffix: string = "…"): string {
  const visible = visibleLength(str);
  if (visible <= maxWidth) return str;

  // For simplicity, strip ANSI and truncate, then re-apply would be complex
  // Just strip and truncate for display
  const stripped = stripAnsi(str);
  return stripped.slice(0, maxWidth - suffix.length) + suffix;
}

/**
 * Draw a horizontal line
 */
export function horizontalLine(width: number, char: string = box.horizontal): string {
  return char.repeat(width);
}

/**
 * Format time as HH:MM:SS
 */
export function formatTime(date: Date = new Date()): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date | string): string {
  if (typeof date === "string") return date;
  return date.toISOString().split("T")[0];
}

/**
 * Write directly to stdout (no newline)
 */
export function write(str: string): void {
  process.stdout.write(str);
}

/**
 * Write a line to stdout
 */
export function writeLine(str: string = ""): void {
  process.stdout.write(str + "\n");
}
