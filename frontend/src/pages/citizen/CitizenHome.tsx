import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Compass, Plus } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type { IssueCard } from "@/types";
import { Button, EmptyState, Panel, Segmented, Skeleton } from "@/components/ui";
import { IssueRow, StatusChip } from "@/components/issue/bits";
import { STATUS } from "@/utils/status";

export default function CitizenHome() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"mine" | "following" | "nearby">("mine");
  const mine = useQuery({ queryKey: ["my-issues"], queryFn: () => api.get<IssueCard[]>("/api/me/issues") });
  const following = useQuery({ queryKey: ["following"], queryFn: () => api.get<IssueCard[]>("/api/me/following"), enabled: tab === "following" });
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const nearby = useQuery({ queryKey: ["nearby", pos], queryFn: () => api.get<IssueCard[]>("/api/nearby", { lat: pos!.lat, lng: pos!.lng, radius_m: 1500 }), enabled: !!pos });

  const needsAction = (mine.data ?? []).filter((i) => i.status === "awaiting_verification");
  const counts = { open: 0, done: 0 };
  (mine.data ?? []).forEach((i) => (STATUS[i.status].group === "done" ? counts.done++ : STATUS[i.status].group !== "closed" && counts.open++));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Hello, {user?.full_name.split(" ")[0]}</h1>
          <p className="mt-1 text-slate">{mine.data ? `${counts.open} open, ${counts.done} resolved of the issues you reported.` : " "}</p>
        </div>
        <Link to="/report"><Button variant="accent" icon={<Plus className="size-4" />}>Report an issue</Button></Link>
      </div>

      {needsAction.length > 0 && (
        <Panel className="mt-8 border-ink bg-raised p-5">
          <h2 className="t-h2">Your confirmation is needed</h2>
          <p className="text-sm text-slate">The field team says these are fixed. Check and confirm, or reopen if they're not.</p>
          <ul className="mt-3 space-y-2">
            {needsAction.map((i) => (
              <li key={i.id}><Link to={`/issues/${i.tracking_id}`} className="flex items-center justify-between gap-3 rounded-md bg-surface px-4 py-3 hover:">
                <span className="font-medium">{i.title}</span><StatusChip status={i.status} size="sm" />
              </Link></li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-8">
        <Segmented value={tab} onChange={(t) => { setTab(t); if (t === "nearby" && !pos) navigator.geolocation?.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => setGeoErr("Location permission denied — showing nothing nearby.")); }}
          options={[{ value: "mine", label: "My reports", count: mine.data?.length }, { value: "following", label: "Following" }, { value: "nearby", label: "Near me" }]} />
      </div>
      <Panel className="mt-4 px-2">
        {tab === "mine" && (mine.isLoading ? <Rows /> : mine.data?.length ? mine.data.map((i) => <IssueRow key={i.id} issue={i} />) :
          <EmptyState title="You haven't reported anything yet" body="Spotted a pothole, broken light or overflowing drain? It takes about a minute." action={<Link to="/report"><Button variant="accent">Report an issue</Button></Link>} />)}
        {tab === "following" && (following.isLoading ? <Rows /> : following.data?.length ? following.data.map((i) => <IssueRow key={i.id} issue={i} />) :
          <EmptyState art="inbox" title="Not following anything" body="Follow or support an issue to get its updates here." action={<Link to="/issues"><Button variant="secondary">Browse issues</Button></Link>} />)}
        {tab === "nearby" && (!pos ? <EmptyState title={geoErr ?? "Finding your location"} body="Allow location access to see issues within 1.5 km." /> :
          nearby.isLoading ? <Rows /> : nearby.data?.length ? nearby.data.map((i) => <IssueRow key={i.id} issue={i} showDistance />) :
          <EmptyState art="check" title="Nothing reported near you" body="No issues within 1.5 km of where you are." action={<Link to="/map"><Button variant="secondary" icon={<Compass className="size-4" />}>Open the map</Button></Link>} />)}
      </Panel>
    </div>
  );
}

function Rows() {
  return <div className="space-y-3 py-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
}
