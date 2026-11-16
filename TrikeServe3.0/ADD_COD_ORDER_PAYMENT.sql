-- Cash on delivery for food orders.
--
-- Why this file exists
-- --------------------
-- Checkout used to force the food half of the bill through GCash, leaving only
-- the delivery fee as cash. COD makes the rider collect the whole bill at the
-- door, which means the shop no longer verifies a transfer before cooking --
-- `payment_confirmed_at` stays NULL for these orders on purpose, because no
-- money has moved yet at that point.
--
-- What is recorded instead is the handover: who collected the cash and when.
-- That is the only audit fact COD actually produces, and it is checkable
-- against the order total. There is deliberately no "proof" image: a photo of
-- banknotes cannot show an amount, so it would be evidence theatre.
--
-- The money itself needs no new column. `subtotal` is the food the rider
-- collects, `delivery_fee` is the fee, and `payment_method = 'cod'` says the
-- customer pays both in cash. GCash orders keep `gcash_amount` and get
-- `cash_collected_*` set to NULL.
--
-- Idempotent: safe to re-run.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_collected_by TEXT;

COMMENT ON COLUMN orders.cash_collected_at IS
  'When the rider confirmed receiving the cash for a COD order. NULL for GCash orders and for COD orders not yet collected.';
COMMENT ON COLUMN orders.cash_collected_by IS
  'Rider user id that collected the cash for a COD order.';

CREATE INDEX IF NOT EXISTS idx_orders_cash_collected_at ON orders(cash_collected_at);

-- Should list exactly two columns.
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'orders'
   AND column_name IN ('cash_collected_at', 'cash_collected_by')
 ORDER BY column_name;
