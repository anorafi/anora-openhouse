import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A USDC field that groups thousands as you type. The value stays a plain
 * digit string, so callers keep reading it with Number(); only the rendering
 * carries separators.
 */
export function AmountInput({ value, onChange, suffix, action }: {
  value: string;
  onChange: (digits: string) => void;
  suffix: string;
  action?: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Digits left of the caret, so the caret keeps its place when separators
  // shift the text around it.
  const digitsBefore = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (!input || digitsBefore.current === null) return;
    let seen = 0;
    let caret = 0;
    while (caret < input.value.length && seen < digitsBefore.current) {
      if (input.value[caret] >= "0" && input.value[caret] <= "9") seen++;
      caret++;
    }
    digitsBefore.current = null;
    input.setSelectionRange(caret, caret);
  });

  return <div className="amount-input">
    <input
      ref={ref}
      inputMode="decimal"
      value={value ? Number(value).toLocaleString("en-US") : ""}
      onChange={(event) => {
        const caret = event.target.selectionStart ?? event.target.value.length;
        digitsBefore.current = event.target.value.slice(0, caret).replace(/\D/g, "").length;
        onChange(event.target.value.replace(/\D/g, ""));
      }}
    />
    <span>{suffix}</span>
    {action}
  </div>;
}
