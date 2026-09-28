const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, resolveBusiness } = require('../middleware/auth');
const { isSchool } = require('../middleware/requireSchool');

router.use(authenticate, resolveBusiness);

router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const [
      totalCustomers, totalVendors, totalEmployees,
      openInvoices, openBills, draftEntries,
      monthRevenue, monthExpense,
      overdueReceivables, overduePayables,
      biz, openingEntry, totalEntries, school, totalStudents,
    ] = await Promise.all([
      prisma.customer.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.vendor.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.employee.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.invoice.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] } }, _sum: { totalAmount: true }, _count: true }),
      prisma.bill.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] } }, _sum: { totalAmount: true }, _count: true }),
      prisma.journalEntry.count({ where: { businessId: req.businessId, status: 'DRAFT' } }),
      prisma.journalLine.aggregate({
        where: { entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOfMonth, lte: endOfMonth } }, account: { accountType: 'REVENUE' } },
        _sum: { credit: true },
      }),
      prisma.journalLine.aggregate({
        where: { entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOfMonth, lte: endOfMonth } }, account: { accountType: 'EXPENSE' } },
        _sum: { debit: true },
      }),
      prisma.invoice.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] }, dueDate: { lt: today } }, _sum: { totalAmount: true } }),
      prisma.bill.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] }, dueDate: { lt: today } }, _sum: { totalAmount: true } }),
      prisma.business.findUnique({ where: { id: req.businessId }, select: { tin: true, address: true, booksStartDate: true, taxType: true } }),
      prisma.journalEntry.findFirst({ where: { businessId: req.businessId, reference: 'OPENING-BALANCE' }, select: { id: true } }),
      prisma.journalEntry.count({ where: { businessId: req.businessId } }),
      isSchool(req.businessId),
      prisma.student.count({ where: { businessId: req.businessId } }),
    ]);

    // Onboarding checklist — each step is derived from real data, so it ticks
    // itself off as the business fills in.
    const steps = [
      { key: 'company',   label: 'Complete company info (TIN, address, tax type)',   href: '/settings/businesses',        done: !!(biz?.tin && biz?.address && biz?.taxType) },
      { key: 'booksDate', label: 'Set the books start date',                  href: '/settings/businesses',        done: !!biz?.booksStartDate },
      { key: 'opening',   label: 'Enter opening balances',                    href: '/settings/opening-balances',  done: !!openingEntry },
      // A school bills students, not trade customers/vendors.
      ...(school
        ? [{ key: 'students', label: 'Enroll your first student', href: '/school/students', done: totalStudents > 0 }]
        : [
            { key: 'customers', label: 'Add your first customer', href: '/receivable/customers', done: totalCustomers > 0 },
            { key: 'vendors',   label: 'Add your first vendor',   href: '/payable/vendors',      done: totalVendors > 0 },
          ]),
      { key: 'firstTxn',  label: 'Record your first transaction',             href: '/journal',                    done: totalEntries - (openingEntry ? 1 : 0) > 0 },
    ];

    res.json({
      setup: { steps, completed: steps.filter((x) => x.done).length, total: steps.length },
      counts: { customers: totalCustomers, vendors: totalVendors, employees: totalEmployees },
      receivables: {
        openCount:  openInvoices._count,
        openAmount: Number(openInvoices._sum.totalAmount || 0),
        overdue:    Number(overdueReceivables._sum.totalAmount || 0),
      },
      payables: {
        openCount:  openBills._count,
        openAmount: Number(openBills._sum.totalAmount || 0),
        overdue:    Number(overduePayables._sum.totalAmount || 0),
      },
      gl: {
        draftEntries,
        monthRevenue: Number(monthRevenue._sum.credit || 0),
        monthExpense: Number(monthExpense._sum.debit  || 0),
        netIncome: Number(monthRevenue._sum.credit || 0) - Number(monthExpense._sum.debit || 0),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
