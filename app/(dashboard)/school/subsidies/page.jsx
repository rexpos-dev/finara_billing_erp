'use client';
import { useState, useEffect, useCallback } from 'react';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Loader2, Landmark, CheckCircle2, Banknote } from 'lucide-react';

const STATUS_BADGE = { PENDING: 'badge-yellow', BILLED: 'badge-blue', RECEIVED: 'badge-green' };

/**
 * DepEd subsidy tracking (ESC, SHS voucher, LGU, private sponsors).
 *
 * A subsidy is a receivable against DepEd, not revenue — the revenue was
 * recognised when the fee was billed. Recording a remittance here only clears
 * that receivable.
 */
export default function SubsidiesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('BILLED');
  const [years, setYears] = useState([]);
  const [schoolYearId, setSchoolYearId] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [receiving, setReceiving] = useState(false);
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');

  useEffect(() => { sApi.schoolYears.list().then(({ data }) => setYears(data)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.subsidies.list({
        status: status || undefined,
        schoolYearId: schoolYearId || undefined,
      });
      setData(data);
      setSelected(new Set());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load subsidies');
    } finally {
      setLoading(false);
    }
  }, [status, schoolYearId]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectable = (data?.items || []).filter((i) => i.status !== 'RECEIVED');
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));
  const selectedTotal = (data?.items || [])
    .filter((i) => selected.has(i.id))
    .reduce((s, i) => s + i.outstanding, 0);

  const receive = async () => {
    if (selected.size === 0) return;
    setReceiving(true);
    try {
      const { data } = await sApi.subsidies.receive({
        subsidyIds: [...selected],
        receivedDate,
        reference: reference || undefined,
      });
      toast.success(data.message);
      setReference('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not record the remittance');
    } finally {
      setReceiving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Subsidies</h1>
          <p className="page-subtitle">ESC, SHS voucher, and sponsor receivables.</p>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="card"><div className="card-body">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Expected</p>
            <p className="text-xl font-semibold tabular-nums">{formatCurrency(data.totals.expected)}</p>
          </div></div>
          <div className="card"><div className="card-body">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Received</p>
            <p className="text-xl font-semibold tabular-nums">{formatCurrency(data.totals.received)}</p>
          </div></div>
          <div className="card"><div className="card-body">
            <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Still owed by DepEd</p>
            <p className="text-xl font-semibold tabular-nums">
              {formatCurrency(data.totals.expected - data.totals.received)}
            </p>
          </div></div>
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body flex flex-wrap gap-3">
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="BILLED">Billed — awaiting remittance</option>
            <option value="RECEIVED">Received</option>
          </select>
          <select className="input w-auto" value={schoolYearId} onChange={(e) => setSchoolYearId(e.target.value)}>
            <option value="">All school years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="card mb-4 border-blue-300 dark:border-blue-800">
          <div className="card-body">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <p className="font-medium">{selected.size} selected — {formatCurrency(selectedTotal)}</p>
                <p className="text-xs text-gray-500">
                  Posts DR Cash in Bank / CR Receivable — DepEd ESC. Revenue is not affected.
                </p>
              </div>
              <div className="form-group mb-0">
                <label className="label">Date received</label>
                <input className="input" type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
              </div>
              <div className="form-group mb-0">
                <label className="label">Remittance ref.</label>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)}
                       placeholder="Optional" />
              </div>
              <button onClick={receive} disabled={receiving} className="btn-primary flex items-center gap-2">
                {receiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                Record remittance
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
          ) : !data?.items.length ? (
            <div className="text-center py-16 text-gray-500">
              <Landmark className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No subsidies on record</p>
              <p className="text-sm">Add them to a student during enrollment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={allSelected}
                             onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((i) => i.id)))} />
                    </th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Programme</th>
                    <th className="px-4 py-3">Reference</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {data.items.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3">
                        <input type="checkbox" disabled={s.status === 'RECEIVED'}
                               checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                      </td>
                      <td className="px-4 py-3 font-medium">{s.student}</td>
                      <td className="px-4 py-3">{s.gradeLevel}</td>
                      <td className="px-4 py-3">{s.type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.referenceNo || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(s.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(s.outstanding)}</td>
                      <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[s.status]}`}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
