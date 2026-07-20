import { cn } from "./cn.js";

import { Button } from "@open-studio/udesign";
/** @param {{ id?: string; checked?: boolean; onCheckedChange?: (v: boolean) => void; label?: import("react").ReactNode; disabled?: boolean; className?: string; title?: string; tone?: "default" | "toolbar" }} props */
export default function Checkbox({ id, checked, onCheckedChange, label, disabled, className, title, tone = "default" }) {
  const toolbarTone = tone === "toolbar";
  return (
    <Button
      id={id}
      type="button"
      role="checkbox"
      variant="text"
      size="small"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      className={cn(
        toolbarTone
          ? className
          : ["inline-flex items-center gap-2", className],
      )}
      onClick={() => !disabled && onCheckedChange?.(!checked)}
    >
      <span
        className={cn(
          toolbarTone
            ? cn(
                "flex size-4 shrink-0 items-center justify-center rounded border transition-[border-color,background-color] duration-150",
                checked
                  ? "border-[var(--os-accent)] bg-[var(--os-accent)] text-white"
                  : "border-[var(--os-border-strong)] bg-[var(--os-bg-elevated)]",
              )
            : [
                "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-[border-color,background-color,box-shadow] duration-150",
                checked
                  ? "border-[var(--os-accent)] bg-[var(--os-accent)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
                  : "border-[var(--os-border-strong)] bg-[var(--os-bg-elevated)] shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]",
              ],
        )}
      >
        {checked ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
            <path d="M2 5.5 4.2 7.7 9 2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </span>
      <span>{label}</span>
    </Button>
  );
}
