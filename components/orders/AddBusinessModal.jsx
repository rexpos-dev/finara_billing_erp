'use client';
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const TAX_TYPES = [
  { key: 'VAT',     label: 'VAT-registered', hint: '12% VAT on sales; input VAT is claimable.' },
  { key: 'NON_VAT', label: 'Non-VAT',        hint: 'Percentage tax instead of VAT.' },
];
const PERIODS = [{ key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' }];
const EMPTY = { name: '', tin: '', address: '', phone: '', companyType: '', taxType: '', booksStartDate: '', period: 'MONTHLY' };

// Pass `order` to open straight on the payment step for an existing order.
export default function AddBusinessModal({ order: initialOrder = null, onClose, onDone }) {
  const [plans, setPlans]     = useState({ prices: [], instructions: { text: '', hasQr: false } });
  const [form, setForm]       = useState(EMPTY);
  const [order, setOrder]     = useState(initialOrder);
  const [busy, setBusy]       = useState(false);
  const [qrUrl, setQrUrl]     = useState(null);
  const [referenceNo, setRef] = useState(initialOrder?.referenceNo || '');
  const [file, setFile]       = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    ordersApi.plans().then(({ data }) => setPlans(data)).catch(() => toast.error('Could not load plans'));
  }, []);

  // Show the QR only once we are on the payment step.
  useEffect(() => {
    if (!order || !plans.instructions.hasQr) return undefined;
    let url;
    ordersApi.qrBlob().then(({ data }) => { url = URL.createObjectURL(data); setQrUrl(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [order, plans.instructions.hasQr]);

  const price = plans.prices.find((p) => p.companyType === form.companyType && p.period === form.period);
  const monthlyPrice = form.period === 'YEARLY'
    ? plans.prices.find((p) => p.companyType === form.companyType && p.period === 'MONTHLY')
    : null;
  const savings = price && monthlyPrice ? Number(monthlyPrice.amount) * 12 - Number(price.amount) : 0;
  const savingsPercent = savings > 0 ? Math.round((savings / (Number(monthlyPrice.amount) * 12)) * 100) : 0;

  const submitOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await ordersApi.create(form);
      setOrder(data);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not place the order');
    } finally { setBusy(false); }
  };

  const submitProof = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await ordersApi.submitProof(order.id, { referenceNo, file });
      toast.success('Payment submitted — we will review it shortly');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit payment');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {order ? `Pay for ${order.orderNo}` : 'Add business'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {!order ? (
          <form onSubmit={submitOrder} className="px-6 py-5 space-y-4">
            <div>
              <label className="label">Company name *</label>
              <input className="input" required value={form.name} onChange={set('name')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">TIN</label><input className="input" value={form.tin} onChange={set('tin')} placeholder="000-000-000-000" /></div>
              <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={set('phone')} /></div>
            </div>
            <div><label className="label">Address</label><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></div>

            <div>
              <label className="label">Company type *</label>
              <div className="grid grid-cols-2 gap-2">
                {COMPANY_TYPES.map((t) => (
                  <label key={t.key} className={`border rounded-lg p-3 cursor-pointer text-sm ${form.companyType === t.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="companyType" className="sr-only" required checked={form.companyType === t.key}
                      onChange={() => setForm((f) => ({ ...f, companyType: t.key }))} />
                    <span className="font-semibold block">{t.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Tax registration *</label>
              <div className="grid grid-cols-2 gap-2">
                {TAX_TYPES.map((t) => (
                  <label key={t.key} className={`border rounded-lg p-3 cursor-pointer text-sm ${form.taxType === t.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="taxType" className="sr-only" required checked={form.taxType === t.key}
                      onChange={() => setForm((f) => ({ ...f, taxType: t.key }))} />
                    <span className="font-semibold block">{t.label}</span>
                    <span className="text-xs text-gray-500">{t.hint}</span>
                  </label>
                ))}
              </div>
            </div>

            <div><label className="label">Books start date</label><input type="date" className="input" value={form.booksStartDate} onChange={set('booksStartDate')} /></div>

            <div>
              <label className="label">Billing period *</label>
              <div className="grid grid-cols-2 gap-2">
                {PERIODS.map((p) => (
                  <label key={p.key} className={`border rounded-lg p-3 cursor-pointer text-sm text-center ${form.period === p.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="period" className="sr-only" checked={form.period === p.key}
                      onChange={() => setForm((f) => ({ ...f, period: p.key }))} />
                    <span className="font-semibold">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm">
              {!form.companyType ? 'Choose a company type to see the price.'
                : price ? (
                  <>
                    Amount to pay: <strong>{formatCurrency(price.amount)}</strong>
                    {savingsPercent > 0 && (
                      <div className="text-green-600 text-xs mt-1">
                        Save {savingsPercent}% — {formatCurrency(savings)} off vs. paying monthly
                      </div>
                    )}
                  </>
                )
                : <span className="text-red-600">This plan is not available yet. Please contact the administrator.</span>}
            </div>

            <button type="submit" disabled={busy || !price} className="btn-primary w-full justify-center flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue to payment
            </button>
          </form>
        ) : (
          <form onSubmit={submitProof} className="px-6 py-5 space-y-4">
            <p className="text-sm">
              Pay <strong>{formatCurrency(order.amount)}</strong> for <strong>{order.companyName}</strong>, then submit your
              reference number or proof. Your business is created once the payment is confirmed.
            </p>
            {plans.instructions.text
              ? <pre className="whitespace-pre-wrap text-sm rounded-lg bg-gray-50 dark:bg-gray-800 p-3 font-sans">{plans.instructions.text}</pre>
              : <p className="text-sm text-gray-500">Payment instructions have not been set up yet. Please contact the administrator.</p>}
            {qrUrl && <img src={qrUrl} alt="Payment QR" className="mx-auto max-h-56 rounded-lg border" />}

            <div><label className="label">Reference number</label><input className="input" value={referenceNo} onChange={(e) => setRef(e.target.value)} placeholder="e.g. GCash ref no." /></div>
            <div>
              <label className="label">Proof of payment (JPG, PNG, WEBP or PDF, max 5 MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>Pay later</button>
              <button type="submit" disabled={busy || (!referenceNo.trim() && !file)} className="btn-primary flex-1 justify-center flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Submit payment
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
