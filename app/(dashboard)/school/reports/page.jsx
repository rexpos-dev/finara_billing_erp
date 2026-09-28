'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Loader2, Printer, Wallet, AlertTriangle, Users, TrendingUp,
} from 'lucide-react';

const TABS = [
  { key: 'collections',  label: 'Collections',        icon: Wallet },
  { key: 'delinquency',  label: 'Delinquency',        icon: AlertTriangle },
  { key: 'enrollment',   label: 'Enrollment Summary', icon: Users },
];

export default function SchoolReportsPage() {
  const [tab, setTab] = useState('collections');
  const [years, setYears] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [schoolYearId, setSchoolYearId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');

  useEffect(() => {
    Promise.all([sApi.schoolYears.list(), sApi.gradeLevels.list()])
      .then(([y, l]) => {
        setYears(y.data);
        setLevels(l.data.filter((x) => x.isActive));
        const current = y.data.find((x) => x.isCurrent);
        if (current) setSchoolYearId(String(current.id));
      })
      .catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true); setReport(null);
    try {
      let data;
      if (tab === 'collections') {
        ({ data } = await sApi.reports.collections({ from, to }));
      } else if (tab === 'delinquency') {
        ({ data } = await sApi.reports.delinquency({
          schoolYearId: schoolYearId || undefined,
          gradeLevelId: gradeLevelId || undefined,
        }));
      } else {
        ({ data } = await sApi.reports.enrollmentSummary({ schoolYearId: schoolYearId || undefined }));
      }
      setReport(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not build this report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setReport(null); }, [tab]);

  const print = () => {
    if (!report) return;
    if (tab === 'collections') {
      const rows = report.items.map((i) => `
        <tr><td>${dateFmt(i.paymentDate)}</td><td>${i.paymentNo}</td><td>${i.student}</td>
            <td>${i.paymentMethod}</td><td style="text-align:right">${phpFmt(i.amount)}</td></tr>`).join('');
      const methods = Object.entries(report.byMethod).map(([m, v]) => `
        <tr><td>${m}</td><td style="text-align:right">${phpFmt(v)}</td></tr>`).join('');
      printDocument('COLLECTIONS REPORT', `${dateFmt(from)} to ${dateFmt(to)}`, `
        <table class="tbl">
          <thead><tr><th>Date</th><th>Receipt</th><th>Student</th><th>Method</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${rows}
            <tr class="total"><td colspan="4"><strong>Total (${report.count} payments)</strong></td>
                <td style="text-align:right"><strong>${phpFmt(report.total)}</strong></td></tr></tbody>
        </table>
        <h3 style="margin-top:22px">By payment method</h3>
        <table class="tbl"><tbody>${methods}</tbody></table>
      `);
    } else if (tab === 'delinquency') {
      const rows = report.items.map((i) => `
        <tr><td>${i.studentNo}</td><td>${i.student}</td><td>${i.gradeLevel}</td>
            <td>${i.guardian || '—'}</td><td>${i.guardianPhone || '—'}</td>
            <td style="text-align:right">${i.oldestDays}</td>
            <td style="text-align:right">${phpFmt(i.outstanding)}</td></tr>`).join('');
      printDocument('DELINQUENCY REPORT', `As of ${dateFmt(today)}`, `
        <table class="tbl">
          <thead><tr><th>Student No.</th><th>Student</th><th>Grade</th><th>Guardian</th><th>Contact</th>
            <th style="text-align:right">Days</th><th style="text-align:right">Outstanding</th></tr></thead>
          <tbody>${rows}
            <tr class="total"><td colspan="6"><strong>Total (${report.studentCount} students)</strong></td>
                <td style="text-align:right"><strong>${phpFmt(report.total)}</strong></td></tr></tbody>
        </table>
      `);
    } else {
      const rows = report.levels.map((l) => `
        <tr><td>${l.name}</td><td style="text-align:right">${l.students}</td>
            <td style="text-align:right">${phpFmt(l.assessed)}</td>
            <td style="text-align:right">${phpFmt(l.billed)}</td>
            <td style="text-align:right">${phpFmt(l.collected)}</td></tr>`).join('');
      printDocument('ENROLLMENT SUMMARY', report.schoolYear.code, `
        <table class="tbl">
          <thead><tr><th>Grade Level</th><th style="text-align:right">Students</th>
            <th style="text-align:right">Assessed</th><th style="text-align:right">Billed</th>
            <th style="text-align:right">Collected</th></tr></thead>
          <tbody>${rows}
            <tr class="total"><td><strong>Total</strong></td>
                <td style="text-align:right"><strong>${report.totals.students}</strong></td>
                <td style="text-align:right"><strong>${phpFmt(report.totals.assessed)}</strong></td>
                <td style="text-align:right"><strong>${phpFmt(report.totals.billed)}</strong></td>
                <td style="text-align:right"><strong>${phpFmt(report.totals.collected)}</strong></td></tr></tbody>
        </table>
      `);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">School Reports</h1>
          <p className="page-subtitle">Collections, delinquency, and enrollment.</p>
        </div>
        {report && (
          <button onClick={print} className="btn-secondary flex items-center gap-2">
            <Printer className="h-4 w-4" /> Print
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b dark:border-gray-700 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 whitespace-nowrap -mb-px ${
              tab === t.key
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body flex flex-wrap gap-3 items-end">
          {tab === 'collections' ? (
            <>
              <div className="form-group mb-0">
                <label className="label">From</label>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="form-group mb-0">
                <label className="label">To</label>
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="form-group mb-0">
                <label className="label">School Year</label>
                <select className="input" value={schoolYearId} onChange={(e) => setSchoolYearId(e.target.value)}>
                  <option value="">All</option>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
                </select>
              </div>
              {tab === 'delinquency' && (
                <div className="form-group mb-0">
                  <label className="label">Grade Level</label>
                  <select className="input" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
                    <option value="">All</option>
                    {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
            </>
          )}
          <button onClick={run} disabled={loading} className="btn-primary flex items-center gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
            Run report
          </button>
        </div>
      </div>

      {/* ── Collections ─────────────────────────────────────── */}
      {report && tab === 'collections' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Total collected</p>
              <p className="text-2xl font-semibold tabular-nums">{formatCurrency(report.total)}</p>
            </div></div>
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Payments</p>
              <p className="text-2xl font-semibold tabular-nums">{report.count}</p>
            </div></div>
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">By method</p>
              <div className="space-y-0.5 text-sm">
                {Object.entries(report.byMethod).map(([m, v]) => (
                  <div key={m} className="flex justify-between">
                    <span className="text-gray-500">{m}</span>
                    <span className="tabular-nums">{formatCurrency(v)}</span>
                  </div>
                ))}
              </div>
            </div></div>
          </div>

          <div className="card"><div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Date</th><th className="px-4 py-3">Receipt</th>
                    <th className="px-4 py-3">Student</th><th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Method</th><th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {report.items.map((i) => (
                    <tr key={i.paymentNo}>
                      <td className="px-4 py-2.5">{formatDate(i.paymentDate)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{i.paymentNo}</td>
                      <td className="px-4 py-2.5">{i.student}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{i.invoiceNo}</td>
                      <td className="px-4 py-2.5">{i.paymentMethod}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></div>
        </>
      )}

      {/* ── Delinquency ─────────────────────────────────────── */}
      {report && tab === 'delinquency' && (
        <>
          <div className="card mb-4"><div className="card-body">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-3">Aging</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {Object.entries(report.summary).map(([bucket, amount]) => (
                <div key={bucket}>
                  <p className="text-xs text-gray-500">{bucket}</p>
                  <p className="font-semibold tabular-nums">{formatCurrency(amount)}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t dark:border-gray-700 flex justify-between">
              <span className="text-sm text-gray-500">{report.studentCount} students behind</span>
              <span className="font-semibold tabular-nums">{formatCurrency(report.total)}</span>
            </div>
          </div></div>

          <div className="card"><div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Student</th><th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Guardian</th><th className="px-4 py-3">Contact</th>
                    <th className="px-4 py-3 text-right">Days</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {report.items.map((i) => (
                    <tr key={i.studentId} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-2.5">
                        <Link href={`/school/students/${i.studentId}`} className="text-blue-600 hover:underline">
                          {i.student}
                        </Link>
                        <span className="block text-[11px] text-gray-500 font-mono">{i.studentNo}</span>
                      </td>
                      <td className="px-4 py-2.5">{i.gradeLevel}</td>
                      <td className="px-4 py-2.5">{i.guardian || '—'}</td>
                      <td className="px-4 py-2.5">{i.guardianPhone || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{i.oldestDays}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(i.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></div>
        </>
      )}

      {/* ── Enrollment summary ──────────────────────────────── */}
      {report && tab === 'enrollment' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            {[
              ['Students', report.totals.students, false],
              ['Assessed', report.totals.assessed, true],
              ['Billed', report.totals.billed, true],
              ['Collected', report.totals.collected, true],
            ].map(([label, value, money]) => (
              <div key={label} className="card"><div className="card-body">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</p>
                <p className="text-xl font-semibold tabular-nums">
                  {money ? formatCurrency(value) : value}
                </p>
              </div></div>
            ))}
          </div>

          <div className="card"><div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Grade Level</th><th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3 text-right">Students</th>
                    <th className="px-4 py-3 text-right">Assessed</th>
                    <th className="px-4 py-3 text-right">Subsidised</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-right">Collected</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {report.levels.map((l) => (
                    <tr key={l.gradeLevelId}>
                      <td className="px-4 py-2.5 font-medium">{l.name}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{l.stage}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{l.students}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(l.assessed)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(l.subsidised)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(l.billed)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(l.collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div></div>
        </>
      )}
    </div>
  );
}
