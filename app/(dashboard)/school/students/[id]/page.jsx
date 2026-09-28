'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Printer, Loader2, Wallet, FileText, User,
  GraduationCap, AlertCircle, PiggyBank,
} from 'lucide-react';

export default function StudentDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.students.ledger(id);
      setLedger(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load this student');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const printSOA = async () => {
    setPrinting(true);
    try {
      const { data } = await sApi.reports.soa(id);
      const feeRows = data.assessment.lines.map((l) => `
        <tr><td>${l.description}</td>
            <td style="text-align:right">${phpFmt(l.amount)}</td></tr>`).join('');

      const schedRows = data.schedule.map((s) => `
        <tr>
          <td>${s.label}</td>
          <td>${dateFmt(s.dueDate)}</td>
          <td style="text-align:right">${phpFmt(s.amount)}</td>
          <td style="text-align:right">${phpFmt(s.paidAmount)}</td>
          <td style="text-align:right">${phpFmt(s.balance)}</td>
          <td>${s.billed ? s.status : 'Not yet billed'}</td>
        </tr>`).join('');

      printDocument('STATEMENT OF ACCOUNT', data.assessment.assessmentNo, `
        <table style="width:100%;margin-bottom:18px">
          <tr>
            <td><strong>Student:</strong> ${data.student.name}<br>
                <strong>Student No.:</strong> ${data.student.studentNo}<br>
                ${data.student.lrn ? `<strong>LRN:</strong> ${data.student.lrn}<br>` : ''}
                ${data.student.guardian ? `<strong>Guardian:</strong> ${data.student.guardian}` : ''}</td>
            <td style="text-align:right">
                <strong>School Year:</strong> ${data.enrollment.schoolYear}<br>
                <strong>Grade Level:</strong> ${data.enrollment.gradeLevel}<br>
                ${data.enrollment.section ? `<strong>Section:</strong> ${data.enrollment.section}<br>` : ''}
                <strong>Plan:</strong> ${data.enrollment.scheme}</td>
          </tr>
        </table>

        <h3>Assessment</h3>
        <table class="tbl">
          <thead><tr><th>Fee</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>
            ${feeRows}
            <tr><td><strong>Gross assessment</strong></td>
                <td style="text-align:right"><strong>${phpFmt(data.assessment.grossAmount)}</strong></td></tr>
            ${data.assessment.discountAmount > 0 ? `<tr><td>Less: discounts</td><td style="text-align:right">(${phpFmt(data.assessment.discountAmount)})</td></tr>` : ''}
            ${data.assessment.subsidyAmount > 0 ? `<tr><td>Less: DepEd subsidy</td><td style="text-align:right">(${phpFmt(data.assessment.subsidyAmount)})</td></tr>` : ''}
            <tr class="total"><td><strong>Total payable</strong></td>
                <td style="text-align:right"><strong>${phpFmt(data.summary.totalPayable)}</strong></td></tr>
          </tbody>
        </table>

        <h3 style="margin-top:22px">Payment Schedule</h3>
        <table class="tbl">
          <thead><tr><th>Installment</th><th>Due</th>
            <th style="text-align:right">Amount</th><th style="text-align:right">Paid</th>
            <th style="text-align:right">Balance</th><th>Status</th></tr></thead>
          <tbody>${schedRows}</tbody>
        </table>

        <table style="width:100%;margin-top:22px">
          <tr><td style="text-align:right"><strong>Total paid to date:</strong></td>
              <td style="text-align:right;width:130px">${phpFmt(data.summary.totalPaid)}</td></tr>
          <tr><td style="text-align:right"><strong>Outstanding balance:</strong></td>
              <td style="text-align:right"><strong>${phpFmt(data.summary.balance)}</strong></td></tr>
        </table>

        <p style="margin-top:24px;font-size:11px">
          Tuition and school fees are VAT-exempt under Sec. 109(H) of the National Internal Revenue Code.
        </p>
      `);
    } catch (err) {
      toast.error(err.response?.data?.error || 'No issued assessment to print');
    } finally {
      setPrinting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-16 text-gray-500"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;
  }
  if (!ledger) return null;

  const { student, summary, assessments, invoices, advances } = ledger;

  return (
    <div>
      <button onClick={() => router.push('/school/students')}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-3">
        <ArrowLeft className="h-4 w-4" /> Students
      </button>

      <div className="page-header">
        <div>
          <h1 className="page-title">{student.fullName}</h1>
          <p className="page-subtitle font-mono">{student.studentNo}{student.lrn ? ` · LRN ${student.lrn}` : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printSOA} disabled={printing} className="btn-secondary flex items-center gap-2">
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Statement of account
          </button>
        </div>
      </div>

      {/* ── Summary ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Total billed', value: summary.totalBilled, icon: FileText },
          { label: 'Total paid', value: summary.totalPaid, icon: Wallet },
          { label: 'Outstanding', value: summary.outstanding, icon: AlertCircle, alert: summary.outstanding > 0 },
          { label: 'Overdue', value: summary.overdue, icon: AlertCircle, alert: summary.overdue > 0 },
        ].map((s) => (
          <div key={s.label} className="card">
            <div className="card-body">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{s.label}</p>
              <p className={`text-xl font-semibold tabular-nums ${s.alert ? 'text-red-600 dark:text-red-400' : ''}`}>
                {formatCurrency(s.value)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {summary.unappliedCredit > 0 && (
        <div className="card mb-4 border-blue-200 dark:border-blue-900">
          <div className="card-body flex items-center gap-3">
            <PiggyBank className="h-5 w-5 text-blue-600" />
            <span className="text-sm">
              <strong>{formatCurrency(summary.unappliedCredit)}</strong> in advance payments not yet applied
              to an invoice. Apply it from the Cashier screen.
            </span>
          </div>
        </div>
      )}

      {/* ── Enrollments ─────────────────────────────────────── */}
      <div className="card mb-4">
        <div className="card-body">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <GraduationCap className="h-4 w-4" /> Enrollment history
          </h2>
          {assessments.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Not yet enrolled in any school year.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="py-2">Assessment</th><th className="py-2">School Year</th>
                    <th className="py-2">Grade</th><th className="py-2">Plan</th>
                    <th className="py-2 text-right">Net</th><th className="py-2 text-right">Paid</th>
                    <th className="py-2 text-center">Installments</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {assessments.map((a) => {
                    const active = (a.installments || []).filter((i) => i.status !== 'CANCELLED');
                    const paid   = active.filter((i) => i.status === 'PAID').length;
                    return (
                      <tr key={a.id}>
                        <td className="py-2.5 font-mono text-xs">{a.assessmentNo}</td>
                        <td className="py-2.5">{a.enrollment.schoolYear.code}</td>
                        <td className="py-2.5">{a.enrollment.gradeLevel.name}</td>
                        <td className="py-2.5">{a.enrollment.paymentScheme.name}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCurrency(a.netAmount)}</td>
                        <td className="py-2.5 text-right tabular-nums">{formatCurrency(a.paidAmount)}</td>
                        <td className="py-2.5 text-center tabular-nums text-gray-500">
                          {active.length > 0 ? `${paid}/${active.length}` : '—'}
                        </td>
                        <td className="py-2.5"><span className="badge badge-blue">{a.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Invoices ────────────────────────────────────────── */}
      <div className="card">
        <div className="card-body">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <FileText className="h-4 w-4" /> Billing ledger
          </h2>
          {invoices.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">Nothing billed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="py-2">Invoice</th><th className="py-2">Description</th>
                    <th className="py-2">Due</th>
                    <th className="py-2 text-right">Amount</th><th className="py-2 text-right">Paid</th>
                    <th className="py-2 text-right">Balance</th><th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2.5 font-mono text-xs">{i.invoiceNo}</td>
                      <td className="py-2.5">{i.description}</td>
                      <td className="py-2.5">{formatDate(i.dueDate)}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatCurrency(i.totalAmount)}</td>
                      <td className="py-2.5 text-right tabular-nums">{formatCurrency(i.paidAmount)}</td>
                      <td className="py-2.5 text-right tabular-nums font-medium">{formatCurrency(i.balance)}</td>
                      <td className="py-2.5">
                        <span className={`badge ${i.status === 'PAID' ? 'badge-green' : i.status === 'PARTIAL' ? 'badge-yellow' : 'badge-blue'}`}>
                          {i.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
