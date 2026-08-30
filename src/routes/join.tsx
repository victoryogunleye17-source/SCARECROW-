import { createFileRoute } from "@tanstack/react-router";
import { JoinView } from "@/components/scarecrow/join-view";

type JoinSearch = { s: string };

export const Route = createFileRoute("/join")({
  validateSearch: (raw: Record<string, unknown>): JoinSearch => ({
    s: typeof raw.s === "string" ? raw.s : "",
  }),
  component: JoinPage,
});

function JoinPage() {
  const { s } = Route.useSearch();
  return <JoinView sessionId={s} />;
}
