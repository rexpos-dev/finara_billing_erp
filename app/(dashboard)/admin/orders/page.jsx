'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';

const STATUSES = [
  ['PROOF_SUBMITTED', 'Under review'], ['PENDING_PAYMENT', 'Awaiting payment'],
  ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['CANCELLED', 'Cancelled'], ['', 'All'],
];

export default function OrdersAdminPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [status, setStatus]   = useState('PROOF_SUBMITTED');
  const [rows, setRows]       = useState([]);
  const [busyId, setBusyId]   = useState(null);
  const [rejecting, setRejecting] = useState(null);   // order
  const [note, setNote]       = useState('');

  const load = useCallback(async () => {
    try { setRows((await ordersApi.admin.orders(status)).data); }
    catch { toast.error('Failed to load orders'); }
  }, [status]);

  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
  }, [router]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  const viewProof = async (o) => {
    try {
      const { data } = await ordersApi.proofBlob(o.id);
      window.open(URL.createObjectURL(data), '_blank');
    } catch { toast.error('Could not open the proof'); }
  };

  const approve = async (o) => {
    if (!window.confirm(`Approve ${o.orderNo} and create "${o.companyName}"?`)) return;
    setBusyId(o.id);
    try { const { data } = await ordersApi.admin.approve(o.id); toast.success(data.message); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Approval failed'); }
    finally { setBusyId(null); }
  };

  const reject = async () => {
    setBusyId(rejecting.id);
    try { await ordersApi.admin.reject(rejecting.id, note); toast.success('Order rejected'); setRejecting(null); setNote(''); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not reject'); }
    finally { setBusyId(null); }
  };

  if (!allowed) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Business Orders</h1>
          <p className="page-subtitle">Review payments; approving creates the customer&apos;s business</p>
        </div>
      </div>

      <div className="card mb-4"><div className="card-body">
        <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div></div>

      <div className="card"><div className="card-body overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="py-2">Order</th><th className="py-2">Customer</th><th className="py-2">Company</th>
            <th className="py-2">Plan</th><th className="py-2 text-right">Amount</th><th className="py-2">Reference</th>
            <th className="py-2">Date</th><th className="py-2" />
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-gray-500">No orders</td></tr>}
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                <td className="py-2.5">{o.user.firstName} {o.user.lastName}<div className="text-xs text-gray-500">{o.user.email}</div></td>
                <td className="py-2.5">{o.companyName}<div className="text-xs text-gray-500">{o.companyType} · {o.taxType}</div></td>
                <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                <td className="py-2.5">{o.referenceNo || '—'}</td>
                <td className="py-2.5">{formatDate(o.createdAt)}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {o.proofFileName && <button className="btn-secondary mr-2" onClick={() => viewProof(o)}>View proof</button>}
                  {o.status === 'PROOF_SUBMITTED' ? (
                    <>
                      <button className="btn-primary mr-2" disabled={busyId === o.id} onClick={() => approve(o)}>Approve</button>
                      <button className="btn-danger" disabled={busyId === o.id} onClick={() => setRejecting(o)}>Reject</button>
                    </>
                  ) : <span className="text-xs text-gray-500">{o.status.replace('_', ' ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      {rejecting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6">
            <h3 className="font-semibold mb-2">Reject {rejecting.orderNo}</h3>
            <label className="label">Reason (shown to the customer) *</label>
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex gap-2 mt-4">
              <button className="btn-secondary flex-1 justify-center" onClick={() => { setRejecting(null); setNote(''); }}>Back</button>
              <button className="btn-danger flex-1 justify-center" disabled={!note.trim() || busyId === rejecting.id} onClick={reject}>Reject order</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
