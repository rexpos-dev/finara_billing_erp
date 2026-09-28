'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { auth as authApi } from '@/lib/api';
import { setSession } from '@/lib/auth';
import { consumePendingRedirect, consumeIdleLogoutFlag } from '@/lib/postLoginRedirect';
import { Lock, Mail, Eye, EyeOff, ArrowRight } from 'lucide-react';

// ── Floating particle background ─────────────────────────────
function Particles() {
  const dots = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    size:  4 + (i % 4) * 3,
    x:     5  + (i * 337 % 90),
    y:     5  + (i * 211 % 90),
    delay: (i * 0.4).toFixed(1),
    dur:   (6  + (i % 5) * 1.2).toFixed(1),
    opacity: 0.06 + (i % 4) * 0.04,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {dots.map((d) => (
        <div
          key={d.id}
          className="absolute rounded-full bg-white"
          style={{
            width: d.size, height: d.size,
            left: `${d.x}%`, top: `${d.y}%`,
            opacity: d.opacity,
            animation: `float ${d.dur}s ease-in-out ${d.delay}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

// ── Animated bar chart icon (mirrors the logo mark) ──────────
function AnimatedMark({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="56" height="56" rx="14" fill="white" fillOpacity="0.15" />
      {/* bar 1 */}
      <rect x="10" y="36" width="9" height="12" rx="2.5" fill="white"
        style={{ animation: 'barRise 1.4s cubic-bezier(.34,1.56,.64,1) 0.1s both' }} />
      {/* bar 2 */}
      <rect x="24" y="27" width="9" height="21" rx="2.5" fill="white"
        style={{ animation: 'barRise 1.4s cubic-bezier(.34,1.56,.64,1) 0.25s both' }} />
      {/* bar 3 */}
      <rect x="38" y="14" width="9" height="34" rx="2.5" fill="white"
        style={{ animation: 'barRise 1.4s cubic-bezier(.34,1.56,.64,1) 0.4s both' }} />
      {/* trend line */}
      <polyline points="14.5,36 28.5,27 42.5,14" stroke="white" strokeWidth="1.2"
        strokeOpacity="0.4" strokeLinecap="round" strokeLinejoin="round"
        style={{ animation: 'lineIn 1s ease 0.6s both' }} />
      {/* peak dot */}
      <circle cx="42.5" cy="14" r="3.5" fill="#60a5fa"
        style={{ animation: 'dotPop 0.5s cubic-bezier(.34,1.56,.64,1) 1s both' }} />
      <circle cx="42.5" cy="14" r="1.8" fill="white"
        style={{ animation: 'dotPop 0.5s cubic-bezier(.34,1.56,.64,1) 1s both' }} />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm]   = useState({ email: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Trigger enter animation after mount
    const t = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (consumeIdleLogoutFlag(window.localStorage)) {
      toast.error('You were logged out due to inactivity.');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authApi.login(form);
      setSession(data);
      toast.success(`Welcome back, ${data.user.firstName}!`);
      const redirectTo = consumePendingRedirect(window.localStorage) || '/dashboard';
      router.push(redirectTo);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* ── Keyframe animations (injected once) ── */}
      <style>{`
        @keyframes float {
          from { transform: translateY(0px) translateX(0px); }
          to   { transform: translateY(-18px) translateX(8px); }
        }
        @keyframes barRise {
          from { transform: scaleY(0); transform-origin: bottom; opacity: 0; }
          to   { transform: scaleY(1); transform-origin: bottom; opacity: 1; }
        }
        @keyframes lineIn {
          from { stroke-dasharray: 100; stroke-dashoffset: 100; opacity: 0; }
          to   { stroke-dasharray: 100; stroke-dashoffset: 0;   opacity: 1; }
        }
        @keyframes dotPop {
          from { transform: scale(0); opacity: 0; }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes logoIn {
          from { opacity: 0; transform: translateY(-16px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes pulse-ring {
          0%  { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(96,165,250,0.5); }
          70% { transform: scale(1);    box-shadow: 0 0 0 12px rgba(96,165,250,0); }
          100%{ transform: scale(0.95); box-shadow: 0 0 0 0 rgba(96,165,250,0); }
        }
        .card-enter {
          animation: cardIn 0.65s cubic-bezier(.22,.68,0,1.2) forwards;
        }
        .logo-enter {
          animation: logoIn 0.7s cubic-bezier(.22,.68,0,1.2) 0.1s both;
        }
        .shimmer {
          background: linear-gradient(90deg, #1e40af 0%, #2563eb 40%, #3b82f6 60%, #1e40af 100%);
          background-size: 200% 100%;
          animation: shimmer 2.5s linear infinite;
        }
        @keyframes shimmer {
          from { background-position: 200% center; }
          to   { background-position: -200% center; }
        }
        .feature-tag {
          opacity: 0;
          animation: tagIn 0.5s ease forwards;
        }
        @keyframes tagIn {
          from { opacity: 0; transform: translateX(-10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>

        {/* ── Left panel — branding / illustration ── */}
        <div className="hidden lg:flex flex-col justify-between w-[46%] relative p-12 overflow-hidden">
          <Particles />

          {/* Top logo */}
          <div className="logo-enter flex items-center gap-3 relative z-10">
            <img src="/finara-logo-white.svg" alt="Finara" className="h-9 w-auto" />
          </div>

          {/* Center hero */}
          <div className="relative z-10 space-y-6">
            {/* Big animated mark */}
            <div style={{ animation: 'logoIn 0.8s cubic-bezier(.22,.68,0,1.2) 0.3s both' }}>
              <AnimatedMark size={80} />
            </div>

            <div style={{ animation: 'logoIn 0.8s cubic-bezier(.22,.68,0,1.2) 0.45s both' }}>
              <h2 className="text-4xl font-black text-white leading-tight tracking-tight">
                Smart accounting<br />
                <span style={{ color: '#60a5fa' }}>for the Philippines.</span>
              </h2>
              <p className="text-blue-200 mt-3 text-sm leading-relaxed max-w-xs">
                Full double-entry accounting with built-in BIR compliance, payroll, and real-time financial reporting.
              </p>
            </div>

            {/* Feature tags */}
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'BIR Compliant', delay: '0.7s' },
                { label: 'TRAIN Law 2023', delay: '0.85s' },
                { label: 'SSS · PhilHealth · Pag-IBIG', delay: '1s' },
                { label: 'PFRS for SMEs', delay: '1.15s' },
              ].map(({ label, delay }) => (
                <span key={label} className="feature-tag text-xs font-medium px-3 py-1.5 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.1)',
                    color: '#bfdbfe',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    animationDelay: delay,
                  }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Bottom */}
          <p className="text-blue-400 text-xs relative z-10">
            © {new Date().getFullYear()} Finara · RA 11976 · PFRS/PFRS for SMEs
          </p>

          {/* Decorative circles */}
          <div className="absolute -bottom-32 -right-32 w-80 h-80 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #60a5fa, transparent)' }} />
          <div className="absolute -top-20 -left-20 w-60 h-60 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #93c5fd, transparent)' }} />
        </div>

        {/* ── Right panel — login form ── */}
        <div className="flex-1 flex items-center justify-center p-6 relative"
          style={{ background: 'rgba(255,255,255,0.03)' }}>

          <div className={`w-full max-w-md ${mounted ? 'card-enter' : 'opacity-0'}`}>

            {/* Mobile logo (visible only on small screens) */}
            <div className="lg:hidden text-center mb-8">
              <img src="/finara-logo-white.svg" alt="Finara" className="h-10 w-auto mx-auto" />
            </div>

            {/* Card */}
            <div className="rounded-2xl overflow-hidden"
              style={{ background: 'white', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>

              {/* Card top accent bar (shimmer) */}
              <div className="shimmer h-1" />

              <div className="p-8 pt-7">
                {/* Card header */}
                <div className="mb-7">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="rounded-xl overflow-hidden" style={{ animation: 'pulse-ring 3s ease-in-out 1.5s infinite' }}>
                      <AnimatedMark size={44} />
                    </div>
                    <div>
                      <h1 className="text-xl font-black text-gray-900 leading-tight">Welcome back</h1>
                      <p className="text-xs text-gray-400 mt-0.5">Sign in to your Finara account</p>
                    </div>
                  </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Email */}
                  <div className="form-group">
                    <label className="label text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="email" required autoComplete="email"
                        className="input pl-10 focus:border-blue-500 focus:ring-blue-500/20"
                        placeholder="you@company.com"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="form-group">
                    <label className="label text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                        className="input pl-10 pr-10 focus:border-blue-500 focus:ring-blue-500/20"
                        placeholder="••••••••"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      />
                      <button type="button" onClick={() => setShowPw(!showPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="text-right mt-1.5">
                      <a href="/forgot-password" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                        Forgot password?
                      </a>
                    </div>
                  </div>

                  {/* Submit */}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-white text-sm transition-all duration-200 mt-2"
                    style={{
                      background: loading
                        ? '#93c5fd'
                        : 'linear-gradient(135deg, #1d4ed8, #2563eb)',
                      boxShadow: loading ? 'none' : '0 4px 20px rgba(29,78,216,0.45)',
                      transform: loading ? 'none' : undefined,
                    }}
                    onMouseEnter={(e) => { if (!loading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <p className="text-xs text-gray-500 text-center mt-5">
                  New to Finara? <a href="/register" className="text-blue-600 font-medium">Create an account</a>
                </p>

                {/* Footer note */}
                <div className="mt-6 pt-5 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    Secured with JWT + bcrypt
                  </p>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400" style={{ animation: 'pulse-ring 2s ease-in-out infinite' }} />
                    <span className="text-xs text-gray-400">System online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Below-card compliance note */}
            <p className="text-center text-blue-300/60 text-xs mt-5">
              BIR · SSS · PhilHealth · Pag-IBIG · PFRS compliant
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
