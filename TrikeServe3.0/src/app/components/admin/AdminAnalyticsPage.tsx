import AdminAnalytics from "./AdminAnalytics";
import AdminShell from "./AdminShell";
import { useAuth } from "../../contexts/AuthContext";

/**
 * Standalone Analytics page.
 *
 * `AdminAnalytics` is also embedded directly inside AdminDashboard, so it stays
 * a bare content fragment; this wrapper supplies the shared shell for the
 * dedicated /admin/analytics route.
 */
export default function AdminAnalyticsPage() {
  // A Rider Admin only ever sees their own terminal, so the scope is resolved
  // here rather than inside the shared analytics component.
  const { user } = useAuth();
  const isRiderAdmin = user?.adminType === "rider";
  const terminalId = isRiderAdmin ? user?.terminalId ?? null : null;
  const terminalName = isRiderAdmin ? user?.terminalName : undefined;

  return (
    <AdminShell
      title="Analytics"
      subtitle={
        isRiderAdmin
          ? `${terminalName || "Your terminal"} · driver and order performance`
          : "Driver and business performance at a glance"
      }
    >
      <AdminAnalytics terminalId={terminalId} terminalName={terminalName} />
    </AdminShell>
  );
}