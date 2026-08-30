import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/scarecrow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ChatBox({
  messages,
  myRole,
  onSend,
}: {
  messages: ChatMessage[];
  myRole: "host" | "guest";
  onSend: (text: string) => Promise<void> | void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const sig = JSON.stringify(messages);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [sig]);

  async function send() {
    const next = text.trim();
    if (!next) return;
    setText("");
    await onSend(next);
  }

  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] tracking-[0.1em] text-muted">
        MESSAGES
      </div>
      <div
        ref={boxRef}
        className="mb-2.5 flex max-h-[190px] flex-col gap-1.5 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <div className="text-[12.5px] text-muted">No messages yet.</div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${m.ts}-${i}`}
              className={
                m.from === myRole
                  ? "max-w-[82%] self-end rounded-xl rounded-br-sm bg-accent-dim px-2.5 py-2 text-[13px] leading-snug text-fg"
                  : "max-w-[82%] self-start rounded-xl rounded-bl-sm bg-surface-2 px-2.5 py-2 text-[13px] leading-snug text-fg"
              }
            >
              {m.text}
            </div>
          ))
        )}
      </div>
      <div className="mb-3.5 flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder="Send a message…"
          className="mb-0"
        />
        <Button
          type="button"
          size="compact"
          className="min-h-11 shrink-0 px-4"
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
