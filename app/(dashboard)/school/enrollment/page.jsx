'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Search, Loader2, Plus, Trash2, GraduationCap, Calculator,
  CheckCircle2, AlertTriangle, User,
} from 'lucide-react';

const DISCOUNT_TYPES = ['SIBLING', 'ACADEMIC', 'EMPLOYEE', 'EARLY_BIRD', 'FULL_PAYMENT', 'OTHER'];
const SUBSIDY_TYPES = ['ESC', 'SHS_VOUCHER', 'LGU', 'PRIVATE_SPONSOR'];

/**
 * Enrollment wizard.
 *
 * Everything recomputes live against the server, so what the registrar reads
 * out to the parent is exactly what will be written — no client-side copy of
 * the assessment maths that could drift from the real one.
 */
export default function EnrollmentPage() {
  const router = useRouter();

  const [years, setYears] = useState([]);
  const [levels, setLevels] = useState([]);
  const [sections, setSections] = useState([]);
  const [schemes, setSchemes] = useState([]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [student, setStudent] = useState(null);

  const [form, setForm] = useState({
    schoolYearId: '', gradeLevelId: '', sectionId: '', paymentSchemeId: '',
    enrollmentDate: new Date().toISOString().slice(0, 10), remarks: '',
  });
  const [discounts, setDiscounts] = useState([]);
  const [subsidies, setSubsidies] = useState([]);

  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── Reference data ───────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [y, l, s] = await Promise.all([
          sApi.schoolYears.list(), sApi.gradeLevels.list(), sApi.paymentSchemes.list(),
        ]);
        setYears(y.data);
        setLevels(l.data.filter((x) => x.isActive));
        setSchemes(s.data.filter((x) => x.isActive));
        const current = y.data.find((x) => x.isCurrent);
        if (current) setForm((f) => ({ ...f, schoolYearId: String(current.id) }));
      } catch {
        toast.error('Could not load school setup. Configure it under School → Setup first.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!form.schoolYearId || !form.gradeLevelId) { setSections([]); return; }
    sApi.sections.list({ schoolYearId: form.schoolYearId, gradeLevelId: form.gradeLevelId })
      .then(({ data }) => setSections(data))
      .catch(() => setSections([]));
  }, [form.schoolYearId, form.gradeLevelId]);

  // ── Student search ───────────────────────────────────────
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await sApi.students.list({ search: query.trim(), limit: 8 });
        setResults(data.items || []);
      } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // ── Live assessment preview ──────────────────────────────
  const runPreview = useCallback(async () => {
    if (!student || !form.schoolYearId || !form.gradeLevelId || !form.paymentSchemeId) {
      setPreview(null); setPreviewError(null); return;
    }
    setPreviewing(true); setPreviewError(null);
    try {
      const { data } = await sApi.enrollments.preview({
        studentId: Number(student.id),
        schoolYearId: Number(form.schoolYearId),
        gradeLevelId: Number(form.gradeLevelId),
        paymentSchemeId: Number(form.paymentSchemeId),
        assessmentDate: form.enrollmentDate,
        discounts: discounts.filter((d) => Number(d.value) > 0),
        subsidies: subsidies.filter((s) => Number(s.amount) > 0),
      });
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setPreviewError(err.response?.data?.error || 'Could not compute this assessment');
    } finally {
      setPreviewing(false);
    }
  }, [student, form, discounts, subsidies]);

  useEffect(() => { const t = setTimeout(runPreview, 300); return () => clearTimeout(t); }, [runPreview]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const enroll = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      const { data } = await sApi.enrollments.create({
        studentId: Number(student.id),
        schoolYearId: Number(form.schoolYearId),
        gradeLevelId: Number(form.gradeLevelId),
        sectionId: form.sectionId ? Number(form.sectionId) : undefined,
        paymentSchemeId: Number(form.paymentSchemeId),
        enrollmentDate: form.enrollmentDate,
        remarks: form.remarks || undefined,
        discounts: discounts.filter((d) => Number(d.value) > 0),
        subsidies: subsidies.filter((s) => Number(s.amount) > 0),
      });
      toast.success(`Enrolled — assessment ${data.assessment.assessmentNo}`);
      router.push(`/school/assessments/${data.assessment.id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not complete this enrollment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Enrollment</h1>
          <p className="page-subtitle">Enroll a student and compute their assessment.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── Form ────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-4">
          <div className="card">
            <div className="card-body">
              <h2 className="font-semibold mb-3 flex items-center gap-2"><User className="h-4 w-4" /> Student</h2>
              {student ? (
                <div className="flex items-center justify-between rounded-lg border px-4 py-3 dark:border-gray-700">
                  <div>
                    <p className="font-medium">{student.fullName}</p>
                    <p className="text-xs text-gray-500 font-mono">{student.studentNo}</p>
                  </div>
                  <button onClick={() => { setStudent(null); setPreview(null); }}
                          className="text-xs text-blue-600 hover:underline">Change</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                    <input className="input pl-9" placeholder="Search by name, student number, or LRN…"
                           value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                  {results.length > 0 && (
                    <div className="mt-2 border rounded-lg divide-y dark:border-gray-700 dark:divide-gray-700">
                      {results.map((s) => (
                        <button key={s.id} onClick={() => { setStudent(s); setResults([]); setQuery(''); }}
                                className="w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <span className="font-medium">{s.fullName}</span>
                          <span className="text-xs text-gray-500 ml-2 font-mono">{s.studentNo}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-body space-y-4">
              <h2 className="font-semibold flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Placement</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="label">School Year *</label>
                  <select className="input" value={form.schoolYearId} onChange={set('schoolYearId')}>
                    <option value="">Select…</option>
                    {years.map((y) => <option key={y.id} value={y.id}>{y.code}{y.isCurrent ? ' (current)' : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Grade Level *</label>
                  <select className="input" value={form.gradeLevelId} onChange={set('gradeLevelId')}>
                    <option value="">Select…</option>
                    {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Section</label>
                  <select className="input" value={form.sectionId} onChange={set('sectionId')} disabled={!sections.length}>
                    <option value="">{sections.length ? 'Unassigned' : 'No sections set up'}</option>
                    {sections.map((s) => (
                      <option key={s.id} value={s.id} disabled={s.capacity && s.enrolledCount >= s.capacity}>
                        {s.name}{s.capacity ? ` (${s.enrolledCount}/${s.capacity})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Payment Plan *</label>
                  <select className="input" value={form.paymentSchemeId} onChange={set('paymentSchemeId')}>
                    <option value="">Select…</option>
                    {schemes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}{Number(s.discountPct) > 0 ? ` — ${s.discountPct}% off tuition` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Enrollment Date *</label>
                  <input className="input" type="date" value={form.enrollmentDate} onChange={set('enrollmentDate')} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Discounts ─────────────────────────────────── */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Discounts &amp; scholarships</h2>
                <button onClick={() => setDiscounts((d) => [...d, { type: 'SIBLING', label: 'Sibling Discount', basis: 'PCT', value: '' }])}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {discounts.length === 0 && <p className="text-sm text-gray-400">None.</p>}
              {discounts.map((d, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end mb-2">
                  <div className="col-span-4 form-group mb-0">
                    <label className="label">Type</label>
                    <select className="input" value={d.type}
                            onChange={(e) => setDiscounts((x) => x.map((y, j) => j === i ? { ...y, type: e.target.value } : y))}>
                      {DISCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3 form-group mb-0">
                    <label className="label">Label</label>
                    <input className="input" value={d.label}
                           onChange={(e) => setDiscounts((x) => x.map((y, j) => j === i ? { ...y, label: e.target.value } : y))} />
                  </div>
                  <div className="col-span-2 form-group mb-0">
                    <label className="label">Basis</label>
                    <select className="input" value={d.basis}
                            onChange={(e) => setDiscounts((x) => x.map((y, j) => j === i ? { ...y, basis: e.target.value } : y))}>
                      <option value="PCT">% of tuition</option>
                      <option value="FIXED">Fixed ₱</option>
                    </select>
                  </div>
                  <div className="col-span-2 form-group mb-0">
                    <label className="label">Value</label>
                    <input className="input" type="number" step="0.01" value={d.value}
                           onChange={(e) => setDiscounts((x) => x.map((y, j) => j === i ? { ...y, value: e.target.value } : y))} />
                  </div>
                  <div className="col-span-1 pb-2">
                    <button onClick={() => setDiscounts((x) => x.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Subsidies ─────────────────────────────────── */}
          <div className="card">
            <div className="card-body">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">DepEd subsidies</h2>
                <button onClick={() => setSubsidies((s) => [...s, { type: 'ESC', referenceNo: '', amount: '' }])}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                A subsidy does not reduce revenue — it moves part of the receivable from the parent to DepEd.
              </p>
              {subsidies.length === 0 && <p className="text-sm text-gray-400">None.</p>}
              {subsidies.map((s, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-end mb-2">
                  <div className="col-span-4 form-group mb-0">
                    <label className="label">Programme</label>
                    <select className="input" value={s.type}
                            onChange={(e) => setSubsidies((x) => x.map((y, j) => j === i ? { ...y, type: e.target.value } : y))}>
                      {SUBSIDY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div className="col-span-4 form-group mb-0">
                    <label className="label">Reference No.</label>
                    <input className="input" value={s.referenceNo}
                           onChange={(e) => setSubsidies((x) => x.map((y, j) => j === i ? { ...y, referenceNo: e.target.value } : y))} />
                  </div>
                  <div className="col-span-3 form-group mb-0">
                    <label className="label">Amount</label>
                    <input className="input" type="number" step="0.01" value={s.amount}
                           onChange={(e) => setSubsidies((x) => x.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} />
                  </div>
                  <div className="col-span-1 pb-2">
                    <button onClick={() => setSubsidies((x) => x.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Live preview ────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="card sticky top-4">
            <div className="card-body">
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Calculator className="h-4 w-4" /> Assessment
                {previewing && <Loader2 className="h-3 w-3 animate-spin text-gray-400" />}
              </h2>

              {previewError && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
                  <AlertTriangle className="h-4 w-4 flex-none text-amber-600 mt-0.5" />
                  <span>{previewError}</span>
                </div>
              )}

              {!preview && !previewError && (
                <p className="text-sm text-gray-400 py-6 text-center">
                  Pick a student, school year, grade level, and payment plan.
                </p>
              )}

              {preview && (
                <>
                  <table className="w-full text-sm mb-3">
                    <tbody className="divide-y dark:divide-gray-700">
                      {preview.lines.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1.5">{l.description}
                            {l.vatCode === 'VAT' && <span className="badge badge-yellow ml-2 text-[10px]">VAT</span>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(l.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td className="py-2">Gross assessment</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(preview.grossAmount)}</td>
                      </tr>
                      {preview.discountAmount > 0 && (
                        <tr className="text-green-700 dark:text-green-400">
                          <td className="py-1.5">Less: discounts</td>
                          <td className="py-1.5 text-right tabular-nums">({formatCurrency(preview.discountAmount)})</td>
                        </tr>
                      )}
                      {preview.subsidyAmount > 0 && (
                        <tr className="text-blue-700 dark:text-blue-400">
                          <td className="py-1.5">Less: DepEd subsidy</td>
                          <td className="py-1.5 text-right tabular-nums">({formatCurrency(preview.subsidyAmount)})</td>
                        </tr>
                      )}
                      <tr className="font-semibold text-base border-t-2 dark:border-gray-600">
                        <td className="py-2">Payable by parent</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(preview.netPayable)}</td>
                      </tr>
                    </tbody>
                  </table>

                  <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Payment schedule</p>
                  <table className="w-full text-xs mb-4">
                    <tbody className="divide-y dark:divide-gray-700">
                      {preview.schedule.map((s) => (
                        <tr key={s.seq}>
                          <td className="py-1.5">{s.label}</td>
                          <td className="py-1.5 text-gray-500">{formatDate(s.dueDate)}</td>
                          <td className="py-1.5 text-right tabular-nums font-medium">{formatCurrency(s.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button onClick={enroll} disabled={saving}
                          className="btn-primary w-full flex items-center justify-center gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    {saving ? 'Enrolling…' : 'Enroll & create assessment'}
                  </button>
                  <p className="text-[11px] text-gray-500 mt-2 text-center">
                    Creates a draft. Nothing posts to the ledger until you issue it.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
