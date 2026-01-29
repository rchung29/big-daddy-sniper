/**
 * Double-Buffered Screen Buffer
 *
 * Maintains front buffer (displayed) and back buffer (building).
 * flush() only writes cells that changed between frames.
 * Eliminates flicker, minimizes I/O.
 */

import { cursor, write, stripAnsi, visibleLength } from "./renderer";

/**
 * A single cell in the buffer
 */
interface Cell {
  char: string;
  dirty: boolean;
}

/**
 * Screen buffer with diff-based rendering
 */
export class ScreenBuffer {
  private width: number;
  private height: number;
  private frontBuffer: Cell[][];
  private backBuffer: Cell[][];
  private cursorRow: number = 1;
  private cursorCol: number = 1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.frontBuffer = this.createBuffer();
    this.backBuffer = this.createBuffer();
  }

  /**
   * Create an empty buffer
   */
  private createBuffer(): Cell[][] {
    const buffer: Cell[][] = [];
    for (let row = 0; row < this.height; row++) {
      const line: Cell[] = [];
      for (let col = 0; col < this.width; col++) {
        line.push({ char: " ", dirty: false });
      }
      buffer.push(line);
    }
    return buffer;
  }

  /**
   * Resize the buffer
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.frontBuffer = this.createBuffer();
    this.backBuffer = this.createBuffer();
  }

  /**
   * Get buffer dimensions
   */
  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Clear the back buffer (prepare for new frame)
   */
  clear(): void {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        this.backBuffer[row][col].char = " ";
        this.backBuffer[row][col].dirty = true;
      }
    }
    this.cursorRow = 1;
    this.cursorCol = 1;
  }

  /**
   * Write a string at position (1-indexed row/col)
   * Handles ANSI escape codes by writing them inline
   */
  writeAt(row: number, col: number, str: string): void {
    if (row < 1 || row > this.height) return;

    const bufRow = row - 1;
    let bufCol = col - 1;

    // Parse the string, handling ANSI codes
    let i = 0;
    let currentAnsi = "";

    while (i < str.length && bufCol < this.width) {
      // Check for ANSI escape sequence
      if (str[i] === "\x1b" && str[i + 1] === "[") {
        // Find end of escape sequence
        let j = i + 2;
        while (j < str.length && !/[a-zA-Z]/.test(str[j])) {
          j++;
        }
        if (j < str.length) {
          currentAnsi += str.slice(i, j + 1);
          i = j + 1;
          continue;
        }
      }

      // Regular character
      if (bufCol >= 0 && bufCol < this.width) {
        const char = currentAnsi + str[i] + (currentAnsi ? "\x1b[0m" : "");
        if (this.backBuffer[bufRow][bufCol].char !== char) {
          this.backBuffer[bufRow][bufCol].char = char;
          this.backBuffer[bufRow][bufCol].dirty = true;
        }
        currentAnsi = "";
      }

      bufCol++;
      i++;
    }
  }

  /**
   * Write a string at current cursor position, advancing cursor
   */
  write(str: string): void {
    this.writeAt(this.cursorRow, this.cursorCol, str);
    this.cursorCol += visibleLength(str);
  }

  /**
   * Move cursor to position (1-indexed)
   */
  moveTo(row: number, col: number): void {
    this.cursorRow = row;
    this.cursorCol = col;
  }

  /**
   * Fill a region with a character
   */
  fill(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    char: string = " "
  ): void {
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        this.writeAt(row, col, char);
      }
    }
  }

  /**
   * Draw a box outline
   */
  drawBox(
    startRow: number,
    startCol: number,
    width: number,
    height: number,
    chars: {
      topLeft: string;
      topRight: string;
      bottomLeft: string;
      bottomRight: string;
      horizontal: string;
      vertical: string;
    }
  ): void {
    const endRow = startRow + height - 1;
    const endCol = startCol + width - 1;

    // Corners
    this.writeAt(startRow, startCol, chars.topLeft);
    this.writeAt(startRow, endCol, chars.topRight);
    this.writeAt(endRow, startCol, chars.bottomLeft);
    this.writeAt(endRow, endCol, chars.bottomRight);

    // Horizontal lines
    for (let col = startCol + 1; col < endCol; col++) {
      this.writeAt(startRow, col, chars.horizontal);
      this.writeAt(endRow, col, chars.horizontal);
    }

    // Vertical lines
    for (let row = startRow + 1; row < endRow; row++) {
      this.writeAt(row, startCol, chars.vertical);
      this.writeAt(row, endCol, chars.vertical);
    }
  }

  /**
   * Flush changes to terminal (diff-based)
   * Only writes cells that changed since last flush
   */
  flush(): void {
    let lastRow = -1;
    let lastCol = -1;
    let output = "";

    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const front = this.frontBuffer[row][col];
        const back = this.backBuffer[row][col];

        if (back.dirty || front.char !== back.char) {
          // Need to update this cell
          if (row !== lastRow || col !== lastCol + 1) {
            // Need to move cursor
            if (output) {
              write(output);
              output = "";
            }
            cursor.moveTo(row + 1, col + 1);
          }

          output += back.char;
          front.char = back.char;
          back.dirty = false;
          lastRow = row;
          lastCol = col;
        }
      }
    }

    if (output) {
      write(output);
    }
  }

  /**
   * Force full redraw (for resize or initial render)
   */
  forceRedraw(): void {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        this.frontBuffer[row][col].char = "";
        this.backBuffer[row][col].dirty = true;
      }
    }
    this.flush();
  }
}
