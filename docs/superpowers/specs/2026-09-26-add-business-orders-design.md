# Add Business with Manual Payment Orders (Part 1)

## Goal
Any signed-in user can request an additional business from a **My Businesses** page.
The business is created only after the super admin confirms a manual payment.
Renewal/expiry locking is **Part 2** (out of scope here); the schema carries `paidUntil` so Part 2 needs no migration of existing data.

## Decisions
- Payment is manual: super admin publishes instructions (GCash/bank text + QR); user pays outside the app and submits a reference no. and/or proof.
- Pricing: per company type (`COMPANY_TYPES`) and per period (MONTHLY / YEARLY).
- The user's first business via `/onboarding` stays free and unchanged.
- The new business is granted only to the ordering user (same as `onboard`).

## Data (Prisma)
- `PlanPrice`: companyType, period, amount, isActive; unique (companyType, period).
- `PaymentInstruction`: single row: text, qrImageUrl.
- `BusinessOrder`: userId, company fields (name, tin, address, phone, companyType, taxType, booksStartDate), period, amount (price snapshot), status (`PENDING_PAYMENT` | `PROOF_SUBMITTED` | `APPROVED` | `REJECTED` | `CANCELLED`), referenceNo, proofUrl, reviewNote, reviewedById, reviewedAt, businessId (set on approval).
- `Business.paidUntil DateTime?` (null = untouched/legacy).

## Backend
User (authenticated): `GET /orders/plans`, `POST /orders`, `POST /orders/:id/proof`, `GET /orders`, `POST /orders/:id/cancel`.
Super admin: `GET|PUT /admin/plan-prices`, `PUT /admin/payment-instructions`, `GET /admin/orders`, `POST /admin/orders/:id/approve|reject`.
- Approve extracts the creation steps of `businessController.onboard` into a shared helper (create business, `cloneChartOfAccounts`, `provisionByType`, `UserBusiness` for the orderer), via an atomic status claim (provisioning uses the global prisma client, so no DB transaction); on failure the status is reverted and the half-built business rolled back. Sets `paidUntil` (+1 month / +1 year), records audit.
- Approve is idempotent: status is re-checked inside the transaction; only `PROOF_SUBMITTED` can be approved.
- Users only read/modify their own orders (scoped by `userId`). Price is read from the snapshot on the order, never recomputed.

## Frontend
- **My Businesses** page (all roles): list of own businesses and orders, **Add Business** button.
- Add Business modal mirrors the registration form + period picker with live price; after submit shows payment instructions and a reference no./proof form.
- `settings/businesses` no longer errors for non-admins (skip the admin-only user list call; redirect non-admins to My Businesses).
- Super admin: **Plans & Payment** page (prices, instructions/QR) and **Orders** page (review proof, approve/reject with note). Sidebar entries added.

## Testing (Jest, existing style)
Order creation validation and price snapshot; proof submission; approve creates business + `paidUntil` + access only for orderer; double-approve rejected; reject/cancel; users cannot see others' orders; non-super-admin blocked from admin routes.

## Out of scope
Renewal orders, expiry lock/read-only mode, online payment gateways, refunds.
