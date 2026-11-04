import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Search } from "lucide-react";
import { api } from "@/services/api";
import type { IssueDetail } from "@/types";
import { Button, ErrorNote, Field, Input, Panel } from "@/components/ui";
import { SLAMeter, StatusChip } from "@/components/issue/bits";
import { fmtDate } from "@/utils/format";

export default function TrackPage() {
  const navigate = useNavigate();
  const [tid, setTid] = useState("");
  const [token, setToken] = useState("");
  const [lookup, setLookup] = useState("");
  const track = useMutation({ mutationFn: () => api.post<{ issue: IssueDetail }>("/api/track", { tracking_id: tid.trim().toUpperCase(), token: token.trim() }) });
  const d = track.data?.issue;
  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="t-h1">Track a report</h1>
      <p className="mt-2 max-w-2xl text-slate">Anyone can look up a report's public status by tracking ID. If you reported anonymously, add your private code to confirm it's yours.</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Panel className="p-6">
          <h2 className="flex items-center gap-2 font-medium"><Search className="size-4 text-ink" />Public lookup</h2>
          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) navigate(`/issues/${lookup.trim().toUpperCase()}`); }}>
            <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="CM-2026-XXXXXX" aria-label="Tracking ID" />
            <Button type="submit">Look up</Button>
          </form>
        </Panel>
        <Panel className="p-6">
          <h2 className="flex items-center gap-2 font-medium"><KeyRound className="size-4 text-amber" />Anonymous reporter</h2>
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); track.mutate(); }}>
            <Field label="Tracking ID" htmlFor="tid"><Input id="tid" value={tid} onChange={(e) => setTid(e.target.value)} required /></Field>
            <Field label="Private code" htmlFor="tok"><Input id="tok" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="off" /></Field>
            <ErrorNote error={track.error} />
            <Button type="submit" loading={track.isPending}>Open my report</Button>
          </form>
        </Panel>
      </div>
      {d && (
        <Panel className="mt-6 p-6">
          <p className="text-sm text-green">Code verified — this is your report.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3"><StatusChip status={d.status} /><span className="num text-sm text-slate">{d.tracking_id}</span></div>
          <h2 className="mt-2 t-h2">{d.title}</h2>
          <p className="mt-1 text-sm text-slate">Reported {fmtDate(d.created_at)}{d.department ? ` · ${d.department.name}` : ""}</p>
          <div className="mt-4"><SLAMeter sla={d.sla} /></div>
          <Link to={`/issues/${d.tracking_id}`} className="mt-5 inline-block"><Button variant="secondary">See the full trail</Button></Link>
          <p className="mt-4 text-xs text-slate">Anonymous reports can't confirm fixes or message officials. Create an account for future reports to do that.</p>
        </Panel>
      )}
    </div>
  );
}
