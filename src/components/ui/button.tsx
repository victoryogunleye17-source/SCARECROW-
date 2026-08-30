import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "inline-flex w-full items-center justify-center gap-2 rounded-md font-sans text-[15px] font-semibold transition-[transform,filter,opacity] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:brightness-110",
        ghost:
          "border border-border bg-transparent text-fg hover:bg-surface-2",
        danger: "bg-danger text-danger-fg hover:brightness-110",
        warn: "bg-warn text-accent-fg hover:brightness-110",
      },
      size: {
        default: "min-h-11 px-4 py-3",
        compact: "min-h-10 w-auto px-3 py-2 text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
