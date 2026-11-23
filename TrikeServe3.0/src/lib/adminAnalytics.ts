import { supabase } from "../utils/supabase";

export type AdminAnalyticsPeriod = "today" | "week" | "month" | "year" | "date";

export interface AdminAnalyticsMetrics {
  requests: number;
  completed: number;
  completedInCohort: number;
  cancelled: number;
  resolved: number;
  completionRate: number;
  cancellationRate: number;
  medianAcceptanceMinutes: number | null;
  waitingForDriver: number;
  staleWaitingForDriver: number;
  serviceMix: { privateRide: number; shareRide: number; delivery: number };
  cancellationByActor: Record<string, number>;
  cancellationReasons: Record<string, number>;
  orders: number;
  activeOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  gcashNeedsReview: number;
  oldestGcashReviewHours: number;
}

export interface AdminAnalyticsActivity {
  label: string;
  requests: number;
  completed: number;
  cancelled: number;
  orders: number;
}

export interface AdminTerminalAnalytics {
  id: string;
  name: string;
  requests: number;
  completed: number;
  cancelled: number;
  completionRate: number;
  medianAcceptanceMinutes: number | null;
  waitingForDriver: number;
  staleWaitingForDriver: number;
  orders: number;
  isActive: boolean | null;
}

export interface AdminAnalyticsResponse {
  role: "rider_admin" | "super_admin";
  terminalId: string | null;
  terminalName: string | null;
  period: AdminAnalyticsPeriod;
  generatedAt: string;
  staleThresholdMinutes: number;
  current: AdminAnalyticsMetrics;
  previous: AdminAnalyticsMetrics;
  activity: AdminAnalyticsActivity[];
  terminalSummaries: AdminTerminalAnalytics[];
}

export async function fetchAdminAnalytics(
  credentials: { email: string; password?: string },
  period: AdminAnalyticsPeriod,
  date?: string,
): Promise<AdminAnalyticsResponse> {
  const { data, error } = await supabase.functions.invoke<AdminAnalyticsResponse>("admin-analytics", {
    body: {
      period,
      ...(period === "date" && date ? { date } : {}),
      ...(credentials.password
        ? { adminEmail: credentials.email, adminPassword: credentials.password }
        : {}),
    },
  });

  if (error) throw new Error(error.message || "Analytics could not be loaded.");
  if (!data || !data.current || !data.previous) throw new Error("Analytics returned an incomplete response.");
  return data;
}
