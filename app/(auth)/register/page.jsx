'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { auth as authApi } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { COMPANY_TYPES, setPendingCompanyType } from '@/lib/companyTypes';
import AuthCarousel from '@/components/auth/AuthCarousel';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', companyType: '' });
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { companyType, ...account } = form; // the server only needs the account here
      const { data } = await authApi.register(account);
      setPendingCompanyType(companyType);
      setSession(data);
      localStorage.removeItem('activeBusinessId');
      toast.success('Account created! Now add your company details.');
      router.push('/onboarding');
    } catch (err) {
      const errors = err.response?.data?.errors;
      toast.error(errors?.[0]?.msg || err.response?.data?.error || 'Could not create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>

      {/* Left: what Finara solves (desktop only) */}
      <div className="hidden lg:flex flex-col justify-between w-[48%] max-w-3xl px-12 py-8">
        <img src="/finara-logo-white.svg" alt="Finara" className="h-9 w-auto self-start" />
        <AuthCarousel />
        <p className="text-blue-400 text-xs">© {new Date().getFullYear()} Finara · PFRS · BIR · SSS · PhilHealth · Pag-IBIG</p>
      </div>

      {/* Right: the form */}
      <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-8">
        <h1 className="text-xl font-black text-gray-900">Create your Finara account</h1>
        <p className="text-xs text-gray-400 mt-1 mb-6">Tell us what kind of company you run — you&apos;ll add its details in the next step.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">First name</label>
              <input className="input" required value={form.firstName} onChange={set('firstName')} />
            </div>
            <div>
              <label className="label">Last name</label>
              <input className="input" required value={form.lastName} onChange={set('lastName')} />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" required autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" required minLength={8} autoComplete="new-password"
              value={form.password} onChange={set('password')} />
            <p className="text-xs text-gray-400 mt-1">At least 8 characters with uppercase, lowercase, and a number.</p>
          </div>
          <div>
            <label className="label">Company type *</label>
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
          <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="text-xs text-gray-500 text-center mt-6">
          Already have an account? <Link href="/login" className="text-blue-600 font-medium">Sign in</Link>
        </p>
      </div>
      </div>
    </div>
  );
}
