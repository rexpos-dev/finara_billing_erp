# Yearly Plan Discount (Part of Business Orders)

## Goal
Admin sets a **discount %** per company type (instead of typing a Yearly amount by hand); the Yearly price is derived from Monthly x 12 x (1 - discount%). At checkout, a user who picks Yearly sees how much they save vs. paying monthly.

## Decisions
- Discount is per company type, applies only to the Monthly -> Yearly relationship (no discounts on Monthly itself, no promo codes, no time limits).
- The discount is the source of truth: admin no longer types a Yearly amount directly; it's computed and stored server-side.
- Existing Yearly amounts already equal exactly 5% off Monthly x12 for every company type (verified: School 1105x12=13260 -> 12597; Services 1350x12=16200 -> 15390; Retail 980x12=11760 -> 11172; Other 1020x12=12240 -> 11628). Migration backfills discountPercent = 5.00 on every Monthly row so no customer sees a price change.

## Data (Prisma)
- `PlanPrice` gains `discountPercent Decimal? @db.Decimal(5,2)` (nullable, default treated as 0). Meaningful only on the `MONTHLY` row per company type; the `YEARLY` row keeps its own `amount` column, but that amount is now server-computed rather than admin-typed. Grain (`@@unique([companyType, period])`) is unchanged, so order creation's existing `planPrice.findUnique({ companyType_period })` snapshot lookup needs no changes.
- Migration adds the column and backfills `discount_percent = 5.00 WHERE period = 'MONTHLY'`.

## Backend
- New pure helper `computeYearlyAmount(monthlyAmount, discountPercent)` in `server/utils/orderPricing.js`: `round2(monthlyAmount x 12 x (1 - discountPercent/100))`, unit-tested like `computePaidUntil`.
- `orderAdminController.savePrices`:
  - Accepts `discountPercent` on `MONTHLY` entries (0-100, 2 decimals, default 0 if blank).
  - Ignores any client-sent `amount`/`discountPercent` on `YEARLY` entries; recomputes and upserts the `YEARLY` row's `amount` from the sibling `MONTHLY` row's amount + discount.
  - If a company type's `MONTHLY` row is blank/not offered in this save, its `YEARLY` row is forced `isActive: false` (nothing to compute from) regardless of what was submitted.
- `orderAdminController.getPrices` returns `discountPercent` as-is so the admin page can round-trip the value.
- No change to `orderController.js` (user-facing plans list and order creation) - it keeps reading whatever `amount` is stored on the `YEARLY` row.

## Frontend
- **Admin - Plans & Payment page**: new "Discount %" input column between Monthly and Yearly, per company-type row. Yearly cell becomes read-only, live-previewing `monthly x 12 x (1 - discount/100)` as the admin types; its "active" checkbox stays but is disabled/greyed when Monthly is blank. Footnote updated to explain the discount drives the yearly price.
- **Checkout - Add Business modal**: when period = YEARLY and a price is found, also look up the Monthly row for the same company type from the already-loaded prices list (no new API call). If found, show a line under "Amount to pay": `Save {percent}% - PHP{savings} off vs. paying monthly`, where `savings = monthly.amount x 12 - yearly.amount`. If the Monthly row is missing/inactive, skip the savings line silently.

## Testing (Jest, existing style)
- `orderPricing.test.js`: `computeYearlyAmount` - 0%, typical %, rounding to centavos, 100% edge, invalid range.
- `orderAdminController.test.js`: `savePrices` computes/persists yearly amount from monthly+discount and ignores client-sent yearly amount; rejects out-of-range discount; forces yearly inactive when monthly is blank; `getPrices` returns `discountPercent`.
- `orderController.test.js`: sanity check that order creation's price snapshot is unaffected by the schema change.
- No frontend test suite exists in this repo (Jest covers backend only); the modal's savings display is not unit-tested, consistent with the rest of the checkout UI.

## Out of scope
Per-user/promo-code discounts, discounts on Monthly, time-limited/seasonal discounts, discount on company types beyond the existing four.
