/**
 * studentLedger.js — The permanent financial history of a student.
 *
 * Append-only. Every charge, discount, subsidy, payment, adjustment and refund
 * lands here as one row carrying the running balance after it, so a statement
 * of account is a read rather than a reconstruction.
 *
 * Sign convention, matching the blueprint's section 11:
 *
 *   DEBIT   raises what the student owes  — tuition, fees, debit adjustments
 *   CREDIT  lowers it                     — payments, discounts, subsidies, credit memos
 *   balance = previous balance + debit − credit
 *
 * Why store the balance rather than sum on read: the ledger is what a parent is
 * handed at the window and what an auditor reads a year later. A stored balance
 * is a statement of what the account showed at that moment; a recomputed one
 * silently rewrites history the moment a backdated row is inserted.
 *
 * The cost of that choice is that `seq` and `balance` must be assigned inside
 * the caller's transaction, against the last row for that student. Every writer
 * therefore passes its transaction client in — never the bare prisma singleton.
 */

const prisma = require('../config/database');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Entry types that credit the account (reduce what is owed). */
const CREDIT_TYPES = new Set([
  'DISCOUNT', 'SCHOLARSHIP', 'SUBSIDY', 'PAYMENT',
  'ADVANCE_APPLIED', 'CREDIT_MEMO',
]);

/**
 * Append one row.
 *
 * @param {object} tx    a Prisma transaction client — REQUIRED, so the seq and
 *                       balance read cannot race another writer on the same student
 * @param {object} entry
 * @param {number} entry.businessId
 * @param {number} entry.studentId
 * @param {Date|string} entry.entryDate
 * @param {string} entry.type         a LedgerEntryType
 * @param {string} entry.description
 * @param {number} [entry.debit=0]
 * @param {number} [entry.credit=0]
 * @param {string} [entry.reference]
 * @param {number} [entry.assessmentId]
 * @param {number} [entry.invoiceId]
 * @param {string} [entry.entryNo]    the journal entry number, when one was posted
 * @param {number} [entry.createdBy]
 */
async function append(tx, entry) {
  const debit  = round2(entry.debit  || 0);
  const credit = round2(entry.credit || 0);

  if (debit < 0 || credit < 0) {
    throw new Error('Ledger amounts must be positive — use the other column instead of a negative');
  }
  if (debit === 0 && credit === 0) return null;
  if (debit > 0 && credit > 0) {
    throw new Error('A ledger row is a debit or a credit, never both');
  }

  // seq/balance are read-then-written against the last row for this student.
  // A unique index on (studentId, seq) turns a concurrent writer racing the
  // same read into a P2002 on create, instead of two rows silently sharing a
  // seq or carrying a stale balance — retry against a fresh read when that
  // happens rather than corrupting the account.
  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await tx.studentLedger.findFirst({
      where:   { studentId: Number(entry.studentId) },
      orderBy: { seq: 'desc' },
      select:  { seq: true, balance: true },
    });

    const seq     = (last?.seq || 0) + 1;
    const balance = round2(Number(last?.balance || 0) + debit - credit);

    try {
      return await tx.studentLedger.create({
        data: {
          businessId:   Number(entry.businessId),
          studentId:    Number(entry.studentId),
          entryDate:    entry.entryDate instanceof Date ? entry.entryDate : new Date(entry.entryDate),
          seq,
          type:         entry.type,
          reference:    entry.reference || null,
          description:  String(entry.description).slice(0, 255),
          debit, credit, balance,
          assessmentId: entry.assessmentId || null,
          invoiceId:    entry.invoiceId || null,
          entryNo:      entry.entryNo || null,
          createdBy:    entry.createdBy || null,
        },
      });
    } catch (err) {
      if (err.code === 'P2002' && attempt < 4) continue;
      throw err;
    }
  }
}

/**
 * Append several rows in order, sharing one transaction.
 *
 * Used where a single business event produces several ledger lines — an
 * assessment posts one row per fee, a discount, and a subsidy.
 */
async function appendMany(tx, entries) {
  const out = [];
  for (const e of entries) {
    const row = await append(tx, e);
    if (row) out.push(row);
  }
  return out;
}

/**
 * Convenience wrapper for callers that have no transaction of their own.
 *
 * Opens one so the seq/balance read and the insert stay atomic. Prefer passing
 * an existing transaction where the ledger row belongs with other writes.
 */
function appendStandalone(entry) {
  return prisma.$transaction((tx) => append(tx, entry));
}

/**
 * Recompute seq and balance for one student, in date then id order.
 *
 * The repair tool for after a backdated insert or a corrected row. Nothing
 * calls it automatically — a ledger that silently reflows is a ledger nobody
 * can reconcile against a printed statement.
 */
async function rebuild(studentId) {
  const rows = await prisma.studentLedger.findMany({
    where:   { studentId: Number(studentId) },
    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
    select:  { id: true, debit: true, credit: true },
  });

  let balance = 0, seq = 0;
  for (const r of rows) {
    seq += 1;
    balance = round2(balance + Number(r.debit) - Number(r.credit));
    await prisma.studentLedger.update({
      where: { id: r.id },
      data:  { seq, balance },
    });
  }
  return { rows: rows.length, closingBalance: balance };
}

/**
 * Read a student's ledger with its closing balance.
 */
async function read(businessId, studentId, { from, to, type } = {}) {
  const where = {
    businessId: Number(businessId),
    studentId:  Number(studentId),
    ...(type && { type }),
    ...((from || to) && {
      entryDate: {
        ...(from && { gte: new Date(from) }),
        ...(to   && { lte: new Date(to) }),
      },
    }),
  };

  const rows = await prisma.studentLedger.findMany({ where, orderBy: { seq: 'asc' } });

  // The closing balance is the last row's balance, not a sum of the filtered
  // window — a date-filtered view still has to show the true account balance.
  const latest = await prisma.studentLedger.findFirst({
    where:   { businessId: Number(businessId), studentId: Number(studentId) },
    orderBy: { seq: 'desc' },
    select:  { balance: true },
  });

  return {
    rows,
    totals: {
      debit:   round2(rows.reduce((s, r) => s + Number(r.debit), 0)),
      credit:  round2(rows.reduce((s, r) => s + Number(r.credit), 0)),
      balance: round2(Number(latest?.balance || 0)),
    },
  };
}

/** Current balance for one student, without pulling the rows. */
async function balanceOf(businessId, studentId) {
  const latest = await prisma.studentLedger.findFirst({
    where:   { businessId: Number(businessId), studentId: Number(studentId) },
    orderBy: { seq: 'desc' },
    select:  { balance: true },
  });
  return round2(Number(latest?.balance || 0));
}

module.exports = {
  append, appendMany, appendStandalone, rebuild, read, balanceOf,
  CREDIT_TYPES, round2,
};
