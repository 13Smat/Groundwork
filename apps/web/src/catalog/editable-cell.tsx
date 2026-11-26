import { useState, type KeyboardEvent } from "react";

const cellClass =
  "min-h-11 w-full min-w-[7rem] rounded-md border border-line bg-paper px-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

function moveGridFocus(grid: string, row: number, col: number): void {
  const next = document.querySelector<HTMLElement>(
    `[data-grid="${grid}"] [data-row="${row}"][data-col="${col}"]`,
  );
  next?.focus();
}

export function EditableCell({
  grid,
  row,
  col,
  id,
  label,
  value,
  onCommit,
  inputMode = "text",
}: {
  grid: string;
  row: number;
  col: number;
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
  inputMode?: "decimal" | "text";
}) {
  return (
    <CellInput
      key={value}
      grid={grid}
      row={row}
      col={col}
      id={id}
      label={label}
      value={value}
      onCommit={onCommit}
      inputMode={inputMode}
    />
  );
}

function CellInput({
  grid,
  row,
  col,
  id,
  label,
  value,
  onCommit,
  inputMode,
}: {
  grid: string;
  row: number;
  col: number;
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
  inputMode: "decimal" | "text";
}) {
  const [text, setText] = useState(value);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (event.key === "ArrowDown" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      moveGridFocus(grid, row + 1, col);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveGridFocus(grid, row - 1, col);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setText(value);
      return;
    }
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    if (event.key === "ArrowLeft" && start === 0 && end === 0) {
      event.preventDefault();
      moveGridFocus(grid, row, col - 1);
    } else if (
      event.key === "ArrowRight" &&
      start === input.value.length &&
      end === input.value.length
    ) {
      event.preventDefault();
      moveGridFocus(grid, row, col + 1);
    }
  }

  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        className={cellClass}
        value={text}
        inputMode={inputMode}
        autoComplete="off"
        data-row={row}
        data-col={col}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text !== value) {
            onCommit(text);
          }
        }}
      />
    </>
  );
}
