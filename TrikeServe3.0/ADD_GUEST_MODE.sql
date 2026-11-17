-- ============================================================================
-- GUEST MODE
-- ============================================================================
-- "Continue as guest" uses Supabase anonymous sign-ins: the guest gets a real
-- auth.uid() with the `authenticated` role, exactly like a registered customer.
-- Orders, rides, chat and notifications therefore keep their existing policies
-- and foreign keys — nothing is loosened here.
--
-- Prerequisite in the Supabase dashboard:
--   Authentication -> Sign In / Providers -> Anonymous sign-ins -> enable
-- Without it, supabase.auth.signInAnonymously() is refused and the guest entry
-- point reports that guest mode is unavailable.
-- ============================================================================

-- Marks a users row as a guest profile. Everything else about the row is a
-- normal customer, so every existing query keeps working unchanged.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

-- The guest creates its own profile at sign-in time, so it needs an INSERT
-- policy of its own. Scoped to the caller's own id: this cannot be used to
-- write a row for somebody else.
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.users;
CREATE POLICY "Users can insert their own profile" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = id::text);

-- Partial index: guest cleanup and analytics both scan by this flag, and the
-- overwhelming majority of rows are not guests.
CREATE INDEX IF NOT EXISTS users_is_guest_idx ON public.users (is_guest) WHERE is_guest;

-- ----------------------------------------------------------------------------
-- Optional: clean up abandoned guests.
--
-- Anonymous sign-ins count toward monthly active users and abandoned guest rows
-- accumulate. This deletes guest profiles that never ordered or booked a ride
-- and are older than 30 days. Run it as a scheduled job, not from the app.
-- ----------------------------------------------------------------------------
-- DELETE FROM public.users AS u
-- WHERE u.is_guest
--   AND u.created_at < now() - interval '30 days'
--   AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.customer_id = u.id)
--   AND NOT EXISTS (SELECT 1 FROM public.ride_requests r WHERE r.customer_id = u.id);
