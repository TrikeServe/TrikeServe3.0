import AdminAnalytics from "./AdminAnalytics";
import AdminShell from "./AdminShell";
import { useAuth } from "../../contexts/AuthContext";

/**
 * Role-aware Analytics page. The service derives terminal scope on the server;
 * this wrapper only sets the page title and shared admin shell.
 */
export default function AdminAnalyticsPage() {
  const { user } = useAuth();
  const isRiderAdmin = user?.adminType === "rider";
  const terminalName = isRiderAdmin ? user?.terminalName : undefined;

  return (
    <AdminShell
      title={isRiderAdmin ? "Terminal analytics" : "Platform analytics"}
      subtitle={
        isRiderAdmin
          ? `${terminalName || "Your terminal"} · demand, response times, and delivery workload`
          : "Service demand, ride outcomes, and operational activity"
      }
    >
      <AdminAnalytics />
    </AdminShell>
  );
}
