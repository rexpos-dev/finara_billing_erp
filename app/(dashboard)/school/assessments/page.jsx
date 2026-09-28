'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { school as sApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Search, FileText, Loader2, ChevronRight } from 'lucide-react';

const STATUS_BADGE = {
  DRAFT: 'badge-yellow', ISSUED: 'badge-blue', SETTLED: 'badge-green', CANCELLED: 'badge-red',
};

export default function AssessmentsPage() {
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [years, setYears] = useState([]);
  const [schoolYearId, setSchoolYearId] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { sApi.schoolYears.list().then(({ data }) => setYears(data)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.assessments.list({
        search: search || undefined,
        status: status || undefined,
        schoolYearId: schoolYearId || undefined,
        page, limit: 25,
      });
      setData(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load assessments');
    } finally {
      setLoading(false);
    }
  }, [search, status, schoolYearId, page]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Assessments</h1>
          <p className="page-subtitle">{data.total} on record</p>
        </div>
        <Link href="/school/enrollment" className="btn-primary">New enrollment</Link>
      </div>

      <div className="card mb-4">
        <div className="card-body flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input className="input pl-9" placeholder="Assessment number or student…"
                   value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="input w-auto" value={schoolYearId} onChange={(e) => { setSchoolYearId(e.target.value); setPage(1); }}>
            <option value="">All school years</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {['DRAFT', 'ISSUED', 'SETTLED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>
          ) : data.items.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <FileText className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No assessments yet</p>
              <p className="text-sm">Enroll a student to create one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Assessment</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Grade</th>
                    <th className="px-4 py-3">Plan</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3 text-right">Billed</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {data.items.map((a) => (
                    <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 font-mono text-xs">{a.assessmentNo}</td>
                      <td className="px-4 py-3 font-medium">{a.studentLabel}</td>
                      <td className="px-4 py-3">{a.enrollment.gradeLevel.name}</td>
                      <td className="px-4 py-3 text-xs">{a.enrollment.paymentScheme.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(a.netAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(a.billedAmount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(a.paidAmount)}</td>
                      <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span></td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/school/assessments/${a.id}`} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs">
                          Open <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data.pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">Page {page} of {data.pages}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-secondary" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
