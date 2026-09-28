'use client';
import { useState, useEffect, useCallback } from 'react';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Loader2, Play, CheckCircle2, Lock, CalendarRange, Info, TrendingUp,
} from 'lucide-react';

/**
 * Monthly recognition of deferred tuition — the ON_ASSESSMENT counterpart to
 * the billing run.
 *
 * Under the "recognise as billed" policy this screen has nothing to do, and
 * says so rather than presenting controls that would post a zero entry.
 */
export default function AmortizationPage() {
  const [years, setYears] = useState([]);
  const [schoolYearId, setSchoolYearId] = useState('');
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    sApi.schoolYears.list()
      .then(({ data }) => {
        setYears(data);
        const current = data.find((y) => y.isCurrent);
        if (current) setSchoolYearId(String(current.id));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.amortization.list(schoolYearId ? { schoolYearId } : {});
      setState(data);
      // Default to the earliest month that has not been recognised yet.
      const next = data.periods?.find((p) => !p.done);
      setPeriod(next ? next.period : (data.periods?.[data.periods.length - 1]?.period || ''));
      setPreview(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load amortisation history');
    } finally {
      setLoading(false);
    }
  }, [schoolYearId]);

  useEffect(() => { load(); }, [load]);

  const runPreview = async () => {
    if (!period) return;
    setPreviewing(true);
    try {
      const { data } = await sApi.amortization.preview({ period, schoolYearId: schoolYearId || undefined });
      setPreview(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not build the preview');
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const commit = async () => {
    if (!preview?.total) return;
    if (!window.confirm(
      `Recognise ${formatCurrency(preview.total)} of tuition revenue for ${period}?\n\n` +
      `This posts DR Unearned Tuition Income / CR revenue and cannot be run twice for the same month.`
    )) return;

    setRunning(true);
    try {
      const { data } = await sApi.amortization.run({ period, schoolYearId: schoolYearId || undefined });
      toast.success(data.message);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'The amortisation run failed');
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Revenue Recognition</h1>
          <p className="page-subtitle">Move deferred tuition into revenue, one month at a time.</p>
        </div>
      </div>

      {state && !state.applicable && (
        <div className="card">
          <div className="card-body flex gap-3 py-10">
            <Info className="h-5 w-5 flex-none text-blue-600 mt-0.5" />
            <div>
              <p className="font-medium">Nothing to amortise on this business.</p>
              <p className="text-sm text-gray-500 mt-1">
                It runs the <strong>recognise as billed</strong> policy, where revenue is earned as each
                installment is invoiced. There is no Unearned Tuition Income balance to release.
              </p>
              <p className="text-sm text-gray-500 mt-2">
                To change that, open <strong>School → Setup → Revenue Policy</strong>. It can only be changed
                while no assessment has been issued.
              </p>
            </div>
          </div>
        </div>
      )}

      {state?.applicable && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Assessed (gross)</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(state.totals.assessedGross)}</p>
            </div></div>
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Recognised to date</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(state.totals.recognised)}</p>
            </div></div>
            <div className="card"><div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Still deferred</p>
              <p className="text-xl font-semibold tabular-nums">{formatCurrency(state.totals.deferred)}</p>
            </div></div>
          </div>

          <div className="card mb-4"><div className="card-body">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="form-group mb-0">
                <label className="label">School Year</label>
                <select className="input" value={schoolYearId} onChange={(e) => setSchoolYearId(e.target.value)}>
                  {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
                </select>
              </div>
              <div className="form-group mb-0">
                <label className="label">Period</label>
                <select className="input" value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); }}>
                  {state.periods.map((p) => (
                    <option key={p.period} value={p.period}>
                      {p.period}{p.done ? ' — already recognised' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={runPreview} disabled={previewing || !period}
                      className="btn-secondary flex items-center gap-2">
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                Preview
              </button>
            </div>
          </div></div>

          {preview && (
            <div className="card mb-4"><div className="card-body">
              {preview.alreadyRun ? (
                <div className="flex gap-3 mb-4">
                  <Lock className="h-5 w-5 flex-none text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">{preview.period} has already been recognised.</p>
                    <p className="text-gray-500">
                      {formatCurrency(preview.alreadyRun.amount)} posted on {formatDate(preview.alreadyRun.runAt)}.
                      Running it again would double the revenue, so it is blocked.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h2 className="font-semibold">
                      {formatCurrency(preview.total)} to recognise for {preview.period}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {preview.assessmentCount} assessment{preview.assessmentCount === 1 ? '' : 's'}
                      {' '}spread over {preview.months} month{preview.months === 1 ? '' : 's'}
                    </p>
                  </div>
                  <button onClick={commit} disabled={running || !preview.total}
                          className="btn-primary flex items-center gap-2">
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    {running ? 'Posting…' : 'Recognise this month'}
                  </button>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                      <th className="py-2">Account</th><th className="py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    <tr className="font-medium">
                      <td className="py-2">
                        <span className="font-mono text-xs mr-2">2210</span>
                        Unearned Tuition Income
                      </td>
                      <td className="py-2 text-right tabular-nums">DR {formatCurrency(preview.total)}</td>
                    </tr>
                    {preview.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="py-2 pl-6">
                          <span className="font-mono text-xs mr-2">{l.accountCode}</span>
                          {l.accountName}
                        </td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div></div>
          )}

          <div className="card"><div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Period</th><th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Posted</th>
                    <th className="px-4 py-3 text-right">Recognised</th>
                    <th className="px-4 py-3">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {state.periods.map((p) => (
                    <tr key={p.period} className={p.period === period ? 'bg-blue-50 dark:bg-blue-950' : ''}>
                      <td className="px-4 py-2.5 font-mono text-xs">{p.period}</td>
                      <td className="px-4 py-2.5">
                        {p.done
                          ? <span className="badge badge-green flex items-center gap-1 w-fit">
                              <CheckCircle2 className="h-3 w-3" /> Recognised
                            </span>
                          : <span className="badge badge-yellow">Pending</span>}
                      </td>
                      <td className="px-4 py-2.5">{p.run ? formatDate(p.run.runAt) : '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {p.run ? formatCurrency(p.run.amount) : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.run?.reference || '—'}</td>
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
