// A chain failure's message can be a full Soroban diagnostic dump (hundreds
// of lines) — this must never go straight into a fixed-height error banner:
// it starves the rest of the screen of space and reads as an unresponsive app.
export function summarizeError(message: string, max = 240): string {
  const firstLine = message.split('\n')[0]?.trim() || message.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max).trimEnd()}…` : firstLine;
}
