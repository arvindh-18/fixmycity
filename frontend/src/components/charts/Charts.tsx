import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CategoryStat, DeptScore, TrendPoint } from "@/types";
import { duration, pct } from "@/utils/format";
import { CategoryIcon } from "@/components/issue/bits";
import { Badge } from "@/components/ui";

const AXIS = { fontSize: 12, fill: "var(--ink-muted)", fontFamily: "var(--font-sans)" };
const tooltipStyle = { borderRadius: 0, border: "1.5px solid var(--ink)", background: "var(--paper)", color: "var(--ink)", boxShadow: "none", fontSize: 13, fontFamily: "var(--font-sans)" };

export function TrendChart({ data, height = 280 }: { data: TrendPoint[]; height?: number }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 rounded-sm bg-stone-200 border border-line-2" />Reported</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3 bg-sage-300 border border-ink" />Resolved</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-[1.5px] border-dashed border-ink" />Average days to resolve</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data.map((d) => ({ ...d, avg_days: d.avg_resolution_hours ? +(d.avg_resolution_hours / 24).toFixed(1) : null }))} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--rule)" />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: string) => v.split(" ")[0]} />
          <YAxis yAxisId="n" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis yAxisId="d" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={34} unit="d" />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--stone-200)", opacity: 0.5 }} />
          <Bar yAxisId="n" dataKey="reported" name="Reported" fill="var(--stone-200)" stroke="var(--line-control)" strokeWidth={1} maxBarSize={22} />
          <Bar yAxisId="n" dataKey="resolved" name="Resolved" fill="var(--sage-300)" stroke="var(--ink)" strokeWidth={1} maxBarSize={22} />
          <Line yAxisId="d" dataKey="avg_days" name="Avg days to resolve" stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" dot={{ r: 2.5, fill: "var(--ink)" }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBars({ data, onSelect }: { data: CategoryStat[]; onSelect?: (id: string) => void }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <ul className="space-y-3">
      {data.map((c) => (
        <li key={c.id}>
          <button onClick={() => onSelect?.(c.id)} disabled={!onSelect} className="group block w-full text-left">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 text-ink group-enabled:group-hover:underline"><CategoryIcon icon={c.icon} className="text-slate" />{c.name}</span>
              <span className="num text-slate"><span className="font-medium text-ink">{c.total}</span> · {c.total ? Math.round((c.resolved / c.total) * 100) : 0}% resolved</span>
            </div>
            <div className="relative h-2 border border-line bg-raised">
              <div className="absolute inset-y-0 left-0 rounded-full bg-stone-200 border border-line-2" style={{ width: `${(c.total / max) * 100}%` }} />
              <div className="absolute inset-y-0 left-0 bg-sage-300" style={{ width: `${(c.resolved / max) * 100}%` }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StatusDonut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <div className="flex items-center gap-6">
      <div className="relative size-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={parts} dataKey="value" nameKey="label" innerRadius={52} outerRadius={76} paddingAngle={0} stroke="var(--ink)" strokeWidth={1} isAnimationActive>
              {parts.map((p) => <Cell key={p.label} fill={p.color} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div><p className="num t-h1">{total}</p><p className="text-[11px] text-slate">issues</p></div>
        </div>
      </div>
      <ul className="space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="size-2.5 border border-ink" style={{ background: p.color }} /><span className="text-slate">{p.label}</span>
            <span className="num ml-auto pl-4 font-medium text-ink">{p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PriorityBars({ data }: { data: { priority: string; total: number }[] }) {
  const colors: Record<string, string> = { critical: "var(--rose-500)", high: "var(--yellow-400)", medium: "var(--blue-500)", low: "var(--sage-300)", unset: "var(--stone-200)" };
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 16 }}>
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="priority" tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v: string) => v[0].toUpperCase() + v.slice(1)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--stone-200)", opacity: 0.5 }} />
        <Bar dataKey="total" name="Issues" maxBarSize={18} stroke="var(--ink)" strokeWidth={1}>
          {data.map((d) => <Cell key={d.priority} fill={colors[d.priority] ?? "var(--stone-200)"} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Department scorecards as a table. Ranked metrics are only shown with enough data. */
export function Scorecards({ data }: { data: DeptScore[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-slate">
            <th className="py-2.5 pr-4 font-medium">Department</th>
            <th className="px-3 py-2.5 text-right font-medium">Assigned</th>
            <th className="px-3 py-2.5 text-right font-medium">Resolved</th>
            <th className="px-3 py-2.5 font-medium">Resolution rate</th>
            <th className="px-3 py-2.5 text-right font-medium">First response</th>
            <th className="px-3 py-2.5 text-right font-medium">Time to resolve</th>
            <th className="px-3 py-2.5 text-right font-medium">Overdue now</th>
            <th className="px-3 py-2.5 text-right font-medium">Satisfaction</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.id} className="border-b border-line last:border-0">
              <td className="py-3 pr-4">
                <p className="font-medium text-ink">{d.name}</p>
                <p className="text-xs text-mute">{d.sample_size} reports{d.date_range.from ? `, since ${new Date(d.date_range.from).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` : ""}</p>
              </td>
              <td className="num px-3 text-right">{d.assigned}</td>
              <td className="num px-3 text-right">{d.resolved}</td>
              <td className="px-3">
                {d.enough_data ? (
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 border border-line bg-raised"><div className="h-full bg-sage-300" style={{ width: pct(d.resolution_rate) }} /></div>
                    <span className="num font-medium">{pct(d.resolution_rate)}</span>
                  </div>
                ) : <Badge>Too few reports</Badge>}
              </td>
              <td className="num px-3 text-right">{duration(d.avg_response_hours)}</td>
              <td className="num px-3 text-right">{duration(d.avg_resolution_hours)}</td>
              <td className={`num px-3 text-right ${d.overdue_now ? "font-medium text-red" : ""}`}>{d.overdue_now}{d.ever_overdue > d.overdue_now ? <span className="text-xs text-mute"> ({d.ever_overdue} ever)</span> : null}</td>
              <td className="num px-3 text-right">{d.satisfaction_avg ? `${d.satisfaction_avg.toFixed(1)}/5` : "—"}<span className="block text-xs text-mute">{d.satisfaction_sample ? `${d.satisfaction_sample} ratings` : ""}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
