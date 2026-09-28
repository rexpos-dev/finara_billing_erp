'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { businesses as bizApi } from '@/lib/api';
import { isAuthenticated, clearSession } from '@/lib/auth';
import { COMPANY_TYPES, takePendingCompanyType } from '@/lib/companyTypes';

const TAX_TYPES = [
  { key: 'VAT',     label: 'VAT-registered', hint: '12% VAT on sales; input VAT is claimable.' },
  { key: 'NON_VAT', label: 'Non-VAT',        hint: 'Percentage tax instead of VAT.' },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: '', tin: '', address: '', phone: '', companyType: '', taxType: '', booksStartDate: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return; }
    // Someone who already has a company has nothing to set up here.
    bizApi.list()
      .then(({ data }) => {
        if (data?.length) { router.replace('/dashboard'); return; }
        // Pre-select what they chose on the signup form; they can still change it.
        const chosen = takePendingCompanyType();
        if (chosen) setForm((f) => ({ ...f, companyType: chosen }));
        setReady(true);
      })
      .catch(() => setReady(true));
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await bizApi.onboard(form);
      localStorage.setItem('activeBusinessId', data.id);
      toast.success(`${data.name} is ready!`);
      router.push('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not create company');
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-8">
        <h1 className="text-xl font-black text-gray-900">Set up your company</h1>
        <p className="text-xs text-gray-400 mt-1 mb-6">
          Tell us about your company so we set up what you need. Your books start empty, with a Philippine Chart of Accounts ready to use.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Company name *</label>
            <input className="input" required value={form.name} onChange={set('name')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">TIN</label>
              <input className="input" value={form.tin} onChange={set('tin')} placeholder="000-000-000-000" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={set('phone')} />
            </div>
          </div>
          <div>
            <label className="label">Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={set('address')} />
          </div>
          <div>
            <label className="label">What type of company is this? *</label>
            <div className="grid grid-cols-2 gap-2">
              {COMPANY_TYPES.map((t) => (
                <label key={t.key}
                  className={`border rounded-lg p-3 cursor-pointer text-sm ${form.companyType === t.key ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="companyType" className="sr-only" required
                    checked={form.companyType === t.key} onChange={() => setForm((f) => ({ ...f, companyType: t.key }))} />
                  <span className="font-semibold text-gray-900 block">{t.label}</span>
                  <span className="text-xs text-gray-500">{t.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Tax registration *</label>
            <div className="grid grid-cols-2 gap-2">
              {TAX_TYPES.map((t) => (
                <label key={t.key}
                  className={`border rounded-lg p-3 cursor-pointer text-sm ${form.taxType === t.key ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="taxType" className="sr-only" required
                    checked={form.taxType === t.key} onChange={() => setForm((f) => ({ ...f, taxType: t.key }))} />
                  <span className="font-semibold text-gray-900 block">{t.label}</span>
                  <span className="text-xs text-gray-500">{t.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Books start date</label>
            <input type="date" className="input" value={form.booksStartDate} onChange={set('booksStartDate')} />
          </div>
          <p className="text-xs text-gray-400">
            The books start date is the first day you record in Finara. It&apos;s needed before you can enter opening balances.
          </p>
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading ? 'Creating…' : 'Create company'}
          </button>
        </form>

        <button type="button" className="text-xs text-gray-400 mt-4 hover:text-gray-600"
          onClick={() => { clearSession(); router.push('/login'); }}>
          Sign out
        </button>
      </div>
    </div>
  );
}
