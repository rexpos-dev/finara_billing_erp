jest.mock('../server/config/database', () => ({
  studentLedger: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
}));

const prisma = require('../server/config/database');
const ledger = require('../server/utils/studentLedger');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * A stand-in for the studentLedger table that behaves like the real one for the
 * two operations `append` depends on: "last row for this student" and "insert".
 *
 * The seq and balance are assigned from a read of the previous row, so asserting
 * on a single mocked call proves nothing — the invariant only shows up across
 * successive appends against state that actually carries forward.
 */
function fakeTx() {
  const rows = [];
  return {
    rows,
    studentLedger: {
      findFirst: async ({ where, orderBy }) => {
        const mine = rows.filter((r) => r.studentId === where.studentId);
        if (!mine.length) return null;
        const desc = orderBy?.seq === 'desc';
        return mine.slice().sort((a, b) => (desc ? b.seq - a.seq : a.seq - b.seq))[0];
      },
      create: async ({ data }) => {
        const row = { id: rows.length + 1, ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

const charge = (over = {}) => ({
  businessId: 6, studentId: 1, entryDate: new Date('2026-09-08T00:00:00Z'),
  type: 'CHARGE', description: 'Installment 1 of 10', debit: 4090, ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('appending to a student ledger', () => {
  test('the balance runs forward: a charge raises it, a payment lowers it', async () => {
    const tx = fakeTx();

    await ledger.append(tx, charge());
    await ledger.append(tx, charge({ type: 'CHARGE', description: 'Installment 2 of 10' }));
    await ledger.append(tx, {
      businessId: 6, studentId: 1, entryDate: new Date('2026-10-05T00:00:00Z'),
      type: 'PAYMENT', description: 'OR-000001', credit: 4090,
    });

    expect(tx.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(tx.rows.map((r) => r2(r.balance))).toEqual([4090, 8180, 4090]);
  });

  test('each student gets their own sequence and balance', async () => {
    const tx = fakeTx();

    await ledger.append(tx, charge({ studentId: 1, debit: 4090 }));
    await ledger.append(tx, charge({ studentId: 2, debit: 3000 }));
    await ledger.append(tx, charge({ studentId: 2, debit: 3000 }));

    const forStudent = (id) => tx.rows.filter((r) => r.studentId === id);
    // Student 2's first row must start at seq 1 with its own balance — not
    // continue student 1's sequence, which would make both statements wrong.
    expect(forStudent(1).map((r) => r.seq)).toEqual([1]);
    expect(forStudent(2).map((r) => r.seq)).toEqual([1, 2]);
    expect(forStudent(2).map((r) => r2(r.balance))).toEqual([3000, 6000]);
  });

  test('rounds to centavos, so float noise never accumulates in the balance', async () => {
    const tx = fakeTx();

    await ledger.append(tx, charge({ debit: 0.1 }));
    await ledger.append(tx, charge({ debit: 0.2 }));

    expect(r2(tx.rows[1].balance)).toBe(0.3);
    expect(tx.rows[1].balance).toBe(0.3);
  });

  test('a zero-amount entry is not written at all', async () => {
    const tx = fakeTx();
    const row = await ledger.append(tx, charge({ debit: 0 }));

    // A ₱0 discount or subsidy is not an event in the account's history;
    // writing it would burn a seq and clutter the statement.
    expect(row).toBeNull();
    expect(tx.rows).toHaveLength(0);
  });

  test('refuses a row that is both a debit and a credit', async () => {
    const tx = fakeTx();
    await expect(ledger.append(tx, charge({ debit: 100, credit: 40 })))
      .rejects.toThrow(/debit or a credit/);
    expect(tx.rows).toHaveLength(0);
  });

  test('refuses a negative amount, rather than treating it as the other column', async () => {
    const tx = fakeTx();
    await expect(ledger.append(tx, charge({ debit: -100 })))
      .rejects.toThrow(/positive/);
    await expect(ledger.append(tx, charge({ debit: 0, credit: -100 })))
      .rejects.toThrow(/positive/);
    expect(tx.rows).toHaveLength(0);
  });

  test('truncates an over-long description instead of failing the write', async () => {
    const tx = fakeTx();
    await ledger.append(tx, charge({ description: 'x'.repeat(400) }));
    expect(tx.rows[0].description).toHaveLength(255);
  });

  test('retries against a fresh read when a concurrent writer already took the next seq', async () => {
    // Simulates two cashiers posting for the same student at once: this writer
    // reads seq 1 first, but by the time it inserts, another transaction has
    // already committed seq 2 — the unique index on (studentId, seq) rejects it
    // (P2002), and append must re-read and retry rather than corrupting the
    // balance or crashing the request.
    const reads = [{ seq: 1, balance: 4090 }, { seq: 2, balance: 8180 }];
    let readCall = 0;
    const created = [];
    const tx = {
      studentLedger: {
        findFirst: jest.fn(async () => reads[readCall++]),
        create: jest.fn(async ({ data }) => {
          if (data.seq === 2) {
            const err = new Error('Unique constraint failed on the fields: (studentId, seq)');
            err.code = 'P2002';
            throw err;
          }
          const row = { id: created.length + 1, ...data };
          created.push(row);
          return row;
        }),
      },
    };

    const row = await ledger.append(tx, charge({ debit: 4090 }));

    expect(tx.studentLedger.findFirst).toHaveBeenCalledTimes(2);
    expect(row.seq).toBe(3);
    expect(row.balance).toBe(12270);
  });

  test('gives up after repeated collisions instead of retrying forever', async () => {
    const tx = {
      studentLedger: {
        findFirst: jest.fn(async () => ({ seq: 1, balance: 4090 })),
        create: jest.fn(async () => {
          const err = new Error('Unique constraint failed on the fields: (studentId, seq)');
          err.code = 'P2002';
          throw err;
        }),
      },
    };

    await expect(ledger.append(tx, charge({ debit: 4090 }))).rejects.toMatchObject({ code: 'P2002' });
    expect(tx.studentLedger.create).toHaveBeenCalledTimes(5);
  });

  test('appendMany keeps the order it was given and skips the empty rows', async () => {
    const tx = fakeTx();
    const written = await ledger.appendMany(tx, [
      charge({ type: 'CHARGE',   description: 'Tuition',  debit: 30000 }),
      charge({ type: 'DISCOUNT', description: 'None',     debit: 0, credit: 0 }),
      charge({ type: 'SUBSIDY',  description: 'DepEd ESC', debit: 0, credit: 9000 }),
    ]);

    expect(written).toHaveLength(2);
    expect(tx.rows.map((r) => r.type)).toEqual(['CHARGE', 'SUBSIDY']);
    expect(tx.rows.map((r) => r2(r.balance))).toEqual([30000, 21000]);
  });
});

describe('reading a student ledger', () => {
  test('the closing balance comes from the latest row, not the filtered window', async () => {
    // A date-filtered statement still has to show what the account actually
    // owes today; summing only the shown rows would understate it.
    prisma.studentLedger.findMany.mockResolvedValue([
      { id: 2, seq: 2, debit: 4090, credit: 0, balance: 8180 },
    ]);
    prisma.studentLedger.findFirst.mockResolvedValue({ balance: 12270 });

    const { rows, totals } = await ledger.read(6, 1, { from: '2026-10-01', to: '2026-10-31' });

    expect(rows).toHaveLength(1);
    expect(totals.debit).toBe(4090);
    expect(totals.credit).toBe(0);
    expect(totals.balance).toBe(12270);
  });

  test('an account with no rows reads as zero, not as a crash', async () => {
    prisma.studentLedger.findMany.mockResolvedValue([]);
    prisma.studentLedger.findFirst.mockResolvedValue(null);

    const { totals } = await ledger.read(6, 1);
    expect(totals).toEqual({ debit: 0, credit: 0, balance: 0 });

    expect(await ledger.balanceOf(6, 1)).toBe(0);
  });
});

describe('rebuilding a student ledger after a backdated row', () => {
  test('renumbers and re-runs the balance in date then id order', async () => {
    // The repair tool: an insert dated before existing rows leaves seq and
    // balance describing a history that no longer exists.
    prisma.studentLedger.findMany.mockResolvedValue([
      { id: 3, debit: 1000, credit: 0 },   // the backdated row, sorted first by the query
      { id: 1, debit: 4090, credit: 0 },
      { id: 2, debit: 0,    credit: 590 },
    ]);
    prisma.studentLedger.update.mockResolvedValue({});

    const result = await ledger.rebuild(1);

    const written = prisma.studentLedger.update.mock.calls.map((c) => ({
      id: c[0].where.id, ...c[0].data,
    }));
    expect(written).toEqual([
      { id: 3, seq: 1, balance: 1000 },
      { id: 1, seq: 2, balance: 5090 },
      { id: 2, seq: 3, balance: 4500 },
    ]);
    expect(result).toEqual({ rows: 3, closingBalance: 4500 });
  });
});
