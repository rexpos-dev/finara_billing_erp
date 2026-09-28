# Yearly Plan Discount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin's manually-typed Yearly price with a discount-percent input; the Yearly price is computed as `Monthly × 12 × (1 − discount%)`, and the checkout modal shows the customer how much a Yearly plan saves them.

**Architecture:** A new nullable `discountPercent` column on `PlanPrice` (meaningful only on the `MONTHLY` row per company type). `orderAdminController.savePrices` becomes the single place that computes the paired `YEARLY` row's `amount` from its sibling `MONTHLY` row + discount — via a new pure helper `computeYearlyAmount` — and persists it, so nothing downstream (order creation, order snapshots, the customer-facing `/orders/plans` endpoint) needs to change. The admin page's Yearly cell becomes a read-only live preview; the checkout modal derives "% saved" by comparing the Monthly×12 and Yearly amounts it already has loaded.

**Tech Stack:** Next.js 14 (App Router), Express.js, Prisma 5 / MySQL 8, Jest.

## Global Constraints

- Migration must not change any customer-visible price: backfill `discountPercent = 5.00` on every existing `MONTHLY` row (verified in the spec to reproduce every current Yearly amount exactly).
- `orderController.js` (customer-facing plans list + order creation) must not require any code changes — it keeps reading whatever `amount` is stored on the `YEARLY` row.
- Discount range: 0–100, up to 2 decimals. Amount rounding: nearest centavo (`Math.round(x * 100) / 100`).
- "Blank/not offered" (no `MONTHLY` row, or its `isActive` is `false`) always forces the paired `YEARLY` row to `isActive: false`, regardless of what was submitted for it.

---

### Task 1: Schema migration — `discountPercent` column + backfill

**Files:**
- Modify: `prisma/schema.prisma:1942-1952` (the `PlanPrice` model)
- Create: `prisma/migrations/20260928120000_add_plan_price_discount/migration.sql`

**Interfaces:**
- Produces: `PlanPrice.discountPercent` (nullable `Decimal`) available on every Prisma Client query/mutation — used by Task 3.

- [ ] **Step 1: Edit the Prisma schema**

In `prisma/schema.prisma`, the `PlanPrice` model currently reads:

```prisma
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
```

Change it to:

```prisma
model PlanPrice {
  id          Int         @id @default(autoincrement())
  companyType String      @db.VarChar(20)
  period      OrderPeriod
  amount      Decimal     @db.Decimal(12, 2)
  isActive    Boolean     @default(true)
  // Only meaningful on the MONTHLY row: the YEARLY row's `amount` is derived
  // from the sibling MONTHLY row's amount and this percentage (see
  // orderAdminController.savePrices / computeYearlyAmount).
  discountPercent Decimal? @db.Decimal(5, 2)
  updatedAt   DateTime    @updatedAt

  @@unique([companyType, period])
  @@map("plan_prices")
}
```

- [ ] **Step 2: Create the migration with a custom backfill**

Run:
```bash
npx prisma migrate dev --name add_plan_price_discount --create-only
```
Expected: a new folder `prisma/migrations/20260928120000_add_plan_price_discount/` (timestamp may differ) containing a `migration.sql` with just the `ALTER TABLE` line, and no changes applied to the database yet.

Open the generated `migration.sql` and make it read exactly:

```sql
-- AlterTable
ALTER TABLE `plan_prices` ADD COLUMN `discountPercent` DECIMAL(5, 2) NULL;

-- Backfill: every existing Yearly amount already equals Monthly x 12 less
-- exactly 5% (School 1105x12=13260->12597, Services 1350x12=16200->15390,
-- Retail 980x12=11760->11172, Other 1020x12=12240->11628) so this changes no
-- price a customer currently sees.
UPDATE `plan_prices` SET `discountPercent` = 5.00 WHERE `period` = 'MONTHLY';
```

- [ ] **Step 3: Apply the migration**

Run:
```bash
npx prisma migrate dev
```
Expected: `Applying migration '20260928120000_add_plan_price_discount'` followed by `Your database is now in sync with your schema.` and `Generated Prisma Client`.

- [ ] **Step 4: Verify existing tests still pass (they mock Prisma entirely, so this just confirms nothing else broke)**

Run: `npm test`
Expected: `Test Suites: 63 passed, 63 total` (unchanged from before this task).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(orders): add discountPercent column to PlanPrice"
```

---

### Task 2: `computeYearlyAmount` helper

**Files:**
- Modify: `server/utils/orderPricing.js`
- Test: `tests/orderPricing.test.js`

**Interfaces:**
- Consumes: nothing new (pure function).
- Produces: `computeYearlyAmount(monthlyAmount: number, discountPercent: number): number` — throws `Error('Invalid monthly amount')` or `Error('Invalid discount percent')` on bad input; otherwise returns `round2(monthlyAmount * 12 * (1 - discountPercent / 100))`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `tests/orderPricing.test.js` (new `describe` block, keep the existing `computePaidUntil` block and its import untouched except for adding `computeYearlyAmount` to the destructured import):

```js
const { PERIODS, computePaidUntil, computeYearlyAmount } = require('../server/utils/orderPricing');
```

```js
describe('computeYearlyAmount', () => {
  test('0% discount is monthly times twelve', () => {
    expect(computeYearlyAmount(1000, 0)).toBe(12000);
  });

  test('applies a typical discount', () => {
    expect(computeYearlyAmount(1105, 5)).toBe(12597);
  });

  test('rounds to the nearest centavo', () => {
    expect(computeYearlyAmount(100, 33.33)).toBe(800.04);
  });

  test('100% discount is free', () => {
    expect(computeYearlyAmount(500, 100)).toBe(0);
  });

  test('rejects a negative monthly amount', () => {
    expect(() => computeYearlyAmount(-1, 5)).toThrow('Invalid monthly amount');
  });

  test('rejects a discount outside 0-100', () => {
    expect(() => computeYearlyAmount(1000, 150)).toThrow('Invalid discount percent');
    expect(() => computeYearlyAmount(1000, -1)).toThrow('Invalid discount percent');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/orderPricing.test.js -v`
Expected: FAIL — `computeYearlyAmount is not a function` (it isn't exported yet).

- [ ] **Step 3: Implement the helper**

In `server/utils/orderPricing.js`, the file currently ends with:

```js
module.exports = { PERIODS, computePaidUntil };
```

Replace the whole file with:

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

/** monthlyAmount x 12, less discountPercent (0-100), rounded to the nearest centavo. */
function computeYearlyAmount(monthlyAmount, discountPercent) {
  const amount = Number(monthlyAmount);
  const discount = Number(discountPercent);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid monthly amount');
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Invalid discount percent');
  return Math.round(amount * 12 * (1 - discount / 100) * 100) / 100;
}

module.exports = { PERIODS, computePaidUntil, computeYearlyAmount };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/orderPricing.test.js -v`
Expected: PASS — all tests in both `describe` blocks green.

- [ ] **Step 5: Commit**

```bash
git add server/utils/orderPricing.js tests/orderPricing.test.js
git commit -m "feat(orders): add computeYearlyAmount helper"
```

---

### Task 3: `orderAdminController.savePrices` computes and persists the yearly amount

**Files:**
- Modify: `server/controllers/orderAdminController.js:5` (import) and `:18-37` (`savePrices`)
- Test: `tests/orderAdminController.test.js:130-151` (`describe('savePrices', ...)`)

**Interfaces:**
- Consumes: `computeYearlyAmount(monthlyAmount, discountPercent)` from Task 2.
- Produces: `PUT /orders/admin/prices` now accepts `discountPercent` on `MONTHLY` entries and ignores any `amount` sent on `YEARLY` entries — consumed by Task 4 (admin page) and indirectly by Task 5 (checkout modal reads the resulting stored amounts via the existing `GET /orders/plans`, unchanged).

- [ ] **Step 1: Write the failing tests**

Replace the entire `describe('savePrices', ...)` block (`tests/orderAdminController.test.js:130-151`) with:

```js
describe('savePrices', () => {
  beforeEach(() => {
    prisma.planPrice.findMany.mockResolvedValue([]);
  });

  test.each([
    [[{ companyType: 'HACK', period: 'MONTHLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'WEEKLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: -5 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: 'abc' }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: 100, discountPercent: -1 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: 100, discountPercent: 150 }]],
    ['nope'],
  ])('rejects invalid rows %#', async (prices) => {
    await expect(call(ctrl.savePrices, { body: { prices } })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.planPrice.upsert).not.toHaveBeenCalled();
  });

  test('upserts a monthly row by (companyType, period), defaulting discount to 0', async () => {
    await call(ctrl.savePrices, { body: { prices: [{ companyType: 'SERVICES', period: 'MONTHLY', amount: '499.5', isActive: true }] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
      update: { amount: 499.5, isActive: true, discountPercent: 0 },
      create: { companyType: 'SERVICES', period: 'MONTHLY', amount: 499.5, isActive: true, discountPercent: 0 },
    });
  });

  test('computes and stores the yearly amount from the monthly amount and discount in the same save', async () => {
    await call(ctrl.savePrices, { body: { prices: [
      { companyType: 'SERVICES', period: 'MONTHLY', amount: 1000, isActive: true, discountPercent: 10 },
      { companyType: 'SERVICES', period: 'YEARLY', isActive: true },
    ] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'YEARLY' } },
      update: { amount: 10800, isActive: true, discountPercent: null },
      create: { companyType: 'SERVICES', period: 'YEARLY', amount: 10800, isActive: true, discountPercent: null },
    });
  });

  test('ignores any client-sent yearly amount and recomputes it', async () => {
    await call(ctrl.savePrices, { body: { prices: [
      { companyType: 'SERVICES', period: 'MONTHLY', amount: 1000, isActive: true, discountPercent: 0 },
      { companyType: 'SERVICES', period: 'YEARLY', amount: 99999, isActive: true },
    ] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyType_period: { companyType: 'SERVICES', period: 'YEARLY' } },
      update: { amount: 12000, isActive: true, discountPercent: null },
    }));
  });

  test('falls back to the existing monthly row in the database when only yearly is submitted', async () => {
    prisma.planPrice.findMany.mockResolvedValueOnce([
      { companyType: 'SERVICES', period: 'MONTHLY', amount: 1000, discountPercent: 5, isActive: true },
    ]);
    await call(ctrl.savePrices, { body: { prices: [{ companyType: 'SERVICES', period: 'YEARLY', isActive: true }] } });
    expect(prisma.planPrice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { period: 'MONTHLY', companyType: { in: ['SERVICES'] } },
    }));
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyType_period: { companyType: 'SERVICES', period: 'YEARLY' } },
      update: { amount: 11400, isActive: true, discountPercent: null },
    }));
  });

  test('forces yearly inactive when there is no monthly price for that company type at all', async () => {
    await call(ctrl.savePrices, { body: { prices: [{ companyType: 'SERVICES', period: 'YEARLY', isActive: true }] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'YEARLY' } },
      update: { amount: 0, isActive: false, discountPercent: null },
      create: { companyType: 'SERVICES', period: 'YEARLY', amount: 0, isActive: false, discountPercent: null },
    });
  });

  test('forces yearly inactive when the monthly price is not active, even if yearly is submitted active', async () => {
    await call(ctrl.savePrices, { body: { prices: [
      { companyType: 'SERVICES', period: 'MONTHLY', amount: 1000, isActive: false, discountPercent: 5 },
      { companyType: 'SERVICES', period: 'YEARLY', isActive: true },
    ] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyType_period: { companyType: 'SERVICES', period: 'YEARLY' } },
      update: expect.objectContaining({ isActive: false }),
    }));
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx jest tests/orderAdminController.test.js -v`
Expected: FAIL on the new tests (`upserts a monthly row...` fails because the current code doesn't send `discountPercent`; the yearly-computation tests fail because `savePrices` doesn't emit a `YEARLY` upsert at all yet).

- [ ] **Step 3: Rewrite `savePrices`**

In `server/controllers/orderAdminController.js`, change the import on line 5 from:

```js
const { PERIODS, computePaidUntil } = require('../utils/orderPricing');
```

to:

```js
const { PERIODS, computePaidUntil, computeYearlyAmount } = require('../utils/orderPricing');
```

Then replace the whole `exports.savePrices` function (currently `server/controllers/orderAdminController.js:18-37`) with:

```js
exports.savePrices = async (req, res, next) => {
  try {
    const { prices } = req.body;
    if (!Array.isArray(prices)) throw createError('prices must be a list', 400);

    const monthlyByType = {}; // companyType -> { amount, isActive, discountPercent }
    const yearlyByType = {};  // companyType -> { isActive }

    prices.forEach((p) => {
      if (!COMPANY_TYPES[p.companyType]) throw createError(`Unknown company type "${p.companyType}"`, 400);
      if (!PERIODS.includes(p.period)) throw createError(`Unknown period "${p.period}"`, 400);
      const isActive = p.isActive !== false;

      if (p.period === 'MONTHLY') {
        const amount = Number(p.amount);
        if (!Number.isFinite(amount) || amount < 0) throw createError('Amounts must be zero or more', 400);
        const discountPercent = p.discountPercent === undefined || p.discountPercent === null || p.discountPercent === ''
          ? 0 : Number(p.discountPercent);
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          throw createError('Discount must be between 0 and 100', 400);
        }
        monthlyByType[p.companyType] = { amount, isActive, discountPercent };
      } else {
        yearlyByType[p.companyType] = { isActive };
      }
    });

    // A YEARLY row's amount is always derived from its sibling MONTHLY row. If
    // that sibling wasn't part of this save, fall back to the DB so the
    // amount can still be computed correctly.
    const missingTypes = Object.keys(yearlyByType).filter((t) => !monthlyByType[t]);
    if (missingTypes.length) {
      const existing = await prisma.planPrice.findMany({
        where: { period: 'MONTHLY', companyType: { in: missingTypes } },
      });
      existing.forEach((row) => {
        monthlyByType[row.companyType] = {
          amount: Number(row.amount), isActive: row.isActive, discountPercent: Number(row.discountPercent || 0),
        };
      });
    }

    const ops = [];
    Object.entries(monthlyByType).forEach(([companyType, m]) => {
      ops.push(prisma.planPrice.upsert({
        where: { companyType_period: { companyType, period: 'MONTHLY' } },
        update: { amount: m.amount, isActive: m.isActive, discountPercent: m.discountPercent },
        create: { companyType, period: 'MONTHLY', amount: m.amount, isActive: m.isActive, discountPercent: m.discountPercent },
      }));
    });
    Object.entries(yearlyByType).forEach(([companyType, y]) => {
      const m = monthlyByType[companyType];
      // "Blank/not offered": no monthly row exists, or it isn't active — nothing to compute from.
      const canOffer = !!m && m.isActive;
      const amount = m ? computeYearlyAmount(m.amount, m.discountPercent) : 0;
      ops.push(prisma.planPrice.upsert({
        where: { companyType_period: { companyType, period: 'YEARLY' } },
        update: { amount, isActive: canOffer && y.isActive, discountPercent: null },
        create: { companyType, period: 'YEARLY', amount, isActive: canOffer && y.isActive, discountPercent: null },
      }));
    });

    await prisma.$transaction(ops);
    await recordAudit({ req, action: 'UPDATE', entity: 'PlanPrice', summary: `Updated ${ops.length} plan price(s)` });
    res.json(await prisma.planPrice.findMany({ orderBy: [{ companyType: 'asc' }, { period: 'asc' }] }));
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/orderAdminController.test.js -v`
Expected: PASS — all `savePrices` tests, and every other test in the file, green.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: `Test Suites: 63 passed, 63 total` (same count as before — no new files, only edited existing ones).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/orderAdminController.js tests/orderAdminController.test.js
git commit -m "feat(orders): compute yearly plan price from monthly amount + discount"
```

---

### Task 4: Admin — Plans & Payment page shows a Discount % column

**Files:**
- Modify: `app/(dashboard)/admin/plans/page.jsx`

**Interfaces:**
- Consumes: `ordersApi.admin.prices()` / `ordersApi.admin.savePrices(prices)` (unchanged client signatures — `lib/api.js` needs no edits), each price row now including `discountPercent` (from Task 1+3).
- Produces: no new exports; this is a leaf page component.

- [ ] **Step 1: Replace the whole file**

Replace `app/(dashboard)/admin/plans/page.jsx` in full with:

```jsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { formatCurrency } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const EMPTY_ROW = { monthlyAmount: '', monthlyActive: true, discountPercent: '0', yearlyActive: true };

/** Live client-side preview only — the server always recomputes and owns the stored amount. */
const previewYearly = (row) => {
  const amount = Number(row.monthlyAmount);
  if (!row.monthlyAmount || !Number.isFinite(amount) || amount < 0) return null;
  const discount = Number(row.discountPercent);
  const d = Number.isFinite(discount) ? Math.min(Math.max(discount, 0), 100) : 0;
  return Math.round(amount * 12 * (1 - d / 100) * 100) / 100;
};

export default function PlansPage() {
  const router = useRouter();
  const [allowed, setAllowed]           = useState(false);
  const [rows, setRows]                 = useState({});   // companyType -> { monthlyAmount, monthlyActive, discountPercent, yearlyActive }
  const [savedMonthly, setSavedMonthly] = useState({});   // companyType -> saved server MONTHLY row
  const [text, setText]       = useState('');
  const [hasQr, setHasQr]     = useState(false);
  const [qrFile, setQrFile]   = useState(null);
  const [qrUrl, setQrUrl]     = useState(null);
  const [saving, setSaving]   = useState(false);

  const loadQr = () => ordersApi.qrBlob().then(({ data }) => setQrUrl(URL.createObjectURL(data))).catch(() => setQrUrl(null));

  const applyPrices = (list) => {
    const r = {}; const sm = {};
    list.forEach((p) => {
      r[p.companyType] = { ...EMPTY_ROW, ...r[p.companyType] };
      if (p.period === 'MONTHLY') {
        r[p.companyType].monthlyAmount = String(p.amount);
        r[p.companyType].monthlyActive = p.isActive;
        r[p.companyType].discountPercent = p.discountPercent != null ? String(p.discountPercent) : '0';
        sm[p.companyType] = p;
      } else {
        r[p.companyType].yearlyActive = p.isActive;
      }
    });
    setRows(r); setSavedMonthly(sm);
  };

  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
    Promise.all([ordersApi.admin.prices(), ordersApi.admin.instructions()])
      .then(([p, i]) => {
        applyPrices(p.data);
        setText(i.data.text); setHasQr(i.data.hasQr);
        if (i.data.hasQr) loadQr();
      })
      .catch(() => toast.error('Failed to load plans'));
  }, [router]);

  const setRow = (companyType, patch) => setRows((r) => ({ ...r, [companyType]: { ...EMPTY_ROW, ...r[companyType], ...patch } }));

  const savePrices = async () => {
    const prices = [];
    const types = new Set([...Object.keys(rows), ...Object.keys(savedMonthly)]);
    types.forEach((t) => {
      const row = rows[t];
      if (row && row.monthlyAmount !== '') {
        prices.push({
          companyType: t, period: 'MONTHLY',
          amount: Number(row.monthlyAmount), isActive: row.monthlyActive,
          discountPercent: row.discountPercent === '' ? 0 : Number(row.discountPercent),
        });
        prices.push({ companyType: t, period: 'YEARLY', isActive: row.yearlyActive });
      } else if (savedMonthly[t]) {
        // cleared cell that was saved before: deactivate it (server never deletes)
        prices.push({
          companyType: t, period: 'MONTHLY', amount: Number(savedMonthly[t].amount), isActive: false,
          discountPercent: Number(savedMonthly[t].discountPercent || 0),
        });
        prices.push({ companyType: t, period: 'YEARLY', isActive: false });
      }
    });
    setSaving(true);
    try { const { data } = await ordersApi.admin.savePrices(prices); applyPrices(data); toast.success('Prices saved'); }
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
            <th className="py-2">Company type</th>
            <th className="py-2">Monthly</th>
            <th className="py-2">Discount %</th>
            <th className="py-2">Yearly</th>
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {COMPANY_TYPES.map((t) => {
              const row = rows[t.key] || EMPTY_ROW;
              const yearly = previewYearly(row);
              return (
                <tr key={t.key}>
                  <td className="py-2.5 font-medium">{t.label}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="0.01" className="input w-32" value={row.monthlyAmount}
                        onChange={(e) => setRow(t.key, { monthlyAmount: e.target.value })} placeholder="not offered" />
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={row.monthlyActive} onChange={(e) => setRow(t.key, { monthlyActive: e.target.checked })} /> active
                      </label>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <input type="number" min="0" max="100" step="0.01" className="input w-24" value={row.discountPercent}
                      disabled={!row.monthlyAmount} onChange={(e) => setRow(t.key, { discountPercent: e.target.value })} />
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="input w-32 inline-flex items-center bg-gray-50 dark:bg-gray-800 text-gray-500">
                        {yearly !== null ? formatCurrency(yearly) : 'set monthly first'}
                      </span>
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={row.yearlyActive} disabled={yearly === null}
                          onChange={(e) => setRow(t.key, { yearlyActive: e.target.checked })} /> active
                      </label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">
          Clear the monthly price or untick active to stop offering that plan. The yearly price is computed
          automatically from the monthly price and the discount. Existing orders keep the price they were placed at.
        </p>
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

- [ ] **Step 2: Manually verify (no frontend test suite exists in this repo)**

Run: `npm run dev`, sign in as a `SUPER_ADMIN`, open **Plans & Payment**:
- Confirm the four company types load with their existing Monthly amounts, `5` in Discount %, and a computed Yearly figure matching what was shown before this change (e.g. School shows ₱12,597.00).
- Change a Monthly amount or the Discount % and confirm the Yearly preview updates live.
- Clear a Monthly amount and confirm the Discount input and Yearly checkbox become disabled.
- Click **Save prices** and confirm the toast succeeds and the page reloads the same values from the server.

- [ ] **Step 3: Run the full backend suite to confirm no regressions**

Run: `npm test`
Expected: `Test Suites: 63 passed, 63 total`.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/admin/plans/page.jsx"
git commit -m "feat(orders): admin discount % input replaces manual yearly price"
```

---

### Task 5: Checkout — Add Business modal shows the yearly savings

**Files:**
- Modify: `components/orders/AddBusinessModal.jsx`

**Interfaces:**
- Consumes: `plans.prices` array already loaded via `ordersApi.plans()` (each row: `{ companyType, period, amount, isActive, discountPercent }`).
- Produces: no new exports; this is a leaf component.

- [ ] **Step 1: Add the monthly lookup and savings calculation**

In `components/orders/AddBusinessModal.jsx`, the line:

```js
  const price = plans.prices.find((p) => p.companyType === form.companyType && p.period === form.period);
```

becomes:

```js
  const price = plans.prices.find((p) => p.companyType === form.companyType && p.period === form.period);
  const monthlyPrice = form.period === 'YEARLY'
    ? plans.prices.find((p) => p.companyType === form.companyType && p.period === 'MONTHLY')
    : null;
  const savings = price && monthlyPrice ? Number(monthlyPrice.amount) * 12 - Number(price.amount) : 0;
  const savingsPercent = savings > 0 ? Math.round((savings / (Number(monthlyPrice.amount) * 12)) * 100) : 0;
```

- [ ] **Step 2: Show the savings line**

The block:

```jsx
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm">
              {!form.companyType ? 'Choose a company type to see the price.'
                : price ? <>Amount to pay: <strong>{formatCurrency(price.amount)}</strong></>
                : <span className="text-red-600">This plan is not available yet. Please contact the administrator.</span>}
            </div>
```

becomes:

```jsx
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm">
              {!form.companyType ? 'Choose a company type to see the price.'
                : price ? (
                  <>
                    Amount to pay: <strong>{formatCurrency(price.amount)}</strong>
                    {savings > 0 && (
                      <div className="text-green-600 text-xs mt-1">
                        Save {savingsPercent}% — {formatCurrency(savings)} off vs. paying monthly
                      </div>
                    )}
                  </>
                )
                : <span className="text-red-600">This plan is not available yet. Please contact the administrator.</span>}
            </div>
```

- [ ] **Step 3: Manually verify (no frontend test suite exists in this repo)**

Run: `npm run dev`, sign in as any user, open **My Businesses → Add business**:
- Pick a company type with Monthly selected: no savings line appears.
- Switch to Yearly: confirm the "Save X% — ₱Y off vs. paying monthly" line appears with the correct figures (e.g. School: Save 5% — ₱663.00 off vs. paying monthly).
- Confirm "Continue to payment" still creates the order at the Yearly amount.

- [ ] **Step 4: Run the full backend suite to confirm no regressions**

Run: `npm test`
Expected: `Test Suites: 63 passed, 63 total`.

- [ ] **Step 5: Commit**

```bash
git add components/orders/AddBusinessModal.jsx
git commit -m "feat(orders): show yearly savings in the Add Business checkout"
```
