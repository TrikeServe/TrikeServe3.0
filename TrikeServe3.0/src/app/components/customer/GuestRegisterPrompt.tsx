import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GUEST_REGISTER_FORM_REQUEST_EVENT, guestNeedsName } from "../../../lib/guestOnboarding";

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
  const guestName = user?.isGuest ? user.name : null;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"prompt" | "form" | "done">("prompt");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [doneMessage, setDoneMessage] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Ask for a display name before showing account registration, so new
    // guests only see one first-run prompt at a time.
    if (!guestId) return;

    if (guestNeedsName(guestName)) {
      setOpen(false);
      return;
    }

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
  }, [guestId, guestName]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const openRegistrationForm = () => {
      if (!guestId || guestNeedsName(guestName)) return;
      setStep("form");
      setEmail("");
      setPassword("");
      setError("");
      setDoneMessage("");
      setOpen(true);
    };

    window.addEventListener(GUEST_REGISTER_FORM_REQUEST_EVENT, openRegistrationForm);
    return () => window.removeEventListener(GUEST_REGISTER_FORM_REQUEST_EVENT, openRegistrationForm);
  }, [guestId, guestName]);

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
        className="relative w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl outline-none"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 text-[var(--muted-foreground)] hover:text-[var(--ink)]"
          aria-label="Close"
          onClick={dismiss}
          disabled={isSaving}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
        {step === "done" ? (
          <>
            <h2 id="guest-register-title" className="pr-10 text-lg font-bold text-[var(--ink)]">
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
            <h2 id="guest-register-title" className="pr-10 text-lg font-bold text-[var(--ink)]">
              Register your account
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Your name, orders and rides stay exactly as they are.
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
                type="button"
                variant="outline"
                className="flex-1 border border-line"
                onClick={() => dismiss()}
                disabled={isSaving}
              >
                Not now
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary)]"
                disabled={isSaving}
              >
                {isSaving ? "REGISTERING..." : "CREATE ACCOUNT"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <h2 id="guest-register-title" className="pr-10 text-lg font-bold text-[var(--ink)]">
              Register to enjoy TrikeServe
            </h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              You're ordering as a guest. Register to keep your orders and rides, save your addresses,
              and sign in from any device — your name stays as it is.
            </p>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border border-line"
                onClick={() => dismiss()}
              >
                Not now
              </Button>
              <Button
                className="flex-1 bg-[var(--primary)] hover:bg-[var(--primary)]"
                onClick={() => setStep("form")}
              >
                Register
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
