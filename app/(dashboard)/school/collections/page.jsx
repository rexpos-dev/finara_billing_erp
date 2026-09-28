'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Search, Wallet, AlertTriangle, CheckCircle2, Printer,
  User, CreditCard, Loader2, X, PiggyBank,
} from 'lucide-react';

const PAYMENT_METHODS = ['Cash', 'GCash', 'Bank Transfer', 'Check', 'Maya', 'Credit Card'];

/**
 * The cashier window.
 *
 * Used hundreds of times a day under queue pressure, so it opens on the search
 * box, keeps the keyboard the primary input, and shows the oldest unpaid item
 * first — which is also what the allocation does.
 */
export default function CollectionsPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [payables, setPayables] = useState(null);
  const [loading, setLoading] = useState(false);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [posting, setPosting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // Debounced search so typing a surname does not fire a request per keystroke.
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await sApi.students.list({ search: query.trim(), limit: 8 });
        setResults(data.items || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const loadPayables = useCallback(async (studentId) => {
    setLoading(true);
    try {
      const { data } = await sApi.collections.payables(studentId);
      setPayables(data);
      // Pre-fill with the oldest item's balance — the most common single
      // transaction at the window.
      setAmount(data.items[0] ? String(data.items[0].balance) : '');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load this student');
      setPayables(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const pick = (student) => {
    setSelected(student);
    setResults([]);
    setQuery('');
    setLastReceipt(null);
    loadPayables(student.id);
  };

  const clear = () => {
    setSelected(null); setPayables(null); setAmount(''); setReference('');
    setLastReceipt(null);
    searchRef.current?.focus();
  };

  const collect = async (e) => {
    e.preventDefault();
    const value = Number(amount);
    if (!value || value <= 0) return toast.error('Enter an amount greater than zero');

    setPosting(true);
    try {
      const { data } = await sApi.collections.record({
        studentId: selected.id,
        amount: value,
        paymentMethod: method,
        paymentDate,
        reference: reference || undefined,
      });
      toast.success(data.message);
      setLastReceipt({ ...data, student: payables.student, paymentDate, method });
      setReference('');
      await loadPayables(selected.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment could not be recorded');
    } finally {
      setPosting(false);
    }
  };

  const applyCredit = async () => {
    try {
      const { data } = await sApi.collections.applyAdvances(selected.id);
      toast.success(data.message);
      await loadPayables(selected.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not apply the advance');
    }
  };

  const printReceipt = () => {
    if (!lastReceipt) return;
    const rows = lastReceipt.applied.map((a) => `
      <tr>
        <td>${a.invoiceNo}</td>
        <td style="text-align:right">${phpFmt(a.amount)}</td>
      </tr>`).join('');

    printDocument('OFFICIAL RECEIPT', lastReceipt.applied[0]?.paymentNo || '', `
      <table style="width:100%;margin-bottom:16px">
        <tr><td><strong>Received from:</strong> ${lastReceipt.student.label}</td>
            <td style="text-align:right"><strong>Date:</strong> ${dateFmt(lastReceipt.paymentDate)}</td></tr>
        <tr><td colspan="2"><strong>Payment method:</strong> ${lastReceipt.method}</td></tr>
      </table>
      <table class="tbl">
        <thead><tr><th>Applied to</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${rows || '<tr><td colspan="2">Advance payment — no invoice applied</td></tr>'}
          ${lastReceipt.advance ? `<tr><td>Held as advance payment</td><td style="text-align:right">${phpFmt(lastReceipt.advance.amount)}</td></tr>` : ''}
          <tr class="total"><td><strong>Total received</strong></td>
              <td style="text-align:right"><strong>${phpFmt(lastReceipt.collected)}</strong></td></tr>
        </tbody>
      </table>
      <p style="margin-top:28px;font-size:11px">
        This receipt covers tuition and school fees, which are VAT-exempt under Sec. 109(H) of the NIRC.
      </p>
      <div style="margin-top:44px">_______________________________<br><span style="font-size:11px">Cashier</span></div>
    `);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cashier</h1>
          <p className="page-subtitle">Search a student, take the payment, print the receipt.</p>
        </div>
      </div>

      {/* ── Search ─────────────────────────────────────────── */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
            <input
              ref={searchRef}
              className="input pl-10 text-lg"
              placeholder="Student number, LRN, or surname…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {searching && <Loader2 className="absolute right-3 top-3 h-5 w-5 animate-spin text-gray-400" />}
          </div>

          {results.length > 0 && (
            <div className="mt-2 border rounded-lg divide-y dark:border-gray-700 dark:divide-gray-700">
              {results.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-3">
                    <User className="h-4 w-4 text-gray-400" />
                    <span>
                      <span className="font-medium">{s.fullName}</span>
                      <span className="text-xs text-gray-500 ml-2 font-mono">{s.studentNo}</span>
                    </span>
                  </span>
                  <span className="text-xs text-gray-500">
                    {s.currentEnrollment?.gradeLevel?.name || 'Not enrolled'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="card"><div className="card-body text-center py-10 text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />Loading account…
        </div></div>
      )}

      {payables && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* ── Outstanding items ───────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card">
              <div className="card-body">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold">{payables.student.label}</h2>
                    <p className="text-sm text-gray-500">
                      Total due {formatCurrency(payables.totalDue)}
                      {payables.overdue > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {' '}· {formatCurrency(payables.overdue)} overdue
                        </span>
                      )}
                    </p>
                  </div>
                  <button onClick={clear} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
                </div>

                {payables.unappliedCredit > 0 && (
                  <div className="mb-4 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900 dark:bg-blue-950">
                    <span className="flex items-center gap-2 text-sm">
                      <PiggyBank className="h-4 w-4 text-blue-600" />
                      Unapplied advance payment of <strong>{formatCurrency(payables.unappliedCredit)}</strong>
                    </span>
                    <button onClick={applyCredit} className="btn-secondary text-xs py-1 px-3">Apply now</button>
                  </div>
                )}

                {payables.items.length === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-500" />
                    <p className="font-medium">Nothing outstanding</p>
                    <p className="text-sm text-gray-500">This student has no unpaid invoices.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                          <th className="py-2">Invoice</th>
                          <th className="py-2">Description</th>
                          <th className="py-2">Due</th>
                          <th className="py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-gray-700">
                        {payables.items.map((i) => (
                          <tr key={i.invoiceId}>
                            <td className="py-2.5 font-mono text-xs">{i.invoiceNo}</td>
                            <td className="py-2.5">{i.description}</td>
                            <td className="py-2.5">
                              {formatDate(i.dueDate)}
                              {i.daysOverdue > 0 && (
                                <span className="badge badge-red ml-2">{i.daysOverdue}d</span>
                              )}
                            </td>
                            <td className="py-2.5 text-right font-medium tabular-nums">
                              {formatCurrency(i.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {lastReceipt && (
              <div className="card border-green-300 dark:border-green-800">
                <div className="card-body flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                    <div>
                      <p className="font-medium">{formatCurrency(lastReceipt.collected)} received</p>
                      <p className="text-xs text-gray-500">{lastReceipt.message}</p>
                    </div>
                  </div>
                  <button onClick={printReceipt} className="btn-primary flex items-center gap-2">
                    <Printer className="h-4 w-4" /> Print receipt
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Take payment ────────────────────────────────── */}
          <div className="card h-fit">
            <div className="card-body">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Take payment
              </h3>
              <form onSubmit={collect} className="space-y-3">
                <div className="form-group">
                  <label className="label">Amount</label>
                  <input
                    className="input text-2xl font-mono" type="number" step="0.01" min="0.01"
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00" required autoFocus
                  />
                  {payables.totalDue > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(payables.totalDue))}
                      className="text-xs text-blue-600 mt-1 hover:underline"
                    >
                      Pay everything due — {formatCurrency(payables.totalDue)}
                    </button>
                  )}
                </div>

                <div className="form-group">
                  <label className="label">Method</label>
                  <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label className="label">Date</label>
                  <input className="input" type="date" value={paymentDate}
                         onChange={(e) => setPaymentDate(e.target.value)} required />
                </div>

                <div className="form-group">
                  <label className="label">Reference <span className="text-gray-400">(optional)</span></label>
                  <input className="input" value={reference} onChange={(e) => setReference(e.target.value)}
                         placeholder="Cheque no., GCash ref…" />
                </div>

                {Number(amount) > payables.totalDue && payables.totalDue > 0 && (
                  <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950">
                    <AlertTriangle className="h-4 w-4 flex-none text-amber-600" />
                    <span>
                      {formatCurrency(Number(amount) - payables.totalDue)} more than what is due.
                      The excess is held as an advance payment, not as revenue.
                    </span>
                  </div>
                )}

                <button type="submit" disabled={posting} className="btn-primary w-full flex items-center justify-center gap-2">
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  {posting ? 'Posting…' : 'Record payment'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {!selected && !loading && (
        <div className="card">
          <div className="card-body text-center py-16 text-gray-500">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Search for a student to begin</p>
            <p className="text-sm">Type at least two characters of a name, student number, or LRN.</p>
          </div>
        </div>
      )}
    </div>
  );
}
