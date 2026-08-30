import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "mb-3.5 min-h-11 w-full rounded-md border border-border bg-surface-2 px-3.5 py-3 font-sans text-[15px] text-fg outline-none transition-[border-color] duration-[var(--motion-quick)] placeholder:text-muted focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}
