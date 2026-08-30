import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      className={cn("size-full", className)}
      aria-hidden="true"
    >
      <circle
        cx="20"
        cy="20"
        r="19"
        stroke="currentColor"
        className="text-accent"
        strokeWidth="1.4"
        opacity="0.4"
      />
      <path
        d="M20 8 L20 20 L28 25"
        stroke="currentColor"
        className="text-fg"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="2.6" className="fill-accent" />
    </svg>
  );
}

export function AppShell({
  kicker,
  children,
}: {
  kicker: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-[18px] pb-10 pt-5">
      <header className="flex items-center gap-3 pb-6 pt-2.5">
        <div className="size-[34px] shrink-0">
          <Mark />
        </div>
        <div>
          <div className="text-[19px] font-extrabold tracking-[0.01em]">
            Scarecrow
          </div>
          <div className="mt-px font-mono text-[10.5px] font-medium tracking-[0.14em] text-muted">
            {kicker}
          </div>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-3.5">{children}</div>
      <footer className="mt-auto pt-7 text-center">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-muted">
          SCARECROW · NOTHING SHARES WITHOUT CONSENT
        </span>
      </footer>
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-surface px-5 py-[22px]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function StatusLine({
  tone,
  children,
}: {
  tone: "idle" | "pending" | "live" | "off" | "alert";
  children: ReactNode;
}) {
  const dot =
    tone === "live"
      ? "bg-accent text-accent"
      : tone === "pending"
        ? "bg-warn text-warn"
        : tone === "off" || tone === "alert"
          ? "bg-danger text-danger"
          : "bg-muted text-muted";
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3.5 py-2.5 font-mono text-[12.5px] tracking-[0.03em] text-muted">
      <span className={cn("relative size-2 shrink-0 rounded-full", dot)}>
        {tone !== "idle" ? (
          <span className="absolute -inset-1.5 animate-[pulse_2.2s_ease-out_infinite] rounded-full border border-current opacity-50" />
        ) : null}
      </span>
      <span className={cn("min-w-0", tone === "alert" && "text-danger")}>
        {children}
      </span>
    </div>
  );
}
