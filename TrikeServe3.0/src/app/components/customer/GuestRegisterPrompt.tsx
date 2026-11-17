import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/**
 * The in-app nudge for a signed-in guest.
 *
 * A guest session cannot be signed back into: there is no email or password.
 * The longer someone stays a guest, the more orders and rides are tied to an
 * identity they would lose, so this asks once, as soon as they are inside the
 * app. "Register" upgrades the current account in place (same user id), which
 * is the only way to keep the history they already have.
 */
const DISMISSED_PREFIX = "trikeserve_guest_prompt_dismissed:";

export default function GuestRegisterPrompt() {
  const { user, upgradeGuestAccount } = useAuth();
  const guestId = user?.isGuest ? user.id : null;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"prompt" | "form" | "done">("prompt");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // No guest: either a registered customer, or the guest just upgraded in
    // step "done" below. Either way the dialog's own state decides, not this.
    if (!guestId) return;

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(`${DISMISSED_PREFIX}${guestId}`) === "1";
    } catch {
      // Storage unavailable: show the prompt and let them close it each visit.
    }

    setStep("prompt");
    setEmail("");
    setPassword("");
    setError("");
    setDoneMessage("");
    setOpen(!dismissed);
  }, [guestId]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  const dismiss = () => {
    if (guestId) {
      try {
        localStorage.setItem(`${DISMISSED_PREFIX}${guestId}`, "1");
      } catch {
        // Closing it now is enough if it cannot be remembered.
      }
    }
    setOpen(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSaving(true);

    const result = await upgradeGuestAccount({ email, password });

    setIsSaving(false);

    if (!result.success) {
      setError(result.error || "Could not register this account.");
      return;
    }

    setDoneMessage(
      result.confirmationSent
        ? `We sent a confirmation link to ${email.trim()}. Your orders and rides stay with this account.`
        : "Your account is registered. Your orders and rides stay with it.",
    );
    setStep("done");
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10040] flex items-end justify-center bg-black/50 px-4 pb-6 backdrop-blur-sm sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-register-title"
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl outline-none"
      >
        {step === "done" ? (
          <>
            <h2 id="guest-register-title" className="text-lg font-bold text-[var(--ink)]">
              You're registered
            </h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{doneMessage}</p>
            <Button
              className="mt-4 w-full bg-[var(--primary)] hover:bg-[var(--primary)]"
              onClick={() => setOpen(false)}
            >
              Got it
            </Button>
          </>
        ) : step === "form" ? (
          <form onSubmit={handleRegister}>
            <h2 id="guest-register-title" className="text-lg font-bold text-[var(--ink)]">
              Register your account
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Your name, number, orders and rides stay exactly as they are.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="guest-register-email" className="mb-1 block text-xs font-semibold text-[var(--ink)]">
                  Email address
                </label>
                <Input
                  id="guest-register-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  autoComplete="email"
                  className="border border-line focus:border-[var(--primary)] h-11"
                  required
                  disabled={isSaving}
                />
              </div>

              <div>
                <label htmlFor="guest-register-password" className="mb-1 block text-xs font-semibold text-[var(--ink)]">
                  Password
                </label>
                <Input
                  id="guest-register-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  minLength={6}
                  className="border border-line focus:border-[var(--primary)] h-11"
                  required
                  disabled={isSaving}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-[var(--error)]">{error}</p>
            )}

            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary)]"
                disabled={isSaving}
              >
                {isSaving ? "REGISTERING..." : "CREATE ACCOUNT"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border border-line"
                onClick={() => dismiss()}
                disabled={isSaving}
              >
                Not now
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h2 id="guest-register-title" className="text-lg font-bold text-[var(--ink)]">
              Register to enjoy TrikeServe
            </h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              You're ordering as a guest. Register to keep your orders and rides, save your addresses,
              and sign in from any device — your name and number stay as they are.
            </p>

            <div className="mt-4 flex gap-2">
              <Button
                className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary)]"
                onClick={() => setStep("form")}
              >
                Register
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border border-line"
                onClick={() => dismiss()}
              >
                Not now
              </Button>
            </div>

            <p className="mt-3 text-[11px] text-[var(--muted-foreground)]">
              Guests can order and book rides, but the session stays on this device.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
