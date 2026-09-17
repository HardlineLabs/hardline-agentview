import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";

// Native iOS selects can pan the layout viewport out from under a fixed app.
export function ChoicePicker({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus({ preventScroll: true });
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="choice-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span>
          {options.find((option) => option.value === value)?.label || label}
        </span>
        <ChevronDown size={13} />
      </button>
      {open &&
        createPortal(
          <div className="choice-backdrop" onClick={close}>
            <div
              className="choice-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`Choose ${label.toLowerCase()}`}
              ref={panel}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                }
                if (["Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
                  const buttons = [
                    ...panel.current!.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const backwards =
                    event.key === "ArrowUp" ||
                    (event.key === "Tab" && event.shiftKey);
                  event.preventDefault();
                  buttons[
                    (index + (backwards ? -1 : 1) + buttons.length) %
                      buttons.length
                  ]?.focus({ preventScroll: true });
                }
              }}
            >
              <header>
                <strong>{label}</strong>
                <button
                  type="button"
                  aria-label={`Close ${label.toLowerCase()} choices`}
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </header>
              <div role="listbox" aria-label={label}>
                {options.map((option) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    key={option.value}
                    onClick={() => {
                      onChange(option.value);
                      close();
                    }}
                  >
                    <span>{option.label}</span>
                    {option.value === value && <Check size={16} />}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          trigger.current?.closest(".workspace-client") ?? document.body,
        )}
    </>
  );
}
