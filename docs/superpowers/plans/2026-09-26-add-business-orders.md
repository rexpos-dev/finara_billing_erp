# Add Business with Manual Payment Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any signed-in user request an extra business from a "My Businesses" page; the business is created only after a SUPER_ADMIN approves a manual payment order.

**Architecture:** New Prisma models (`PlanPrice`, `PaymentInstruction`, `BusinessOrder`) + `Business.paidUntil`. The business-creation steps in `businessController.onboard` move into a shared helper (`server/utils/provisionBusiness.js`) reused by order approval. One new router `/api/orders` (authenticate only, no `resolveBusiness`) with user routes and `/admin/*` SUPER_ADMIN routes. Approval is guarded by an atomic `updateMany` status claim (provisioning uses the global prisma client, so a DB transaction is not possible; failures revert the status and roll the half-built business back).

**Tech Stack:** Express 4, Prisma 5 / MySQL 8, multer, Jest 30, Next.js 14 App Router, Axios, lucide-react, react-hot-toast.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-26-add-business-orders-design.md`. Renewal/expiry locking is OUT OF SCOPE (Part 2).
- The first business via `/onboarding` stays free and unchanged.
- Order routes use `authenticate` only — never `resolveBusiness` (a user may have no business).
- Admin order routes use `authorize('SUPER_ADMIN')` (ADMIN is NOT enough).
- A user may only read/cancel/upload proof for their own orders (scope by `userId`).
- Amount is snapshotted on the order at creation; never recomputed at approval.
- Errors are thrown with `createError(message, status)`; tests assert `statusCode`.
- Frontend: reuse `card`, `btn-primary`, `btn-secondary`, `btn-danger`, `input`, `label`, `badge*`, `page-header`, `page-title`, `page-subtitle`; icons from `lucide-react`; toasts via `react-hot-toast`; all API calls via `lib/api.js`.
- Follow existing test style: `jest.mock('../server/config/database', ...)`, promise-wrapped controller calls (see `tests/businessOnboarding.test.js`).
- Commit trailer on every commit: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | New models/enums, `Business.paidUntil`, `User.businessOrders` |
| `server/utils/orderPricing.js` (create) | `PERIODS`, `computePaidUntil` |
| `server/utils/provisionBusiness.js` (create) | `provisionByType`, `rollbackBusiness`, `createProvisionedBusiness` |
| `server/controllers/businessController.js` (modify) | Use the helper (onboard/create) |
| `server/utils/orderUploads.js` (create) | multer upload (proof/QR) + `sendStoredFile` |
| `server/controllers/orderController.js` (create) | User-side order actions |
| `server/controllers/orderAdminController.js` (create) | Prices, instructions, order review (approve/reject) |
| `server/routes/orders.js` (create) + `routes/index.js`, `server/index.js` (modify) | Wiring |
| `lib/api.js` (modify) | `orders` API |
| `components/orders/AddBusinessModal.jsx` (create) | Add-business form + payment step |
| `app/(dashboard)/my-businesses/page.jsx` (create) | User's businesses + orders |
| `app/(dashboard)/admin/plans/page.jsx`, `app/(dashboard)/admin/orders/page.jsx` (create) | SUPER_ADMIN pages |
| `components/layout/Sidebar.jsx`, `app/(dashboard)/settings/businesses/page.jsx` (modify) | Nav links; stop non-admin errors |
| `tests/orderPricing.test.js`, `tests/orderController.test.js`, `tests/orderAdminController.test.js` (create) | Tests |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (Business model ~line 11, User model ~line 50, append new models at end)
- Create: `prisma/migrations/<timestamp>_add_business_orders/migration.sql` (generated)

**Interfaces:**
- Produces: Prisma models `planPrice`, `paymentInstruction`, `businessOrder`; enums `OrderPeriod`, `OrderStatus`; `Business.paidUntil DateTime?`.

- [ ] **Step 1: Edit the schema**

In `model Business`, after `booksStartDate DateTime? @db.Date` add:

```prisma
  // Subscription paid-through date. Set when an add-business order is approved.
  // Null = legacy / free business (never locked). Expiry handling is Part 2.
  paidUntil   DateTime?
```

In `model User`, after `userBusinesses UserBusiness[]` add:

```prisma
  businessOrders BusinessOrder[]
```

Append at the end of the file:

```prisma
// ─── Add-business payment orders ───────────────────────────
enum OrderPeriod {
  MONTHLY
  YEARLY
}

enum OrderStatus {
  PENDING_PAYMENT
  PROOF_SUBMITTED
  APPROVED
  REJECTED
  CANCELLED
}

model PlanPrice {
  id          Int         @id @default(autoincrement())
  companyType String      @db.VarChar(20)
  period      OrderPeriod
  amount      Decimal     @db.Decimal(12, 2)
  isActive    Boolean     @default(true)
  updatedAt   DateTime    @updatedAt

  @@unique([companyType, period])
  @@map("plan_prices")
}

// Single row (id = 1): what the user is told when paying.
model PaymentInstruction {
  id         Int      @id @default(1)
  text       String   @db.Text
  qrFileName String?  @db.VarChar(255)
  qrMimeType String?  @db.VarChar(100)
  updatedAt  DateTime @updatedAt

  @@map("payment_instructions")
}

model BusinessOrder {
  id          Int         @id @default(autoincrement())
  orderNo     String      @unique @db.VarChar(20)
  userId      Int
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  // What to create on approval
  companyName    String    @db.VarChar(150)
  tin            String?   @db.VarChar(30)
  address        String?   @db.Text
  phone          String?   @db.VarChar(30)
  companyType    String    @db.VarChar(20)
  taxType        String    @db.VarChar(20)
  booksStartDate DateTime? @db.Date

  period      OrderPeriod
  amount      Decimal     @db.Decimal(12, 2)   // price snapshot
  status      OrderStatus @default(PENDING_PAYMENT)

  referenceNo       String?  @db.VarChar(100)
  proofFileName     String?  @db.VarChar(255)
  proofOriginalName String?  @db.VarChar(255)
  proofMimeType     String?  @db.VarChar(100)

  reviewNote   String?   @db.VarChar(500)
  reviewedById Int?
  reviewedAt   DateTime?
  businessId   Int?      // set once approved

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  @@index([userId])
  @@index([status])
  @@map("business_orders")
}
```

- [ ] **Step 2: Generate the migration and client**

Run: `npx prisma migrate dev --name add_business_orders`
Expected: a new folder under `prisma/migrations/`, "Your database is now in sync", client regenerated. (If it complains about drift, stop and report — do not reset the database.)

- [ ] **Step 3: Verify**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`

- [ ] **Step 4: Commit**

```bash
git add prisma
git commit -m "feat(orders): schema for plan prices, payment instructions and business orders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Order pricing utility (`computePaidUntil`)

**Files:**
- Create: `server/utils/orderPricing.js`
- Test: `tests/orderPricing.test.js`

**Interfaces:**
- Produces: `PERIODS: ['MONTHLY','YEARLY']`; `computePaidUntil(from: Date|string, period: 'MONTHLY'|'YEARLY'): Date` — adds 1 month / 12 months in UTC, clamping to the last day of the target month; throws `Error('Invalid period')` otherwise.

- [ ] **Step 1: Write the failing test**

```js
const { PERIODS, computePaidUntil } = require('../server/utils/orderPricing');

const iso = (d) => d.toISOString().slice(0, 10);

describe('computePaidUntil', () => {
  test('exports the two periods', () => {
    expect(PERIODS).toEqual(['MONTHLY', 'YEARLY']);
  });

  test('monthly adds one calendar month', () => {
    expect(iso(computePaidUntil('2026-09-26T00:00:00Z', 'MONTHLY'))).toBe('2026-10-26');
  });

  test('monthly clamps to the last day of a shorter month', () => {
    expect(iso(computePaidUntil('2026-01-31T00:00:00Z', 'MONTHLY'))).toBe('2026-02-28');
  });

  test('yearly adds twelve months', () => {
    expect(iso(computePaidUntil('2026-09-26T00:00:00Z', 'YEARLY'))).toBe('2027-09-26');
  });

  test('yearly from a leap day clamps to Feb 28', () => {
    expect(iso(computePaidUntil('2028-02-29T00:00:00Z', 'YEARLY'))).toBe('2029-02-28');
  });

  test('rejects an unknown period', () => {
    expect(() => computePaidUntil('2026-09-26T00:00:00Z', 'WEEKLY')).toThrow('Invalid period');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/orderPricing.test.js`
Expected: FAIL — `Cannot find module '../server/utils/orderPricing'`

- [ ] **Step 3: Implement**

```js
// Billing periods for add-business orders and how far each one extends
// Business.paidUntil.
const PERIODS = ['MONTHLY', 'YEARLY'];

/** `from` + 1 month (MONTHLY) or 12 months (YEARLY), UTC, clamped to month end. */
function computePaidUntil(from, period) {
  if (!PERIODS.includes(period)) throw new Error('Invalid period');
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (period === 'YEARLY' ? 12 : 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

module.exports = { PERIODS, computePaidUntil };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/orderPricing.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/orderPricing.js tests/orderPricing.test.js
git commit -m "feat(orders): computePaidUntil for monthly/yearly periods

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extract the shared business-provisioning helper

**Files:**
- Create: `server/utils/provisionBusiness.js`
- Modify: `server/controllers/businessController.js` (remove `provisionByType` + `rollbackBusiness` at ~lines 55-88, rewrite `onboard`, import the helper in `create`)
- Test: existing `tests/businessOnboarding.test.js` (must keep passing unchanged — it is the regression net)

**Interfaces:**
- Produces:
  - `provisionByType(businessId, companyType): Promise<void>`
  - `rollbackBusiness(businessId): Promise<void>`
  - `createProvisionedBusiness({ name, tin, address, phone, email, companyType, taxType, booksStartDate, ownerUserId, paidUntil? }): Promise<Business>` — creates the business (`BIZ-XXXXXX` code, `industry` = company-type label), clones COA from business 1, grants ONLY `ownerUserId`, runs `provisionByType`; on any failure calls `rollbackBusiness` and rethrows. `paidUntil` is only put in the create data when truthy.

- [ ] **Step 1: Run the existing tests to record the baseline**

Run: `npx jest tests/businessOnboarding.test.js tests/businessGetAccessControl.test.js`
Expected: PASS

- [ ] **Step 2: Create the helper** — `provisionByType` and `rollbackBusiness` are moved verbatim from `businessController.js`:

```js
const crypto = require('crypto');
const prisma = require('../config/database');
const { cloneChartOfAccounts } = require('./cloneChartOfAccounts');
const { COMPANY_TYPES, TRADING_RETIRE_CODES } = require('./companyTypes');
const { setupSchool } = require('../../prisma/seedSchool');
const requireSchool = require('../middleware/requireSchool');

// Type-specific setup on top of the cloned COA. A school gets the school COA,
// fee types, grade levels and payment schemes; any other type has the School
// module hidden for THIS business only; TRADING also drops the agency-only
// accounts. Never touches other businesses.
async function provisionByType(businessId, companyType) {
  if (companyType === 'TRADING') {
    await prisma.account.updateMany({
      where: { businessId, accountCode: { in: TRADING_RETIRE_CODES } },
      data:  { isActive: false },
    });
  }
  if (companyType === 'SCHOOL') {
    await setupSchool(businessId, { hideFromOthers: false });
    requireSchool.clearCache(businessId);
  } else {
    await prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId, key: 'disabledModules' } },
      update: { value: JSON.stringify(['school']) },
      create: { businessId, key: 'disabledModules', value: JSON.stringify(['school']) },
    });
  }
}

// Undo a half-built company so a failed setup doesn't leave an orphan behind.
async function rollbackBusiness(businessId) {
  const swallow = () => {};
  await prisma.userBusiness.deleteMany({ where: { businessId } }).catch(swallow);
  await prisma.systemSetting.deleteMany({ where: { businessId } }).catch(swallow);
  for (const m of ['feeType', 'gradeLevel', 'paymentScheme']) {
    await prisma[m].deleteMany({ where: { businessId } }).catch(swallow);
  }
  await prisma.account.deleteMany({ where: { businessId, parentId: { not: null } } }).catch(swallow);
  await prisma.account.deleteMany({ where: { businessId } }).catch(swallow);
  await prisma.business.delete({ where: { id: businessId } }).catch(swallow);
}

// A company owned by exactly one user (self-service onboarding and approved
// orders). Callers validate companyType/taxType first.
async function createProvisionedBusiness({
  name, tin, address, phone, email, companyType, taxType, booksStartDate, ownerUserId, paidUntil = null,
}) {
  const code = `BIZ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const biz = await prisma.business.create({
    data: {
      code, name: String(name).trim(), tin, address, phone, email,
      industry: COMPANY_TYPES[companyType].label,
      taxType,
      booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      ...(paidUntil && { paidUntil }),
    },
  });

  try {
    await cloneChartOfAccounts(1, biz.id);
    await prisma.userBusiness.create({ data: { userId: ownerUserId, businessId: biz.id } });
    await provisionByType(biz.id, companyType);
  } catch (err) {
    await rollbackBusiness(biz.id);
    throw err;
  }
  return biz;
}

module.exports = { provisionByType, rollbackBusiness, createProvisionedBusiness };
```

- [ ] **Step 3: Refactor `businessController.js`**

1. Delete the local `provisionByType` and `rollbackBusiness` functions and their comment blocks.
2. Add: `const { provisionByType, rollbackBusiness, createProvisionedBusiness } = require('../utils/provisionBusiness');`
3. Replace the body of `exports.onboard` after the `already` check with:

```js
    const biz = await createProvisionedBusiness({
      name, tin, address, phone, email: req.user.email,
      companyType, taxType, booksStartDate, ownerUserId: req.user.id,
    });
    res.status(201).json(biz);
  } catch (err) { next(err); }
};
```
   (keep the validation lines and the `already` check above it exactly as they are).
4. `exports.create` keeps using `provisionByType` / `rollbackBusiness` (now imported).
5. Run `Grep` for `setupSchool`, `requireSchool`, `TRADING_RETIRE_CODES`, `cloneChartOfAccounts` in the controller; remove any import that is no longer used anywhere in the file (`cloneChartOfAccounts` is still used by `create`).

- [ ] **Step 4: Run the regression tests**

Run: `npx jest tests/businessOnboarding.test.js tests/businessGetAccessControl.test.js`
Expected: PASS, same test count as Step 1. If a test fails because a `jest.mock` path no longer intercepts, the mocked module paths are unchanged (`../server/utils/cloneChartOfAccounts`, `../prisma/seedSchool`), so investigate the controller edit, do not edit the tests.

- [ ] **Step 5: Commit**

```bash
git add server/utils/provisionBusiness.js server/controllers/businessController.js
git commit -m "refactor(business): extract createProvisionedBusiness for reuse

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: User-side order API

**Files:**
- Create: `server/utils/orderUploads.js`, `server/controllers/orderController.js`
- Test: `tests/orderController.test.js`
- Check: `uploads/` is git-ignored (`git check-ignore uploads/orders/x`; if it prints nothing, add `uploads/` to `.gitignore`).

**Interfaces:**
- Produces (`orderUploads.js`): `uploadMiddleware` (express middleware, field `file`, JPG/PNG/WEBP/PDF, 5 MB, errors → 400 JSON); `removeStoredFile(name)`; `sendStoredFile(res, { fileName, mimeType, originalName })` (404 via `createError` if missing).
- Produces (`orderController.js`): `plans`, `paymentQr`, `create`, `list`, `submitProof`, `cancel`, `downloadProof` — Express handlers `(req,res,next)`.
- Consumes: `PERIODS` (Task 2); `COMPANY_TYPES`, `TAX_TYPES` from `server/utils/companyTypes`; `recordAudit`.

- [ ] **Step 1: Write the failing test** (`tests/orderController.test.js`)

```js
jest.mock('../server/config/database', () => ({
  planPrice:          { findMany: jest.fn(), findUnique: jest.fn() },
  paymentInstruction: { findUnique: jest.fn() },
  businessOrder:      { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/orderUploads', () => ({
  uploadMiddleware: jest.fn(), removeStoredFile: jest.fn(), sendStoredFile: jest.fn(),
}));

const prisma = require('../server/config/database');
const uploads = require('../server/utils/orderUploads');
const ctrl = require('../server/controllers/orderController');

const user = { id: 7, email: 'u@example.com', role: 'MANAGER' };
const call = (fn, req) => new Promise((resolve, reject) => {
  const res = { json: resolve, status: () => ({ json: resolve }) };
  fn({ user, params: {}, body: {}, ...req }, res, reject);
});

const valid = { name: ' Acme ', companyType: 'SERVICES', taxType: 'VAT', period: 'MONTHLY' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.planPrice.findUnique.mockResolvedValue({ amount: 999, isActive: true });
  prisma.businessOrder.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
});

describe('orderController.create', () => {
  test.each([
    [{ ...valid, name: '  ' }, 'Company name is required'],
    [{ ...valid, companyType: 'HACK' }, 'Choose a company type'],
    [{ ...valid, taxType: 'NOPE' }, 'Choose a tax type (VAT or Non-VAT)'],
    [{ ...valid, period: 'WEEKLY' }, 'Choose a billing period'],
  ])('rejects invalid input %#', async (body, message) => {
    await expect(call(ctrl.create, { body })).rejects.toMatchObject({ statusCode: 400, message });
    expect(prisma.businessOrder.create).not.toHaveBeenCalled();
  });

  test('400s when no active price exists for that type and period', async () => {
    prisma.planPrice.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.create, { body: valid })).rejects.toMatchObject({ statusCode: 400 });
    prisma.planPrice.findUnique.mockResolvedValue({ amount: 999, isActive: false });
    await expect(call(ctrl.create, { body: valid })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('snapshots the price and creates a PENDING_PAYMENT order for the caller', async () => {
    const order = await call(ctrl.create, { body: valid });

    expect(prisma.planPrice.findUnique).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
    });
    expect(order).toMatchObject({
      userId: 7, companyName: 'Acme', companyType: 'SERVICES', taxType: 'VAT',
      period: 'MONTHLY', amount: 999, status: 'PENDING_PAYMENT',
    });
    expect(order.orderNo).toMatch(/^ORD-[0-9A-F]{6}$/);
  });
});

describe('orderController.list / plans', () => {
  test('list is scoped to the caller', async () => {
    prisma.businessOrder.findMany.mockResolvedValue([]);
    await call(ctrl.list, {});
    expect(prisma.businessOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
  });

  test('plans returns active prices and whether a QR exists', async () => {
    prisma.planPrice.findMany.mockResolvedValue([{ companyType: 'SERVICES', period: 'MONTHLY', amount: 999 }]);
    prisma.paymentInstruction.findUnique.mockResolvedValue({ text: 'GCash 0917', qrFileName: 'q.png' });
    const out = await call(ctrl.plans, {});
    expect(prisma.planPrice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
    expect(out.instructions).toEqual({ text: 'GCash 0917', hasQr: true });
  });
});

describe('orderController.submitProof', () => {
  const order = { id: 5, userId: 7, status: 'PENDING_PAYMENT', proofFileName: null };

  test('404s for an order that is not the caller\'s', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(null);
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X1' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5, userId: 7 } });
  });

  test('requires a reference number or a file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(order);
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: '  ' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test.each(['APPROVED', 'REJECTED', 'CANCELLED'])('refuses a %s order', async (status) => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, status });
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X1' } }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('moves the order to PROOF_SUBMITTED and stores the reference + file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, proofFileName: 'old.png' });
    prisma.businessOrder.update.mockImplementation(async ({ data }) => ({ id: 5, ...data }));
    const file = { filename: 'new.png', originalname: 'gcash.png', mimetype: 'image/png' };

    const out = await call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: ' GC123 ' }, file });

    expect(out).toMatchObject({ status: 'PROOF_SUBMITTED', referenceNo: 'GC123', proofFileName: 'new.png' });
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('old.png');
  });
});

describe('orderController.cancel', () => {
  test('only cancels the caller\'s open orders', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 1 });
    await call(ctrl.cancel, { params: { id: '5' } });
    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 5, userId: 7, status: { in: ['PENDING_PAYMENT', 'PROOF_SUBMITTED'] } },
      data: { status: 'CANCELLED' },
    });
  });

  test('409s when nothing was cancellable', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.cancel, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('orderController.downloadProof', () => {
  const withProof = { proofFileName: 'p.png', proofMimeType: 'image/png', proofOriginalName: 'p.png' };
  const run = (req) => new Promise((resolve, reject) => {
    uploads.sendStoredFile.mockImplementation(() => resolve('sent'));
    ctrl.downloadProof(req, {}, reject);
  });

  test('owner can download', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(withProof);
    await run({ user, params: { id: '5' } });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5, userId: 7 } });
  });

  test('SUPER_ADMIN can download any order\'s proof', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(withProof);
    await run({ user: { id: 1, role: 'SUPER_ADMIN' }, params: { id: '5' } });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  test('404s when there is no proof on file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ proofFileName: null });
    await expect(call(ctrl.downloadProof, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 404 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/orderController.test.js`
Expected: FAIL — `Cannot find module '../server/utils/orderUploads'` / `orderController`.

- [ ] **Step 3: Create `server/utils/orderUploads.js`**

```js
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { createError } = require('../middleware/errorHandler');

const DIR = path.join(__dirname, '..', '..', 'uploads', 'orders');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const uploader = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or PDF files are allowed')),
}).single('file');

// multer errors become clean 400s instead of a generic 500
const uploadMiddleware = (req, res, next) => {
  uploader(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds 5 MB limit' : err.message;
      return res.status(400).json({ error: msg });
    }
    next();
  });
};

const storedPath = (name) => path.join(DIR, path.basename(name));

const removeStoredFile = (name) => {
  try { if (name) fs.unlinkSync(storedPath(name)); } catch (_) { /* already gone */ }
};

function sendStoredFile(res, { fileName, mimeType, originalName }) {
  const p = storedPath(fileName);
  if (!fs.existsSync(p)) throw createError('File missing from storage', 404);
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName || fileName)}"`);
  fs.createReadStream(p).pipe(res);
}

module.exports = { uploadMiddleware, removeStoredFile, sendStoredFile };
```

- [ ] **Step 4: Create `server/controllers/orderController.js`**

```js
const crypto = require('crypto');
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { COMPANY_TYPES, TAX_TYPES } = require('../utils/companyTypes');
const { PERIODS } = require('../utils/orderPricing');
const { removeStoredFile, sendStoredFile } = require('../utils/orderUploads');

const OPEN = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];

// Active prices + what to tell the user about paying.
exports.plans = async (req, res, next) => {
  try {
    const [prices, ins] = await Promise.all([
      prisma.planPrice.findMany({ where: { isActive: true } }),
      prisma.paymentInstruction.findUnique({ where: { id: 1 } }),
    ]);
    res.json({ prices, instructions: { text: ins?.text || '', hasQr: !!ins?.qrFileName } });
  } catch (err) { next(err); }
};

// The QR image is shown to any signed-in user who has to pay.
exports.paymentQr = async (req, res, next) => {
  try {
    const ins = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    if (!ins?.qrFileName) throw createError('No payment QR has been set up', 404);
    sendStoredFile(res, { fileName: ins.qrFileName, mimeType: ins.qrMimeType });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, tin, address, phone, companyType, taxType, booksStartDate, period } = req.body;
    if (!name || !String(name).trim()) throw createError('Company name is required', 400);
    if (!COMPANY_TYPES[companyType]) throw createError('Choose a company type', 400);
    if (!TAX_TYPES.includes(taxType)) throw createError('Choose a tax type (VAT or Non-VAT)', 400);
    if (!PERIODS.includes(period)) throw createError('Choose a billing period', 400);

    const price = await prisma.planPrice.findUnique({
      where: { companyType_period: { companyType, period } },
    });
    if (!price || !price.isActive) {
      throw createError('This plan is not available yet. Please contact the administrator.', 400);
    }

    const order = await prisma.businessOrder.create({
      data: {
        orderNo: `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        userId: req.user.id,
        companyName: String(name).trim(),
        tin, address, phone, companyType, taxType,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
        period,
        amount: price.amount,
        status: 'PENDING_PAYMENT',
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BusinessOrder', entityId: order.id, summary: `Ordered business "${order.companyName}" (${order.orderNo})` });
    res.status(201).json(order);
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    res.json(await prisma.businessOrder.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' } }));
  } catch (err) { next(err); }
};

exports.submitProof = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const referenceNo = String(req.body.referenceNo || '').trim();
    const order = await prisma.businessOrder.findFirst({ where: { id, userId: req.user.id } });
    if (!order) { removeStoredFile(req.file?.filename); throw createError('Order not found', 404); }
    if (!OPEN.includes(order.status)) { removeStoredFile(req.file?.filename); throw createError('This order can no longer be changed', 409); }
    if (!referenceNo && !req.file) throw createError('Enter the payment reference number or attach a proof', 400);

    const data = { status: 'PROOF_SUBMITTED', referenceNo: referenceNo || order.referenceNo };
    if (req.file) {
      removeStoredFile(order.proofFileName);
      Object.assign(data, {
        proofFileName: req.file.filename,
        proofOriginalName: req.file.originalname,
        proofMimeType: req.file.mimetype,
      });
    }
    const updated = await prisma.businessOrder.update({ where: { id }, data });
    await recordAudit({ req, action: 'UPDATE', entity: 'BusinessOrder', entityId: id, summary: `Submitted payment proof for ${order.orderNo}` });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.cancel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { count } = await prisma.businessOrder.updateMany({
      where: { id, userId: req.user.id, status: { in: OPEN } },
      data: { status: 'CANCELLED' },
    });
    if (!count) throw createError('Order not found or can no longer be cancelled', 409);
    await recordAudit({ req, action: 'UPDATE', entity: 'BusinessOrder', entityId: id, summary: 'Cancelled business order' });
    res.json({ message: 'Order cancelled' });
  } catch (err) { next(err); }
};

// Owner, or SUPER_ADMIN reviewing the order.
exports.downloadProof = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const where = req.user.role === 'SUPER_ADMIN' ? { id } : { id, userId: req.user.id };
    const order = await prisma.businessOrder.findFirst({ where });
    if (!order?.proofFileName) throw createError('No proof on file', 404);
    sendStoredFile(res, {
      fileName: order.proofFileName, mimeType: order.proofMimeType, originalName: order.proofOriginalName,
    });
  } catch (err) { next(err); }
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx jest tests/orderController.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/utils/orderUploads.js server/controllers/orderController.js tests/orderController.test.js .gitignore
git commit -m "feat(orders): user-side order API (create, proof, cancel, list)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: SUPER_ADMIN order API (prices, instructions, approve/reject)

**Files:**
- Create: `server/controllers/orderAdminController.js`
- Test: `tests/orderAdminController.test.js`

**Interfaces:**
- Consumes: `createProvisionedBusiness` (Task 3); `computePaidUntil`, `PERIODS` (Task 2); `removeStoredFile` (Task 4).
- Produces handlers: `getPrices`, `savePrices` (body `{ prices: [{ companyType, period, amount, isActive }] }`), `getInstructions`, `saveInstructions` (multipart: `text`, optional `file` = QR), `listOrders` (`?status=`), `approve`, `reject` (body `{ note }` required).

- [ ] **Step 1: Write the failing test**

```js
jest.mock('../server/config/database', () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  planPrice:          { findMany: jest.fn(), upsert: jest.fn() },
  paymentInstruction: { findUnique: jest.fn(), upsert: jest.fn() },
  businessOrder:      { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/orderUploads', () => ({ removeStoredFile: jest.fn() }));
jest.mock('../server/utils/provisionBusiness', () => ({ createProvisionedBusiness: jest.fn() }));

const prisma = require('../server/config/database');
const { createProvisionedBusiness } = require('../server/utils/provisionBusiness');
const { removeStoredFile } = require('../server/utils/orderUploads');
const ctrl = require('../server/controllers/orderAdminController');

const admin = { id: 1, email: 'sa@example.com', role: 'SUPER_ADMIN' };
const call = (fn, req) => new Promise((resolve, reject) => {
  fn({ user: admin, params: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const order = {
  id: 9, orderNo: 'ORD-AAAAAA', userId: 7, companyName: 'Acme', tin: null, address: null, phone: null,
  companyType: 'SERVICES', taxType: 'VAT', booksStartDate: null, period: 'YEARLY',
  user: { id: 7, email: 'u@example.com' },
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.businessOrder.updateMany.mockResolvedValue({ count: 1 });
  prisma.businessOrder.findUnique.mockResolvedValue(order);
  createProvisionedBusiness.mockResolvedValue({ id: 42, name: 'Acme' });
});

describe('approve', () => {
  test('claims only a PROOF_SUBMITTED order, provisions for the orderer, sets paidUntil and links the business', async () => {
    const out = await call(ctrl.approve, { params: { id: '9' } });

    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 'PROOF_SUBMITTED' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedById: 1 }),
    }));
    const arg = createProvisionedBusiness.mock.calls[0][0];
    expect(arg).toMatchObject({
      name: 'Acme', companyType: 'SERVICES', taxType: 'VAT', ownerUserId: 7, email: 'u@example.com',
    });
    expect(arg.paidUntil).toBeInstanceOf(Date);
    expect(arg.paidUntil.getTime()).toBeGreaterThan(Date.now() + 360 * 864e5); // ~1 year out
    expect(prisma.businessOrder.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { businessId: 42 } });
    expect(out).toMatchObject({ businessId: 42 });
  });

  test('a second approve (status already claimed) is a 409 and creates nothing', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(createProvisionedBusiness).not.toHaveBeenCalled();
  });

  test('if provisioning fails the order goes back to PROOF_SUBMITTED and the error surfaces', async () => {
    createProvisionedBusiness.mockRejectedValue(new Error('boom'));
    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toThrow('boom');
    expect(prisma.businessOrder.updateMany).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
    });
  });
});

describe('reject', () => {
  test('requires a note', async () => {
    await expect(call(ctrl.reject, { params: { id: '9' }, body: { note: '  ' } })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.businessOrder.updateMany).not.toHaveBeenCalled();
  });

  test('rejects only a PROOF_SUBMITTED order and stores the note', async () => {
    await call(ctrl.reject, { params: { id: '9' }, body: { note: 'Amount does not match' } });
    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 'PROOF_SUBMITTED' },
      data: expect.objectContaining({ status: 'REJECTED', reviewNote: 'Amount does not match', reviewedById: 1 }),
    }));
  });

  test('409s when the order is not awaiting review', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.reject, { params: { id: '9' }, body: { note: 'x' } })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('savePrices', () => {
  test.each([
    [[{ companyType: 'HACK', period: 'MONTHLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'WEEKLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: -5 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: 'abc' }]],
    ['nope'],
  ])('rejects invalid rows %#', async (prices) => {
    await expect(call(ctrl.savePrices, { body: { prices } })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.planPrice.upsert).not.toHaveBeenCalled();
  });

  test('upserts each row by (companyType, period)', async () => {
    prisma.planPrice.findMany.mockResolvedValue([]);
    await call(ctrl.savePrices, { body: { prices: [{ companyType: 'SERVICES', period: 'MONTHLY', amount: '499.5', isActive: true }] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
      update: { amount: 499.5, isActive: true },
      create: { companyType: 'SERVICES', period: 'MONTHLY', amount: 499.5, isActive: true },
    });
  });
});

describe('saveInstructions', () => {
  test('replaces the QR file and removes the old one', async () => {
    prisma.paymentInstruction.findUnique.mockResolvedValue({ qrFileName: 'old.png' });
    prisma.paymentInstruction.upsert.mockImplementation(async ({ update }) => update);
    await call(ctrl.saveInstructions, { body: { text: 'GCash 0917' }, file: { filename: 'new.png', mimetype: 'image/png' } });
    expect(prisma.paymentInstruction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { text: 'GCash 0917', qrFileName: 'new.png', qrMimeType: 'image/png' },
    }));
    expect(removeStoredFile).toHaveBeenCalledWith('old.png');
  });

  test('keeps the existing QR when no file is sent', async () => {
    prisma.paymentInstruction.findUnique.mockResolvedValue({ qrFileName: 'old.png' });
    prisma.paymentInstruction.upsert.mockImplementation(async ({ update }) => update);
    await call(ctrl.saveInstructions, { body: { text: 'New text' } });
    expect(prisma.paymentInstruction.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { text: 'New text' } }));
    expect(removeStoredFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/orderAdminController.test.js`
Expected: FAIL — cannot find `orderAdminController`.

- [ ] **Step 3: Implement `server/controllers/orderAdminController.js`**

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { COMPANY_TYPES } = require('../utils/companyTypes');
const { PERIODS, computePaidUntil } = require('../utils/orderPricing');
const { createProvisionedBusiness } = require('../utils/provisionBusiness');
const { removeStoredFile } = require('../utils/orderUploads');

// ─── Prices ──────────────────────────────────────────────────────
exports.getPrices = async (req, res, next) => {
  try { res.json(await prisma.planPrice.findMany({ orderBy: [{ companyType: 'asc' }, { period: 'asc' }] })); }
  catch (err) { next(err); }
};

exports.savePrices = async (req, res, next) => {
  try {
    const { prices } = req.body;
    if (!Array.isArray(prices)) throw createError('prices must be a list', 400);
    const rows = prices.map((p) => {
      const amount = Number(p.amount);
      if (!COMPANY_TYPES[p.companyType]) throw createError(`Unknown company type "${p.companyType}"`, 400);
      if (!PERIODS.includes(p.period)) throw createError(`Unknown period "${p.period}"`, 400);
      if (!Number.isFinite(amount) || amount < 0) throw createError('Amounts must be zero or more', 400);
      return { companyType: p.companyType, period: p.period, amount, isActive: p.isActive !== false };
    });
    await prisma.$transaction(rows.map((r) => prisma.planPrice.upsert({
      where: { companyType_period: { companyType: r.companyType, period: r.period } },
      update: { amount: r.amount, isActive: r.isActive },
      create: r,
    })));
    await recordAudit({ req, action: 'UPDATE', entity: 'PlanPrice', summary: `Updated ${rows.length} plan price(s)` });
    res.json(await prisma.planPrice.findMany({ orderBy: [{ companyType: 'asc' }, { period: 'asc' }] }));
  } catch (err) { next(err); }
};

// ─── Payment instructions ────────────────────────────────────────
exports.getInstructions = async (req, res, next) => {
  try {
    const ins = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    res.json({ text: ins?.text || '', hasQr: !!ins?.qrFileName });
  } catch (err) { next(err); }
};

exports.saveInstructions = async (req, res, next) => {
  try {
    const text = String(req.body.text || '');
    const existing = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    const update = { text };
    if (req.file) {
      update.qrFileName = req.file.filename;
      update.qrMimeType = req.file.mimetype;
    }
    const saved = await prisma.paymentInstruction.upsert({
      where: { id: 1 }, update, create: { id: 1, ...update },
    });
    if (req.file && existing?.qrFileName) removeStoredFile(existing.qrFileName);
    await recordAudit({ req, action: 'UPDATE', entity: 'PaymentInstruction', entityId: 1, summary: 'Updated payment instructions' });
    res.json({ text: saved.text ?? text, hasQr: !!(saved.qrFileName ?? existing?.qrFileName) });
  } catch (err) { next(err); }
};

// ─── Orders ──────────────────────────────────────────────────────
exports.listOrders = async (req, res, next) => {
  try {
    const where = req.query.status ? { status: String(req.query.status) } : {};
    res.json(await prisma.businessOrder.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }));
  } catch (err) { next(err); }
};

// Atomic claim: only one caller can move PROOF_SUBMITTED → APPROVED, so a
// double-click or two admins can never create two businesses. Provisioning
// uses the global prisma client (not a tx), so on failure we revert the claim
// (createProvisionedBusiness has already rolled its own half-built rows back).
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const claimed = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!claimed.count) throw createError('This order is not awaiting approval', 409);

    try {
      const order = await prisma.businessOrder.findUnique({ where: { id }, include: { user: true } });
      const biz = await createProvisionedBusiness({
        name: order.companyName, tin: order.tin, address: order.address, phone: order.phone,
        email: order.user.email,
        companyType: order.companyType, taxType: order.taxType, booksStartDate: order.booksStartDate,
        ownerUserId: order.userId,
        paidUntil: computePaidUntil(new Date(), order.period),
      });
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
      await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
      res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
    } catch (err) {
      await prisma.businessOrder.updateMany({
        where: { id },
        data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
      });
      throw err;
    }
  } catch (err) { next(err); }
};

exports.reject = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const note = String(req.body.note || '').trim();
    if (!note) throw createError('Tell the customer why the payment was rejected', 400);
    const { count } = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'REJECTED', reviewNote: note.slice(0, 500), reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!count) throw createError('This order is not awaiting review', 409);
    await recordAudit({ req, action: 'REJECT', entity: 'BusinessOrder', entityId: id, summary: `Rejected business order: ${note}` });
    res.json({ message: 'Order rejected' });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/orderAdminController.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/controllers/orderAdminController.js tests/orderAdminController.test.js
git commit -m "feat(orders): super-admin prices, instructions and order approval

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Routes and frontend API client

**Files:**
- Create: `server/routes/orders.js`
- Modify: `server/routes/index.js`, `server/index.js`, `lib/api.js`

**Interfaces:**
- Produces HTTP: `GET /api/orders/plans`, `GET /api/orders/payment-qr`, `GET|POST /api/orders`, `POST /api/orders/:id/proof` (multipart `file`, `referenceNo`), `POST /api/orders/:id/cancel`, `GET /api/orders/:id/proof`; SUPER_ADMIN: `GET|PUT /api/orders/admin/prices`, `GET|PUT /api/orders/admin/instructions` (PUT multipart `text`, `file`), `GET /api/orders/admin/orders?status=`, `POST /api/orders/admin/orders/:id/approve|reject`.
- Produces (`lib/api.js`): `orders = { plans, list, create, submitProof(id,{referenceNo,file}), cancel, proofBlob(id), qrBlob, admin: { prices, savePrices, instructions, saveInstructions({text,file}), orders(status), approve, reject(id,note) } }`.

- [ ] **Step 1: Create `server/routes/orders.js`**

```js
const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth');
const { uploadMiddleware } = require('../utils/orderUploads');
const user = require('../controllers/orderController');
const admin = require('../controllers/orderAdminController');

// authenticate only: an order can be placed by any signed-in user and must not
// depend on resolveBusiness (which rejects a user that has no business yet).
router.use(authenticate);

const superOnly = authorize('SUPER_ADMIN');   // ADMIN is deliberately not enough
router.get('/admin/prices',                 superOnly, admin.getPrices);
router.put('/admin/prices',                 superOnly, admin.savePrices);
router.get('/admin/instructions',           superOnly, admin.getInstructions);
router.put('/admin/instructions',           superOnly, uploadMiddleware, admin.saveInstructions);
router.get('/admin/orders',                 superOnly, admin.listOrders);
router.post('/admin/orders/:id/approve',    superOnly, admin.approve);
router.post('/admin/orders/:id/reject',     superOnly, admin.reject);

router.get('/plans',            user.plans);
router.get('/payment-qr',       user.paymentQr);
router.get('/',                 user.list);
router.post('/',                user.create);
router.post('/:id/proof',       uploadMiddleware, user.submitProof);
router.post('/:id/cancel',      user.cancel);
router.get('/:id/proof',        user.downloadProof);

module.exports = router;
```

- [ ] **Step 2: Register it**

In `server/routes/index.js` add `orders:        require('./orders'),` inside the export object (after `school`). In `server/index.js` add `app.use('/api/orders',           routes.orders);` after the `/api/school` line.

- [ ] **Step 3: Add the API client** — in `lib/api.js`, directly after the `businesses` export block:

```js
const multipart = { headers: { 'Content-Type': 'multipart/form-data' } };

// Add-business payment orders. Proof/QR are fetched as blobs because the
// endpoints need the Authorization header (a plain <a>/<img> would not send it).
export const orders = {
  plans:       ()           => api.get('/orders/plans'),
  list:        ()           => api.get('/orders'),
  create:      (data)       => api.post('/orders', data),
  submitProof: (id, { referenceNo, file }) => {
    const fd = new FormData();
    fd.append('referenceNo', referenceNo || '');
    if (file) fd.append('file', file);
    return api.post(`/orders/${id}/proof`, fd, multipart);
  },
  cancel:      (id)         => api.post(`/orders/${id}/cancel`),
  proofBlob:   (id)         => api.get(`/orders/${id}/proof`, { responseType: 'blob' }),
  qrBlob:      ()           => api.get('/orders/payment-qr', { responseType: 'blob' }),
  admin: {
    prices:           ()            => api.get('/orders/admin/prices'),
    savePrices:       (prices)      => api.put('/orders/admin/prices', { prices }),
    instructions:     ()            => api.get('/orders/admin/instructions'),
    saveInstructions: ({ text, file }) => {
      const fd = new FormData();
      fd.append('text', text || '');
      if (file) fd.append('file', file);
      return api.put('/orders/admin/instructions', fd, multipart);
    },
    orders:  (status)      => api.get('/orders/admin/orders', { params: status ? { status } : {} }),
    approve: (id)          => api.post(`/orders/admin/orders/${id}/approve`),
    reject:  (id, note)    => api.post(`/orders/admin/orders/${id}/reject`, { note }),
  },
};
```

- [ ] **Step 4: Verify the server boots and rejects anonymous calls**

Run (PowerShell): `$env:PORT=5055; $p = Start-Process node -ArgumentList 'server/index.js' -PassThru -WindowStyle Hidden; Start-Sleep 4; try { Invoke-WebRequest http://localhost:5055/api/orders/plans -UseBasicParsing } catch { $_.Exception.Response.StatusCode.value__ }; Stop-Process $p`
Expected: prints `401`.

- [ ] **Step 5: Run the whole backend suite, then commit**

Run: `npx jest`
Expected: all suites PASS.

```bash
git add server/routes lib/api.js server/index.js
git commit -m "feat(orders): mount /api/orders and add the orders API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: My Businesses page, Add Business modal, nav and non-admin fix

**Files:**
- Create: `components/orders/AddBusinessModal.jsx`, `app/(dashboard)/my-businesses/page.jsx`
- Modify: `components/layout/Sidebar.jsx`, `app/(dashboard)/settings/businesses/page.jsx`

**Interfaces:**
- Consumes: `orders`, `businesses` from `@/lib/api` (Task 6); `COMPANY_TYPES` from `@/lib/companyTypes`; `formatCurrency`, `formatDate` from `@/lib/auth`.
- Produces: `<AddBusinessModal order={optional order to jump to payment} onClose onDone />` (default export).

- [ ] **Step 1: Create `components/orders/AddBusinessModal.jsx`**

```jsx
'use client';
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const TAX_TYPES = [
  { key: 'VAT',     label: 'VAT-registered', hint: '12% VAT on sales; input VAT is claimable.' },
  { key: 'NON_VAT', label: 'Non-VAT',        hint: 'Percentage tax instead of VAT.' },
];
const PERIODS = [{ key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' }];
const EMPTY = { name: '', tin: '', address: '', phone: '', companyType: '', taxType: '', booksStartDate: '', period: 'MONTHLY' };

// Pass `order` to open straight on the payment step for an existing order.
export default function AddBusinessModal({ order: initialOrder = null, onClose, onDone }) {
  const [plans, setPlans]     = useState({ prices: [], instructions: { text: '', hasQr: false } });
  const [form, setForm]       = useState(EMPTY);
  const [order, setOrder]     = useState(initialOrder);
  const [busy, setBusy]       = useState(false);
  const [qrUrl, setQrUrl]     = useState(null);
  const [referenceNo, setRef] = useState(initialOrder?.referenceNo || '');
  const [file, setFile]       = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    ordersApi.plans().then(({ data }) => setPlans(data)).catch(() => toast.error('Could not load plans'));
  }, []);

  // Show the QR only once we are on the payment step.
  useEffect(() => {
    if (!order || !plans.instructions.hasQr) return undefined;
    let url;
    ordersApi.qrBlob().then(({ data }) => { url = URL.createObjectURL(data); setQrUrl(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [order, plans.instructions.hasQr]);

  const price = plans.prices.find((p) => p.companyType === form.companyType && p.period === form.period);

  const submitOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await ordersApi.create(form);
      setOrder(data);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not place the order');
    } finally { setBusy(false); }
  };

  const submitProof = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await ordersApi.submitProof(order.id, { referenceNo, file });
      toast.success('Payment submitted — we will review it shortly');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit payment');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {order ? `Pay for ${order.orderNo}` : 'Add business'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {!order ? (
          <form onSubmit={submitOrder} className="px-6 py-5 space-y-4">
            <div>
              <label className="label">Company name *</label>
              <input className="input" required value={form.name} onChange={set('name')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">TIN</label><input className="input" value={form.tin} onChange={set('tin')} placeholder="000-000-000-000" /></div>
              <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
            </div>
            <div><label className="label">Address</label><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></div>

            <div>
              <label className="label">Company type *</label>
              <div className="grid grid-cols-2 gap-2">
                {COMPANY_TYPES.map((t) => (
                  <label key={t.key} className={`border rounded-lg p-3 cursor-pointer text-sm ${form.companyType === t.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="companyType" className="sr-only" required checked={form.companyType === t.key}
                      onChange={() => setForm((f) => ({ ...f, companyType: t.key }))} />
                    <span className="font-semibold block">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Tax registration *</label>
              <div className="grid grid-cols-2 gap-2">
                {TAX_TYPES.map((t) => (
                  <label key={t.key} className={`border rounded-lg p-3 cursor-pointer text-sm ${form.taxType === t.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="taxType" className="sr-only" required checked={form.taxType === t.key}
                      onChange={() => setForm((f) => ({ ...f, taxType: t.key }))} />
                    <span className="font-semibold block">{t.label}</span>
                    <span className="text-xs text-gray-500">{t.hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <div><label className="label">Books start date</label><input type="date" className="input" value={form.booksStartDate} onChange={set('booksStartDate')} /></div>

            <div>
              <label className="label">Billing period *</label>
              <div className="grid grid-cols-2 gap-2">
                {PERIODS.map((p) => (
                  <label key={p.key} className={`border rounded-lg p-3 cursor-pointer text-sm text-center ${form.period === p.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="period" className="sr-only" checked={form.period === p.key}
                      onChange={() => setForm((f) => ({ ...f, period: p.key }))} />
                    <span className="font-semibold">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm">
              {!form.companyType ? 'Choose a company type to see the price.'
                : price ? <>Amount to pay: <strong>{formatCurrency(price.amount)}</strong></>
                : <span className="text-red-600">This plan is not available yet. Please contact the administrator.</span>}
            </div>

            <button type="submit" disabled={busy || !price} className="btn-primary w-full justify-center flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue to payment
            </button>
          </form>
        ) : (
          <form onSubmit={submitProof} className="px-6 py-5 space-y-4">
            <p className="text-sm">
              Pay <strong>{formatCurrency(order.amount)}</strong> for <strong>{order.companyName}</strong>, then submit your
              reference number or proof. Your business is created once the payment is confirmed.
            </p>
            {plans.instructions.text
              ? <pre className="whitespace-pre-wrap text-sm rounded-lg bg-gray-50 dark:bg-gray-800 p-3 font-sans">{plans.instructions.text}</pre>
              : <p className="text-sm text-gray-500">Payment instructions have not been set up yet. Please contact the administrator.</p>}
            {qrUrl && <img src={qrUrl} alt="Payment QR" className="mx-auto max-h-56 rounded-lg border" />}

            <div><label className="label">Reference number</label><input className="input" value={referenceNo} onChange={(e) => setRef(e.target.value)} placeholder="e.g. GCash ref no." /></div>
            <div>
              <label className="label">Proof of payment (JPG, PNG, WEBP or PDF, max 5 MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>Pay later</button>
              <button type="submit" disabled={busy || (!referenceNo.trim() && !file)} className="btn-primary flex-1 justify-center flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Submit payment
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(dashboard)/my-businesses/page.jsx`**

```jsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Building2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { businesses as bizApi, orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import AddBusinessModal from '@/components/orders/AddBusinessModal';

const STATUS = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'badge-yellow' },
  PROOF_SUBMITTED: { label: 'Under review',     cls: 'badge-blue' },
  APPROVED:        { label: 'Approved',         cls: 'badge-green' },
  REJECTED:        { label: 'Rejected',         cls: 'badge-red' },
  CANCELLED:       { label: 'Cancelled',        cls: 'badge' },
};

export default function MyBusinessesPage() {
  const [list, setList]       = useState([]);
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);   // null | 'new' | order

  const load = useCallback(async () => {
    try {
      const [b, o] = await Promise.all([bizApi.list(), ordersApi.list()]);
      setList(b.data); setOrders(o.data);
    } catch { toast.error('Failed to load your businesses'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = async (o) => {
    if (!window.confirm(`Cancel order ${o.orderNo}?`)) return;
    try { await ordersApi.cancel(o.id); toast.success('Order cancelled'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not cancel'); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Businesses</h1>
          <p className="page-subtitle">Your companies, and orders for additional ones</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> Add business
        </button>
      </div>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div> : (
        <>
          <div className="card mb-6"><div className="card-body">
            <h2 className="font-semibold mb-3">Businesses</h2>
            {list.length === 0 ? <p className="text-sm text-gray-500">No businesses yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Name</th><th className="py-2">Type</th><th className="py-2">Code</th><th className="py-2">Paid until</th>
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {list.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{b.name}</td>
                      <td className="py-2.5">{b.industry || '—'}</td>
                      <td className="py-2.5 font-mono text-xs">{b.code}</td>
                      <td className="py-2.5">{b.paidUntil ? formatDate(b.paidUntil) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>

          <div className="card"><div className="card-body">
            <h2 className="font-semibold mb-3">Orders</h2>
            {orders.length === 0 ? <p className="text-sm text-gray-500">No orders yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Order</th><th className="py-2">Company</th><th className="py-2">Period</th>
                  <th className="py-2 text-right">Amount</th><th className="py-2">Status</th><th className="py-2" />
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {orders.map((o) => {
                    const s = STATUS[o.status] || STATUS.CANCELLED;
                    const open = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'].includes(o.status);
                    return (
                      <tr key={o.id}>
                        <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                        <td className="py-2.5">{o.companyName}</td>
                        <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                        <td className="py-2.5">
                          <span className={`badge ${s.cls}`}>{s.label}</span>
                          {o.status === 'REJECTED' && o.reviewNote && <div className="text-xs text-red-600 mt-1">{o.reviewNote}</div>}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {open && (
                            <>
                              <button className="btn-secondary mr-2" onClick={() => setModal(o)}>
                                {o.status === 'PENDING_PAYMENT' ? 'Pay' : 'Update payment'}
                              </button>
                              <button className="btn-danger" onClick={() => cancel(o)}>Cancel</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div></div>
        </>
      )}

      {modal && (
        <AddBusinessModal
          order={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
```

A rejected order is final (the server only accepts proof on open orders); the user places a new order, so no action buttons are shown for it.

- [ ] **Step 3: Sidebar** — in `components/layout/Sidebar.jsx`:
  - Expanded footer: directly before the `{(!user || canAccess('/settings', user.role)) && (` block that renders the text links (the one containing `<Link href="/settings" className="sidebar-link-inactive">`), add:

```jsx
            <Link href="/my-businesses" className={pathname === '/my-businesses' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
              <Building2 className="w-4 h-4" />
              My Businesses
            </Link>
```
  - Collapsed footer: inside the `collapsed ? (<div className="flex flex-col items-center gap-1">` branch, before its `{(!user || canAccess('/settings', user.role)) && (`, add:

```jsx
            <Link href="/my-businesses" title="My Businesses" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Building2 className="w-5 h-5" /></Link>
```

- [ ] **Step 4: Stop `settings/businesses` from erroring for non-admins** — in `app/(dashboard)/settings/businesses/page.jsx`:
  - Add `import { useRouter } from 'next/navigation';` and, inside the component after `const isAdmin = ...`, `const router = useRouter();`.
  - Replace `useEffect(() => { load(); }, []);` with:

```jsx
  // Non-admins have their own page; don't fire the admin-only calls at all.
  useEffect(() => {
    if (!isAdmin) { router.replace('/my-businesses'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 5: Lint**

Run: `npx next lint --dir components --dir app`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add components app
git commit -m "feat(orders): My Businesses page and Add Business payment modal

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: SUPER_ADMIN pages (Plans & Payment, Orders)

**Files:**
- Create: `app/(dashboard)/admin/plans/page.jsx`, `app/(dashboard)/admin/orders/page.jsx`
- Modify: `components/layout/Sidebar.jsx`

**Interfaces:**
- Consumes: `orders.admin.*`, `orders.proofBlob`, `orders.qrBlob` (Task 6); `COMPANY_TYPES` from `@/lib/companyTypes`.

- [ ] **Step 1: Create `app/(dashboard)/admin/plans/page.jsx`**

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const PERIODS = [{ key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' }];
const cellKey = (t, p) => `${t}:${p}`;

export default function PlansPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [grid, setGrid]       = useState({});          // "TYPE:PERIOD" -> { amount, isActive }
  const [text, setText]       = useState('');
  const [hasQr, setHasQr]     = useState(false);
  const [qrFile, setQrFile]   = useState(null);
  const [qrUrl, setQrUrl]     = useState(null);
  const [saving, setSaving]   = useState(false);

  const loadQr = () => ordersApi.qrBlob().then(({ data }) => setQrUrl(URL.createObjectURL(data))).catch(() => setQrUrl(null));

  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
    Promise.all([ordersApi.admin.prices(), ordersApi.admin.instructions()])
      .then(([p, i]) => {
        const g = {};
        p.data.forEach((r) => { g[cellKey(r.companyType, r.period)] = { amount: String(r.amount), isActive: r.isActive }; });
        setGrid(g); setText(i.data.text); setHasQr(i.data.hasQr);
        if (i.data.hasQr) loadQr();
      })
      .catch(() => toast.error('Failed to load plans'));
  }, [router]);

  const setCell = (t, p, patch) => setGrid((g) => ({ ...g, [cellKey(t, p)]: { amount: '', isActive: true, ...g[cellKey(t, p)], ...patch } }));

  const savePrices = async () => {
    const prices = Object.entries(grid)
      .filter(([, v]) => v.amount !== '')
      .map(([k, v]) => { const [companyType, period] = k.split(':'); return { companyType, period, amount: Number(v.amount), isActive: v.isActive }; });
    setSaving(true);
    try { await ordersApi.admin.savePrices(prices); toast.success('Prices saved'); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not save prices'); }
    finally { setSaving(false); }
  };

  const saveInstructions = async () => {
    setSaving(true);
    try {
      const { data } = await ordersApi.admin.saveInstructions({ text, file: qrFile });
      setHasQr(data.hasQr); setQrFile(null);
      if (data.hasQr) loadQr();
      toast.success('Payment instructions saved');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (!allowed) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Plans &amp; Payment</h1>
          <p className="page-subtitle">Price per company type and how customers pay for an additional business</p>
        </div>
      </div>

      <div className="card mb-6"><div className="card-body">
        <h2 className="font-semibold mb-3">Prices (PHP)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="py-2">Company type</th>{PERIODS.map((p) => <th key={p.key} className="py-2">{p.label}</th>)}
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {COMPANY_TYPES.map((t) => (
              <tr key={t.key}>
                <td className="py-2.5 font-medium">{t.label}</td>
                {PERIODS.map((p) => {
                  const c = grid[cellKey(t.key, p.key)] || { amount: '', isActive: true };
                  return (
                    <td key={p.key} className="py-2.5">
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" step="0.01" className="input w-32" value={c.amount}
                          onChange={(e) => setCell(t.key, p.key, { amount: e.target.value })} placeholder="not offered" />
                        <label className="text-xs flex items-center gap-1">
                          <input type="checkbox" checked={c.isActive} onChange={(e) => setCell(t.key, p.key, { isActive: e.target.checked })} /> active
                        </label>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">Leave a price empty (or untick active) to stop offering that plan. Existing orders keep the price they were placed at.</p>
        <button className="btn-primary mt-4" disabled={saving} onClick={savePrices}>Save prices</button>
      </div></div>

      <div className="card"><div className="card-body">
        <h2 className="font-semibold mb-3">Payment instructions</h2>
        <label className="label">Shown to the customer when paying (GCash / bank details, account name, notes)</label>
        <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3">
          <label className="label">Payment QR (JPG, PNG or WEBP, max 5 MB){hasQr ? ' — uploading replaces the current one' : ''}</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="input" onChange={(e) => setQrFile(e.target.files?.[0] || null)} />
          {qrUrl && <img src={qrUrl} alt="Current QR" className="mt-3 max-h-48 rounded-lg border" />}
        </div>
        <button className="btn-primary mt-4" disabled={saving} onClick={saveInstructions}>Save instructions</button>
      </div></div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(dashboard)/admin/orders/page.jsx`**

```jsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';

const STATUSES = [
  ['PROOF_SUBMITTED', 'Under review'], ['PENDING_PAYMENT', 'Awaiting payment'],
  ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['CANCELLED', 'Cancelled'], ['', 'All'],
];

export default function OrdersAdminPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus]   = useState('PROOF_SUBMITTED');
  const [rows, setRows]       = useState([]);
  const [busyId, setBusyId]   = useState(null);
  const [rejecting, setRejecting] = useState(null);   // order
  const [note, setNote]       = useState('');

  const load = useCallback(async () => {
    try { setRows((await ordersApi.admin.orders(status)).data); }
    catch { toast.error('Failed to load orders'); }
  }, [status]);

  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
  }, [router]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const viewProof = async (o) => {
    try {
      const { data } = await ordersApi.proofBlob(o.id);
      window.open(URL.createObjectURL(data), '_blank');
    } catch { toast.error('Could not open the proof'); }
  };

  const approve = async (o) => {
    if (!window.confirm(`Approve ${o.orderNo} and create "${o.companyName}"?`)) return;
    setBusyId(o.id);
    try { const { data } = await ordersApi.admin.approve(o.id); toast.success(data.message); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Approval failed'); }
    finally { setBusyId(null); }
  };

  const reject = async () => {
    setBusyId(rejecting.id);
    try { await ordersApi.admin.reject(rejecting.id, note); toast.success('Order rejected'); setRejecting(null); setNote(''); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not reject'); }
    finally { setBusyId(null); }
  };

  if (!allowed) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Business Orders</h1>
          <p className="page-subtitle">Review payments; approving creates the customer&apos;s business</p>
        </div>
      </div>

      <div className="card mb-4"><div className="card-body">
        <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div></div>

      <div className="card"><div className="card-body overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="py-2">Order</th><th className="py-2">Customer</th><th className="py-2">Company</th>
            <th className="py-2">Plan</th><th className="py-2 text-right">Amount</th><th className="py-2">Reference</th>
            <th className="py-2">Date</th><th className="py-2" />
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">No orders</td></tr>}
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                <td className="py-2.5">{o.user.firstName} {o.user.lastName}<div className="text-xs text-gray-500">{o.user.email}</div></td>
                <td className="py-2.5">{o.companyName}<div className="text-xs text-gray-500">{o.companyType} · {o.taxType}</div></td>
                <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                <td className="py-2.5">{o.referenceNo || '—'}</td>
                <td className="py-2.5">{formatDate(o.createdAt)}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {o.proofFileName && <button className="btn-secondary mr-2" onClick={() => viewProof(o)}>View proof</button>}
                  {o.status === 'PROOF_SUBMITTED' ? (
                    <>
                      <button className="btn-primary mr-2" disabled={busyId === o.id} onClick={() => approve(o)}>Approve</button>
                      <button className="btn-danger" disabled={busyId === o.id} onClick={() => setRejecting(o)}>Reject</button>
                    </>
                  ) : <span className="text-xs text-gray-500">{o.status.replace('_', ' ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold mb-2">Reject {rejecting.orderNo}</h3>
            <label className="label">Reason (shown to the customer) *</label>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1 justify-center" onClick={() => { setRejecting(null); setNote(''); }}>Back</button>
              <button className="btn-danger flex-1 justify-center" disabled={!note.trim() || busyId === rejecting.id} onClick={reject}>Reject order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Sidebar links for SUPER_ADMIN** — in `components/layout/Sidebar.jsx`, add `Tags, ClipboardCheck` to the `lucide-react` import list. Each existing `{user?.role === 'SUPER_ADMIN' && ( <Link .../> )}` block wraps a single Modules link; wrap its contents in a fragment `<>...</>` and add after the Modules link:

Expanded:
```jsx
                    <Link href="/admin/plans" className={pathname === '/admin/plans' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
                      <Tags className="w-4 h-4" />
                      Plans &amp; Payment
                    </Link>
                    <Link href="/admin/orders" className={pathname === '/admin/orders' ? 'sidebar-link-active' : 'sidebar-link-inactive'}>
                      <ClipboardCheck className="w-4 h-4" />
                      Business Orders
                    </Link>
```

Collapsed:
```jsx
                  <Link href="/admin/plans" title="Plans & Payment" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><Tags className="w-5 h-5" /></Link>
                  <Link href="/admin/orders" title="Business Orders" className="flex items-center justify-center h-10 w-10 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ClipboardCheck className="w-5 h-5" /></Link>
```

- [ ] **Step 4: Lint + commit**

Run: `npx next lint --dir components --dir app`
Expected: no new errors.

```bash
git add app components
git commit -m "feat(orders): super-admin plans/payment and order review pages

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification

**Files:** none (verification only; fix and commit if anything is wrong).

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: every suite PASS, including `businessOnboarding`, `orderPricing`, `orderController`, `orderAdminController`.

- [ ] **Step 2: Production build compiles**

Run: `npm run build:prod`
Expected: `Compiled successfully`, routes `/my-businesses`, `/admin/plans`, `/admin/orders` listed.

- [ ] **Step 3: Manual walkthrough** (`npm run dev`; ports 3000/5000)

1. Log in as SUPER_ADMIN → Plans & Payment: set a price for Services/Monthly (and Yearly), write instructions, upload a QR → Save. Reload: values persist and the QR shows.
2. Log in as a MANAGER (individual account) → sidebar **My Businesses** → **Add business** → fill the form, pick Services + Monthly → the price shows → Continue → payment step shows instructions + QR → enter a reference, attach an image → Submit. Order shows **Under review**.
3. As the MANAGER open Settings → Businesses: it redirects to My Businesses, no "Failed to load data" toasts.
4. As SUPER_ADMIN → Business Orders → **View proof** opens → **Approve**. Order becomes Approved; the MANAGER's My Businesses now lists the new business with a Paid-until date one month ahead, and it appears in the business switcher; other users cannot see it.
5. Repeat an order and **Reject** with a note → the MANAGER sees the note.
6. Confirm a Retail/Trading plan with no price shows "not available yet" and blocks Continue.

- [ ] **Step 4: Report** the results (what passed, anything not verified) to the user; do not claim success for steps that were not run.
