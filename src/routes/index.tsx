import { createFileRoute } from "@tanstack/react-router";
import { whoamiFn } from "@/lib/scarecrow/api";
import { AdminDashboard } from "@/components/scarecrow/admin-dashboard";

export const Route = createFileRoute("/")({
  loader: () => whoamiFn(),
  component: Home,
});

function Home() {
  const who = Route.useLoaderData();
  return <AdminDashboard initial={who} />;
}
