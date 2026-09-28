'use client';
import { useState, useEffect } from 'react';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Play, Loader2, AlertTriangle, CheckCircle2, CalendarClock, Ban,
} from 'lucide-react';

/**
 * The monthly billing run.
 *
 * Preview before commit, always. A run creates hundreds of invoices and
 * hundreds of journal entries; an accountant needs to see the list and the
 * total before any of that happens.
 */
export default function BillingRunPage() {
  const [years, setYears] = useState([]);
  const [levels, setLevels] = useState([]);
  const [upTo, setUpTo] = useState(() => {
    // Default to the end of the current month — the usual billing cut-off.
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [schoolYearId, setSchoolYearId] = useState('');
  const [gradeLevelId, setGradeLevelId] = useState('');

  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

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

  const runPreview = async () => {
    setLoading(true); setResult(null);
    try {
      const { data } = await sApi.billing.preview({
        upTo,
        schoolYearId: schoolYearId || undefined,
        gradeLevelId: gradeLevelId || undefined,
      });
      setPreview(data);
      if (data.billable.length === 0 && data.blocked.length === 0) {
        toast('Nothing is due to bill up to that date.', { icon: '📭' });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not build the preview');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    if (!preview?.billable.length) return;
    if (!window.confirm(
      `Bill ${preview.billable.length} installment${preview.billable.length === 1 ? '' : 's'} ` +
      `totalling ${formatCurrency(preview.totals.amount)}?\n\n` +
      `This creates invoices and posts them to the general ledger.`
    )) return;

    setRunning(true);
    try {
      const { data } = await sApi.billing.run({
        upTo,
        schoolYearId: schoolYearId || undefined,
        gradeLevelId: gradeLevelId || undefined,
      });
      setResult(data);
      toast.success(data.message);
      await runPreview();
    } catch (err) {
      toast.error(err.response?.data?.error || 'The billing run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing Run</h1>
          <p className="page-subtitle">Turn due installments into invoices, posted to the ledger.</p>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="form-group mb-0">
              <label className="label">Bill everything due up to</label>
              <input className="input" type="date" value={upTo} onChange={(e) => setUpTo(e.target.value)} />
            </div>
            <div className="form-group mb-0">
              <label className="label">School Year</label>
              <select className="input" value={schoolYearId} onChange={(e) => setSchoolYearId(e.target.value)}>
                <option value="">All</option>
                {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
              </select>
            </div>
            <div className="form-group mb-0">
              <label className="label">Grade Level</label>
              <select className="input" value={gradeLevelId} onChange={(e) => setGradeLevelId(e.target.value)}>
                <option value="">All</option>
                {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <button onClick={runPreview} disabled={loading} className="btn-secondary flex items-center justify-center gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              Preview
            </button>
          </div>
        </div>
      </div>

      {result && (
        <div className="card mb-4 border-green-300 dark:border-green-800">
          <div className="card-body">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 flex-none text-green-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium">{result.message}</p>
                {result.failures.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-red-600 mb-1">Could not bill:</p>
                    <ul className="text-xs space-y-1">
                      {result.failures.map((f) => (
                        <li key={f.installmentId} className="text-gray-600 dark:text-gray-400">
                          <strong>{f.student}</strong> — {f.label}: {f.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.blocked > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-500 mb-1">
                      Skipped — dated before the books start ({result.cutover}):
                    </p>
                    <ul className="text-xs space-y-1">
                      {result.blockedRows.slice(0, 8).map((b) => (
                        <li key={b.installmentId} className="text-gray-600 dark:text-gray-400">
                          <strong>{b.student}</strong> — {b.label}, due {formatDate(b.dueDate)}
                        </li>
                      ))}
                      {result.blockedRows.length > 8 && <li>…and {result.blockedRows.length - 8} more.</li>}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {preview?.blocked?.length > 0 && (
        <div className="card mb-4 border-amber-300 dark:border-amber-800">
          <div className="card-body">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 flex-none text-amber-600 mt-0.5" />
              <div>
                <p className="font-medium">{preview.warning}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Excluded: {preview.totals.blockedCount} installment{preview.totals.blockedCount === 1 ? '' : 's'}
                  {' '}worth {formatCurrency(preview.totals.blockedAmount)}.
                  Change the books start date in Settings, or move these due dates forward.
                </p>
                <ul className="text-xs mt-2 space-y-0.5 text-gray-600 dark:text-gray-400">
                  {preview.blocked.slice(0, 8).map((b) => (
                    <li key={b.installmentId}>
                      <Ban className="h-3 w-3 inline mr-1" />
                      {b.student} — {b.label}, due {formatDate(b.dueDate)}
                    </li>
                  ))}
                  {preview.blocked.length > 8 && <li>…and {preview.blocked.length - 8} more.</li>}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="card">
          <div className="card-body">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="font-semibold">
                  {preview.totals.count} installment{preview.totals.count === 1 ? '' : 's'} ready to bill
                </h2>
                <p className="text-sm text-gray-500">
                  Total {formatCurrency(preview.totals.amount)}
                </p>
              </div>
              <button onClick={commit} disabled={running || preview.totals.count === 0}
                      className="btn-primary flex items-center gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {running ? 'Billing…' : `Bill ${preview.totals.count} installment${preview.totals.count === 1 ? '' : 's'}`}
              </button>
            </div>

            {preview.billable.length === 0 ? (
              <p className="text-center text-gray-500 py-10">Nothing due up to {formatDate(upTo)}.</p>
            ) : (
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white dark:bg-gray-900">
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                      <th className="py-2">Student</th><th className="py-2">Grade</th>
                      <th className="py-2">Installment</th><th className="py-2">Due</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {preview.billable.map((r) => (
                      <tr key={r.installmentId}>
                        <td className="py-2">{r.student}</td>
                        <td className="py-2">{r.gradeLevel}</td>
                        <td className="py-2">{r.label}</td>
                        <td className="py-2">{formatDate(r.dueDate)}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {!preview && !loading && (
        <div className="card">
          <div className="card-body text-center py-16 text-gray-500">
            <CalendarClock className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Pick a cut-off date and preview the run</p>
            <p className="text-sm">Nothing is billed until you review the list and commit.</p>
          </div>
        </div>
      )}
    </div>
  );
}
