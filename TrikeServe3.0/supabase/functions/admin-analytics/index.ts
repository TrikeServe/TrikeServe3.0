import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE_SIZE = 500;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const STALE_REQUEST_MINUTES = 15;
const ACTIVE_RIDE_STATUSES = new Set(["pending", "accepted", "in_progress"]);
const ACTIVE_ORDER_STATUSES = new Set([
  "pending", "payment-confirmed", "confirmed", "preparing", "ready", "picked_up", "on-the-way",
]);

type Period = "today" | "week" | "month" | "year" | "date";
type Window = { start: Date; end: Date };
type RideRow = {
  id: string;
  terminal_id: string | null;
  driver_id: string | null;
  accepted_driver_id: string | null;
  created_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  status: string | null;
  ride_type: string | null;
  pickup_location: string | null;
  cancel_reason: string | null;
  cancelled_by: string | null;
};
type OrderRow = {
  id: string;
  terminal_id: string | null;
  created_at: string | null;
  payment_proof_uploaded_at: string | null;
  status: string | null;
  payment_method: string | null;
  payment_proof_url: string | null;
  payment_confirmed_at: string | null;
};
type WaitingRideRow = Pick<RideRow, "id" | "terminal_id" | "driver_id" | "accepted_driver_id" | "created_at">;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function manilaMidnightUtc(localDate: Date) {
  return new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
  ) - MANILA_OFFSET_MS);
}

function parseManilaDateStart(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const localDate = new Date(0);
  localDate.setUTCFullYear(year, month - 1, day);
  localDate.setUTCHours(0, 0, 0, 0);
  if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 || localDate.getUTCDate() !== day) {
    return null;
  }
  return new Date(localDate.getTime() - MANILA_OFFSET_MS);
}

function getWindows(period: Period, now = new Date(), selectedDateStart?: Date) {
  const manilaNow = new Date(now.getTime() + MANILA_OFFSET_MS);
  const manilaTodayStart = new Date(Date.UTC(
    manilaNow.getUTCFullYear(),
    manilaNow.getUTCMonth(),
    manilaNow.getUTCDate(),
  ));
  const currentStart = period === "today"
    ? manilaMidnightUtc(manilaTodayStart)
    : period === "date"
      ? selectedDateStart!
      : period === "year"
        ? new Date(Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth() - 11, 1) - MANILA_OFFSET_MS)
        : new Date(now.getTime() - (period === "week" ? 7 : 30) * 24 * 60 * 60 * 1000);
  const currentEnd = period === "date"
    ? new Date(Math.min(now.getTime(), currentStart.getTime() + 24 * 60 * 60 * 1000))
    : now;
  const elapsed = Math.max(currentEnd.getTime() - currentStart.getTime(), 60 * 1000);
  const localYearStart = period === "year" ? new Date(currentStart.getTime() + MANILA_OFFSET_MS) : null;
  const previousStart = localYearStart
    ? new Date(Date.UTC(localYearStart.getUTCFullYear(), localYearStart.getUTCMonth() - 12, 1) - MANILA_OFFSET_MS)
    : new Date(currentStart.getTime() - elapsed);
  return {
    current: { start: currentStart, end: currentEnd },
    previous: { start: previousStart, end: new Date(previousStart.getTime() + elapsed) },
    queryStart: previousStart,
    queryEnd: currentEnd,
  };
}

function dateValue(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function insideWindow(value: string | null | undefined, window: Window) {
  const date = dateValue(value);
  return !!date && date >= window.start && date < window.end;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isDeliveryRide(ride: RideRow) {
  return (ride.ride_type || "").toLowerCase() === "delivery"
    || String(ride.pickup_location || "").startsWith("DELIVERY|");
}

function serviceType(ride: RideRow) {
  if (isDeliveryRide(ride)) return "delivery";
  const type = (ride.ride_type || "").toLowerCase();
  return type === "share" || type === "shared" ? "shareRide" : "privateRide";
}

function normalizeCanceller(value: string | null) {
  const actor = (value || "").toLowerCase();
  if (actor === "customer") return "Customer";
  if (actor === "driver" || actor === "rider") return "Driver";
  if (actor === "business") return "Business";
  return "Not recorded";
}

function getBuckets(period: Period, current: Window) {
  const localStart = new Date(current.start.getTime() + MANILA_OFFSET_MS);
  const starts: Date[] = [];
  const ends: Date[] = [];
  const labels: string[] = [];
  const dateFormatter = new Intl.DateTimeFormat("en-PH", {
    weekday: "short", timeZone: "Asia/Manila",
  });
  const hourFormatter = new Intl.DateTimeFormat("en-PH", {
    hour: "numeric", timeZone: "Asia/Manila",
  });
  const selectedDateFormatter = new Intl.DateTimeFormat("en-PH", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila",
  });
  const monthFormatter = new Intl.DateTimeFormat("en-PH", {
    month: "short", year: "2-digit", timeZone: "Asia/Manila",
  });

  if (period === "today") {
    for (let index = 0; index < 8; index += 1) {
      const start = new Date(Date.UTC(
        localStart.getUTCFullYear(), localStart.getUTCMonth(), localStart.getUTCDate(), index * 3,
      ) - MANILA_OFFSET_MS);
      starts.push(start);
      ends.push(new Date(start.getTime() + 3 * 60 * 60 * 1000));
      labels.push(hourFormatter.format(start));
    }
  } else if (period === "week") {
    for (let index = 0; index < 7; index += 1) {
      const start = new Date(current.start.getTime() + index * 24 * 60 * 60 * 1000);
      starts.push(start);
      ends.push(new Date(start.getTime() + 24 * 60 * 60 * 1000));
      labels.push(dateFormatter.format(start));
    }
  } else if (period === "date") {
    starts.push(current.start);
    ends.push(current.end);
    labels.push(selectedDateFormatter.format(current.start));
  } else if (period === "year") {
    for (let index = 0; index < 12; index += 1) {
      const start = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth() + index, 1) - MANILA_OFFSET_MS);
      const nextMonth = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth() + index + 1, 1) - MANILA_OFFSET_MS);
      starts.push(start);
      ends.push(new Date(Math.min(current.end.getTime(), nextMonth.getTime())));
      labels.push(monthFormatter.format(start));
    }
  } else {
    const count = 6;
    for (let index = 0; index < count; index += 1) {
      const start = new Date(current.start.getTime() + index * 5 * 24 * 60 * 60 * 1000);
      const end = new Date(Math.min(current.end.getTime(), start.getTime() + 5 * 24 * 60 * 60 * 1000));
      starts.push(start);
      ends.push(end);
      labels.push(`Days ${index * 5 + 1}–${index * 5 + 5}`);
    }
  }

  return starts.map((start, index) => ({ start, end: ends[index], label: labels[index] }));
}

async function readPaged<T>(buildQuery: (start: string, end: string) => any, start: Date, end: Date): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await buildQuery(start.toISOString(), end.toISOString())
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data || []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readOpenGcashReviews(client: any, terminalId: string | null, now: Date) {
  let countQuery = client.from("orders")
    .select("id", { count: "exact", head: true })
    .ilike("payment_method", "gcash")
    .not("payment_proof_url", "is", null)
    .is("payment_confirmed_at", null)
    .neq("status", "cancelled");
  let oldestUploadedQuery = client.from("orders")
    .select("payment_proof_uploaded_at")
    .ilike("payment_method", "gcash")
    .not("payment_proof_url", "is", null)
    .not("payment_proof_uploaded_at", "is", null)
    .is("payment_confirmed_at", null)
    .neq("status", "cancelled")
    .order("payment_proof_uploaded_at", { ascending: true })
    .limit(1);
  let oldestCreatedQuery = client.from("orders")
    .select("created_at")
    .ilike("payment_method", "gcash")
    .not("payment_proof_url", "is", null)
    .is("payment_proof_uploaded_at", null)
    .is("payment_confirmed_at", null)
    .neq("status", "cancelled")
    .order("created_at", { ascending: true })
    .limit(1);

  if (terminalId) {
    countQuery = countQuery.eq("terminal_id", terminalId);
    oldestUploadedQuery = oldestUploadedQuery.eq("terminal_id", terminalId);
    oldestCreatedQuery = oldestCreatedQuery.eq("terminal_id", terminalId);
  }

  const [{ count, error: countError }, { data: uploadedRows, error: uploadedError }, { data: createdRows, error: createdError }] = await Promise.all([
    countQuery,
    oldestUploadedQuery,
    oldestCreatedQuery,
  ]);
  const error = countError || uploadedError || createdError;
  if (error) throw new Error(error.message);

  const oldestDate = dateValue(uploadedRows?.[0]?.payment_proof_uploaded_at)
    || dateValue(createdRows?.[0]?.created_at);
  return {
    count: count || 0,
    oldestHours: oldestDate ? Math.max(0, (now.getTime() - oldestDate.getTime()) / 3_600_000) : 0,
  };
}

function queryRows(client: any, table: string, columns: string, timestampColumn: string, terminalId: string | null) {
  return (start: string, end: string) => {
    let query = client.from(table).select(columns)
      .gte(timestampColumn, start)
      .lt(timestampColumn, end)
      .order(timestampColumn, { ascending: true });
    if (terminalId) query = query.eq("terminal_id", terminalId);
    return query;
  };
}

function measureWindow(
  requests: RideRow[],
  completedEvents: RideRow[],
  orders: OrderRow[],
  window: Window,
  referenceTime: Date,
) {
  const cohort = requests.filter(row => insideWindow(row.created_at, window));
  const completedCohort = cohort.filter(row => row.status === "completed").length;
  const cancelledRows = cohort.filter(row => row.status === "cancelled");
  const resolved = completedCohort + cancelledRows.length;
  const waiting = cohort.filter(row => row.status === "pending" && !row.driver_id && !row.accepted_driver_id);
  const acceptMinutes = cohort.map(row => {
    const created = dateValue(row.created_at);
    const accepted = dateValue(row.accepted_at);
    if (!created || !accepted) return null;
    const minutes = (accepted.getTime() - created.getTime()) / 60_000;
    return minutes >= 0 ? minutes : null;
  }).filter((value): value is number => value !== null);
  const periodOrders = orders.filter(row => insideWindow(row.created_at, window));
  const activeOrders = periodOrders.filter(row => ACTIVE_ORDER_STATUSES.has(String(row.status)));
  const gcashNeedsReview = periodOrders.filter(row =>
    String(row.payment_method || "").toUpperCase() === "GCASH"
    && Boolean(row.payment_proof_url)
    && !row.payment_confirmed_at
    && row.status !== "cancelled"
  );

  return {
    requests: cohort.length,
    completed: completedEvents.filter(row => insideWindow(row.completed_at, window)).length,
    completedInCohort: completedCohort,
    cancelled: cancelledRows.length,
    resolved,
    completionRate: resolved ? (completedCohort / resolved) * 100 : 0,
    cancellationRate: cohort.length ? (cancelledRows.length / cohort.length) * 100 : 0,
    medianAcceptanceMinutes: median(acceptMinutes),
    waitingForDriver: waiting.length,
    staleWaitingForDriver: waiting.filter(row => {
      const created = dateValue(row.created_at);
      return created != null && referenceTime.getTime() - created.getTime() >= STALE_REQUEST_MINUTES * 60_000;
    }).length,
    serviceMix: cohort.reduce((counts, row) => {
      counts[serviceType(row)] += 1;
      return counts;
    }, { privateRide: 0, shareRide: 0, delivery: 0 }),
    cancellationByActor: cancelledRows.reduce<Record<string, number>>((counts, row) => {
      const actor = normalizeCanceller(row.cancelled_by);
      counts[actor] = (counts[actor] || 0) + 1;
      return counts;
    }, {}),
    cancellationReasons: cancelledRows.reduce<Record<string, number>>((counts, row) => {
      const reason = row.cancel_reason?.trim() || "No reason recorded";
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {}),
    orders: periodOrders.length,
    activeOrders: activeOrders.length,
    deliveredOrders: periodOrders.filter(row => row.status === "delivered").length,
    cancelledOrders: periodOrders.filter(row => row.status === "cancelled").length,
    gcashNeedsReview: gcashNeedsReview.length,
    oldestGcashReviewHours: gcashNeedsReview.reduce((oldest, row) => {
      const proofUploaded = dateValue(row.payment_proof_uploaded_at) || dateValue(row.created_at);
      return proofUploaded ? Math.max(oldest, (referenceTime.getTime() - proofUploaded.getTime()) / 3_600_000) : oldest;
    }, 0),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const adminEmail = typeof body.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
  const adminPassword = typeof body.adminPassword === "string" ? body.adminPassword : "";
  const period: Period = body.period === "today" || body.period === "month" || body.period === "year" || body.period === "date"
    ? body.period
    : "week";
  const selectedDate = typeof body.date === "string" ? body.date : "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[admin-analytics] Supabase service configuration is missing");
    return jsonResponse({ error: "Analytics service is not configured" }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let isTerminalAdmin = false;
  let terminalId: string | null = null;
  let terminalName: string | null = null;

  if (adminEmail && adminPassword) {
    const { data: admin, error: adminError } = await serviceClient
      .from("admins")
      .select("admin_type, password_hash, terminal_id, terminal_name")
      .eq("email", adminEmail)
      .maybeSingle();

    if (adminError) {
      console.error("[admin-analytics] Could not validate admin account:", adminError.message);
      return jsonResponse({ error: "Could not verify admin access" }, 500);
    }
    if (!admin || admin.password_hash !== adminPassword || !["admin", "business_customer", "rider"].includes(admin.admin_type)) {
      return jsonResponse({ error: "Admin access could not be verified" }, 401);
    }

    isTerminalAdmin = admin.admin_type === "rider";
    terminalId = isTerminalAdmin && typeof admin.terminal_id === "string" ? admin.terminal_id : null;
    terminalName = isTerminalAdmin && typeof admin.terminal_name === "string" ? admin.terminal_name : null;
  } else {
    const authorization = request.headers.get("authorization") || "";
    const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!accessToken) return jsonResponse({ error: "Admin sign-in is required" }, 401);

    try {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;
      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
      if (authError || !authData.user) return jsonResponse({ error: "Admin sign-in is required" }, 401);

      const { data: riderAdmin, error: riderAdminError } = await serviceClient
        .from("users")
        .select("role, is_terminal_admin, terminal_id, terminal_name")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (riderAdminError) {
        console.error("[admin-analytics] Could not verify terminal admin assignment:", riderAdminError.message);
        return jsonResponse({ error: "Could not verify admin access" }, 500);
      }
      if (riderAdmin?.role !== "rider" || riderAdmin.is_terminal_admin !== true) {
        return jsonResponse({ error: "Admin access could not be verified" }, 403);
      }

      isTerminalAdmin = true;
      terminalId = typeof riderAdmin.terminal_id === "string" ? riderAdmin.terminal_id : null;
      terminalName = typeof riderAdmin.terminal_name === "string" ? riderAdmin.terminal_name : null;
    } catch (error) {
      console.error("[admin-analytics] Could not validate signed-in terminal admin:", error instanceof Error ? error.message : error);
      return jsonResponse({ error: "Could not verify admin access" }, 500);
    }
  }

  if (isTerminalAdmin && !terminalId) return jsonResponse({ error: "This Rider Admin has no terminal assignment" }, 403);

  const now = new Date();
  const selectedDateStart = period === "date" ? parseManilaDateStart(selectedDate) : undefined;
  if (period === "date" && !selectedDateStart) {
    return jsonResponse({ error: "Choose a valid calendar date." }, 400);
  }
  if (selectedDateStart && selectedDateStart > manilaMidnightUtc(new Date(now.getTime() + MANILA_OFFSET_MS))) {
    return jsonResponse({ error: "Choose today or an earlier date." }, 400);
  }
  const windows = getWindows(period, now, selectedDateStart || undefined);
  const rideColumns = "id,terminal_id,driver_id,accepted_driver_id,created_at,accepted_at,completed_at,status,ride_type,pickup_location,cancel_reason,cancelled_by";
  const orderColumns = "id,terminal_id,created_at,payment_proof_uploaded_at,status,payment_method,payment_proof_url,payment_confirmed_at";

  try {
    const requestQuery = queryRows(serviceClient, "ride_requests", rideColumns, "created_at", terminalId);
    const completedQuery = queryRows(serviceClient, "ride_requests", rideColumns, "completed_at", terminalId);
    const orderQuery = queryRows(serviceClient, "orders", orderColumns, "created_at", terminalId);
    const openRequestQuery = () => {
      let query = serviceClient.from("ride_requests")
        .select("id,terminal_id,driver_id,accepted_driver_id,created_at")
        .eq("status", "pending")
        .is("driver_id", null)
        .is("accepted_driver_id", null)
        .order("created_at", { ascending: true });
      if (terminalId) query = query.eq("terminal_id", terminalId);
      return query;
    };
    const [requests, completedEvents, orders, openRequests] = await Promise.all([
      readPaged<RideRow>(requestQuery, windows.queryStart, windows.queryEnd),
      readPaged<RideRow>(completedQuery, windows.queryStart, windows.queryEnd),
      readPaged<OrderRow>(orderQuery, windows.queryStart, windows.queryEnd),
      readPaged<WaitingRideRow>(openRequestQuery, windows.queryStart, windows.queryEnd),
    ]);

    const current = measureWindow(requests, completedEvents, orders, windows.current, now);
    const previous = measureWindow(requests, completedEvents, orders, windows.previous, windows.previous.end);
    current.waitingForDriver = openRequests.length;
    current.staleWaitingForDriver = openRequests.filter(row => {
      const created = dateValue(row.created_at);
      return created != null && now.getTime() - created.getTime() >= STALE_REQUEST_MINUTES * 60_000;
    }).length;
    const openGcashReviews = await readOpenGcashReviews(serviceClient, terminalId, now);
    current.gcashNeedsReview = openGcashReviews.count;
    current.oldestGcashReviewHours = openGcashReviews.oldestHours;
    const buckets = getBuckets(period, windows.current).map(bucket => ({
      ...bucket,
      requests: requests.filter(row => insideWindow(row.created_at, bucket)).length,
      completed: completedEvents.filter(row => insideWindow(row.completed_at, bucket)).length,
      cancelled: requests.filter(row => row.status === "cancelled" && insideWindow(row.created_at, bucket)).length,
      orders: orders.filter(row => insideWindow(row.created_at, bucket)).length,
    }));

    let terminalSummaries: any[] = [];
    if (!isTerminalAdmin) {
      const [{ data: terminals, error: terminalsError }, { data: drivers, error: driversError }] = await Promise.all([
        serviceClient.from("terminals").select("id,name,is_active").order("name", { ascending: true }),
        serviceClient.from("users").select("id,terminal_id").eq("role", "rider"),
      ]);
      if (terminalsError || driversError) throw new Error(terminalsError?.message || driversError?.message || "Could not load terminal directory");

      const terminalNames = new Map<string, string>((terminals || []).map((terminal: any) => [String(terminal.id), String(terminal.name)] as [string, string]));
      const driverTerminal = new Map<string, string>((drivers || [])
        .filter((driver: any) => driver.terminal_id)
        .map((driver: any) => [String(driver.id), String(driver.terminal_id)] as [string, string]));
      const terminalKeyForRide = (ride: Pick<RideRow, "terminal_id" | "accepted_driver_id" | "driver_id">) => ride.terminal_id
        || (ride.accepted_driver_id ? driverTerminal.get(String(ride.accepted_driver_id)) : null)
        || (ride.driver_id ? driverTerminal.get(String(ride.driver_id)) : null)
        || "__unassigned";

      const ids = new Set<string>([
        ...(terminals || []).map((terminal: any) => String(terminal.id)),
        ...requests.map(terminalKeyForRide),
        ...openRequests.map(terminalKeyForRide),
        ...orders.map(order => order.terminal_id || "__unassigned"),
      ]);
      terminalSummaries = [...ids].map(id => {
        const requestRows = requests.filter(row =>
          insideWindow(row.created_at, windows.current) && terminalKeyForRide(row) === id,
        );
        const completionRows = completedEvents.filter(row =>
          insideWindow(row.completed_at, windows.current) && terminalKeyForRide(row) === id,
        );
        const terminalOrders = orders.filter(row =>
          insideWindow(row.created_at, windows.current) && (row.terminal_id || "__unassigned") === id,
        );
        const completedCohort = requestRows.filter(row => row.status === "completed").length;
        const cancelledCohort = requestRows.filter(row => row.status === "cancelled").length;
        const resolved = completedCohort + cancelledCohort;
        const acceptTimes = requestRows.map(row => {
          const created = dateValue(row.created_at);
          const accepted = dateValue(row.accepted_at);
          return created && accepted && accepted >= created ? (accepted.getTime() - created.getTime()) / 60_000 : null;
        }).filter((value): value is number => value !== null);
        const waiting = openRequests.filter(row => terminalKeyForRide(row) === id);
        return {
          id,
          name: id === "__unassigned" ? "No terminal recorded" : terminalNames.get(id) || id,
          requests: requestRows.length,
          completed: completionRows.length,
          cancelled: cancelledCohort,
          completionRate: resolved ? (completedCohort / resolved) * 100 : 0,
          medianAcceptanceMinutes: median(acceptTimes),
          waitingForDriver: waiting.length,
          staleWaitingForDriver: waiting.filter(row => {
            const created = dateValue(row.created_at);
            return created != null && now.getTime() - created.getTime() >= STALE_REQUEST_MINUTES * 60_000;
          }).length,
          orders: terminalOrders.length,
          isActive: (terminals || []).find((terminal: any) => String(terminal.id) === id)?.is_active ?? null,
        };
      }).filter(terminal => terminal.id !== "__unassigned" || terminal.requests > 0 || terminal.orders > 0 || terminal.waitingForDriver > 0)
        .sort((a, b) => b.staleWaitingForDriver - a.staleWaitingForDriver || b.requests - a.requests || a.name.localeCompare(b.name));
    }

    return jsonResponse({
      role: isTerminalAdmin ? "rider_admin" : "super_admin",
      terminalId,
      terminalName: isTerminalAdmin ? terminalName : null,
      period,
      generatedAt: now.toISOString(),
      staleThresholdMinutes: STALE_REQUEST_MINUTES,
      current,
      previous,
      activity: buckets.map(({ label, requests: requestCount, completed, cancelled, orders: orderCount }) => ({
        label, requests: requestCount, completed, cancelled, orders: orderCount,
      })),
      terminalSummaries,
    });
  } catch (error) {
    console.error("[admin-analytics] Failed to build analytics summary:", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "Analytics could not be loaded. Refresh to try again." }, 500);
  }
});
