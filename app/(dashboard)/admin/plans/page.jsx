'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { getUser, formatCurrency } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const EMPTY_ROW = { monthlyAmount: '', monthlyActive: true, discountPercent: '0', yearlyActive: true };

/** Live client-side preview only — the server always recomputes and owns the stored amount. */
const previewYearly = (row) => {
  const amount = Number(row.monthlyAmount);
  if (!row.monthlyAmount || !Number.isFinite(amount) || amount < 0) return null;
  const discount = Number(row.discountPercent);
  const d = Number.isFinite(discount) ? Math.min(Math.max(discount, 0), 100) : 0;
  return Math.round(amount * 12 * (1 - d / 100) * 100) / 100;
};

export default function PlansPage() {
  const router = useRouter();
  const [allowed, setAllowed]           = useState(false);
  const [rows, setRows]                 = useState({});   // companyType -> { monthlyAmount, monthlyActive, discountPercent, yearlyActive }
  const [savedMonthly, setSavedMonthly] = useState({});   // companyType -> saved server MONTHLY row
  const [text, setText]       = useState('');
  const [hasQr, setHasQr]     = useState(false);
  const [qrFile, setQrFile]   = useState(null);
  const [qrUrl, setQrUrl]     = useState(null);
  const [saving, setSaving]   = useState(false);

  const loadQr = () => ordersApi.qrBlob().then(({ data }) => setQrUrl(URL.createObjectURL(data))).catch(() => setQrUrl(null));

  const applyPrices = (list) => {
    const r = {}; const sm = {};
    list.forEach((p) => {
      r[p.companyType] = { ...EMPTY_ROW, ...r[p.companyType] };
      if (p.period === 'MONTHLY') {
        r[p.companyType].monthlyAmount = String(p.amount);
        r[p.companyType].monthlyActive = p.isActive;
        r[p.companyType].discountPercent = p.discountPercent != null ? String(p.discountPercent) : '0';
        sm[p.companyType] = p;
      } else {
        r[p.companyType].yearlyActive = p.isActive;
      }
    });
    setRows(r); setSavedMonthly(sm);
  };

  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
    Promise.all([ordersApi.admin.prices(), ordersApi.admin.instructions()])
      .then(([p, i]) => {
        applyPrices(p.data);
        setText(i.data.text); setHasQr(i.data.hasQr);
        if (i.data.hasQr) loadQr();
      })
      .catch(() => toast.error('Failed to load plans'));
  }, [router]);

  const setRow = (companyType, patch) => setRows((r) => ({ ...r, [companyType]: { ...EMPTY_ROW, ...r[companyType], ...patch } }));

  const savePrices = async () => {
    const prices = [];
    const types = new Set([...Object.keys(rows), ...Object.keys(savedMonthly)]);
    types.forEach((t) => {
      const row = rows[t];
      if (row && row.monthlyAmount !== '') {
        prices.push({
          companyType: t, period: 'MONTHLY',
          amount: Number(row.monthlyAmount), isActive: row.monthlyActive,
          discountPercent: row.discountPercent === '' ? 0 : Number(row.discountPercent),
        });
        prices.push({ companyType: t, period: 'YEARLY', isActive: row.yearlyActive });
      } else if (savedMonthly[t]) {
        // cleared cell that was saved before: deactivate it (server never deletes)
        prices.push({
          companyType: t, period: 'MONTHLY', amount: Number(savedMonthly[t].amount), isActive: false,
          discountPercent: Number(savedMonthly[t].discountPercent || 0),
        });
        prices.push({ companyType: t, period: 'YEARLY', isActive: false });
      }
    });
    setSaving(true);
    try { const { data } = await ordersApi.admin.savePrices(prices); applyPrices(data); toast.success('Prices saved'); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not save prices'); }
    finally { setSaving(false); }
  };

  const saveInstructions = async () => {
    setSaving(true);
    try {
      const { data } = await ordersApi.admin.saveInstructions({ text, file: qrFile });
      setHasQr(data.hasQr); setQrFile(null);
      if (data.hasQr) loadQr();
      toast.success('Payment instructions saved');
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  if (!allowed) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Plans &amp; Payment</h1>
          <p className="page-subtitle">Price per company type and how customers pay for an additional business</p>
        </div>
      </div>

      <div className="card mb-6"><div className="card-body">
        <h2 className="font-semibold mb-3">Prices (PHP)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="py-2">Company type</th>
            <th className="py-2">Monthly</th>
            <th className="py-2">Discount %</th>
            <th className="py-2">Yearly</th>
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {COMPANY_TYPES.map((t) => {
              const row = rows[t.key] || EMPTY_ROW;
              const yearly = previewYearly(row);
              return (
                <tr key={t.key}>
                  <td className="py-2.5 font-medium">{t.label}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="0.01" className="input w-32" value={row.monthlyAmount}
                        onChange={(e) => setRow(t.key, { monthlyAmount: e.target.value })} placeholder="not offered" />
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={row.monthlyActive} onChange={(e) => setRow(t.key, { monthlyActive: e.target.checked })} /> active
                      </label>
                    </div>
                  </td>
                  <td className="py-2.5">
                    <input type="number" min="0" max="100" step="0.01" className="input w-24" value={row.discountPercent}
                      disabled={!row.monthlyAmount} onChange={(e) => setRow(t.key, { discountPercent: e.target.value })} />
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="input w-32 inline-flex items-center bg-gray-50 dark:bg-gray-800 text-gray-500">
                        {yearly !== null ? formatCurrency(yearly) : 'set monthly first'}
                      </span>
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={row.monthlyActive && row.yearlyActive} disabled={yearly === null || !row.monthlyActive}
                          onChange={(e) => setRow(t.key, { yearlyActive: e.target.checked })} /> active
                      </label>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">
          Clear the monthly price or untick active to stop offering that plan. The yearly price is computed
          automatically from the monthly price and the discount. Existing orders keep the price they were placed at.
        </p>
        <button className="btn-primary mt-4" disabled={saving} onClick={savePrices}>Save prices</button>
      </div></div>

      <div className="card"><div className="card-body">
        <h2 className="font-semibold mb-3">Payment instructions</h2>
        <label className="label">Shown to the customer when paying (GCash / bank details, account name, notes)</label>
        <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-3">
          <label className="label">Payment QR (JPG, PNG or WEBP, max 5 MB){hasQr ? ' — uploading replaces the current one' : ''}</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" className="input" onChange={(e) => setQrFile(e.target.files?.[0] || null)} />
          {qrUrl && <img src={qrUrl} alt="Current QR" className="mt-3 max-h-48 rounded-lg border" />}
        </div>
        <button className="btn-primary mt-4" disabled={saving} onClick={saveInstructions}>Save instructions</button>
      </div></div>
    </div>
  );
}
