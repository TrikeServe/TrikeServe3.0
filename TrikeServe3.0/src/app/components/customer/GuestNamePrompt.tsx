import { useState } from "react";
import { guestNeedsName, GUEST_NAME_PLACEHOLDER } from "../../../lib/guestOnboarding";
import { useAuth } from "../../contexts/AuthContext";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export default function GuestNamePrompt() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const open = Boolean(user?.isGuest && guestNeedsName(user.name));

  const handleSaveName = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.toLocaleLowerCase() === GUEST_NAME_PLACEHOLDER.toLocaleLowerCase()) {
      setError("Please enter your name to continue.");
      return;
    }

    setIsSaving(true);
    const result = await updateProfile({ name: trimmedName });
    setIsSaving(false);

    if (!result.success) {
      setError(result.error || "Could not save your name. Please try again.");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10060] flex items-end justify-center bg-black/55 px-4 pb-6 backdrop-blur-sm sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-name-title"
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-2xl"
      >
        <h2 id="guest-name-title" className="text-lg font-bold text-[var(--ink)]">
          Welcome to TrikeServe
        </h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          What should we call you?
        </p>

        <form onSubmit={handleSaveName} className="mt-4">
          <label htmlFor="guest-display-name" className="mb-1 block text-xs font-semibold text-[var(--ink)]">
            Your name
          </label>
          <Input
            id="guest-display-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Juan Dela Cruz"
            autoComplete="name"
            autoFocus
            className="h-11 border border-line focus:border-[var(--primary)]"
            required
            disabled={isSaving}
          />

          {error && <p role="alert" className="mt-2 text-sm text-[var(--error)]">{error}</p>}

          <Button
            type="submit"
            className="mt-4 h-11 w-full bg-[var(--primary)] hover:bg-[var(--primary)]"
            disabled={isSaving}
          >
            {isSaving ? "SAVING..." : "CONTINUE"}
          </Button>
        </form>
      </section>
    </div>
  );
}
