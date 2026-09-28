/**
 * End-to-end exercise of the school billing module against the running API.
 *
 * Runs the whole flow twice — once per revenue policy — verifying the ledger
 * after each step, then deletes everything it created so the database is left
 * exactly as it was found.
 *
 *   npm run dev          # the API must be running on :5000
 *   node scripts/e2eSchool.js
 */

const BASE = 'http://localhost:5000/api';
const BUSINESS_ID = 6;
const LOGIN = { email: 'admin@ph-erp.com', password: 'Admin@123' };

const prisma = require('../server/config/database');

let token = null;
let created = {
  studentIds: [], customerIds: [], schoolYearIds: [], feeStructureIds: [],
  assessmentIds: [], enrollmentIds: [], invoiceIds: [], journalRefs: [],
};
function resetTracker() {
  created = {
    studentIds: [], customerIds: [], schoolYearIds: [], feeStructureIds: [],
    assessmentIds: [], enrollmentIds: [], invoiceIds: [], journalRefs: [],
  };
}

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

let passed = 0, failed = 0;
function check(label, actual, expected) {
  // Numbers compare at 2dp; everything else compares as-is. Rounding a string
  // yields NaN, and NaN never equals itself, so a naive r2() on both sides
  // fails every string assertion silently.
  const ok = typeof expected === 'function'
    ? expected(actual)
    : (typeof expected === 'number' ? r2(actual) === r2(expected) : actual === expected);
  if (ok) { passed++; console.log(`    PASS  ${label}`); }
  else    { failed++; console.log(`    FAIL  ${label}\n          expected ${expected}, got ${actual}`); }
  return ok;
}
function note(label, value) { console.log(`    ····  ${label}: ${value}`); }

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      'x-business-id': String(BUSINESS_ID),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${data?.error || text}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

/** Sum of debits minus credits on an account, across POSTED entries only. */
async function accountBalance(accountCode) {
  const account = await prisma.account.findFirst({ where: { businessId: BUSINESS_ID, accountCode } });
  if (!account) return null;
  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entry: { businessId: BUSINESS_ID, status: 'POSTED' } },
    select: { debit: true, credit: true },
  });
  return r2(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));
}

/** Every posted entry must balance; this asserts it across the whole business. */
async function assertLedgerBalanced() {
  const lines = await prisma.journalLine.findMany({
    where: { entry: { businessId: BUSINESS_ID, status: 'POSTED' } },
    select: { debit: true, credit: true },
  });
  const dr = r2(lines.reduce((s, l) => s + Number(l.debit), 0));
  const cr = r2(lines.reduce((s, l) => s + Number(l.credit), 0));
  check(`ledger balances (DR ${peso(dr)} = CR ${peso(cr)})`, dr, cr);
}

// ── Setup shared by both policies ──────────────────────────────────────────
async function setupYearAndFees(suffix) {
  const year = await api('POST', '/school/school-years', {
    code: `E2E-${suffix}`,
    name: `E2E Test Year ${suffix}`,
    startDate: '2026-10-01',
    endDate: '2027-07-31',
  });
  created.schoolYearIds.push(year.id);

  const levels = await api('GET', '/school/grade-levels');
  const g7 = levels.find((l) => l.code === 'G7');

  const feeTypes = await api('GET', '/school/fee-types');
  const pick = (code) => feeTypes.find((f) => f.code === code);

  const structure = await api('POST', '/school/fee-structures', {
    schoolYearId: year.id,
    gradeLevelId: g7.id,
    name: `Grade 7 — E2E ${suffix}`,
    lines: [
      { feeTypeId: pick('TUITION').id, amount: 42000, billingBasis: 'ANNUAL' },
      { feeTypeId: pick('REG').id,     amount: 1500,  billingBasis: 'ONE_TIME' },
      { feeTypeId: pick('MISC').id,    amount: 6500,  billingBasis: 'ANNUAL' },
      { feeTypeId: pick('BOOKS').id,   amount: 3500,  billingBasis: 'ANNUAL' },
    ],
  });
  created.feeStructureIds.push(structure.id);

  const schemes = await api('GET', '/school/payment-schemes');
  const monthly = schemes.find((s) => s.code === 'MONTHLY_10');

  return { year, g7, monthly };
}

async function createStudent(suffix) {
  const student = await api('POST', '/school/students', {
    lastName: 'Dela Cruz', firstName: 'Juan', middleName: 'Santos',
    lrn: suffix === 'A' ? '999900000001' : '999900000002',
    birthDate: '2013-05-14', gender: 'Male',
    address: '123 Rizal St., Tagum City',
    contactPhone: '09171234567',
    guardians: [{ name: 'Maria Dela Cruz', relationship: 'Mother', phone: '09181234567', isPrimaryPayer: true }],
  });
  created.studentIds.push(student.id);
  const row = await prisma.student.findUnique({ where: { id: student.id }, select: { customerId: true } });
  created.customerIds.push(row.customerId);
  return student;
}

// ══════════════════════════════════════════════════════════════════════════
// Policy 1 — recognise as billed
// ══════════════════════════════════════════════════════════════════════════
async function runOnBilling() {
  console.log('\n─── ON_BILLING — recognise as each installment is billed ───\n');

  await api('PUT', '/school/revenue-policy', { policy: 'ON_BILLING' });
  const { year, g7, monthly } = await setupYearAndFees('A');
  const student = await createStudent('A');
  note('student', `${student.studentNo} — ${student.fullName}`);

  console.log('\n  1. Assessment preview');
  const preview = await api('POST', '/school/enrollments/preview', {
    studentId: student.id, schoolYearId: year.id, gradeLevelId: g7.id,
    paymentSchemeId: monthly.id, assessmentDate: '2026-09-08',
    discounts: [{ type: 'SIBLING', label: 'Sibling Discount', basis: 'PCT', value: 5 }],
    subsidies: [{ type: 'ESC', referenceNo: 'ESC-E2E-001', amount: 9000 }],
  });
  check('gross assessment', preview.grossAmount, 53500);
  check('sibling discount is 5% of tuition', preview.discountAmount, 2100);
  check('ESC subsidy', preview.subsidyAmount, 9000);
  check('payable by parent', preview.netPayable, 42400);
  check('schedule sums to payable',
    r2(preview.schedule.reduce((s, x) => s + x.amount, 0)), preview.netPayable);
  note('schedule', `${preview.schedule.length} rows, first ${peso(preview.schedule[0].amount)} on enrolment`);

  console.log('\n  2. Enroll');
  const enrolled = await api('POST', '/school/enrollments', {
    studentId: student.id, schoolYearId: year.id, gradeLevelId: g7.id,
    paymentSchemeId: monthly.id, enrollmentDate: '2026-09-08',
    discounts: [{ type: 'SIBLING', label: 'Sibling Discount', basis: 'PCT', value: 5 }],
    subsidies: [{ type: 'ESC', referenceNo: 'ESC-E2E-001', amount: 9000 }],
  });
  created.assessmentIds.push(enrolled.assessment.id);
  created.enrollmentIds.push(enrolled.enrollment.id);
  check('assessment starts as a draft', enrolled.assessment.status, 'DRAFT');

  const arBefore = await accountBalance('1110');
  check('a draft posts nothing to the ledger', arBefore, 0);

  console.log('\n  3. Issue the assessment');
  const issued = await api('POST', `/school/assessments/${enrolled.assessment.id}/issue`);
  created.invoiceIds.push(issued.invoice.id);
  note('enrolment invoice', issued.invoice.invoiceNo);

  // MONTHLY_10 carries no down payment, so the enrolment invoice is exactly the
  // one-time registration fee — billed whole, on its own account.
  check('enrolment invoice is the registration fee', issued.invoice.totalAmount, 1500);
  const enrolInst = await prisma.installment.findFirst({
    where: { assessmentId: enrolled.assessment.id, seq: 0 },
  });
  check('the invoice matches the scheduled installment exactly',
    Number(issued.invoice.totalAmount), Number(enrolInst.amount));

  const invLines = await prisma.invoiceLine.findMany({ where: { invoiceId: issued.invoice.id } });
  check('the registration fee is not pro-rated across other accounts', invLines.length, 1);
  check('every line is VAT-exempt',
    invLines.every((l) => l.vatCode === 'EXEMPT'), true);
  check('no output VAT on an exempt-only invoice', Number(issued.invoice.vatAmount), 0);

  check('AR — Students debited by the registration fee less discount and subsidy',
    await accountBalance('1110'), r2(1500 - 2100 - 9000));
  check('discounts posted as contra-revenue', await accountBalance('4499'), 2100);
  check('DepEd receivable raised', await accountBalance('1120'), 9000);
  check('no unearned income under this policy', await accountBalance('2210'), 0);
  await assertLedgerBalanced();

  console.log('\n  4. Billing run');
  const billPreview = await api('GET', '/school/billing/preview?upTo=2026-12-31');
  note('due up to 2026-12-31', `${billPreview.totals.count} installments, ${peso(billPreview.totals.amount)}`);
  check('nothing blocked by the cutover', billPreview.totals.blockedCount, 0);

  const runResult = await api('POST', '/school/billing/run', { upTo: '2026-12-31' });
  check('billing run had no failures', runResult.failed, 0);
  note('billed', `${runResult.billed} invoices, ${peso(runResult.totalAmount)}`);

  const invoicesAfter = await prisma.invoice.findMany({
    where: { businessId: BUSINESS_ID, customerId: created.customerIds[0] },
  });
  invoicesAfter.forEach((i) => { if (!created.invoiceIds.includes(i.id)) created.invoiceIds.push(i.id); });

  // Every billed invoice must equal the installment it came from. A VATable fee
  // assessed as VAT-exclusive used to inflate the invoice past the schedule, so
  // the installment could never settle exactly.
  const billed = await prisma.installment.findMany({
    where: { assessmentId: enrolled.assessment.id, invoiceId: { not: null } },
    include: { invoice: { select: { totalAmount: true, vatAmount: true } } },
  });
  const mismatched = billed.filter(
    (i) => r2(i.amount) !== r2(i.invoice.totalAmount)
  );
  check('every invoice equals its scheduled installment', mismatched.length, 0);
  note('VAT carved out of the books line',
    peso(billed.reduce((s, i) => s + Number(i.invoice.vatAmount), 0)));

  console.log('\n  5. Billing run is idempotent');
  const rerun = await api('POST', '/school/billing/run', { upTo: '2026-12-31' });
  check('a second run bills nothing', rerun.billed, 0);

  console.log('\n  6. Cashier collects');
  const payables = await api('GET', `/school/collections/${student.id}/payables`);
  note('outstanding', `${payables.items.length} invoices, ${peso(payables.totalDue)}`);
  const oldest = payables.items[0];

  const collection = await api('POST', '/school/collections', {
    studentId: student.id, amount: oldest.balance,
    paymentMethod: 'Cash', paymentDate: '2026-09-08',
  });
  check('payment applied in full', collection.appliedTotal, oldest.balance);
  check('no advance created for an exact payment', collection.advance, (a) => a === null);

  const cash = await accountBalance('1010');
  check('cash on hand debited', cash, oldest.balance);
  await assertLedgerBalanced();

  console.log('\n  7. Overpayment becomes a liability, not revenue');
  const over = await api('POST', '/school/collections', {
    studentId: student.id, amount: 100000,
    paymentMethod: 'Cash', paymentDate: '2026-09-08',
  });
  check('surplus held as an advance', over.advance, (a) => a && Number(a.amount) > 0);
  note('advance', peso(over.advance.amount));
  check('advance sits in liability 2215', await accountBalance('2215'), r2(-Number(over.advance.amount)));
  await assertLedgerBalanced();

  console.log('\n  8. Statement of account');
  const soa = await api('GET', `/school/reports/soa/${student.id}`);
  check('SOA total payable matches the assessment', soa.summary.totalPayable, 42400);
  note('paid to date', peso(soa.summary.totalPaid));

  console.log('\n  9. Reports');
  const collections = await api('GET', '/school/reports/collections?from=2026-09-01&to=2026-09-30');
  check('collections report sees the payments', collections.count, (n) => n >= 2);
  const summary = await api(`GET`, `/school/reports/enrollment-summary?schoolYearId=${year.id}`);
  check('enrollment summary counts the student', summary.totals.students, 1);
  const delinquency = await api('GET', `/school/reports/delinquency?schoolYearId=${year.id}&minDays=0`);
  note('delinquency', `${delinquency.studentCount} students, ${peso(delinquency.total)}`);
}

// ══════════════════════════════════════════════════════════════════════════
// The cutover guard — a school year that opened before the books did
// ══════════════════════════════════════════════════════════════════════════
async function runCutoverGuard() {
  console.log('\n─── Cutover guard ───\n');

  const biz = await prisma.business.findUnique({
    where: { id: BUSINESS_ID }, select: { booksStartDate: true },
  });
  note('books start', String(biz.booksStartDate).slice(0, 15));

  // A year that opened in June while the books start in September — the exact
  // situation a school onboarding mid-year walks into.
  const year = await api('POST', '/school/school-years', {
    code: 'E2E-CUT', name: 'E2E Cutover Year',
    startDate: '2026-06-01', endDate: '2027-03-31',
  });
  created.schoolYearIds.push(year.id);

  const levels = await api('GET', '/school/grade-levels');
  const g7 = levels.find((l) => l.code === 'G7');
  const feeTypes = await api('GET', '/school/fee-types');
  const structure = await api('POST', '/school/fee-structures', {
    schoolYearId: year.id, gradeLevelId: g7.id, name: 'Grade 7 — E2E Cutover',
    lines: [{ feeTypeId: feeTypes.find((f) => f.code === 'TUITION').id, amount: 30000, billingBasis: 'ANNUAL' }],
  });
  created.feeStructureIds.push(structure.id);

  const schemes = await api('GET', '/school/payment-schemes');
  const monthly = schemes.find((s) => s.code === 'MONTHLY_10');

  const student = await api('POST', '/school/students', {
    lastName: 'Reyes', firstName: 'Ana', lrn: '999900000003',
    guardians: [{ name: 'Pedro Reyes', relationship: 'Father', isPrimaryPayer: true }],
  });
  created.studentIds.push(student.id);
  const row = await prisma.student.findUnique({ where: { id: student.id }, select: { customerId: true } });
  created.customerIds.push(row.customerId);

  const enrolled = await api('POST', '/school/enrollments', {
    studentId: student.id, schoolYearId: year.id, gradeLevelId: g7.id,
    paymentSchemeId: monthly.id, enrollmentDate: '2026-09-08',
  });
  created.assessmentIds.push(enrolled.assessment.id);
  created.enrollmentIds.push(enrolled.enrollment.id);
  const issued = await api('POST', `/school/assessments/${enrolled.assessment.id}/issue`);
  if (issued.invoice) created.invoiceIds.push(issued.invoice.id);

  const preview = await api('GET', `/school/billing/preview?upTo=2026-12-31&schoolYearId=${year.id}`);
  check('the preview flags pre-cutover installments', preview.totals.blockedCount, (n) => n > 0);
  note('blocked', `${preview.totals.blockedCount} installments before ${preview.cutover}`);
  check('the preview explains why', preview.warning, (w) => typeof w === 'string' && /books start/i.test(w));

  const result = await api('POST', '/school/billing/run', { upTo: '2026-12-31', schoolYearId: year.id });
  // Blocked is a configuration mismatch, not an error — reporting it as a
  // failure would bury the ones that genuinely need investigating.
  check('the run reports them as blocked, not failed', result.failed, 0);
  check('the run skipped them', result.blocked, preview.totals.blockedCount);
  note('run', result.message);

  const billedInvoices = await prisma.invoice.findMany({
    where: { businessId: BUSINESS_ID, customerId: row.customerId }, select: { id: true, invoiceNo: true },
  });
  billedInvoices.forEach((i) => { if (!created.invoiceIds.includes(i.id)) created.invoiceIds.push(i.id); });

  // Every invoice that WAS created must have a journal entry behind it.
  const refs = billedInvoices.map((i) => i.invoiceNo);
  const entries = await prisma.journalEntry.findMany({
    where: { businessId: BUSINESS_ID, reference: { in: refs }, status: 'POSTED' },
    select: { reference: true },
  });
  check('every invoice that posted has a journal entry', entries.length, refs.length);
  await assertLedgerBalanced();
}

// ══════════════════════════════════════════════════════════════════════════
// Policy 2 — defer and amortise
// ══════════════════════════════════════════════════════════════════════════
async function runOnAssessment() {
  console.log('\n─── ON_ASSESSMENT — defer and amortise ───\n');

  await api('PUT', '/school/revenue-policy', { policy: 'ON_ASSESSMENT' });
  const check1 = await api('GET', '/school/revenue-policy');
  check('policy switched', check1.policy, 'ON_ASSESSMENT');

  const { year, g7, monthly } = await setupYearAndFees('B');
  await api('PUT', `/school/school-years/${year.id}`, { isCurrent: true });
  const student = await createStudent('B');
  note('student', `${student.studentNo} — ${student.fullName}`);

  console.log('\n  1. Enroll and issue');
  const enrolled = await api('POST', '/school/enrollments', {
    studentId: student.id, schoolYearId: year.id, gradeLevelId: g7.id,
    paymentSchemeId: monthly.id, enrollmentDate: '2026-09-08',
    discounts: [{ type: 'SIBLING', label: 'Sibling Discount', basis: 'PCT', value: 5 }],
    subsidies: [{ type: 'ESC', referenceNo: 'ESC-E2E-002', amount: 9000 }],
  });
  created.assessmentIds.push(enrolled.assessment.id);
  created.enrollmentIds.push(enrolled.enrollment.id);

  const unearnedBefore = await accountBalance('2210');
  const issued = await api('POST', `/school/assessments/${enrolled.assessment.id}/issue`);
  if (issued.invoice) created.invoiceIds.push(issued.invoice.id);

  const unearnedAfter = await accountBalance('2210');
  check('the whole gross assessment is deferred',
    r2(unearnedBefore - unearnedAfter), 53500);
  note('unearned tuition', peso(-unearnedAfter));
  await assertLedgerBalanced();

  console.log('\n  2. The policy is now locked');
  let locked = false;
  try { await api('PUT', '/school/revenue-policy', { policy: 'ON_BILLING' }); }
  catch (e) { locked = e.status === 409; }
  check('switching mid-year is refused', locked, true);

  console.log('\n  3. Monthly recognition');
  const amortPreview = await api('GET', `/school/amortization/preview?period=2026-10&schoolYearId=${year.id}`);
  check('one tenth of the gross per month', amortPreview.total, 5350);
  check('credits sum to the debit',
    r2(amortPreview.lines.reduce((s, l) => s + l.amount, 0)), amortPreview.total);
  const vatLine = amortPreview.lines.find((l) => l.accountCode === '2030');
  check('books carry output VAT', vatLine, (v) => v && v.amount > 0);

  const amort = await api('POST', '/school/amortization/run', { period: '2026-10', schoolYearId: year.id });
  created.journalRefs.push(`AMORT-${year.code}-2026-10`);
  check('recognised one month', amort.recognised, 5350);
  note('journal entry', amort.entryNo);
  await assertLedgerBalanced();

  console.log('\n  4. A month cannot be recognised twice');
  let blocked = false;
  try { await api('POST', '/school/amortization/run', { period: '2026-10', schoolYearId: year.id }); }
  catch (e) { blocked = e.status === 409; }
  check('re-running the same month is refused', blocked, true);

  console.log('\n  5. Invoices post no GL under this policy');
  const arBefore = await accountBalance('1110');
  const runResult = await api('POST', '/school/billing/run', { upTo: '2026-12-31' });
  note('billed', `${runResult.billed} invoices`);
  const arAfter = await accountBalance('1110');
  check('billing does not touch AR again (already booked at issue)', arAfter, arBefore);

  const invoicesAfter = await prisma.invoice.findMany({
    where: { businessId: BUSINESS_ID, customerId: created.customerIds[1] },
  });
  invoicesAfter.forEach((i) => { if (!created.invoiceIds.includes(i.id)) created.invoiceIds.push(i.id); });
  await assertLedgerBalanced();

  console.log('\n  6. Delinquency reads installments under this policy');
  const delinquency = await api('GET', `/school/reports/delinquency?schoolYearId=${year.id}&minDays=0`);
  note('delinquency', `${delinquency.studentCount} students, ${peso(delinquency.total)}`);
  check('the unbilled balance is still counted as owed', delinquency.total, (t) => t > 0);
}

// ── Cleanup ────────────────────────────────────────────────────────────────
async function cleanup() {
  console.log('\n─── Cleanup ───\n');

  const refs = [
    ...created.journalRefs,
    ...(await prisma.invoice.findMany({
      where: { id: { in: created.invoiceIds } }, select: { invoiceNo: true },
    })).map((i) => i.invoiceNo),
    ...(await prisma.assessment.findMany({
      where: { id: { in: created.assessmentIds } }, select: { assessmentNo: true },
    })).map((a) => a.assessmentNo),
  ];

  const paymentNos = await prisma.paymentAR.findMany({
    where: { invoiceId: { in: created.invoiceIds } }, select: { paymentNo: true },
  });
  refs.push(...paymentNos.map((p) => p.paymentNo));

  const advances = await prisma.studentAdvance.findMany({
    where: { studentId: { in: created.studentIds } }, select: { receiptNo: true },
  });
  refs.push(...advances.map((a) => a.receiptNo));
  refs.push(...created.studentIds.map(() => null).filter(Boolean));

  // Journal entries first — they reference accounts, nothing references them.
  const entries = await prisma.journalEntry.findMany({
    where: { businessId: BUSINESS_ID, OR: [
      { reference: { in: refs.filter(Boolean) } },
      { reference: { startsWith: 'ADV-APPLY-' } },
      { description: { contains: 'Dela Cruz, Juan' } },
      { description: { contains: 'Reyes, Ana' } },
    ] },
    select: { id: true },
  });
  await prisma.journalLine.deleteMany({ where: { entryId: { in: entries.map((e) => e.id) } } });
  await prisma.journalEntry.deleteMany({ where: { id: { in: entries.map((e) => e.id) } } });
  console.log(`  journal entries removed: ${entries.length}`);

  await prisma.amortizationRun.deleteMany({ where: { schoolYearId: { in: created.schoolYearIds } } });
  await prisma.paymentAR.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
  await prisma.installment.deleteMany({ where: { assessmentId: { in: created.assessmentIds } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: created.invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: created.invoiceIds } } });
  console.log(`  invoices removed: ${created.invoiceIds.length}`);

  await prisma.studentAdvance.deleteMany({ where: { studentId: { in: created.studentIds } } });

  // Student-scoped children that block student.deleteMany. The ledger, refunds
  // and adjustments each hold a studentId FK, and an adjustment also points at
  // an assessment — so it has to go before the assessments below, not merely
  // before the students.
  await prisma.studentLedger.deleteMany({ where: { studentId: { in: created.studentIds } } });
  await prisma.refund.deleteMany({ where: { studentId: { in: created.studentIds } } });
  await prisma.billingAdjustment.deleteMany({ where: { studentId: { in: created.studentIds } } });
  await prisma.assessmentLine.deleteMany({ where: { assessmentId: { in: created.assessmentIds } } });
  await prisma.assessment.deleteMany({ where: { id: { in: created.assessmentIds } } });
  await prisma.studentDiscount.deleteMany({ where: { enrollmentId: { in: created.enrollmentIds } } });
  await prisma.studentSubsidy.deleteMany({ where: { enrollmentId: { in: created.enrollmentIds } } });
  await prisma.enrollment.deleteMany({ where: { id: { in: created.enrollmentIds } } });
  await prisma.guardian.deleteMany({ where: { studentId: { in: created.studentIds } } });
  await prisma.student.deleteMany({ where: { id: { in: created.studentIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: created.customerIds } } });
  console.log(`  students removed: ${created.studentIds.length}`);

  await prisma.feeStructureLine.deleteMany({ where: { feeStructureId: { in: created.feeStructureIds } } });
  await prisma.feeStructure.deleteMany({ where: { id: { in: created.feeStructureIds } } });
  await prisma.schoolYear.deleteMany({ where: { id: { in: created.schoolYearIds } } });
  console.log(`  school years removed: ${created.schoolYearIds.length}`);

  await prisma.auditLog.deleteMany({
    where: { businessId: BUSINESS_ID, summary: { contains: 'Dela Cruz' } },
  });
  await prisma.auditLog.deleteMany({
    where: { businessId: BUSINESS_ID, summary: { contains: 'E2E' } },
  });

  // Leave the business on the default policy.
  await prisma.systemSetting.updateMany({
    where: { businessId: BUSINESS_ID, key: 'school.revenuePolicy' },
    data:  { value: 'ON_BILLING' },
  });
  console.log('  revenue policy restored to ON_BILLING');
}

async function verifyClean() {
  console.log('\n─── Post-cleanup state ───\n');
  const counts = {
    students:    await prisma.student.count({ where: { businessId: BUSINESS_ID } }),
    invoices:    await prisma.invoice.count({ where: { businessId: BUSINESS_ID } }),
    assessments: await prisma.assessment.count({ where: { businessId: BUSINESS_ID } }),
    journal:     await prisma.journalEntry.count({ where: { businessId: BUSINESS_ID } }),
    schoolYears: await prisma.schoolYear.count({ where: { businessId: BUSINESS_ID } }),
    feeTypes:    await prisma.feeType.count({ where: { businessId: BUSINESS_ID } }),
    gradeLevels: await prisma.gradeLevel.count({ where: { businessId: BUSINESS_ID } }),
  };
  console.log('  ' + JSON.stringify(counts));
  check('no test students left',    counts.students, 0);
  check('no test invoices left',    counts.invoices, 0);
  check('no test assessments left', counts.assessments, 0);
  check('no test journal entries left', counts.journal, 0);
  check('no test school years left', counts.schoolYears, 0);
  check('seeded fee types untouched', counts.feeTypes, 12);
  check('seeded grade levels untouched', counts.gradeLevels, 15);
}

(async () => {
  console.log('\n══ School billing end-to-end ══');
  const auth = await api('POST', '/auth/login', LOGIN);
  token = auth.accessToken;
  console.log(`  authenticated as ${auth.user.email} (${auth.user.role})`);

  try {
    await runOnBilling();
    await runCutoverGuard();
    // Phase A must be fully removed before the policy can be switched — the
    // lock that blocks a mid-year change is itself part of what is under test.
    await cleanup();
    resetTracker();
    await runOnAssessment();
  } catch (err) {
    failed++;
    console.error('\n  ERROR:', err.message);
    if (err.data?.details) console.error('  details:', JSON.stringify(err.data.details));
  } finally {
    await cleanup();
    await verifyClean();
  }

  console.log(`\n══ ${passed} passed, ${failed} failed ══\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
})();
