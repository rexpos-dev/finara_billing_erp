/**
 * seedSchool.js — Phase 0 setup for a school business.
 *
 *   node prisma/seedSchool.js --business=6
 *
 * Idempotent: safe to re-run. Seeds the school chart of accounts, fee types,
 * grade levels and payment schemes, then deactivates the advertising-agency
 * revenue accounts that a cloned COA leaves behind.
 *
 * It never deletes an account — deactivating keeps historical postings intact
 * while removing the account from every picker.
 */

const prisma = require('../server/config/database');

// ── School chart of accounts ───────────────────────────────────────────────
// Tuition is VAT-exempt under Sec 109(H) NIRC; books and uniforms are sales of
// goods and stay VATable. The VAT code lives on the fee type, not here.
const ACCOUNTS = [
  { accountCode: '1030', accountName: 'Online Payment Clearing',               accountType: 'ASSET',     normalBalance: 'DEBIT',  parentCode: '1000', description: 'GCash, Maya and card collections held until the gateway pays out. Cleared by a settlement.' },
  { accountCode: '1110', accountName: 'Accounts Receivable — Students',        accountType: 'ASSET',     normalBalance: 'DEBIT',  parentCode: '1000', description: 'Student receivables control. Kept separate from 1100 trade AR.' },
  { accountCode: '1120', accountName: 'Receivable — DepEd ESC / SHS Voucher',  accountType: 'ASSET',     normalBalance: 'DEBIT',  parentCode: '1000', description: 'Subsidy owed by DepEd, not by the parent.' },
  { accountCode: '2210', accountName: 'Unearned Tuition Income',               accountType: 'LIABILITY', normalBalance: 'CREDIT', parentCode: '2000', description: 'Deferred tuition under the "defer and amortise" revenue policy. Unused under "recognise as billed".' },
  { accountCode: '2215', accountName: 'Advance Payments from Students',        accountType: 'LIABILITY', normalBalance: 'CREDIT', parentCode: '2000', description: 'Cash collected ahead of billing. Drawn down as invoices are issued.' },

  { accountCode: '4400', accountName: 'Tuition Fees',                          accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4410', accountName: 'Registration / Enrollment Fee',         accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4420', accountName: 'Miscellaneous Fees',                    accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4430', accountName: 'Laboratory & Computer Fees',            accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4440', accountName: 'Library Fee',                           accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4450', accountName: 'Athletic & Activity Fee',               accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4460', accountName: 'Medical & Dental Fee',                  accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4470', accountName: 'Books & Learning Modules',              accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000', description: 'Sale of goods — VATable.' },
  { accountCode: '4480', accountName: 'School & PE Uniforms',                  accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000', description: 'Sale of goods — VATable.' },
  { accountCode: '4490', accountName: 'ID, Handbook & School Supplies',        accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4495', accountName: 'Graduation / Completion Fee',           accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  { accountCode: '4498', accountName: 'Other School Fees',                     accountType: 'REVENUE',   normalBalance: 'CREDIT', parentCode: '4000' },
  // Contra-revenue. computeInvoiceTotals() negates DEBIT-normal revenue lines,
  // so discounts reduce the invoice with no school-specific code.
  { accountCode: '4499', accountName: 'Tuition Discounts & Scholarships',      accountType: 'REVENUE',   normalBalance: 'DEBIT',  parentCode: '4000', description: 'Contra-revenue. Mirrors 4240 Sales Discounts.' },
];

// Agency revenue accounts a cloned COA leaves behind. Deactivated, never
// deleted — a posting may already reference them.
const RETIRE_CODES = [
  '4100','4110','4120','4130','4131','4132','4133','4140','4150','4160',
  '4170','4171','4172','4173','4180','4190',
  '4200','4210','4220','4230',
];

const FEE_TYPES = [
  { code: 'TUITION',   name: 'Tuition Fee',                 category: 'TUITION',       account: '4400', vatCode: 'EXEMPT', sortOrder: 10 },
  { code: 'REG',       name: 'Registration / Enrollment',   category: 'OTHER',         account: '4410', vatCode: 'EXEMPT', sortOrder: 20 },
  { code: 'MISC',      name: 'Miscellaneous Fee',           category: 'MISCELLANEOUS', account: '4420', vatCode: 'EXEMPT', sortOrder: 30 },
  { code: 'LAB',       name: 'Laboratory / Computer Fee',   category: 'MISCELLANEOUS', account: '4430', vatCode: 'EXEMPT', sortOrder: 40 },
  { code: 'LIBRARY',   name: 'Library Fee',                 category: 'MISCELLANEOUS', account: '4440', vatCode: 'EXEMPT', sortOrder: 50 },
  { code: 'ATHLETIC',  name: 'Athletic / Activity Fee',     category: 'MISCELLANEOUS', account: '4450', vatCode: 'EXEMPT', sortOrder: 60 },
  { code: 'MEDICAL',   name: 'Medical & Dental Fee',        category: 'MISCELLANEOUS', account: '4460', vatCode: 'EXEMPT', sortOrder: 70 },
  { code: 'BOOKS',     name: 'Books & Learning Modules',    category: 'BOOKS',         account: '4470', vatCode: 'VAT',    sortOrder: 80 },
  { code: 'UNIFORM',   name: 'School & PE Uniform',         category: 'UNIFORM',       account: '4480', vatCode: 'VAT',    sortOrder: 90 },
  { code: 'ID',        name: 'ID, Handbook & Supplies',     category: 'OTHER',         account: '4490', vatCode: 'EXEMPT', sortOrder: 100 },
  { code: 'GRADUATION',name: 'Graduation / Completion Fee', category: 'OTHER',         account: '4495', vatCode: 'EXEMPT', sortOrder: 110 },
  { code: 'OTHER',     name: 'Other School Fees',           category: 'OTHER',         account: '4498', vatCode: 'EXEMPT', sortOrder: 120 },
];

const GRADE_LEVELS = [
  { code: 'NUR',  name: 'Nursery',      stage: 'PRESCHOOL',   sortOrder: 10 },
  { code: 'K1',   name: 'Kinder 1',     stage: 'PRESCHOOL',   sortOrder: 20 },
  { code: 'K2',   name: 'Kinder 2',     stage: 'PRESCHOOL',   sortOrder: 30 },
  { code: 'G1',   name: 'Grade 1',      stage: 'ELEMENTARY',  sortOrder: 40 },
  { code: 'G2',   name: 'Grade 2',      stage: 'ELEMENTARY',  sortOrder: 50 },
  { code: 'G3',   name: 'Grade 3',      stage: 'ELEMENTARY',  sortOrder: 60 },
  { code: 'G4',   name: 'Grade 4',      stage: 'ELEMENTARY',  sortOrder: 70 },
  { code: 'G5',   name: 'Grade 5',      stage: 'ELEMENTARY',  sortOrder: 80 },
  { code: 'G6',   name: 'Grade 6',      stage: 'ELEMENTARY',  sortOrder: 90 },
  { code: 'G7',   name: 'Grade 7',      stage: 'JHS',         sortOrder: 100 },
  { code: 'G8',   name: 'Grade 8',      stage: 'JHS',         sortOrder: 110 },
  { code: 'G9',   name: 'Grade 9',      stage: 'JHS',         sortOrder: 120 },
  { code: 'G10',  name: 'Grade 10',     stage: 'JHS',         sortOrder: 130 },
  { code: 'G11',  name: 'Grade 11',     stage: 'SHS',         sortOrder: 140 },
  { code: 'G12',  name: 'Grade 12',     stage: 'SHS',         sortOrder: 150 },
];

// Down payment is set per school in the UI; these are the shapes, not the prices.
const PAYMENT_SCHEMES = [
  { code: 'CASH',       name: 'Full Payment (Cash)',   installmentCount: 1,  discountPct: 5,  sortOrder: 10 },
  { code: 'SEMESTRAL',  name: 'Semestral (2 payments)',installmentCount: 2,  discountPct: 2,  sortOrder: 20 },
  { code: 'QUARTERLY',  name: 'Quarterly (4 payments)',installmentCount: 4,  discountPct: 0,  sortOrder: 30 },
  { code: 'MONTHLY_10', name: 'Monthly (10 payments)', installmentCount: 10, discountPct: 0,  sortOrder: 40 },
];

function parseBusinessId() {
  const arg = process.argv.find((a) => a.startsWith('--business='));
  const id = arg ? Number(arg.split('=')[1]) : NaN;
  if (!Number.isInteger(id) || id < 1) {
    console.error('Usage: node prisma/seedSchool.js --business=<id>');
    process.exit(1);
  }
  return id;
}

/**
 * Set a business up as a school. Used by the CLI below and by self-service
 * onboarding. `hideFromOthers` (CLI default) also switches the School module
 * off on every non-school business - onboarding passes false, because a new
 * signup must never touch another tenant's settings.
 */
async function setupSchool(businessId, { hideFromOthers = true } = {}) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new Error('No business with id ' + businessId + '.');
  console.log('\nSeeding school setup for [' + business.code + '] ' + business.name + '\n');

  // ── Accounts ─────────────────────────────────────────────────────────────
  let created = 0, updated = 0;
  for (const a of ACCOUNTS) {
    const parent = a.parentCode
      ? await prisma.account.findFirst({ where: { businessId, accountCode: a.parentCode } })
      : null;

    const existing = await prisma.account.findFirst({ where: { businessId, accountCode: a.accountCode } });
    const data = {
      businessId,
      accountCode:   a.accountCode,
      accountName:   a.accountName,
      accountType:   a.accountType,
      normalBalance: a.normalBalance,
      parentId:      parent?.id || null,
      description:   a.description || null,
      isActive:      true,
    };
    if (existing) {
      await prisma.account.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.account.create({ data });
      created++;
    }
  }
  console.log(`  Accounts: ${created} created, ${updated} updated`);

  // ── Retire inherited agency revenue accounts ─────────────────────────────
  // Only those with no postings — an account already used stays visible so its
  // history remains explicable.
  let retired = 0, kept = 0;
  for (const code of RETIRE_CODES) {
    const acc = await prisma.account.findFirst({ where: { businessId, accountCode: code, isActive: true } });
    if (!acc) continue;
    const inUse = await prisma.journalLine.count({ where: { accountId: acc.id } });
    if (inUse > 0) { kept++; continue; }
    await prisma.account.update({ where: { id: acc.id }, data: { isActive: false } });
    retired++;
  }
  console.log(`  Agency revenue accounts: ${retired} deactivated${kept ? `, ${kept} kept (have postings)` : ''}`);

  // ── Fee types ────────────────────────────────────────────────────────────
  let ftCreated = 0;
  for (const f of FEE_TYPES) {
    const account = await prisma.account.findFirst({ where: { businessId, accountCode: f.account } });
    if (!account) { console.warn(`  ! Skipped fee type ${f.code} — account ${f.account} missing`); continue; }
    const existing = await prisma.feeType.findFirst({ where: { businessId, code: f.code } });
    if (existing) continue;
    await prisma.feeType.create({
      data: {
        businessId, code: f.code, name: f.name, category: f.category,
        accountId: account.id, vatCode: f.vatCode, sortOrder: f.sortOrder,
      },
    });
    ftCreated++;
  }
  console.log(`  Fee types: ${ftCreated} created`);

  // ── Grade levels ─────────────────────────────────────────────────────────
  let glCreated = 0;
  for (const g of GRADE_LEVELS) {
    const existing = await prisma.gradeLevel.findFirst({ where: { businessId, code: g.code } });
    if (existing) continue;
    await prisma.gradeLevel.create({ data: { businessId, ...g } });
    glCreated++;
  }
  console.log(`  Grade levels: ${glCreated} created`);

  // ── Payment schemes ──────────────────────────────────────────────────────
  let psCreated = 0;
  for (const p of PAYMENT_SCHEMES) {
    const existing = await prisma.paymentScheme.findFirst({ where: { businessId, code: p.code } });
    if (existing) continue;
    await prisma.paymentScheme.create({ data: { businessId, ...p } });
    psCreated++;
  }
  console.log(`  Payment schemes: ${psCreated} created`);

  // ── Enable the module for this business ──────────────────────────────────
  await prisma.systemSetting.upsert({
    where:  { businessId_key: { businessId, key: 'school.enabled' } },
    update: { value: 'true' },
    create: { businessId, key: 'school.enabled', value: 'true' },
  });
  console.log('  Module flag: school.enabled = true');

  // ── Hide the module from the businesses that are not schools ─────────────
  if (hideFromOthers) {
  // The existing per-business module toggle (Settings → Modules) already does
  // exactly this, so we reuse it rather than inventing a second mechanism.
  // A business that has its own fee types is treated as a school and left
  // alone, so setting up a second school never switches the first one off.
  const others = await prisma.business.findMany({ where: { id: { not: businessId } }, select: { id: true, code: true } });
  const hidden = [];
  for (const o of others) {
    const isSchool = await prisma.feeType.count({ where: { businessId: o.id } });
    if (isSchool) continue;

    const row = await prisma.systemSetting.findUnique({
      where: { businessId_key: { businessId: o.id, key: 'disabledModules' } },
    });
    let list = [];
    if (row?.value) { try { list = JSON.parse(row.value); } catch { list = []; } }
    if (list.includes('school')) continue;

    list.push('school');
    await prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId: o.id, key: 'disabledModules' } },
      update: { value: JSON.stringify(list) },
      create: { businessId: o.id, key: 'disabledModules', value: JSON.stringify(list) },
    });
    hidden.push(o.code);
  }
  console.log(`  Module hidden from non-school businesses: ${hidden.length ? hidden.join(', ') : 'none needed'}`);
  }

  // ── Cutover warning ──────────────────────────────────────────────────────
  // glPost silently skips anything dated before booksStartDate, so a school
  // year that opened before the cutover would post nothing at all.
  if (business.booksStartDate) {
    const d = business.booksStartDate.toISOString().slice(0, 10);
    console.log(`\n  Books start date is ${d}.`);
    console.log('  Invoices dated before it will NOT post to the GL. Confirm this is');
    console.log('  the intended cutover before running the first billing run.');
  }

  console.log('\nDone.\n');
}

module.exports = { setupSchool };

// CLI entry - only when run directly, so requiring this file has no side effects.
if (require.main === module) {
  setupSchool(parseBusinessId())
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
