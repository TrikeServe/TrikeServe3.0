import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDown, ArrowRight, ArrowUp, BarChart3, CheckCircle, Clock3, Minus, Package, RefreshCw, Store, Timer, TrendingUp, Users, XCircle, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { TerminalIconGlyph } from "../ui/TerminalIcon";
import { Card } from "../ui/card";
import {
  AnalyticsBarChart,
  AnalyticsDonutChart,
  type BarDatum,
  type DonutDatum,
} from "../ui/AnalyticsCharts";
import { supabase } from "../../../utils/supabase";

interface RideRow {
  driver_id?: string | null;
  accepted_driver_id?: string | null;
  driver_name?: string | null;
  amount?: number | string | null;
  ride_type?: string | null;
  pickup_location?: string | null;
  status?: string | null;
  terminal_id?: string | null;
  accepted_at?: string | null;
  cancel_reason?: string | null;
  cancelled_by?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

interface OrderRow {
  restaurant_name?: string | null;
  restaurant_email?: string | null;
  total?: number | string | null;
  status?: string | null;
  terminal_id?: string | null;
  created_at?: string | null;
}

type AnalyticsPeriod = "today" | "week" | "month";

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const PERIOD_NAMES: Record<AnalyticsPeriod, string> = {
  today: "today",
  week: "this week",
  month: "this month",
};

/** What the current period is measured against. */
const COMPARISON_NAMES: Record<AnalyticsPeriod, string> = {
  today: "yesterday",
  week: "last week",
  month: "last month",
};

function getPeriodStart(now: Date, period: AnalyticsPeriod) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") {
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
  } else if (period === "month") {
    start.setDate(1);
  }
  return start;
}

/**
 * The same slot one period back (yesterday, last week, last month), cut to the
 * same amount of elapsed time. Comparing a half-finished day with a full
 * previous day would make every figure look like a decline.
 */
function getPreviousWindow(now: Date, period: AnalyticsPeriod) {
  const start = getPeriodStart(now, period);
  const previousStart = new Date(start);
  if (period === "today") previousStart.setDate(previousStart.getDate() - 1);
  else if (period === "week") previousStart.setDate(previousStart.getDate() - 7);
  else previousStart.setMonth(previousStart.getMonth() - 1);

  const elapsed = Math.max(now.getTime() - start.getTime(), 60 * 60 * 1000);
  return { start: previousStart, end: new Date(previousStart.getTime() + elapsed) };
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getRideDate(ride: RideRow) {
  // Completed rides are timestamped by updated_at in the ride flow; use a
  // dedicated completion field when present and fall back for older records.
  return parseDate(ride.completed_at || ride.updated_at || ride.created_at);
}

const DELIVERY_RIDE_TYPES = new Set(["delivery"]);

function isDeliveryRide(ride: RideRow) {
  const type = (ride.ride_type || "").toLowerCase();
  return DELIVERY_RIDE_TYPES.has(type) || String(ride.pickup_location || "").startsWith("DELIVERY|");
}

function businessKey(order: OrderRow) {
  return order.restaurant_name || order.restaurant_email || "Unknown business";
}

/** Percent change; null means there is no meaningful baseline to compare with. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** Difference between two rates, in percentage points. */
function pointChange(current: number, previous: number): number | null {
  return previous === 0 && current === 0 ? 0 : current - previous;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function formatDuration(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function getActivityBuckets(period: AnalyticsPeriod, now: Date) {
  if (period === "today") {
    return Array.from({ length: 8 }, (_, index) => {
      const start = new Date(now);
      start.setHours(index * 3, 0, 0, 0);
      const end = new Date(start);
      end.setHours(end.getHours() + 3);
      return {
        label: start.toLocaleTimeString("en-US", { hour: "numeric" }),
        start,
        end,
      };
    });
  }

  if (period === "week") {
    const weekStart = getPeriodStart(now, period);
    return Array.from({ length: 7 }, (_, index) => {
      const start = new Date(weekStart);
      start.setDate(start.getDate() + index);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return {
        label: start.toLocaleDateString("en-PH", { weekday: "short" }),
        start,
        end,
      };
    });
  }

  const daysElapsed = now.getDate();
  const bucketCount = Math.ceil(daysElapsed / 7);
  return Array.from({ length: bucketCount }, (_, index) => {
    const firstDay = index * 7 + 1;
    const start = new Date(now.getFullYear(), now.getMonth(), firstDay);
    const end = new Date(now.getFullYear(), now.getMonth(), Math.min(firstDay + 7, daysElapsed + 1));
    return { label: `Week ${index + 1}`, start, end };
  });
}

function PeriodFilter({ value, onChange }: {
  value: AnalyticsPeriod;
  onChange: (period: AnalyticsPeriod) => void;
}) {
  return (
    <div role="group" aria-label="Filter performance by period" className="inline-flex shrink-0 rounded-xl border border-line bg-card p-1">
      {PERIOD_OPTIONS.map((option) => (
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
  );
}

// Literal class strings so Tailwind can statically pick up the arbitrary values.
const TONE_CLASSES = {
  primary: { bg: "bg-[var(--primary-soft)]", text: "text-[var(--primary)]" },
  info: { bg: "bg-[var(--info-soft)]", text: "text-[var(--info)]" },
  success: { bg: "bg-[var(--success-soft)]", text: "text-[var(--success-ink)]" },
  violet: { bg: "bg-[var(--violet-soft)]", text: "text-[var(--violet)]" },
} as const;

/**
 * Movement against the previous period. `delta === undefined` renders nothing
 * (used while loading); `null` means there is no baseline yet.
 */
function DeltaChip({
  delta,
  label,
  unit = "percent",
  invert = false,
  onSoft = false,
}: {
  delta: number | null | undefined;
  label: string;
  unit?: "percent" | "points";
  invert?: boolean;
  onSoft?: boolean;
}) {
  if (delta === undefined) return null;

  const suffix = unit === "points" ? " pp" : "%";
  const base = "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums";
  const neutralTone = onSoft ? "bg-card text-[var(--muted-foreground)]" : "bg-soft text-[var(--muted-foreground)]";

  if (delta === null) {
    return (
      <span className={`${base} ${neutralTone}`} aria-label={`${label}: first period with data`}>
        <Minus className="size-3" aria-hidden="true" /> New
      </span>
    );
  }

  const rounded = Math.round(delta);
  const flat = rounded === 0;
  const good = invert ? rounded < 0 : rounded > 0;
  const tone = flat
    ? neutralTone
    : good
      ? "bg-[var(--success-soft)] text-[var(--success-ink)]"
      : "bg-[var(--error-soft)] text-[var(--error)]";
  const Icon = flat ? Minus : rounded > 0 ? ArrowUp : ArrowDown;

  return (
    <span
      className={`${base} ${tone}`}
      aria-label={`${label}: ${flat ? "unchanged" : rounded > 0 ? "up" : "down"} ${Math.abs(rounded)}${unit === "points" ? " percentage points" : " percent"} vs previous period`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {flat ? "Flat" : `${Math.abs(rounded)}${suffix}`}
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  delta,
  deltaUnit,
  invert,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: keyof typeof TONE_CLASSES;
  delta?: number | null;
  deltaUnit?: "percent" | "points";
  invert?: boolean;
}) {
  return (
    <Card className="min-w-0 gap-0 rounded-2xl border-line bg-card p-4 sm:p-5">
      <span className={`mb-4 grid size-9 shrink-0 place-items-center rounded-xl ${TONE_CLASSES[tone].bg}`}>
        <Icon className={`size-[18px] ${TONE_CLASSES[tone].text}`} aria-hidden="true" />
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="break-all text-2xl font-extrabold leading-none tracking-tight text-[var(--ink)] tabular-nums sm:text-3xl">{value}</p>
        <DeltaChip delta={delta} label={label} unit={deltaUnit} invert={invert} />
      </div>
      <h3 className="mt-2 text-xs font-semibold leading-relaxed text-[var(--muted-foreground)] sm:text-sm">{label}</h3>
    </Card>
  );
}

function RankingCard({ title, description, data, tone, loading, currency = false }: {
  title: string;
  description: string;
  data: BarDatum[];
  tone: "info" | "violet";
  loading: boolean;
  currency?: boolean;
}) {
  const max = Math.max(...data.map(item => item.value), 1);
  return (
    <Card className="min-w-0 gap-5 rounded-3xl border-line bg-card p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[var(--ink)]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">{description}</p>
        </div>
        <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${TONE_CLASSES[tone].bg} ${TONE_CLASSES[tone].text}`}>Top 6</span>
      </div>
      {loading ? (
        <div role="status" aria-label={`Loading ${title}`} className="space-y-4 py-2">
          {[1, 2, 3].map(item => <div key={item} className="h-12 animate-pulse rounded-xl bg-soft" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="grid min-h-52 place-content-center justify-items-center gap-3 text-center">
          <BarChart3 className="size-9 text-[var(--muted-foreground)]" aria-hidden="true" />
          <p className="text-sm font-bold text-[var(--ink)]">No activity yet</p>
          <p className="max-w-xs text-xs text-[var(--muted-foreground)]">{currency ? "Businesses will appear here when orders are placed." : "Drivers will appear here after their first completed ride."}</p>
        </div>
      ) : (
        <ol className="space-y-5">
          {data.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex items-start gap-3">
              <span className={`grid size-7 shrink-0 place-items-center rounded-lg text-xs font-extrabold tabular-nums ${index === 0 ? `${TONE_CLASSES[tone].bg} ${TONE_CLASSES[tone].text}` : "bg-soft text-[var(--muted-foreground)]"}`}>{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-sm font-bold text-[var(--ink)]">{item.label}</span>
                  <span className="text-xs font-bold text-[var(--muted-foreground)] tabular-nums">{currency ? `₱${item.value.toLocaleString("en-PH")}` : `${item.value.toLocaleString()} ${item.value === 1 ? "ride" : "rides"}`}</span>
                </div>
                <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-soft">
                  <div className={`h-full rounded-full ${tone === "info" ? "bg-[var(--info)]" : "bg-[var(--violet)]"}`} style={{ width: `${Math.max(0, item.value / max * 100)}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

type HealthStats = {
  requests: number;
  completed: number;
  cancelled: number;
  completionRate: number;
  cancellationRate: number;
  medianAccept: number;
  acceptSamples: number;
  unresolved: number;
  byCanceller: { label: string; value: number }[];
  topReasons: BarDatum[];
};

/**
 * Super Admin analytics: how drivers are performing (completed rides) and how
 * partner businesses are performing (non-cancelled orders), plus platform health
 * (fulfilment, cancellations, response speed). Reads the platform-wide tables
 * directly.
 *
 * When `terminalId` is provided the view is scoped to one TODA: rides count when
 * the ride carries that terminal or was handled by one of its drivers, and orders
 * count when they were routed through that terminal.
 */
export default function AdminAnalytics({
  compact = false,
  refreshToken = 0,
  terminalId = null,
  terminalName,
}: {
  compact?: boolean;
  refreshToken?: number;
  terminalId?: string | null;
  terminalName?: string;
} = {}) {
  const [allRides, setRides] = useState<RideRow[]>([]);
  const [allOrders, setOrders] = useState<OrderRow[]>([]);
  const [terminalDriverIds, setTerminalDriverIds] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [period, setPeriod] = useState<AnalyticsPeriod>("week");

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [ridesRes, ordersRes] = await Promise.all([
          supabase.from("ride_requests").select("*"),
          supabase.from("orders").select("*"),
        ]);

        // Most ride rows carry no terminal of their own, so a TODA view is built
        // from the drivers assigned to it.
        let driverIds = new Set<string>();
        let driversFailed = false;
        if (terminalId) {
          const driversRes = await supabase
            .from("users")
            .select("id")
            .eq("role", "rider")
            .eq("terminal_id", terminalId);
          driversFailed = Boolean(driversRes.error);
          driverIds = new Set((driversRes.data || []).map((driver: any) => String(driver.id)));
        }

        if (!active) return;
        if (ridesRes.error || ordersRes.error || driversFailed) {
          setLoadError('Performance data could not be loaded. Refresh to try again.');
        }
        setRides((ridesRes.data as RideRow[]) || []);
        // Canceled orders shouldn't count toward business performance.
        setOrders(((ordersRes.data as OrderRow[]) || []).filter((o) => o.status !== "cancelled"));
        setTerminalDriverIds(driverIds);
        if (!ridesRes.error && !ordersRes.error && !driversFailed) setLastUpdated(new Date());
      } catch (error) {
        console.error("[AdminAnalytics] Failed to load analytics:", error);
        if (active) setLoadError('Performance data could not be loaded. Refresh to try again.');
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshToken, reload, terminalId]);

  const scopedRides = useMemo(() => {
    if (!terminalId) return allRides;
    return allRides.filter((ride) => {
      if (ride.terminal_id === terminalId) return true;
      const accepted = ride.accepted_driver_id ? terminalDriverIds.has(String(ride.accepted_driver_id)) : false;
      const assigned = ride.driver_id ? terminalDriverIds.has(String(ride.driver_id)) : false;
      return accepted || assigned;
    });
  }, [allRides, terminalId, terminalDriverIds]);

  const scopedOrders = useMemo(
    () => (terminalId ? allOrders.filter((order) => order.terminal_id === terminalId) : allOrders),
    [allOrders, terminalId],
  );

  const { rides, orders, previousRides, previousOrders, health, previousHealth } = useMemo(() => {
    const now = new Date();
    const start = getPeriodStart(now, period);
    const previous = getPreviousWindow(now, period);
    const currentEnd = new Date(now.getTime() + 1);

    const within = (date: Date | null, from: Date, to: Date) => Boolean(date && date >= from && date < to);

    const completedIn = (from: Date, to: Date) =>
      scopedRides.filter((ride) => ride.status === "completed" && within(getRideDate(ride), from, to));

    const ordersIn = (from: Date, to: Date) =>
      scopedOrders.filter((order) => within(parseDate(order.created_at), from, to));

    const buildHealth = (from: Date, to: Date): HealthStats => {
      const requests = scopedRides.filter((ride) => within(parseDate(ride.created_at), from, to));
      const cancelledRides = requests.filter((ride) => ride.status === "cancelled");
      const completed = requests.filter((ride) => ride.status === "completed").length;

      const acceptMinutes = requests
        .map((ride) => {
          const created = parseDate(ride.created_at);
          const accepted = parseDate(ride.accepted_at);
          if (!created || !accepted) return null;
          const minutes = (accepted.getTime() - created.getTime()) / 60000;
          return minutes >= 0 ? minutes : null;
        })
        .filter((minutes): minutes is number => minutes !== null);

      const cancellerCounts = { customer: 0, driver: 0, business: 0, other: 0 };
      cancelledRides.forEach((ride) => {
        const who = String(ride.cancelled_by || "").toLowerCase();
        if (who === "customer") cancellerCounts.customer += 1;
        else if (who === "driver" || who === "rider") cancellerCounts.driver += 1;
        else if (who === "business") cancellerCounts.business += 1;
        else cancellerCounts.other += 1;
      });

      const reasonCounts = new Map<string, number>();
      cancelledRides.forEach((ride) => {
        const reason = (ride.cancel_reason || "").trim() || "No reason given";
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      });

      return {
        requests: requests.length,
        completed,
        cancelled: cancelledRides.length,
        completionRate: requests.length > 0 ? (completed / requests.length) * 100 : 0,
        cancellationRate: requests.length > 0 ? (cancelledRides.length / requests.length) * 100 : 0,
        medianAccept: percentile(acceptMinutes, 50),
        acceptSamples: acceptMinutes.length,
        unresolved: requests.filter((ride) => ["pending", "accepted", "in_progress"].includes(String(ride.status))).length,
        byCanceller: [
          { label: "Customer", value: cancellerCounts.customer },
          { label: "Driver", value: cancellerCounts.driver },
          { label: "Business", value: cancellerCounts.business },
          { label: "Not recorded", value: cancellerCounts.other },
        ].filter((bucket) => bucket.value > 0),
        topReasons: [...reasonCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([label, value]) => ({ label, value })),
      };
    };

    return {
      rides: completedIn(start, currentEnd),
      orders: ordersIn(start, currentEnd),
      previousRides: completedIn(previous.start, previous.end),
      previousOrders: ordersIn(previous.start, previous.end),
      health: buildHealth(start, currentEnd),
      previousHealth: buildHealth(previous.start, previous.end),
    };
  }, [scopedRides, scopedOrders, period]);

  // ---- Driver performance -------------------------------------------------

  const driverStats = useMemo(() => {
    const map = new Map<string, { name: string; trips: number; earnings: number }>();
    rides.forEach((ride) => {
      const key = ride.driver_id || ride.driver_name || "unassigned";
      const entry = map.get(key) || { name: ride.driver_name || "Driver", trips: 0, earnings: 0 };
      entry.trips += 1;
      entry.earnings += Number(ride.amount) || 0;
      if (ride.driver_name) entry.name = ride.driver_name;
      map.set(key, entry);
    });
    return Array.from(map.values());
  }, [rides]);

  const topDrivers = useMemo<BarDatum[]>(
    () =>
      [...driverStats]
        .sort((a, b) => b.trips - a.trips)
        .slice(0, 6)
        .map((d) => ({ label: d.name, value: d.trips })),
    [driverStats]
  );

  const rideTypeDonut = useMemo<DonutDatum[]>(() => {
    let privateCount = 0;
    let shareCount = 0;
    let deliveryCount = 0;
    rides.forEach((ride) => {
      const type = (ride.ride_type || "").toLowerCase();
      if (isDeliveryRide(ride)) deliveryCount += 1;
      else if (type === "share" || type === "shared") shareCount += 1;
      else privateCount += 1;
    });
    return [
      { label: "Private Ride", value: privateCount, color: "var(--success)" },
      { label: "Share Ride", value: shareCount, color: "var(--amber)" },
      { label: "Delivery", value: deliveryCount, color: "var(--info)" },
    ];
  }, [rides]);

  const totalTrips = rides.length;
  const activeDrivers = driverStats.filter((d) => d.trips > 0).length;
  const totalDriverEarnings = driverStats.reduce((sum, d) => sum + d.earnings, 0);
  const avgPerTrip = totalTrips > 0 ? totalDriverEarnings / totalTrips : 0;

  // ---- Business performance ----------------------------------------------

  const businessStats = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; revenue: number }>();
    orders.forEach((order) => {
      const key = businessKey(order);
      const entry = map.get(key) || { name: key, orders: 0, revenue: 0 };
      entry.orders += 1;
      entry.revenue += Number(order.total) || 0;
      map.set(key, entry);
    });
    return Array.from(map.values());
  }, [orders]);

  const topBusinesses = useMemo<BarDatum[]>(
    () =>
      [...businessStats]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 6)
        .map((b) => ({ label: b.name, value: Math.round(b.revenue) })),
    [businessStats]
  );

  const ordersActivity = useMemo<BarDatum[]>(() => {
    const buckets = getActivityBuckets(period, new Date());
    return buckets.map((bucket) => ({
      label: bucket.label,
      value: orders.filter((order) => {
        const created = parseDate(order.created_at);
        return created != null && created >= bucket.start && created < bucket.end;
      }).length,
    }));
  }, [orders, period]);

  const totalOrders = orders.length;
  const grossRevenue = businessStats.reduce((sum, b) => sum + b.revenue, 0);
  const avgOrderValue = totalOrders > 0 ? grossRevenue / totalOrders : 0;

  // ---- Previous period, for the deltas -----------------------------------

  const previousTotals = useMemo(() => {
    const trips = previousRides.length;
    const earnings = previousRides.reduce((sum, ride) => sum + (Number(ride.amount) || 0), 0);
    const drivers = new Set(previousRides.map((ride) => ride.driver_id || ride.driver_name || "unassigned")).size;
    const orders = previousOrders.length;
    const revenue = previousOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const businesses = new Set(previousOrders.map(businessKey)).size;
    return {
      trips,
      earnings,
      drivers,
      orders,
      revenue,
      businesses,
      avgPerTrip: trips > 0 ? earnings / trips : 0,
      avgOrderValue: orders > 0 ? revenue / orders : 0,
    };
  }, [previousRides, previousOrders]);

  const peso = (value: number) =>
    `₱${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toFixed(0)}`;

  // A terminal admin only ever sees their own terminal's drivers; platform-wide
  // health and business figures stay with the Super Admin.
  const isTerminalScoped = Boolean(terminalId);
  const scopeLabel = isTerminalScoped ? terminalName || "Your terminal" : null;

  if (compact) {
    const metrics = [
      { label: "Completed rides", value: String(totalTrips), delta: percentChange(totalTrips, previousTotals.trips), unit: "percent" as const },
      { label: "Orders", value: String(totalOrders), delta: percentChange(totalOrders, previousTotals.orders), unit: "percent" as const },
      { label: "Driver earnings", value: peso(totalDriverEarnings), delta: percentChange(totalDriverEarnings, previousTotals.earnings), unit: "percent" as const },
      { label: "Order value", value: peso(grossRevenue), delta: percentChange(grossRevenue, previousTotals.revenue), unit: "percent" as const },
    ];

    return (
      <section aria-labelledby="overview-performance-title" className="@container min-w-0 space-y-4 rounded-3xl border border-line bg-card p-4 sm:p-5" aria-busy={isLoading}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="overview-performance-title" className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">Platform performance</h2>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">{PERIOD_NAMES[period]} · Cancelled orders excluded</p>
          </div>
          <PeriodFilter value={period} onChange={setPeriod} />
          <Link to="/admin/analytics" className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold text-[var(--teal)] transition-colors hover:bg-[var(--teal-soft)] sm:text-sm">
            View analytics <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {loadError ? (
          <div role="alert" className="rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-5 text-sm text-[var(--amber-ink)]">{loadError}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 @min-[35rem]:grid-cols-4">
              {metrics.map(metric => (
                <div key={metric.label} className="min-w-0 rounded-xl bg-soft p-3 sm:p-4">
                  <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{metric.label}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="break-words text-xl font-extrabold text-[var(--ink)] tabular-nums">{isLoading ? "—" : metric.value}</p>
                    {!isLoading && <DeltaChip delta={metric.delta} label={metric.label} unit={metric.unit} onSoft />}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid min-w-0 gap-4 @min-[38rem]:grid-cols-2">
              <Card className="min-w-0 gap-5 rounded-2xl border-line bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[var(--ink)]">Order activity</h3>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">{period === "today" ? "Orders by 3-hour block" : period === "week" ? "Orders by day this week" : "Orders by week this month"}</p>
                  </div>
                  <span className="rounded-lg bg-[var(--primary-soft)] px-2 py-1 text-[11px] font-bold text-[var(--coral-dark)]">{PERIOD_NAMES[period]}</span>
                </div>
                {isLoading ? (
                  <div role="status" aria-label="Loading order activity" className="h-52 animate-pulse rounded-xl bg-soft" />
                ) : (
                  <div role="img" aria-label={`Orders ${PERIOD_NAMES[period]}: ${ordersActivity.map(day => `${day.label} ${day.value}`).join(', ')}`}>
                    <AnalyticsBarChart data={ordersActivity} color="var(--primary)" height={190} emptyHint={`No orders ${PERIOD_NAMES[period]}`} />
                  </div>
                )}
              </Card>

              <Card className="min-w-0 gap-5 rounded-2xl border-line bg-card p-4 sm:p-5">
                <div>
                  <h3 className="text-base font-bold text-[var(--ink)]">Service mix</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">Completed rides by service type</p>
                </div>
                {isLoading ? (
                  <div role="status" aria-label="Loading service mix" className="h-52 animate-pulse rounded-xl bg-soft" />
                ) : (
                  <div role="img" aria-label={rideTypeDonut.map(service => `${service.label}: ${service.value}`).join(', ')}>
                    <AnalyticsDonutChart data={rideTypeDonut} centerLabel="Completed" centerValue={String(totalTrips)} emptyHint="No completed rides yet" />
                  </div>
                )}
                {!isLoading && <p className="mt-auto border-t border-line pt-3 text-xs text-[var(--muted-foreground)]">{activeDrivers} {activeDrivers === 1 ? "driver has" : "drivers have"} completed rides.</p>}
              </Card>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[100rem] space-y-6 sm:space-y-8">
      <section aria-labelledby="analytics-summary-title" className="relative isolate overflow-hidden rounded-3xl bg-[var(--ink-solid)] p-5 text-white sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 -z-10 size-80 rounded-full border-[3rem] border-white/5" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
          <div className="min-w-0">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--mint)] sm:text-xs">TrikeServe · {scopeLabel ? "Terminal insights" : "Platform insights"}</p>
            <h2 id="analytics-summary-title" className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">{scopeLabel ? `See what moves ${scopeLabel}.` : "See what moves your community."}</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
              {scopeLabel
                ? "Completed rides, service mix, and earnings for the drivers assigned to your terminal."
                : "Explore driver activity, business performance, and the services your community uses."}
            </p>
          </div>
          <div className="shrink-0 space-y-2 sm:text-right">
            <button type="button" disabled={isLoading} onClick={() => setReload(value => value + 1)} aria-label="Refresh analytics" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 text-sm font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-60">
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
              {isLoading ? "Refreshing…" : "Refresh data"}
            </button>
            <p role="status" className="flex items-center gap-1.5 text-xs text-white/70 sm:justify-end">
              <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
              {isLoading ? "Loading platform data…" : loadError ? "Update unavailable" : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}` : "Not yet updated"}
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Analytics sections" className="flex flex-wrap gap-2">
          {!isTerminalScoped && <a href="#analytics-health" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 text-xs font-bold text-[var(--amber-ink)] hover:bg-[var(--amber-soft)]"><Activity className="size-4" aria-hidden="true" /> Health</a>}
          <a href="#analytics-drivers" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 text-xs font-bold text-[var(--info)] hover:bg-[var(--info-soft)]"><TerminalIconGlyph className="size-4" aria-hidden="true" /> Drivers</a>
          {!isTerminalScoped && <a href="#analytics-businesses" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-card px-3 text-xs font-bold text-[var(--violet)] hover:bg-[var(--violet-soft)]"><Store className="size-4" aria-hidden="true" /> Businesses</a>}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <PeriodFilter value={period} onChange={setPeriod} />
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><Clock3 className="size-3.5" aria-hidden="true" /> {isTerminalScoped ? `${PERIOD_NAMES[period]} · Drivers assigned to your terminal` : `${PERIOD_NAMES[period]} · Cancelled orders excluded`}</span>
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--amber)]/40 bg-[var(--amber-soft)] p-5 text-sm text-[var(--amber-ink)]">
          <p className="min-w-0 flex-1">{loadError}</p>
          <button type="button" disabled={isLoading} onClick={() => setReload(value => value + 1)} className="min-h-11 rounded-xl border border-current px-4 text-xs font-bold disabled:opacity-50">Try again</button>
        </div>
      ) : (
      <>
      {/* Platform health is platform-wide, so a terminal admin does not get it. */}
      {!isTerminalScoped && (
      <section id="analytics-health" aria-labelledby="analytics-health-title" aria-busy={isLoading} className="@container min-w-0 scroll-mt-32 space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--amber-soft)] text-[var(--amber-ink)]"><Activity className="size-5" aria-hidden="true" /></span>
          <div>
            <h2 id="analytics-health-title" className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">Platform health</h2>
            <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Requests created {PERIOD_NAMES[period]} · compared with {COMPARISON_NAMES[period]}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 @min-[38rem]:grid-cols-3">
          <StatCard
            label="Completion rate"
            value={isLoading ? "—" : health.requests === 0 ? "—" : `${health.completionRate.toFixed(0)}%`}
            tone="success"
            icon={CheckCircle}
            delta={isLoading || health.requests === 0 || previousHealth.requests === 0 ? undefined : pointChange(health.completionRate, previousHealth.completionRate)}
            deltaUnit="points"
          />
          <StatCard
            label="Cancelled"
            value={isLoading ? "—" : health.requests === 0 ? "—" : `${health.cancellationRate.toFixed(0)}%`}
            tone="primary"
            icon={XCircle}
            delta={isLoading || health.requests === 0 || previousHealth.requests === 0 ? undefined : pointChange(health.cancellationRate, previousHealth.cancellationRate)}
            deltaUnit="points"
            invert
          />
          <StatCard
            label="Median time to accept"
            value={isLoading ? "—" : health.acceptSamples === 0 ? "—" : formatDuration(health.medianAccept)}
            tone="info"
            icon={Timer}
            delta={isLoading || health.acceptSamples === 0 || previousHealth.acceptSamples === 0 ? undefined : percentChange(health.medianAccept, previousHealth.medianAccept)}
            invert
          />
        </div>

        <Card className="min-w-0 gap-5 rounded-3xl border-line bg-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-[var(--ink)]">Where requests fall through</h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {isLoading
                  ? "Loading cancellation detail…"
                  : `${health.cancelled.toLocaleString()} of ${health.requests.toLocaleString()} requests cancelled · ${health.unresolved.toLocaleString()} still open · ${health.completed.toLocaleString()} completed`}
              </p>
            </div>
            <span className="shrink-0 rounded-lg bg-[var(--error-soft)] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--error)]">{PERIOD_NAMES[period]}</span>
          </div>

          {isLoading ? (
            <div role="status" aria-label="Loading cancellation detail" className="space-y-4 py-2">
              {[1, 2, 3].map(item => <div key={item} className="h-12 animate-pulse rounded-xl bg-soft" />)}
            </div>
          ) : health.requests === 0 ? (
            <div className="grid min-h-40 place-content-center justify-items-center gap-3 text-center">
              <BarChart3 className="size-9 text-[var(--muted-foreground)]" aria-hidden="true" />
              <p className="text-sm font-bold text-[var(--ink)]">No ride requests yet</p>
              <p className="max-w-xs text-xs text-[var(--muted-foreground)]">Fulfilment and cancellation figures appear once requests are created {PERIOD_NAMES[period]}.</p>
            </div>
          ) : health.cancelled === 0 ? (
            <p className="border-t border-line pt-4 text-sm text-[var(--muted-foreground)]">No requests were cancelled {PERIOD_NAMES[period]}.</p>
          ) : (
            <div className="grid gap-5 border-t border-line pt-4 @min-[34rem]:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Cancelled by</p>
                <ul className="space-y-3">
                  {health.byCanceller.map(bucket => (
                    <li key={bucket.label} className="min-w-0">
                      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-semibold text-[var(--ink)]">{bucket.label}</span>
                        <span className="font-bold text-[var(--muted-foreground)] tabular-nums">{bucket.value}</span>
                      </div>
                      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-soft">
                        <div className="h-full rounded-full bg-[var(--error)]" style={{ width: `${Math.max(2, bucket.value / health.cancelled * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Top reasons</p>
                <ol className="space-y-2">
                  {health.topReasons.map((reason, index) => (
                    <li key={`${reason.label}-${index}`} className="flex items-start justify-between gap-3 rounded-xl bg-soft px-3 py-2">
                      <span className="min-w-0 break-words text-xs font-semibold leading-relaxed text-[var(--ink)]">{reason.label}</span>
                      <span className="shrink-0 text-xs font-bold text-[var(--muted-foreground)] tabular-nums">{reason.value}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          <p className="border-t border-line pt-4 text-xs leading-relaxed text-[var(--muted-foreground)]">Completion rate counts requests created in the period by their current status, so unassigned and in-progress requests count as not yet completed. Food-delivery trips are included.</p>
        </Card>
      </section>
      )}

      {/* Driver Performance */}
      <section id="analytics-drivers" aria-labelledby="analytics-drivers-title" aria-busy={isLoading} className="@container min-w-0 scroll-mt-32 space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--info-soft)] text-[var(--info)]"><TerminalIconGlyph className="size-5" aria-hidden="true" /></span>
          <div><h2 id="analytics-drivers-title" className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">Driver performance</h2><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{scopeLabel ? "Completed rides handled by your terminal's drivers" : "Completed rides and driver earnings"}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 @min-[38rem]:grid-cols-4">
          <StatCard
            label="Completed Trips"
            value={isLoading ? "—" : String(totalTrips)}
            tone="info"
            icon={TerminalIconGlyph}
            delta={isLoading ? undefined : percentChange(totalTrips, previousTotals.trips)}
          />
          <StatCard
            label="Drivers with trips"
            value={isLoading ? "—" : String(activeDrivers)}
            tone="success"
            icon={Users}
            delta={isLoading ? undefined : percentChange(activeDrivers, previousTotals.drivers)}
          />
          <StatCard
            label="Driver Earnings"
            value={isLoading ? "—" : peso(totalDriverEarnings)}
            tone="primary"
            icon={TrendingUp}
            delta={isLoading ? undefined : percentChange(totalDriverEarnings, previousTotals.earnings)}
          />
          <StatCard
            label="Avg / Trip"
            value={isLoading ? "—" : `₱${avgPerTrip.toFixed(0)}`}
            tone="violet"
            icon={TrendingUp}
            delta={isLoading || previousTotals.trips === 0 ? undefined : percentChange(avgPerTrip, previousTotals.avgPerTrip)}
          />
        </div>

        <div className="grid items-start gap-4 @min-[46rem]:grid-cols-2 sm:gap-5">
          <RankingCard title="Top drivers" description={`Ranked by completed rides · ${PERIOD_NAMES[period]}`} data={topDrivers} tone="info" loading={isLoading} />
          <Card className="min-w-0 gap-5 rounded-3xl border-line bg-card p-4 sm:p-6">
            <div><h3 className="text-base font-bold text-[var(--ink)]">Service mix</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">How completed rides are distributed</p></div>
            {isLoading ? <div role="status" aria-label="Loading service mix" className="h-60 animate-pulse rounded-xl bg-soft" /> : (
              <div role="img" aria-label={rideTypeDonut.map(service => `${service.label}: ${service.value}`).join(', ')}>
                <AnalyticsDonutChart data={rideTypeDonut} centerLabel="Completed" centerValue={String(totalTrips)} emptyHint="No completed rides yet" />
              </div>
            )}
            <p className="flex items-start gap-2 border-t border-line pt-4 text-xs leading-relaxed text-[var(--muted-foreground)]"><CheckCircle className="size-4 shrink-0 text-[var(--success-ink)]" aria-hidden="true" /> Only completed rides are included in driver performance.</p>
          </Card>
        </div>
      </section>

      {/* Business performance is platform-wide, so a terminal admin does not get it. */}
      {!isTerminalScoped && (
      <section id="analytics-businesses" aria-labelledby="analytics-businesses-title" aria-busy={isLoading} className="@container min-w-0 scroll-mt-32 space-y-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--violet-soft)] text-[var(--violet)]"><Store className="size-5" aria-hidden="true" /></span>
          <div><h2 id="analytics-businesses-title" className="text-lg font-bold tracking-tight text-[var(--ink)] sm:text-xl">Business performance</h2><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{scopeLabel ? "Orders routed through your terminal · Cancelled orders excluded" : "Order activity · Cancelled orders excluded"}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 @min-[38rem]:grid-cols-4">
          <StatCard
            label="Orders"
            value={isLoading ? "—" : String(totalOrders)}
            tone="primary"
            icon={Package}
            delta={isLoading ? undefined : percentChange(totalOrders, previousTotals.orders)}
          />
          <StatCard
            label="Businesses with orders"
            value={isLoading ? "—" : String(businessStats.length)}
            tone="violet"
            icon={Store}
            delta={isLoading ? undefined : percentChange(businessStats.length, previousTotals.businesses)}
          />
          <StatCard
            label="Gross order value"
            value={isLoading ? "—" : peso(grossRevenue)}
            tone="success"
            icon={TrendingUp}
            delta={isLoading ? undefined : percentChange(grossRevenue, previousTotals.revenue)}
          />
          <StatCard
            label="Avg Order Value"
            value={isLoading ? "—" : `₱${avgOrderValue.toFixed(0)}`}
            tone="info"
            icon={TrendingUp}
            delta={isLoading || previousTotals.orders === 0 ? undefined : percentChange(avgOrderValue, previousTotals.avgOrderValue)}
          />
        </div>

        <div className="grid items-start gap-4 @min-[46rem]:grid-cols-2 sm:gap-5">
          <RankingCard title="Top businesses" description={`Ranked by gross order value · ${PERIOD_NAMES[period]}`} data={topBusinesses} tone="violet" loading={isLoading} currency />
          <Card className="min-w-0 gap-5 rounded-3xl border-line bg-card p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="text-base font-bold text-[var(--ink)]">Order activity</h3><p className="mt-1 text-xs text-[var(--muted-foreground)]">{period === "today" ? "Orders by 3-hour block" : period === "week" ? "Orders by day this week" : "Orders by week this month"}</p></div>
              <span className="rounded-lg bg-[var(--primary-soft)] px-2 py-1 text-[10px] font-bold text-[var(--coral-dark)]">{PERIOD_NAMES[period]}</span>
            </div>
            {isLoading ? <div role="status" aria-label="Loading order activity" className="h-60 animate-pulse rounded-xl bg-soft" /> : (
              <div role="img" aria-label={`Orders ${PERIOD_NAMES[period]}: ${ordersActivity.map(day => `${day.label} ${day.value}`).join(', ')}`}>
                <AnalyticsBarChart data={ordersActivity} color="var(--primary)" height={210} emptyHint={`No orders ${PERIOD_NAMES[period]}`} />
              </div>
            )}
            <p className="border-t border-line pt-4 text-xs leading-relaxed text-[var(--muted-foreground)]">Order value includes all non-cancelled orders, not just delivered orders.</p>
          </Card>
        </div>
      </section>
      )}
      </>
      )}
    </div>
  );
}
