/** Fixed en-US dollars so the PDF text layer does not depend on the host locale. */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}.${remainder.toString().padStart(2, "0")}`;
}

export function selectedOptional(lineId: string, selected: readonly string[]): boolean {
  return selected.includes(lineId);
}
