-- Analytics foundations for role-scoped admin dashboards.
-- Run after the existing terminal and order-payment migrations, before deploying
-- supabase/functions/admin-analytics.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS terminal_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_terminal_admin BOOLEAN DEFAULT false;

UPDATE public.users
SET is_terminal_admin = false
WHERE is_terminal_admin IS NULL;

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMPTZ;

-- Preserve terminal attribution for older assigned rides. Unassigned historical
-- requests remain platform-wide and are shown as unattributed in Super Admin.
UPDATE public.ride_requests AS ride
SET terminal_id = COALESCE(
  ride.terminal_id,
  (SELECT driver.terminal_id FROM public.users AS driver WHERE driver.id = ride.accepted_driver_id),
  (SELECT driver.terminal_id FROM public.users AS driver WHERE driver.id = ride.driver_id)
)
WHERE ride.terminal_id IS NULL;

-- Attribute older delivery orders to the terminal handling their linked ride.
-- Orders without a terminal-bound ride remain platform-wide only.
UPDATE public.orders AS order_row
SET terminal_id = (
  SELECT ride.terminal_id
  FROM public.ride_requests AS ride
  WHERE ride.order_id = order_row.id
    AND ride.terminal_id IS NOT NULL
  ORDER BY ride.created_at DESC
  LIMIT 1
)
WHERE order_row.terminal_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.ride_requests AS ride
    WHERE ride.order_id = order_row.id
      AND ride.terminal_id IS NOT NULL
  );

-- Backfill a best available acceptance point for requests already assigned to
-- a driver. New assignments are timestamped by the trigger below.
UPDATE public.ride_requests
SET accepted_at = COALESCE(updated_at, created_at, NOW())
WHERE accepted_at IS NULL
  AND (status IN ('accepted', 'in_progress', 'completed')
    OR driver_id IS NOT NULL
    OR accepted_driver_id IS NOT NULL);

-- Backfill a best available completion point for existing completed requests.
UPDATE public.ride_requests
SET completed_at = COALESCE(updated_at, created_at, NOW())
WHERE status = 'completed' AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ride_requests_terminal_created_at
  ON public.ride_requests (terminal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ride_requests_terminal_completed_at
  ON public.ride_requests (terminal_id, completed_at)
  WHERE completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_terminal_created_at
  ON public.orders (terminal_id, created_at);

CREATE OR REPLACE FUNCTION public.set_ride_request_completed_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.accepted_at IS NULL AND (
    NEW.status IN ('accepted', 'in_progress', 'completed')
    OR NEW.driver_id IS NOT NULL
    OR NEW.accepted_driver_id IS NOT NULL
  ) THEN
    NEW.accepted_at := NOW();
  END IF;

  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    ELSE
      NEW.completed_at := COALESCE(OLD.completed_at, NEW.completed_at, NOW());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ride_requests_completed_at ON public.ride_requests;
DROP TRIGGER IF EXISTS trg_ride_requests_analytics_timestamps ON public.ride_requests;
CREATE TRIGGER trg_ride_requests_analytics_timestamps
  BEFORE INSERT OR UPDATE OF status, driver_id, accepted_driver_id ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_ride_request_completed_at();

