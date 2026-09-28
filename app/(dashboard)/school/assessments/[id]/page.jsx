'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Printer, Loader2, CheckCircle2, XCircle, AlertTriangle, Receipt, Mail,
} from 'lucide-react';

const STATUS_BADGE = {
  DRAFT: 'badge-yellow', ISSUED: 'badge-blue', SETTLED: 'badge-green', CANCELLED: 'badge-red',
  SCHEDULED: 'badge-yellow', BILLED: 'badge-blue', PARTIAL: 'badge-yellow',
  PAID: 'badge-green', CANCELLED_I: 'badge-red',
};

export default function AssessmentDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [a, setA] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.assessments.get(id);
      setA(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load this assessment');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const issue = async () => {
    setBusy(true);
    try {
      const { data } = await sApi.assessments.issue(id);
      toast.success(data.invoice
        ? `Issued — enrollment invoice ${data.invoice.invoiceNo}`
        : 'Assessment issued');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not issue this assessment');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const reason = window.prompt('Why is this enrollment being cancelled?');
    if (reason === null) return;
    setBusy(true);
    try {
      await sApi.assessments.cancel(id, { reason });
      toast.success('Enrollment cancelled');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not cancel this enrollment');
    } finally {
      setBusy(false);
    }
  };

  const emailAssessment = async () => {
    setEmailing(true);
    try {
      const { data } = await sApi.assessments.email(id);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send this assessment by email');
    } finally { setEmailing(false); }
  };

  const printForm = () => {
    const feeRows = a.lines.map((l) => `
      <tr><td>${l.description}</td>
          <td>${l.vatCode === 'VAT' ? 'VATable' : 'VAT-exempt'}</td>
          <td style="text-align:right">${phpFmt(l.amount)}</td></tr>`).join('');
    const schedRows = a.installments.map((i) => `
      <tr><td>${i.label}</td><td>${dateFmt(i.dueDate)}</td>
          <td style="text-align:right">${phpFmt(i.amount)}</td></tr>`).join('');

    printDocument('ASSESSMENT OF FEES', a.assessmentNo, `
      <table style="width:100%;margin-bottom:18px">
        <tr>
          <td><strong>Student:</strong> ${a.studentLabel}<br>
              ${a.student.lrn ? `<strong>LRN:</strong> ${a.student.lrn}<br>` : ''}
              <strong>Date:</strong> ${dateFmt(a.assessmentDate)}</td>
          <td style="text-align:right">
              <strong>School Year:</strong> ${a.enrollment.schoolYear.code}<br>
              <strong>Grade Level:</strong> ${a.enrollment.gradeLevel.name}<br>
              ${a.enrollment.section ? `<strong>Section:</strong> ${a.enrollment.section.name}<br>` : ''}
              <strong>Plan:</strong> ${a.enrollment.paymentScheme.name}</td>
        </tr>
      </table>

      <table class="tbl">
        <thead><tr><th>Fee</th><th>Tax</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          ${feeRows}
          <tr><td colspan="2"><strong>Gross assessment</strong></td>
              <td style="text-align:right"><strong>${phpFmt(a.grossAmount)}</strong></td></tr>
          ${Number(a.discountAmount) > 0 ? `<tr><td colspan="2">Less: discounts and scholarships</td><td style="text-align:right">(${phpFmt(a.discountAmount)})</td></tr>` : ''}
          ${Number(a.subsidyAmount) > 0 ? `<tr><td colspan="2">Less: DepEd subsidy</td><td style="text-align:right">(${phpFmt(a.subsidyAmount)})</td></tr>` : ''}
          <tr class="total"><td colspan="2"><strong>TOTAL PAYABLE</strong></td>
              <td style="text-align:right"><strong>${phpFmt(Number(a.netAmount) - Number(a.subsidyAmount))}</strong></td></tr>
        </tbody>
      </table>

      <h3 style="margin-top:22px">Payment Schedule</h3>
      <table class="tbl">
        <thead><tr><th>Installment</th><th>Due Date</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${schedRows}</tbody>
      </table>

      <p style="margin-top:22px;font-size:11px">
        Tuition and school fees are VAT-exempt under Sec. 109(H) of the National Internal Revenue Code.
        Books, modules and uniforms are sales of goods and are subject to VAT.
      </p>
      <table style="width:100%;margin-top:48px">
        <tr>
          <td>_______________________________<br><span style="font-size:11px">Parent / Guardian</span></td>
          <td style="text-align:right">_______________________________<br><span style="font-size:11px">Registrar</span></td>
        </tr>
      </table>
    `);
  };

  if (loading) return <div className="text-center py-16"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>;
  if (!a) return null;

  const totalPayable = Number(a.netAmount) - Number(a.subsidyAmount);

  return (
    <div>
      <button onClick={() => router.push('/school/assessments')}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3">
        <ArrowLeft className="h-4 w-4" /> Assessments
      </button>

      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-3">
            {a.assessmentNo}
            <span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
          </h1>
          <p className="page-subtitle">
            {a.studentLabel} · {a.enrollment.gradeLevel.name} · {a.enrollment.schoolYear.code}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={emailAssessment} disabled={emailing} className="btn-secondary flex items-center gap-2">
            {emailing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send to email
          </button>
          <button onClick={printForm} className="btn-secondary flex items-center gap-2">
            <Printer className="h-4 w-4" /> Print
          </button>
          {a.status === 'DRAFT' && (
            <>
              <button onClick={cancel} disabled={busy} className="btn-danger flex items-center gap-2">
                <XCircle className="h-4 w-4" /> Cancel
              </button>
              <button onClick={issue} disabled={busy} className="btn-primary flex items-center gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Issue assessment
              </button>
            </>
          )}
        </div>
      </div>

      {a.status === 'DRAFT' && (
        <div className="card mb-4 border-amber-200 dark:border-amber-900">
          <div className="card-body flex gap-3">
            <AlertTriangle className="h-5 w-5 flex-none text-amber-600" />
            <div className="text-sm">
              <p className="font-medium">This assessment is still a draft.</p>
              <p className="text-gray-500">
                Nothing has posted to the ledger. Issuing it bills the enrollment payment,
                posts any discounts as contra-revenue, and moves subsidised amounts to the DepEd receivable.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Fees ────────────────────────────────────────── */}
        <div className="card">
          <div className="card-body">
            <h2 className="font-semibold mb-3">Assessment of fees</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y dark:divide-gray-700">
                {a.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2">
                      {l.description}
                      {l.vatCode === 'VAT' && <span className="badge badge-yellow ml-2 text-[10px]">VAT</span>}
                      {l.billingBasis === 'ONE_TIME' && <span className="badge badge-blue ml-2 text-[10px]">One-time</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCurrency(l.amount)}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2">Gross assessment</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(a.grossAmount)}</td>
                </tr>
                {Number(a.discountAmount) > 0 && (
                  <tr className="text-green-700 dark:text-green-400">
                    <td className="py-2">Less: discounts</td>
                    <td className="py-2 text-right tabular-nums">({formatCurrency(a.discountAmount)})</td>
                  </tr>
                )}
                {Number(a.subsidyAmount) > 0 && (
                  <tr className="text-blue-700 dark:text-blue-400">
                    <td className="py-2">Less: DepEd subsidy</td>
                    <td className="py-2 text-right tabular-nums">({formatCurrency(a.subsidyAmount)})</td>
                  </tr>
                )}
                <tr className="font-semibold text-base border-t-2 dark:border-gray-600">
                  <td className="py-2">Total payable</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(totalPayable)}</td>
                </tr>
              </tbody>
            </table>

            {(a.enrollment.discounts.length > 0 || a.enrollment.subsidies.length > 0) && (
              <div className="mt-4 pt-4 border-t dark:border-gray-700 space-y-1 text-xs text-gray-500">
                {a.enrollment.discounts.map((d) => (
                  <p key={d.id}>{d.label} — {d.basis === 'PCT' ? `${d.value}% of tuition` : 'fixed'} = {formatCurrency(d.amount)}</p>
                ))}
                {a.enrollment.subsidies.map((s) => (
                  <p key={s.id}>{s.type.replace(/_/g, ' ')}{s.referenceNo ? ` (${s.referenceNo})` : ''} = {formatCurrency(s.amount)} · {s.status}</p>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Schedule ────────────────────────────────────── */}
        <div className="card">
          <div className="card-body">
            <h2 className="font-semibold mb-3">Payment schedule</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="py-2">Installment</th><th className="py-2">Due</th>
                    <th className="py-2 text-right">Amount</th><th className="py-2 text-right">Paid</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {a.installments.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2">
                        {i.label}
                        {i.invoice && (
                          <span className="block text-[11px] text-gray-500 font-mono">{i.invoice.invoiceNo}</span>
                        )}
                      </td>
                      <td className="py-2">{formatDate(i.dueDate)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(i.amount)}</td>
                      <td className="py-2 text-right tabular-nums">{formatCurrency(i.paidAmount)}</td>
                      <td className="py-2">
                        <span className={`badge ${i.status === 'PAID' ? 'badge-green' : i.status === 'BILLED' ? 'badge-blue' : i.status === 'PARTIAL' ? 'badge-yellow' : 'badge-yellow'}`}>
                          {i.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 pt-4 border-t dark:border-gray-700 flex justify-between text-sm">
              <span className="text-gray-500">Billed so far</span>
              <span className="tabular-nums font-medium">{formatCurrency(a.billedAmount)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Collected</span>
              <span className="tabular-nums font-medium">{formatCurrency(a.paidAmount)}</span>
            </div>

            {a.status === 'ISSUED' && (
              <Link href="/school/collections" className="btn-primary w-full mt-4 flex items-center justify-center gap-2">
                <Receipt className="h-4 w-4" /> Take a payment
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
