'use client';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Building2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { businesses as bizApi, orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import AddBusinessModal from '@/components/orders/AddBusinessModal';

const STATUS = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'badge-yellow' },
  PROOF_SUBMITTED: { label: 'Under review',     cls: 'badge-blue' },
  APPROVED:        { label: 'Approved',         cls: 'badge-green' },
  REJECTED:        { label: 'Rejected',         cls: 'badge-red' },
  CANCELLED:       { label: 'Cancelled',        cls: 'badge' },
};

export default function MyBusinessesPage() {
  const [list, setList]       = useState([]);
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);   // null | 'new' | order

  const load = useCallback(async () => {
    try {
      const [b, o] = await Promise.all([bizApi.list(), ordersApi.list()]);
      setList(b.data); setOrders(o.data);
    } catch { toast.error('Failed to load your businesses'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = async (o) => {
    if (!window.confirm(`Cancel order ${o.orderNo}?`)) return;
    try { await ordersApi.cancel(o.id); toast.success('Order cancelled'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not cancel'); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Businesses</h1>
          <p className="page-subtitle">Your companies, and orders for additional ones</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> Add business
        </button>
      </div>

      {loading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div> : (
        <>
          <div className="card mb-6"><div className="card-body">
            <h2 className="font-semibold mb-3">Businesses</h2>
            {list.length === 0 ? <p className="text-sm text-gray-500">No businesses yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Name</th><th className="py-2">Type</th><th className="py-2">Code</th><th className="py-2">Paid until</th>
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {list.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{b.name}</td>
                      <td className="py-2.5">{b.industry || '—'}</td>
                      <td className="py-2.5 font-mono text-xs">{b.code}</td>
                      <td className="py-2.5">{b.paidUntil ? formatDate(b.paidUntil) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div></div>

          <div className="card"><div className="card-body">
            <h2 className="font-semibold mb-3">Orders</h2>
            {orders.length === 0 ? <p className="text-sm text-gray-500">No orders yet.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Order</th><th className="py-2">Company</th><th className="py-2">Period</th>
                  <th className="py-2 text-right">Amount</th><th className="py-2">Status</th><th className="py-2" />
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {orders.map((o) => {
                    const s = STATUS[o.status] || STATUS.CANCELLED;
                    const open = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'].includes(o.status);
                    return (
                      <tr key={o.id}>
                        <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                        <td className="py-2.5">{o.companyName}</td>
                        <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                        <td className="py-2.5">
                          <span className={`badge ${s.cls}`}>{s.label}</span>
                          {o.status === 'REJECTED' && o.reviewNote && <div className="text-xs text-red-600 mt-1">{o.reviewNote}</div>}
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          {open && (
                            <>
                              <button className="btn-secondary mr-2" onClick={() => setModal(o)}>
                                {o.status === 'PENDING_PAYMENT' ? 'Pay' : 'Update payment'}
                              </button>
                              <button className="btn-danger" onClick={() => cancel(o)}>Cancel</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div></div>
        </>
      )}

      {modal && (
        <AddBusinessModal
          order={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
