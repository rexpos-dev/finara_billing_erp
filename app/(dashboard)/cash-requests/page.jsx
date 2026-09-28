'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashRequests as crApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, Check, X, Send, HandCoins, CheckCircle2, Ban,
} from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'LIQUIDATED', 'REJECTED', 'CANCELLED'];

const STATUS_BADGE = {
  DRAFT:      'badge-gray',
  SUBMITTED:  'badge-yellow',
  APPROVED:   'badge-blue',
  RELEASED:   'badge-yellow',
  LIQUIDATED: 'badge-green',
  REJECTED:   'badge-red',
  CANCELLED:  'badge-gray',
};

const CASH_ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on Hand' },
  { code: '1011', label: '1011 — Petty Cash Fund' },
  { code: '1012', label: '1012 — Cash — GCash' },
  { code: '1020', label: '1020 — Cash in Bank (BDO Checking)' },
];

const todayStr = () => new Date().toISOString().split('T')[0];
const emptyItem = () => ({ description: '', quantity: '1', estimatedCost: '', accountId: '', accountTouched: false });

// Mirrors server/utils/accountMap.js — word-boundary, case-insensitive,
// first rule wins. The rules themselves come from the server so the two
// never drift apart.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchCodeFor(description, rules = [], fallback = '6390') {
  const text = String(description || '').trim();
  if (!text) return { accountCode: fallback, matched: false };
  for (const rule of rules) {
    if (rule.keywords.some((kw) => new RegExp(`\\b${escapeRe(kw)}\\b`, 'i').test(text))) {
      return { accountCode: rule.accountCode, matched: true };
    }
  }
  return { accountCode: fallback, matched: false };
}

// Resolve a matched code to an account id within the loaded COA. Retired
// (inactive) accounts are skipped, falling back to the default expense account,
// so a trading company never gets an agency account suggested.
const accountIdForCode = (accounts, code, fallback = '6390') => {
  const usable = (c) => accounts.find((a) => a.accountCode === c && a.isActive !== false);
  return (usable(code) || usable(fallback))?.id || '';
};

// ─── New / Edit Request Modal ─────────────────────────────────
function RequestModal({ request, accounts, names, accountMap, onClose, onSaved }) {
  const isEdit = !!request?.id;
  const [form, setForm] = useState(
    isEdit
      ? {
          requestDate:  request.requestDate?.split('T')[0] || todayStr(),
          neededDate:   request.neededDate?.split('T')[0] || '',
          requestedFor: request.requestedFor || '',
          purpose:      request.purpose || '',
          notes:        request.notes || '',
          items: request.items?.length
            ? request.items.map((i) => ({
                description: i.description,
                quantity: i.quantity != null ? String(i.quantity) : '',
                estimatedCost: String(i.estimatedCost),
                accountId: i.accountId ? String(i.accountId) : '',
                accountTouched: !!i.accountId,
              }))
            : [emptyItem()],
        }
      : { requestDate: todayStr(), neededDate: '', requestedFor: '', purpose: '', notes: '', items: [emptyItem()] }
  );
  const [saving, setSaving] = useState(false);

  const setItem = (i, k, v) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) => {
        if (idx !== i) return it;
        const next = { ...it, [k]: v };
        // A manual account choice is sticky.
        if (k === 'accountId') next.accountTouched = true;
        // Typing a description re-runs the match until the user overrides it.
        if (k === 'description' && !next.accountTouched) {
          const { accountCode } = matchCodeFor(v, accountMap.rules, accountMap.fallback);
          next.accountId = accountIdForCode(accounts, accountCode, accountMap.fallback);
        }
        return next;
      }),
    }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const rmItem  = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const total = form.items.reduce((s, i) => s + (Number(i.estimatedCost) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.requestedFor.trim()) { toast.error('Enter who will receive the cash'); return; }
    if (!form.purpose.trim())      { toast.error('Enter the purpose'); return; }
    const items = form.items.filter((i) => i.description && Number(i.estimatedCost) > 0);
    if (!items.length) { toast.error('Add at least one item with an estimated cost'); return; }

    setSaving(true);
    try {
      const payload = {
        ...form,
        items: items.map(({ accountTouched, ...rest }) => rest),
      };
      if (isEdit) await crApi.update(request.id, payload);
      else        await crApi.create(payload);
      toast.success(isEdit ? 'Cash request updated' : 'Cash request created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? `Edit ${request.requestNo}` : 'New Cash Request'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Requested For (name) *</label>
                <input
                  className="input" list="cr-names" required
                  value={form.requestedFor}
                  onChange={(e) => setForm((f) => ({ ...f, requestedFor: e.target.value }))}
                  placeholder="e.g. Juan Dela Cruz"
                />
                <datalist id="cr-names">
                  {names.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="label">Purpose *</label>
                <input
                  className="input" required value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="e.g. Materials para sa booth build"
                />
              </div>
              <div className="form-group">
                <label className="label">Request Date *</label>
                <input type="date" className="input" required value={form.requestDate}
                  onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Needed By</label>
                <input type="date" className="input" value={form.neededDate}
                  onChange={(e) => setForm((f) => ({ ...f, neededDate: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Items to Buy (estimate)</h4>
                <button type="button" onClick={addItem} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Item
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-28 text-right">Qty</th>
                      <th className="w-56">Intended Account</th>
                      <th className="w-40 text-right">Est. Cost (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <input className="input text-xs" value={it.description}
                            onChange={(e) => setItem(i, 'description', e.target.value)}
                            placeholder="e.g. Plywood 3/4 — 4 pcs" />
                        </td>
                        <td>
                          <NumberInput decimals={3} className="input text-xs text-right"
                            value={it.quantity} onChange={(v) => setItem(i, 'quantity', v)} />
                        </td>
                        <td>
                          <AccountSelect
                            value={it.accountId}
                            onChange={(v) => setItem(i, 'accountId', v)}
                            accounts={accounts}
                            placeholder="— optional —"
                          />
                          {it.description && !it.accountTouched && (
                            <p className={`text-[10px] mt-0.5 ${
                              matchCodeFor(it.description, accountMap.rules, accountMap.fallback).matched
                                ? 'text-gray-400' : 'text-amber-600'
                            }`}>
                              {matchCodeFor(it.description, accountMap.rules, accountMap.fallback).matched
                                ? 'auto · click to change'
                                : 'no match — review this account'}
                            </p>
                          )}
                        </td>
                        <td>
                          <NumberInput className="input text-xs text-right" placeholder="0.00"
                            value={it.estimatedCost} onChange={(v) => setItem(i, 'estimatedCost', v)} />
                        </td>
                        <td>
                          {form.items.length > 1 && (
                            <button type="button" onClick={() => rmItem(i)}
                              className="p-1 text-gray-300 hover:text-red-500">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-3">
                <div className="bg-gray-50 rounded-xl p-4 w-72 flex justify-between text-sm font-bold">
                  <span>Total Requested</span>
                  <span className="text-blue-700">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Optional remarks…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <HandCoins className="w-4 h-4" />
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Release Modal ────────────────────────────────────────────
function ReleaseModal({ request, onClose, onDone }) {
  const [form, setForm] = useState({
    releasedAmount:  String(request.requestedAmount),
    cashAccountCode: '1010',
    releasedDate:    todayStr(),
    releasedBy:      '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(form.releasedAmount) > 0)) { toast.error('Enter an amount greater than zero'); return; }
    setSaving(true);
    try {
      await crApi.release(request.id, form);
      toast.success('Cash released');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Release failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Release Cash</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-600">Request</span><span className="font-mono">{request.requestNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">For</span><span className="font-medium">{request.requestedFor}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1.5">
                <span>Requested</span><span>{formatCurrency(request.requestedAmount)}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Amount to Release (₱) *</label>
              <NumberInput className="input" required placeholder="0.00"
                value={form.releasedAmount}
                onChange={(v) => setForm((f) => ({ ...f, releasedAmount: v }))} />
            </div>

            <div className="form-group">
              <label className="label">Cash Source *</label>
              <select className="select" required value={form.cashAccountCode}
                onChange={(e) => setForm((f) => ({ ...f, cashAccountCode: e.target.value }))}>
                {CASH_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Release Date *</label>
              <input type="date" className="input" required value={form.releasedDate}
                onChange={(e) => setForm((f) => ({ ...f, releasedDate: e.target.value }))} />
            </div>

            <div className="form-group">
              <label className="label">Released By</label>
              <input className="input" placeholder="Defaults to the logged-in user if blank"
                value={form.releasedBy}
                onChange={(e) => setForm((f) => ({ ...f, releasedBy: e.target.value }))} />
            </div>

            <p className="text-xs text-gray-500">
              Posts <strong>DR 1104 Advances</strong> / <strong>CR {form.cashAccountCode}</strong>.
              The amount stays outstanding until liquidated.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Releasing…' : 'Release Cash'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Liquidate Modal ──────────────────────────────────────────
function LiquidateModal({ request, accounts, accountMap, onClose, onDone }) {
  // Start from what was requested — description, account and estimated amount.
  // The user corrects the amounts against the receipts and adds anything extra.
  const [lines, setLines] = useState(() => {
    const fromRequest = (request.items || []).map((i) => ({
      description:    i.description,
      amount:         String(i.estimatedCost),
      accountId:      i.accountId ? String(i.accountId) : '',
      receiptNo:      '',
      accountTouched: !!i.accountId,
    }));
    return fromRequest.length
      ? fromRequest
      : [{ description: '', amount: '', accountId: '', receiptNo: '', accountTouched: false }];
  });
  const [receiptNo, setReceiptNo] = useState('');
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);

  const released = Number(request.releasedAmount);
  const spent    = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const variance = Number((spent - released).toFixed(2));

  const setLine = (i, k, v) =>
    setLines((p) => p.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, [k]: v };
      if (k === 'accountId') next.accountTouched = true;
      if (k === 'description' && !next.accountTouched) {
        const { accountCode } = matchCodeFor(v, accountMap.rules, accountMap.fallback);
        next.accountId = accountIdForCode(accounts, accountCode, accountMap.fallback);
      }
      return next;
    }));

  const addLine = () =>
    setLines((p) => [...p, { description: '', amount: '', accountId: '', receiptNo: '', accountTouched: false }]);
  const rmLine  = (i) => setLines((p) => p.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.description && Number(l.amount) > 0);
    if (!valid.length) { toast.error('Add at least one line with an amount'); return; }
    setSaving(true);
    try {
      const payload = valid.map(({ accountTouched, ...rest }) => rest);
      await crApi.liquidate(request.id, { lines: payload, receiptNo, liquidationDate: date });
      toast.success('Liquidation recorded');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Liquidation failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">Liquidate {request.requestNo}</h3>
            <p className="text-xs text-gray-400">{request.requestedFor} · released {formatCurrency(released)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Liquidation Date *</label>
                <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">Overall Receipt / OR No.</label>
                <input className="input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Actual Spend (with receipts)</h4>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Line
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-56">Account</th>
                      <th className="w-32">Receipt #</th>
                      <th className="w-40 text-right">Amount (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td>
                          <input className="input text-xs" value={l.description}
                            onChange={(e) => setLine(i, 'description', e.target.value)}
                            placeholder="e.g. Plywood 3/4 — 4 pcs" />
                        </td>
                        <td>
                          <AccountSelect value={l.accountId} onChange={(v) => setLine(i, 'accountId', v)}
                            accounts={accounts} placeholder="— select —" />
                        </td>
                        <td>
                          <input className="input text-xs" value={l.receiptNo}
                            onChange={(e) => setLine(i, 'receiptNo', e.target.value)} placeholder="OR #" />
                        </td>
                        <td>
                          <NumberInput className="input text-xs text-right" placeholder="0.00"
                            value={l.amount} onChange={(v) => setLine(i, 'amount', v)} />
                        </td>
                        <td>
                          {lines.length > 1 && (
                            <button type="button" onClick={() => rmLine(i)} className="p-1 text-gray-300 hover:text-red-500">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <div className="bg-gray-50 rounded-xl p-4 w-80 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Released</span><span>{formatCurrency(released)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Actual Spent</span><span>{formatCurrency(spent)}</span></div>
                <div className={`flex justify-between font-bold text-base border-t border-gray-200 pt-2 ${
                  variance < 0 ? 'text-green-600' : variance > 0 ? 'text-red-600' : 'text-gray-700'
                }`}>
                  <span>{variance < 0 ? 'Sukli to return' : variance > 0 ? 'Reimburse' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Record Liquidation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reject Modal ─────────────────────────────────────────────
function RejectModal({ request, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await crApi.reject(request.id, { reason });
      toast.success('Request rejected');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reject failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Reject {request.requestNo}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-group">
              <label className="label">Reason for Rejection *</label>
              <textarea className="input" rows={3} required
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this request is being rejected…" />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !reason.trim()} className="btn-danger">
              {saving ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Printable Cash Request Form ──────────────────────────────
// Rows written before the actorName fix hold the literal string
// "undefined undefined"; treat that as no name rather than printing it
// onto a document someone signs.
const signatory = (name) => {
  const n = String(name || '').trim();
  return !n || n === 'undefined undefined' ? '' : n;
};

const sigColumn = (label, name) => `
  <div style="flex:1;">
    <p style="font-weight:700;color:#111827;margin:0 0 30px;font-size:10px;">${label}:</p>
    <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#111;min-height:13px;">${signatory(name)}</p>
    <div style="border-top:1px solid #374151;padding-top:3px;color:#6b7280;font-size:8px;">Signature over printed name / Date</div>
  </div>`;

async function printCashRequestForm(cr) {
  const released = Number(cr.releasedAmount);
  const spent    = Number(cr.liquidation?.totalAmount || 0);
  const variance = cr.liquidation ? Number((spent - released).toFixed(2)) : null;
  const requestedTotal = (cr.items || []).reduce((s, i) => s + Number(i.estimatedCost || 0), 0);

  const itemsHTML = (cr.items || []).map((i) => `
    <tr>
      <td>${i.description}</td>
      <td class="mono small">${i.account ? `${i.account.accountCode} ${i.account.accountName}` : '—'}</td>
      <td class="right">${i.quantity != null ? Number(i.quantity).toLocaleString() : '—'}</td>
      <td class="right mono">${phpFmt(i.estimatedCost)}</td>
    </tr>`).join('');

  const releasedHTML = released > 0 ? `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Amount Released</div><div class="info-val mono">${phpFmt(released)}</div></div>
      <div class="info-box"><div class="info-lbl">Cash Source</div><div class="info-val mono">${cr.cashAccountCode || '—'}</div></div>
      <div class="info-box"><div class="info-lbl">Date Released</div><div class="info-val">${cr.releasedDate ? dateFmt(cr.releasedDate) : '—'}</div></div>
    </div>` : '';

  const liqHTML = cr.liquidation ? `
    <div class="section-title">Liquidation — ${cr.liquidation.voucherNo}</div>
    <table>
      <thead><tr><th>Description</th><th>Account</th><th>Receipt #</th><th class="right">Amount</th></tr></thead>
      <tbody>${(cr.liquidation.items || []).map((l) => `
        <tr>
          <td>${l.description}</td>
          <td class="mono small">${l.account ? `${l.account.accountCode} ${l.account.accountName}` : '—'}</td>
          <td class="mono small">${l.receiptNo || '—'}</td>
          <td class="right mono">${phpFmt(l.amount)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="totals-block" style="max-width:320px;margin-left:auto;margin-top:12px;">
      <div class="totals-row"><span class="gray">Released</span><span class="mono">${phpFmt(released)}</span></div>
      <div class="totals-row"><span class="gray">Actual Spent</span><span class="mono">${phpFmt(spent)}</span></div>
      <div class="totals-divider"></div>
      <div class="totals-row totals-total">
        <span>${variance < 0 ? 'Sukli Returned' : variance > 0 ? 'Reimbursed' : 'Exact'}</span>
        <span class="mono">${phpFmt(Math.abs(variance))}</span>
      </div>
    </div>` : '';

  const body = `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Request No.</div><div class="info-val mono">${cr.requestNo}</div></div>
      <div class="info-box"><div class="info-lbl">Requested For</div><div class="info-val">${cr.requestedFor}</div></div>
      <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${badge(cr.status)}</div></div>
      <div class="info-box"><div class="info-lbl">Request Date</div><div class="info-val">${dateFmt(cr.requestDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Needed By</div><div class="info-val">${cr.neededDate ? dateFmt(cr.neededDate) : '—'}</div></div>
      <div class="info-box"><div class="info-lbl">Prepared By</div><div class="info-val">${signatory(cr.requestedBy) || '—'}</div></div>
    </div>

    <div class="desc-box"><strong>Purpose:</strong> ${cr.purpose}</div>

    <div class="section-title">Requested Items (estimate)</div>
    <table>
      <thead><tr><th>Description</th><th>Account</th><th class="right">Qty</th><th class="right">Est. Cost</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
      <tfoot>
        <tr><td colspan="3" class="right">TOTAL REQUESTED</td><td class="right mono">${phpFmt(requestedTotal)}</td></tr>
      </tfoot>
    </table>

    ${releasedHTML}
    ${liqHTML}

    <div style="margin-top:34px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;gap:24px;">
      ${sigColumn('Requested by', cr.requestedBy)}
      ${sigColumn('Approved by', cr.approvedBy)}
      ${sigColumn('Released by', cr.releasedBy)}
    </div>

    <div style="margin-top:22px;padding:10px 14px;border:1px solid #d1daf0;border-radius:6px;background:#f8faff;">
      <p style="margin:0 0 26px;font-size:10px;color:#374151;">
        Received the sum of <strong class="mono">${released > 0 ? phpFmt(released) : '₱ ______________'}</strong>
        as cash advance for the purpose stated above.
      </p>
      <div style="max-width:280px;">
        <div style="border-top:1px solid #374151;padding-top:3px;color:#6b7280;font-size:8px;">
          Signature over printed name / Date
        </div>
      </div>
    </div>`;

  await printDocument(
    `Cash Request Form — ${cr.requestNo}`,
    `${cr.requestedFor} · ${dateFmt(cr.requestDate)}`,
    body
  );
}

// ─── Detail Modal ─────────────────────────────────────────────
function DetailModal({ requestId, onClose }) {
  const [cr, setCr] = useState(null);

  useEffect(() => {
    crApi.get(requestId)
      .then((r) => setCr(r.data))
      .catch(() => toast.error('Failed to load the request'));
  }, [requestId]);

  if (!cr) {
    return (
      <div className="modal-overlay">
        <div className="modal max-w-3xl">
          <div className="modal-body text-center py-16 text-gray-400">Loading…</div>
        </div>
      </div>
    );
  }

  const released = Number(cr.releasedAmount);
  const spent    = Number(cr.liquidation?.totalAmount || 0);
  const variance = cr.liquidation ? Number((spent - released).toFixed(2)) : null;

  const TIMELINE = [
    { label: 'Requested',  who: cr.requestedBy, when: cr.requestDate,           done: true },
    { label: 'Approved',   who: cr.approvedBy,  when: null,                     done: ['APPROVED', 'RELEASED', 'LIQUIDATED'].includes(cr.status) },
    { label: 'Released',   who: cr.releasedBy,  when: cr.releasedDate,          done: ['RELEASED', 'LIQUIDATED'].includes(cr.status) },
    { label: 'Liquidated', who: null,           when: cr.liquidation?.paidDate, done: cr.status === 'LIQUIDATED' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{cr.requestNo}</h3>
            <p className="text-sm text-gray-500">{cr.requestedFor}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={STATUS_BADGE[cr.status]}>{cr.status}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-gray-700">{cr.purpose}</div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Progress</h4>
            <div className="flex items-center gap-2">
              {TIMELINE.map((t, i) => (
                <div key={t.label} className="flex items-center gap-2 flex-1">
                  <div className={`flex-1 rounded-lg px-3 py-2 text-center text-xs ${
                    t.done ? 'bg-green-50 text-green-700 border border-green-200'
                           : 'bg-gray-50 text-gray-400 border border-gray-200'
                  }`}>
                    <p className="font-semibold">{t.label}</p>
                    {t.who && <p className="text-[10px] opacity-70">{t.who}</p>}
                    {t.when && <p className="text-[10px] opacity-70">{formatDate(t.when)}</p>}
                  </div>
                  {i < TIMELINE.length - 1 && <span className="text-gray-300">→</span>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items (estimate)</h4>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Est. Cost</th></tr>
                </thead>
                <tbody>
                  {cr.items?.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td className="text-right">{i.quantity != null ? Number(i.quantity).toLocaleString() : '—'}</td>
                      <td className="text-right">{formatCurrency(i.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Requested</span><span>{formatCurrency(cr.requestedAmount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Released</span><span>{released > 0 ? formatCurrency(released) : '—'}</span></div>
            {cr.liquidation && (
              <>
                <div className="flex justify-between"><span className="text-gray-600">Actual Spent</span><span>{formatCurrency(spent)}</span></div>
                <div className={`flex justify-between font-bold text-base border-t border-gray-200 pt-2 ${
                  variance < 0 ? 'text-green-600' : variance > 0 ? 'text-red-600' : 'text-gray-700'
                }`}>
                  <span>{variance < 0 ? 'Sukli returned' : variance > 0 ? 'Reimbursed' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
              </>
            )}
            {cr.status === 'RELEASED' && (
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 text-red-600">
                <span>Outstanding in 1104</span><span>{formatCurrency(released)}</span>
              </div>
            )}
          </div>

          {cr.rejectedReason && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700">
              <strong>Rejected:</strong> {cr.rejectedReason}
            </div>
          )}

          {cr.liquidation && (
            <p className="text-xs text-gray-500">
              Liquidation voucher: <span className="font-mono text-blue-600">{cr.liquidation.voucherNo}</span>
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={() => printCashRequestForm(cr)} className="btn-secondary">Print</button>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function CashRequestsPage() {
  const [rows, setRows]       = useState([]);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus]   = useState('');
  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState(null);
  const [accountMap, setAccountMap] = useState({ rules: [], fallback: '6390' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        crApi.list({ status: status || undefined, search: search || undefined, limit: 100 }),
        crApi.summary(),
      ]);
      setRows(list.data.data);
      setSummary(sum.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load cash requests');
    } finally { setLoading(false); }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    acctApi.list({ limit: 500 })
      .then((r) => setAccounts(r.data.data || r.data))
      .catch(() => setAccounts([]));
  }, []);
  useEffect(() => {
    crApi.accountMap()
      .then((r) => setAccountMap(r.data))
      .catch(() => setAccountMap({ rules: [], fallback: '6390' }));
  }, []);

  const names = [...new Set(rows.map((r) => r.requestedFor))];

  const act = async (fn, msg) => {
    try { await fn(); toast.success(msg); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  };

  const cancel = (r) => {
    if (!window.confirm(`Cancel ${r.requestNo}? This cannot be undone.`)) return;
    act(() => crApi.cancel(r.id), 'Request cancelled');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Requests</h1>
          <p className="page-subtitle">Cash advances for purchases — request, approve, release, liquidate</p>
        </div>
        <button onClick={() => setModal({ type: 'new' })} className="btn-primary">
          <Plus className="w-4 h-4" /> New Cash Request
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Pending Approval</p>
            <p className="text-2xl font-bold text-yellow-600">{summary.pendingApproval}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Awaiting Release</p>
            <p className="text-2xl font-bold text-blue-600">{summary.awaitingRelease}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Unliquidated</p>
            <p className="text-2xl font-bold text-gray-800">{summary.releasedCount}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Outstanding (1104)</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.outstandingAmount)}</p>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search request no., name, or purpose…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Request No.</th>
                <th>Requested For</th>
                <th>Purpose</th>
                <th>Date</th>
                <th className="text-right">Requested</th>
                <th className="text-right">Released</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">No cash requests yet</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs text-blue-700">{r.requestNo}</td>
                  <td className="font-medium">{r.requestedFor}</td>
                  <td className="text-sm text-gray-600 max-w-xs truncate">{r.purpose}</td>
                  <td className="text-sm">{formatDate(r.requestDate)}</td>
                  <td className="text-right">{formatCurrency(r.requestedAmount)}</td>
                  <td className="text-right font-medium">
                    {Number(r.releasedAmount) > 0 ? formatCurrency(r.releasedAmount) : '—'}
                  </td>
                  <td><span className={STATUS_BADGE[r.status]}>{r.status}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setModal({ type: 'detail', id: r.id })}
                      className="btn-secondary btn-sm mr-1" title="View">
                      <Eye className="w-3 h-3" />
                    </button>
                    {r.status === 'DRAFT' && (
                      <button onClick={() => act(() => crApi.submit(r.id), 'Submitted for approval')}
                        className="btn-secondary btn-sm" title="Submit">
                        <Send className="w-3 h-3" />
                      </button>
                    )}
                    {r.status === 'SUBMITTED' && (
                      <button onClick={() => act(() => crApi.approve(r.id, {}), 'Approved')}
                        className="btn-success btn-sm ml-1" title="Approve">
                        <Check className="w-3 h-3" />
                      </button>
                    )}
                    {r.status === 'APPROVED' && (
                      <button onClick={() => setModal({ type: 'release', request: r })}
                        className="btn-primary btn-sm ml-1" title="Release cash">
                        <HandCoins className="w-3 h-3" /> Release
                      </button>
                    )}
                    {(r.status === 'SUBMITTED' || r.status === 'APPROVED') && (
                      <button onClick={() => setModal({ type: 'reject', request: r })}
                        className="btn-danger btn-sm ml-1" title="Reject">
                        <Ban className="w-3 h-3" />
                      </button>
                    )}
                    {r.status === 'RELEASED' && (
                      <button onClick={() => setModal({ type: 'liquidate', request: r })}
                        className="btn-primary btn-sm" title="Liquidate">
                        <CheckCircle2 className="w-3 h-3" /> Liquidate
                      </button>
                    )}
                    {(r.status === 'DRAFT' || r.status === 'SUBMITTED' || r.status === 'APPROVED') && (
                      <button onClick={() => cancel(r)}
                        className="btn-secondary btn-sm ml-1" title="Cancel request">
                        <Ban className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === 'new' && (
        <RequestModal accounts={accounts} names={names} accountMap={accountMap}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'release' && (
        <ReleaseModal request={modal.request}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'reject' && (
        <RejectModal request={modal.request}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'liquidate' && (
        <LiquidateModal request={modal.request} accounts={accounts} accountMap={accountMap}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'detail' && (
        <DetailModal requestId={modal.id} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
