'use client';
import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Each slide pairs a problem the user recognises with what Finara does about it.
// Screenshots are the marketing ones (demo data); the school slide is a mock
// statement because there is no school screenshot to reuse.
const SLIDES = [
  {
    key: 'school',
    problem: 'Chasing tuition balances in spreadsheets?',
    solution: 'Assess fees, split them into installments, and see every student\'s statement of account in one place.',
    visual: 'school',
    person: { role: 'School registrar', bg: '#bfdbfe', skin: '#f1c9a5', hair: '#1f2937', top: '#2563eb', style: 'long' },
  },
  {
    key: 'books',
    problem: 'Month-end close taking days?',
    solution: 'Double-entry books that post themselves, with income statement and balance sheet ready in a click.',
    image: '/marketing/screenshots/reports.png',
    alt: 'Finara income statement with revenue, gross profit and net income',
    person: { role: 'Accountant', bg: '#bbf7d0', skin: '#e0ac86', hair: '#111827', top: '#0f766e', style: 'short', glasses: true },
  },
  {
    key: 'payroll',
    problem: 'Computing SSS, PhilHealth and Pag-IBIG by hand?',
    solution: 'Payroll with government contributions and TRAIN Law withholding computed for you.',
    image: '/marketing/screenshots/payroll.png',
    alt: 'Finara payroll management with employees and pay periods',
    person: { role: 'HR & payroll officer', bg: '#fde68a', skin: '#c68863', hair: '#3f2a1d', top: '#b45309', style: 'bun' },
  },
  {
    key: 'sales',
    problem: 'Not sure who still owes you — or who you owe?',
    solution: 'Invoices, bills and aging reports that show receivables and payables at a glance.',
    image: '/marketing/screenshots/receivable.png',
    alt: 'Finara accounts receivable list',
    person: { role: 'Business owner', bg: '#fecaca', skin: '#f1c9a5', hair: '#6b7280', top: '#7c3aed', style: 'short' },
  },
  {
    key: 'inventory',
    problem: 'Stock counts that never match the books?',
    solution: 'Inventory that posts to cost of goods sold automatically, so stock and ledger agree.',
    image: '/marketing/screenshots/inventory.png',
    alt: 'Finara inventory items and stock levels',
    person: { role: 'Store manager', bg: '#ddd6fe', skin: '#d9a17a', hair: '#1f2937', top: '#be123c', style: 'long', glasses: true },
  },
];

const INTERVAL_MS = 6000;

// Product frame: a rounded window with three dots, cropping out the app sidebar
// so the useful part of the screen is what shows.
function Frame({ children }) {
  return (
    <div className="rounded-xl overflow-hidden bg-white shadow-2xl ring-1 ring-white/20">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 border-b border-gray-200">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-green-400" />
      </div>
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16 / 10' }}>{children}</div>
    </div>
  );
}

// A person using the product. Illustrated by default; give a slide's person a
// `photo` (a file under /public/marketing/people/) to show a real one instead.
function Avatar({ person }) {
  const { photo, role, bg, skin, hair, top, style, glasses } = person;
  return (
    <div className="flex items-center gap-3">
      <div className="w-[72px] h-[72px] rounded-full overflow-hidden ring-4 ring-white/25 shadow-xl flex-shrink-0 bg-white">
        {photo ? (
          <img src={photo} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
            <rect width="100" height="100" fill={bg} />
            {/* hair behind the head */}
            {style === 'long' && <path d="M27 48c0-18 10-28 23-28s23 10 23 28v22H27z" fill={hair} />}
            {style === 'bun' && <circle cx="50" cy="19" r="9" fill={hair} />}
            {/* shoulders + neck */}
            <path d="M14 100c0-17 14-28 36-28s36 11 36 28z" fill={top} />
            <rect x="43" y="58" width="14" height="16" rx="6" fill={skin} />
            {/* head */}
            <ellipse cx="50" cy="44" rx="17" ry="20" fill={skin} />
            {/* hair on top */}
            {style === 'short' && <path d="M33 42c0-14 8-20 17-20s17 6 17 20c-4-7-10-10-17-10s-13 3-17 10z" fill={hair} />}
            {style === 'long' && <path d="M33 44c0-15 8-22 17-22s17 7 17 22c-5-8-10-11-17-11s-12 3-17 11z" fill={hair} />}
            {style === 'bun' && <path d="M33 44c0-14 8-21 17-21s17 7 17 21c-5-7-10-10-17-10s-12 3-17 10z" fill={hair} />}
            {/* face */}
            <circle cx="43" cy="46" r="1.8" fill="#1f2937" />
            <circle cx="57" cy="46" r="1.8" fill="#1f2937" />
            <path d="M44 54q6 5 12 0" stroke="#7f1d1d" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            {glasses && (
              <g fill="none" stroke="#1f2937" strokeWidth="1.5">
                <circle cx="43" cy="46" r="5.5" /><circle cx="57" cy="46" r="5.5" /><path d="M48.5 46h3" />
              </g>
            )}
            {/* laptop edge: they are using it */}
            <rect x="24" y="86" width="52" height="14" rx="3" fill="#e5e7eb" />
            <rect x="28" y="89" width="44" height="11" rx="2" fill="#9ca3af" />
            <circle cx="50" cy="94" r="2" fill="#f9fafb" />
          </svg>
        )}
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-blue-300">Built for</p>
        <p className="text-sm font-semibold text-white">{role}</p>
      </div>
    </div>
  );
}

function SchoolMock() {
  const rows = [
    { fee: 'Tuition Fee',          amount: '18,000.00', status: 'Paid',    tone: 'bg-green-100 text-green-700' },
    { fee: 'Miscellaneous Fees',   amount: '4,500.00',  status: 'Paid',    tone: 'bg-green-100 text-green-700' },
    { fee: 'Books & Modules',      amount: '2,800.00',  status: 'Partial', tone: 'bg-yellow-100 text-yellow-700' },
    { fee: 'School Uniform',       amount: '1,650.00',  status: 'Due',     tone: 'bg-red-100 text-red-700' },
  ];
  return (
    <div className="absolute inset-0 p-5 bg-white text-gray-800 select-none" aria-label="Sample student statement of account">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Statement of Account</p>
          <p className="text-base font-bold text-gray-900">Juan D. Santos</p>
          <p className="text-[11px] text-gray-500">Grade 7 · SY 2026–2027</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Balance</p>
          <p className="text-lg font-extrabold text-blue-600">₱ 4,450.00</p>
        </div>
      </div>
      <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg">
        {rows.map((r) => (
          <div key={r.fee} className="flex items-center justify-between px-3 py-1.5 text-[12px]">
            <span className="text-gray-700">{r.fee}</span>
            <span className="flex items-center gap-3">
              <span className="tabular-nums text-gray-900">₱ {r.amount}</span>
              <span className={`w-14 text-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.tone}`}>{r.status}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {['Down payment', 'Sep 15', 'Oct 15', 'Nov 15'].map((s, i) => (
          <div key={s} className={`flex-1 rounded-md px-2 py-1.5 text-center text-[10px] font-medium ${i === 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
            {s}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Recent payments</p>
      <div className="mt-1 divide-y divide-gray-100 text-[12px]">
        {[['Sep 02', 'Down payment', '5,000.00'], ['Sep 15', 'Installment 1', '6,000.00']].map(([d, what, amt]) => (
          <div key={d} className="flex items-center justify-between py-1.5">
            <span className="text-gray-500 w-14">{d}</span>
            <span className="flex-1 text-gray-700">{what}</span>
            <span className="tabular-nums text-green-600 font-medium">+ ₱ {amt}</span>
          </div>
        ))}
      </div>
      <p className="absolute bottom-2 right-3 text-[9px] text-gray-300">Sample data</p>
    </div>
  );
}

export default function AuthCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const on = (e) => setReduceMotion(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const go = useCallback((n) => setIndex((n + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused || reduceMotion) return undefined;
    const t = setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => clearTimeout(t);
  }, [index, paused, reduceMotion, go]);

  const slide = SLIDES[index];

  return (
    <div
      className="w-full"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      role="region"
      aria-roledescription="carousel"
      aria-label="What Finara solves"
    >
      <Frame>
        {SLIDES.map((s, i) => (
          <div
            key={s.key}
            aria-hidden={i !== index}
            className="absolute inset-0"
            style={{ opacity: i === index ? 1 : 0, transition: reduceMotion ? 'none' : 'opacity 600ms ease' }}
          >
            {s.visual === 'school' ? (
              <SchoolMock />
            ) : (
              // Cropped so the app sidebar is out of frame and the content fills it.
              <img
                src={s.image} alt={i === index ? s.alt : ''} loading={i === 0 ? 'eager' : 'lazy'}
                className="absolute top-0 max-w-none"
                style={{ width: '130%', left: '-24%' }}
                draggable={false}
              />
            )}
          </div>
        ))}
      </Frame>

      {slide.person && <div className="mt-5"><Avatar key={slide.key} person={slide.person} /></div>}

      <div className="mt-5 min-h-[92px]" aria-live={paused ? 'polite' : 'off'}>
        <h2 className="text-2xl font-black text-white leading-snug tracking-tight">{slide.problem}</h2>
        <p className="mt-2 text-sm text-blue-200 leading-relaxed max-w-md">{slide.solution}</p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => go(index - 1)} aria-label="Previous slide"
          className="p-1.5 rounded-full text-blue-200 hover:text-white hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          {SLIDES.map((s, i) => (
            <button key={s.key} type="button" onClick={() => go(i)} aria-label={`Show slide ${i + 1}`} aria-current={i === index}
              className={`h-2 rounded-full transition-all ${i === index ? 'w-6 bg-white' : 'w-2 bg-white/35 hover:bg-white/60'}`} />
          ))}
        </div>
        <button type="button" onClick={() => go(index + 1)} aria-label="Next slide"
          className="p-1.5 rounded-full text-blue-200 hover:text-white hover:bg-white/10 transition-colors">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
