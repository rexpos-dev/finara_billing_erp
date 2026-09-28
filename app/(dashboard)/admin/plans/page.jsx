'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { COMPANY_TYPES } from '@/lib/companyTypes';

const PERIODS = [{ key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' }];
const cellKey = (t, p) => `${t}:${p}`;

export default function PlansPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [grid, setGrid]       = useState({});          // "TYPE:PERIOD" -> { amount, isActive }
  const [saved, setSaved]     = useState({});          // "TYPE:PERIOD" -> saved server row
  const [text, setText]       = useState('');
  const [hasQr, setHasQr]     = useState(false);
  const [qrFile, setQrFile]   = useState(null);
  const [qrUrl, setQrUrl]     = useState(null);
  const [saving, setSaving]   = useState(false);

  const loadQr = () => ordersApi.qrBlob().then(({ data }) => setQrUrl(URL.createObjectURL(data))).catch(() => setQrUrl(null));

  const applyPrices = (rows) => {
    const g = {}; const sv = {};
    rows.forEach((r) => {
      const k = cellKey(r.companyType, r.period);
      g[k] = { amount: String(r.amount), isActive: r.isActive };
      sv[k] = r;
    });
    setGrid(g); setSaved(sv);
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

  const setCell = (t, p, patch) => setGrid((g) => ({ ...g, [cellKey(t, p)]: { amount: '', isActive: true, ...g[cellKey(t, p)], ...patch } }));

  const savePrices = async () => {
    const prices = [];
    const keys = new Set([...Object.keys(grid), ...Object.keys(saved)]);
    keys.forEach((k) => {
      const [companyType, period] = k.split(':');
      const v = grid[k];
      if (v && v.amount !== '') {
        prices.push({ companyType, period, amount: Number(v.amount), isActive: v.isActive });
      } else if (saved[k]) {
        // cleared cell that was saved before: deactivate it (server never deletes)
        prices.push({ companyType, period, amount: Number(saved[k].amount), isActive: false });
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
            <th className="py-2">Company type</th>{PERIODS.map((p) => <th key={p.key} className="py-2">{p.label}</th>)}
          </tr></thead>
          <tbody className="divide-y dark:divide-gray-700">
            {COMPANY_TYPES.map((t) => (
              <tr key={t.key}>
                <td className="py-2.5 font-medium">{t.label}</td>
                {PERIODS.map((p) => {
                  const c = grid[cellKey(t.key, p.key)] || { amount: '', isActive: true };
                  return (
                    <td key={p.key} className="py-2.5">
                      <div className="flex items-center gap-2">
                        <input type="number" min="0" step="0.01" className="input w-32" value={c.amount}
                          onChange={(e) => setCell(t.key, p.key, { amount: e.target.value })} placeholder="not offered" />
                        <label className="text-xs flex items-center gap-1">
                          <input type="checkbox" checked={c.isActive} onChange={(e) => setCell(t.key, p.key, { isActive: e.target.checked })} /> active
                        </label>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-2">Clear a price or untick active to stop offering that plan. Existing orders keep the price they were placed at.</p>
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
