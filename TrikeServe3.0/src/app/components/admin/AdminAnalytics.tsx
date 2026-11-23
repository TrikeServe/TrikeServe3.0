import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  CheckCircle,
  Clock3,
  Minus,
  Package,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../../contexts/AuthContext";
import { fetchAdminAnalytics, type AdminAnalyticsMetrics, type AdminAnalyticsPeriod, type AdminAnalyticsResponse } from "../../../lib/adminAnalytics";
import {
  AnalyticsBarChart,
  AnalyticsDonutChart,
  AnalyticsGroupedBarChart,
  type DonutDatum,
  type GroupedBarSeries,
} from "../ui/AnalyticsCharts";
import { Card } from "../ui/card";
import OnlineDriversForTerminal from "./OnlineDriversForTerminal";

const PERIODS: { value: AdminAnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
  { value: "year", label: "Year" },
];

const RIDE_ACTIVITY_SERIES: GroupedBarSeries[] = [
  { key: "requests", label: "Requests", color: "var(--teal)" },
  { key: "completed", label: "Completed", color: "var(--success)" },
  { key: "cancelled", label: "Cancelled", color: "var(--amber)" },
];

function formatDuration(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatPeriod(period: AdminAnalyticsPeriod, selectedDate = "") {
  if (period === "today") return "today";
  if (period === "week") return "the last 7 days";
  if (period === "month") return "the last 30 days";
  if (period === "year") return "the last 12 months";
  const date = selectedDate ? new Date(`${selectedDate}T12:00:00+08:00`) : new Date();
  return `on ${new Intl.DateTimeFormat("en-PH", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila",
  }).format(date)}`;
}

function Comparison({ current, previous, unit = "percent", invert = false }: {
  current: number;
  previous: number;
  unit?: "percent" | "points";
  invert?: boolean;
}) {
  if (previous === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-soft px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">
        <Minus className="size-3" aria-hidden="true" />{current === 0 ? "No change" : "New"}
      </span>
    );
  }
  const delta = unit === "points" ? current - previous : ((current - previous) / previous) * 100;
  const rounded = unit === "points" ? Math.round(delta * 10) / 10 : Math.round(delta);
  const good = invert ? rounded < 0 : rounded > 0;
  const flat = rounded === 0;
  const Icon = flat ? Minus : rounded > 0 ? ArrowUp : ArrowDown;
  const tone = flat
    ? "bg-soft text-[var(--muted-foreground)]"
    : good
      ? "bg-[var(--success-soft)] text-[var(--success-ink)]"
      : "bg-[var(--error-soft)] text-[var(--error)]";
  const suffix = unit === "points" ? " pp" : "%";

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${tone}`}>
      <Icon className="size-3" aria-hidden="true" />
      {flat ? "No change" : `${Math.abs(rounded)}${suffix}`}
    </span>
  );
}

function MetricCard({ label, value, detail, icon: Icon, tone = "teal", comparison, invert = false }: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "teal" | "success" | "amber" | "info" | "violet";
  comparison?: { current: number; previous: number; unit?: "percent" | "points" };
  invert?: boolean;
}) {
  const colors = {
    teal: "bg-[var(--teal-soft)] text-[var(--teal)]",
    success: "bg-[var(--success-soft)] text-[var(--success-ink)]",
    amber: "bg-[var(--amber-soft)] text-[var(--amber-ink)]",
    info: "bg-[var(--info-soft)] text-[var(--info)]",
    violet: "bg-[var(--violet-soft)] text-[var(--violet)]",
  };

  return (
    <Card className="min-w-0 gap-0 rounded-2xl border-line bg-card p-4 sm:p-5">
      <span className={`mb-4 grid size-9 place-items-center rounded-xl ${colors[tone]}`}>
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-2xl font-extrabold leading-none tracking-tight text-[var(--ink)] tabular-nums sm:text-3xl">{value}</p>
        {comparison && <Comparison {...comparison} invert={invert} />}
      </div>
      <h3 className="mt-2 text-xs font-semibold text-[var(--muted-foreground)] sm:text-sm">{label}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{detail}</p>
    </Card>
  );
}

function PeriodFilter({ value, selectedDate, onChange, onDateChange }: {
  value: AdminAnalyticsPeriod;
  selectedDate: string;
  onChange: (period: AdminAnalyticsPeriod) => void;
  onDateChange: (date: string) => void;
}) {
  const latestManilaDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div role="group" aria-label="Analytics date range" className="inline-flex rounded-xl border border-line bg-card p-1">
        {PERIODS.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded-lg px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] ${value === option.value ? "bg-[var(--teal)] text-white shadow-sm" : "text-[var(--muted-foreground)] hover:bg-soft hover:text-[var(--ink)]"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 text-[var(--muted-foreground)] focus-within:ring-2 focus-within:ring-[var(--teal)]">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        <span className="sr-only">View analytics for a specific date</span>
        <input
          type="date"
          aria-label="View analytics for a specific date"
          value={selectedDate}
          max={latestManilaDate}
          onChange={event => onDateChange(event.currentTarget.value)}
          className="min-w-0 bg-transparent text-xs font-semibold text-[var(--ink)] outline-none"
        />
      </label>
    </div>
  );
}

function Section({ title, description, children, action }: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">{title}</h2>
          {description && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CancellationPanel({ metrics, compact = false }: { metrics: AdminAnalyticsMetrics; compact?: boolean }) {
  const actors = Object.entries(metrics.cancellationByActor).sort((a, b) => b[1] - a[1]);
  const reasons = Object.entries(metrics.cancellationReasons).sort((a, b) => b[1] - a[1]).slice(0, compact ? 3 : 5);

  return (
    <Card className={`gap-4 border-line bg-card p-4 ${compact ? "rounded-2xl" : "rounded-3xl sm:p-5"}`}>
      <div>
        <h3 className={`${compact ? "text-sm" : "text-base"} font-bold text-[var(--ink)]`}>Cancellation signals</h3>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{compact ? "See who cancelled and the most common reasons." : "Use the reason and source to decide whether to follow up on coverage, routing, or service issues."}</p>
      </div>
      {metrics.cancelled === 0 ? (
        <p className="rounded-xl bg-[var(--success-soft)] px-3 py-3 text-sm font-semibold text-[var(--success-ink)]">No ride cancellations in this period.</p>
      ) : (
        <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <div>
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">Cancelled by</p>
            <ul className="space-y-2">
              {actors.map(([label, count]) => (
                <li key={label} className="flex items-center justify-between gap-3 rounded-xl bg-soft px-3 py-2 text-sm">
                  <span className="text-[var(--ink)]">{label}</span><strong className="tabular-nums text-[var(--ink)]">{count}</strong>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--muted-foreground)]">Common reasons</p>
            {reasons.length ? (
              <ul className="space-y-2">
                {reasons.map(([label, count]) => (
                  <li key={label} className="flex items-start justify-between gap-3 rounded-xl bg-soft px-3 py-2 text-sm">
                    <span className="min-w-0 break-words text-[var(--ink)]">{label}</span><strong className="shrink-0 tabular-nums text-[var(--ink)]">{count}</strong>
                  </li>
                ))}
              </ul>
            ) : <p className="rounded-xl bg-soft px-3 py-3 text-xs text-[var(--muted-foreground)]">Cancellation reasons have not been recorded.</p>}
          </div>
        </div>
      )}
    </Card>
  );
}

function RideServiceMixPanel({ data, compact = false }: { data: DonutDatum[]; compact?: boolean }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <Card className={`gap-4 border-line bg-card p-4 ${compact ? "rounded-2xl" : "rounded-3xl sm:p-5"}`}>
      <div>
        <h3 className={`${compact ? "text-sm" : "text-base"} font-bold text-[var(--ink)]`}>Ride service mix</h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">Types of requests created during this period</p>
      </div>
      <div role="img" aria-label={data.map(item => `${item.label}: ${item.value}`).join(", ")}>
        <AnalyticsDonutChart
          data={data}
          centerLabel="Requests"
          centerValue={String(total)}
          emptyHint="No ride requests in this period"
        />
      </div>
    </Card>
  );
}

function ActivityCharts({ data }: { data: AdminAnalyticsResponse["activity"] }) {
  const rideActivity = data.map(item => ({
    label: item.label,
    values: { requests: item.requests, completed: item.completed, cancelled: item.cancelled },
  }));
  const orders = data.map(item => ({ label: item.label, value: item.orders }));

  return (
    <div className="grid min-w-0 gap-4 @container @min-[42rem]:grid-cols-2">
      <Card className="min-w-0 gap-4 rounded-3xl border-line bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-base font-bold text-[var(--ink)]">Ride demand and outcomes</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Requests and cancellations by creation date; completions by recorded completion date</p>
        </div>
        <AnalyticsGroupedBarChart data={rideActivity} series={RIDE_ACTIVITY_SERIES} height={190} emptyHint="No ride activity in this period" />
      </Card>
      <Card className="min-w-0 gap-4 rounded-3xl border-line bg-card p-4 sm:p-5">
        <div>
          <h3 className="text-base font-bold text-[var(--ink)]">Food order demand</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">Orders placed during the selected period</p>
        </div>
        <div role="img" aria-label={orders.map(item => `${item.label}: ${item.value} orders`).join(", ")}>
          <AnalyticsBarChart data={orders} color="var(--primary)" height={190} emptyHint="No food orders in this period" />
        </div>
      </Card>
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-label="Loading analytics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 animate-pulse rounded-2xl bg-soft" />)}
    </div>
  );
}

export default function AdminAnalytics({ compact = false, refreshToken = 0 }: {
  compact?: boolean;
  refreshToken?: number;
}) {
  const { user } = useAuth();
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>("week");
  const [selectedDate, setSelectedDate] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isRiderAdmin = user?.adminType === "rider";
  const isSuperAdmin = user?.adminType === "business_customer";

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const hasTerminalAdminSession = isRiderAdmin && !!user?.id;
    if (!user?.email || (!user.password && !hasTerminalAdminSession)) {
      setData(null);
      setError("Admin session needs to be refreshed. Sign out and sign back in to load analytics.");
      setLoading(false);
      return () => { active = false; };
    }

    fetchAdminAnalytics({ email: user.email, password: user.password }, period, selectedDate)
      .then(response => {
        if (!active) return;
        setData(response);
      })
      .catch(() => {
        if (!active) return;
        setData(null);
        setError("Analytics could not be loaded. Refresh to try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [user?.id, user?.email, user?.password, user?.adminType, period, selectedDate, refreshToken, refreshCount]);

  const selectPeriod = (nextPeriod: AdminAnalyticsPeriod) => {
    setSelectedDate("");
    setPeriod(nextPeriod);
  };
  const selectDate = (date: string) => {
    setSelectedDate(date);
    setPeriod(date ? "date" : "week");
  };

  const serviceData = useMemo<DonutDatum[]>(() => [
    { label: "Private ride", value: data?.current.serviceMix.privateRide || 0, color: "var(--success)" },
    { label: "Shared ride", value: data?.current.serviceMix.shareRide || 0, color: "var(--amber)" },
    { label: "Delivery", value: data?.current.serviceMix.delivery || 0, color: "var(--info)" },
  ], [data?.current.serviceMix]);

  const lastUpdated = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })
    : null;

  if (!isRiderAdmin && !isSuperAdmin) {
    return <div role="alert" className="rounded-2xl border border-line bg-soft p-5 text-sm text-[var(--muted-foreground)]">Analytics is available to Super Admins and assigned Rider Admins.</div>;
  }

  const current = data?.current;
  const previous = data?.previous;

  if (compact) {
    return (
      <section aria-labelledby="overview-service-signals-title" aria-busy={loading} className="@container min-w-0 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="overview-service-signals-title" className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">Service signals</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Cancellation patterns and ride types · {formatPeriod(period)}</p>
          </div>
          <Link to="/admin/analytics" className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold text-[var(--teal)] hover:bg-[var(--teal-soft)]">Analytics details <ArrowRight className="size-3.5" aria-hidden="true" /></Link>
        </div>
        {error ? (
          <p role="alert" className="rounded-xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-4 text-sm text-[var(--amber-ink)]">{error}</p>
        ) : loading ? (
          <div className="grid min-w-0 gap-3 @min-[42rem]:grid-cols-2">
            <div className="h-52 animate-pulse rounded-2xl bg-soft" />
            <div className="h-52 animate-pulse rounded-2xl bg-soft" />
          </div>
        ) : data && (
          <div className="grid min-w-0 gap-3 @min-[42rem]:grid-cols-2">
            <CancellationPanel metrics={data.current} compact />
            <RideServiceMixPanel data={serviceData} compact />
          </div>
        )}
      </section>
    );
  }

  const metrics = current ? (isRiderAdmin ? [
    { label: "Ride requests", value: current.requests.toLocaleString(), detail: `Created ${formatPeriod(period, selectedDate)}`, icon: Activity, tone: "teal" as const, comparison: { current: current.requests, previous: previous!.requests } },
    { label: "Completion rate", value: percent(current.completionRate), detail: "Of resolved requests", icon: CheckCircle, tone: "success" as const, comparison: { current: current.completionRate, previous: previous!.completionRate, unit: "points" as const } },
    { label: "Median driver response", value: formatDuration(current.medianAcceptanceMinutes), detail: "Request created to driver acceptance", icon: Clock3, tone: "info" as const },
    { label: "Waiting for a driver", value: current.waitingForDriver.toLocaleString(), detail: "Unassigned requests", icon: Clock3, tone: "info" as const },
    { label: "Food orders", value: current.orders.toLocaleString(), detail: `${current.activeOrders} currently in progress`, icon: Package, tone: "violet" as const, comparison: { current: current.orders, previous: previous!.orders } },
  ] : [
    { label: "Ride requests", value: current.requests.toLocaleString(), detail: `Created ${formatPeriod(period, selectedDate)}`, icon: Activity, tone: "teal" as const, comparison: { current: current.requests, previous: previous!.requests } },
    { label: "Completion rate", value: percent(current.completionRate), detail: "Of resolved requests", icon: CheckCircle, tone: "success" as const, comparison: { current: current.completionRate, previous: previous!.completionRate, unit: "points" as const } },
    { label: "Cancellation rate", value: percent(current.cancellationRate), detail: "Of ride requests created", icon: AlertTriangle, tone: "amber" as const, comparison: { current: current.cancellationRate, previous: previous!.cancellationRate, unit: "points" as const }, invert: true },
    { label: "Waiting for a driver", value: current.waitingForDriver.toLocaleString(), detail: "Unassigned requests", icon: Clock3, tone: "info" as const },
    { label: "Food orders", value: current.orders.toLocaleString(), detail: `${current.activeOrders} currently in progress`, icon: Package, tone: "violet" as const, comparison: { current: current.orders, previous: previous!.orders } },
  ]) : [];

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-6 sm:space-y-8" aria-busy={loading}>
      <section className="relative isolate overflow-hidden rounded-3xl bg-[var(--ink-solid)] p-5 text-white sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 size-80 rounded-full border-[3rem] border-white/5" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--mint)]">TrikeServe · {isRiderAdmin ? "Terminal operations" : "Platform operations"}</p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{isRiderAdmin ? data?.terminalName || user?.terminalName || "Your terminal" : "Monitor the network"}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/75">{isRiderAdmin ? "Spot ride demand, slow driver responses, and delivery workload for your assigned terminal." : "Track service demand, ride outcomes, and operational activity across the platform."}</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-[26rem] sm:max-w-full">
            <PeriodFilter value={period} selectedDate={selectedDate} onChange={selectPeriod} onDateChange={selectDate} />
            <button type="button" disabled={loading} onClick={() => setRefreshCount(value => value + 1)} aria-label="Refresh analytics" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-3 text-sm font-bold text-white hover:bg-white/10 disabled:opacity-60">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /><span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/15 pt-4 text-xs text-white/70">
          <span>{formatPeriod(period, selectedDate)} · Asia/Manila</span>
          {lastUpdated && <span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5" aria-hidden="true" /> Updated {lastUpdated}</span>}
          <span className="ml-auto inline-flex items-center gap-1.5"><CheckCircle className="size-3.5 text-[var(--mint)]" aria-hidden="true" /> {isRiderAdmin ? "Assigned terminal only" : "Platform-wide"}</span>
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-4 text-sm text-[var(--amber-ink)]">
          <span>{error}</span>
          <button type="button" onClick={() => setRefreshCount(value => value + 1)} className="min-h-10 rounded-lg border border-[var(--amber)]/40 px-3 text-xs font-bold">Try again</button>
        </div>
      ) : loading && !data ? <LoadingState /> : data && current ? (
        <>
          <section aria-label="Key operational metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {metrics.map(metric => (
              <MetricCard key={metric.label} {...metric} />
            ))}
          </section>

          {isRiderAdmin && user?.terminalId && (
            <OnlineDriversForTerminal terminalId={user.terminalId} terminalName={data.terminalName || user.terminalName} refreshToken={refreshToken + refreshCount} />
          )}

          <Section title="Demand and outcomes" description={`Operational activity ${formatPeriod(period, selectedDate)}.`}>
            <ActivityCharts data={data.activity} />
          </Section>

          <div className="grid items-start gap-4 xl:grid-cols-2">
            <CancellationPanel metrics={current} />
            <RideServiceMixPanel data={serviceData} />
          </div>

        </>
      ) : null}
    </div>
  );
}
