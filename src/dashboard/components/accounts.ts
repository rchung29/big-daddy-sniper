/**
 * Accounts Component
 *
 * Displays registered user accounts.
 */

import type { ScreenBuffer } from "../buffer";
import type { Region } from "../layout";
import type { User } from "../../db/schema";
import { colors, box, pad, truncate, status } from "../renderer";

export interface AccountsData {
  users: User[];
}

/**
 * Check if user is fully registered
 */
function isUserRegistered(user: User): boolean {
  return !!user.resy_auth_token && !!user.resy_payment_method_id;
}

/**
 * Render the accounts component
 */
export function renderAccounts(
  buffer: ScreenBuffer,
  region: Region,
  data: AccountsData
): void {
  const { startRow, startCol, width, height } = region;
  const innerWidth = width - 2;

  // Header
  const header = colors.bold(" ACCOUNTS ");
  buffer.writeAt(startRow, startCol, box.vertical + header + " ".repeat(innerWidth - 10) + box.vertical);

  // Separator
  buffer.writeAt(
    startRow + 1,
    startCol,
    box.teeLeft + box.horizontal.repeat(innerWidth) + box.teeRight
  );

  let currentRow = startRow + 2;
  const maxContentRows = height - 3;

  const { users } = data;

  if (users.length === 0) {
    const emptyMsg = colors.dim("  No registered accounts");
    buffer.writeAt(currentRow, startCol, box.vertical + pad(emptyMsg, innerWidth) + box.vertical);
    currentRow++;
  } else {
    // Sort: registered first, then by username
    const sortedUsers = [...users].sort((a, b) => {
      const aReg = isUserRegistered(a);
      const bReg = isUserRegistered(b);
      if (aReg !== bReg) return bReg ? 1 : -1;
      return (a.discord_username ?? "").localeCompare(b.discord_username ?? "");
    });

    for (const user of sortedUsers) {
      if (currentRow - startRow - 2 >= maxContentRows) break;

      const registered = isUserRegistered(user);
      const username = user.discord_username ?? user.discord_id.slice(0, 8);

      let line: string;
      if (registered) {
        const indicator = colors.green(status.success);
        const name = colors.white(username);
        const statusText = colors.dim(" (registered)");
        line = ` ${indicator} ${name}${statusText}`;
      } else {
        const indicator = colors.yellow(status.warning);
        const name = colors.dim(username);
        const statusText = colors.yellow(" (no payment)");
        line = ` ${indicator} ${name}${statusText}`;
      }

      buffer.writeAt(currentRow, startCol, box.vertical + pad(truncate(line, innerWidth - 1), innerWidth) + box.vertical);
      currentRow++;
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
