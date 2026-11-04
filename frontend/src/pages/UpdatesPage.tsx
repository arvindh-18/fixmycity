import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "@/services/api";
import { Button, ErrorNote, Spinner } from "@/components/ui";
import { FramesArt } from "@/components/Art";

/** Landing page for the links in "Get updates on this report" emails. */
export default function UpdatesPage() {
  const { action = "", token = "" } = useParams();
  const m = useMutation({ mutationFn: () => api.post<{ tracking_id: string; title: string }>(`/api/subscriptions/${token}/${action === "confirm" ? "confirm" : "unsubscribe"}`) });
  useEffect(() => { m.mutate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto max-w-[560px] px-4 py-24 text-center">
      <FramesArt icon={action === "confirm" ? "megaphone" : "pin"} className="mx-auto w-48" />
      {m.isPending && <Spinner className="mx-auto mt-10" />}
      {m.isError && <div className="mt-10"><ErrorNote error={m.error} className="text-left" /></div>}
      {m.isSuccess && (<>
        <h1 className="t-h1 mt-10">{action === "confirm" ? <>You'll hear from us <em>when it changes</em></> : <>You won't get <em>any more</em> emails</>}</h1>
        <p className="t-body mt-4 text-slate">
          {action === "confirm" ? "We'll email you each time" : "You've stopped updates for"} “{m.data.title}”{action === "confirm" ? " moves along." : "."}
        </p>
        <Link to={`/issues/${m.data.tracking_id}`} className="mt-8 inline-block"><Button>Open the report</Button></Link>
      </>)}
    </div>
  );
}
