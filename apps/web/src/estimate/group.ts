export type LineGroup<T> = {
  key: string;
  title: string;
  lines: T[];
};

/** Recipe lines use the takeoff item name as their group. Manual lines use the typed group. */
export function groupLines<T extends { group: string | null; source: string }>(
  lines: readonly T[],
): LineGroup<T>[] {
  const groups: LineGroup<T>[] = [];
  for (const line of lines) {
    const titled = line.group?.trim();
    const title = titled ? titled : line.source === "manual" ? "Manual" : "Ungrouped";
    const existing = groups.find((group) => group.key === title);
    if (existing) {
      existing.lines.push(line);
    } else {
      groups.push({ key: title, title, lines: [line] });
    }
  }
  return groups;
}

export function variableKeys(line: {
  variables: Record<string, string>;
  recipe_variables?: Record<string, string>;
}): string[] {
  return [
    ...new Set([...Object.keys(line.recipe_variables ?? {}), ...Object.keys(line.variables)]),
  ].sort();
}

export function overrideMap(
  line: { variables: Record<string, string>; recipe_variables?: Record<string, string> },
  key: string,
  value: string,
): Record<string, string> {
  const next = { ...line.variables };
  if (line.recipe_variables?.[key] === value) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}
