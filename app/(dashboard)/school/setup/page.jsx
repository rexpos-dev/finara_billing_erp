'use client';
import { useState, useEffect, useCallback } from 'react';
import { school as sApi, accounts as aApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Loader2, Plus, Calendar, Layers, Users, Receipt, Wallet, Copy, Save, Trash2,
  Scale, Upload, AlertTriangle, CheckCircle2, Lock, FileSpreadsheet, Download,
} from 'lucide-react';

const TABS = [
  { key: 'years',      label: 'School Years',    icon: Calendar },
  { key: 'levels',     label: 'Grade Levels',    icon: Layers },
  { key: 'sections',   label: 'Sections',        icon: Users },
  { key: 'feeTypes',   label: 'Fee Types',       icon: Receipt },
  { key: 'structures', label: 'Fee Structures',  icon: Wallet },
  { key: 'schemes',    label: 'Payment Plans',   icon: Wallet },
  { key: 'policy',     label: 'Revenue Policy',  icon: Scale },
  { key: 'import',     label: 'Import Students', icon: Upload },
];

export default function SchoolSetupPage() {
  const [tab, setTab] = useState('years');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">School Setup</h1>
          <p className="page-subtitle">Reference data the rest of the module builds on.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b dark:border-gray-700 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 whitespace-nowrap -mb-px ${
              tab === t.key ? 'border-blue-600 text-blue-600 font-medium'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'years'      && <SchoolYears />}
      {tab === 'levels'     && <GradeLevels />}
      {tab === 'sections'   && <Sections />}
      {tab === 'feeTypes'   && <FeeTypes />}
      {tab === 'structures' && <FeeStructures />}
      {tab === 'schemes'    && <PaymentSchemes />}
      {tab === 'policy'     && <RevenuePolicy />}
      {tab === 'import'     && <ImportStudents />}
    </div>
  );
}

// ── Revenue policy ─────────────────────────────────────────────────────────
function RevenuePolicy() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setState((await sApi.revenuePolicy.get()).data); }
    catch { toast.error('Could not load the revenue policy'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const choose = async (value) => {
    if (value === state.policy) return;
    setSaving(true);
    try {
      const { data } = await sApi.revenuePolicy.set({ policy: value });
      toast.success(data.message);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not change the policy');
    } finally { setSaving(false); }
  };

  if (loading) return <Spinner />;
  if (!state) return null;

  return (
    <>
      {state.locked && (
        <div className="card mb-4 border-amber-300 dark:border-amber-800"><div className="card-body flex gap-3">
          <Lock className="h-5 w-5 flex-none text-amber-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">This policy is locked.</p>
            <p className="text-gray-500">
              {state.issuedCount} assessment{state.issuedCount === 1 ? ' has' : 's have'} already been issued
              under it. The two policies post fundamentally different entries, so switching now would leave
              revenue either double-counted or never recognised. Cancel the outstanding assessments, or wait
              until the school year closes.
            </p>
          </div>
        </div></div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {state.options.map((o) => {
          const active = o.value === state.policy;
          return (
            <button
              key={o.value}
              onClick={() => choose(o.value)}
              disabled={saving || state.locked || active}
              className={`card text-left transition ${
                active ? 'border-blue-500 border-2' : 'hover:border-gray-300 dark:hover:border-gray-600'
              } ${state.locked && !active ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="card-body">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h3 className="font-semibold">{o.label}</h3>
                  {active && (
                    <span className="badge badge-green flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> In use
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{o.description}</p>
                <p className="text-xs font-mono text-gray-400 mt-3">{o.value}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="card mt-4"><div className="card-body text-sm text-gray-500">
        <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">What changes</p>
        <p className="mb-2">
          Under <strong>defer and amortise</strong>, the receivable control account holds the whole year
          while the invoice subledger holds only what has been billed so far. Those two figures do not agree
          by design, so the delinquency report reads the installment schedule instead of invoices, and
          <strong> School → Revenue Recognition</strong> becomes the screen that moves deferred income into revenue.
        </p>
        <p>
          Under <strong>recognise as billed</strong>, invoices are the receivable and there is no deferred
          balance to maintain.
        </p>
      </div></div>
    </>
  );
}

// ── Student roster import ──────────────────────────────────────────────────
/**
 * Parse a CSV into row objects.
 *
 * Handles quoted fields containing commas and escaped quotes, because a
 * Philippine address ("123 Rizal St., Tagum City") breaks a naive split and
 * would silently shift every column after it.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const IMPORT_COLUMNS = [
  'lastName', 'firstName', 'middleName', 'suffix', 'lrn', 'birthDate', 'gender',
  'address', 'contactPhone', 'email', 'guardianName', 'guardianRelationship', 'guardianPhone',
];

function ImportStudents() {
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [check, setCheck] = useState(null);
  const [done, setDone] = useState(null);

  const reset = () => { setRows([]); setFileName(''); setCheck(null); setDone(null); setParseError(null); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    setFileName(file.name);
    try {
      const text = await file.text();
      const grid = parseCsv(text);
      if (grid.length < 2) throw new Error('The file has a header row but no data rows.');

      const header = grid[0].map((h) => h.trim());
      const missing = ['lastName', 'firstName'].filter((c) => !header.includes(c));
      if (missing.length) {
        throw new Error(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
                        `The header row must use these exact names.`);
      }

      const parsed = grid.slice(1).map((cells) => {
        const obj = {};
        header.forEach((h, i) => {
          if (IMPORT_COLUMNS.includes(h)) {
            const v = (cells[i] ?? '').trim();
            if (v) obj[h] = v;
          }
        });
        return obj;
      });
      setRows(parsed);
    } catch (err) {
      setParseError(err.message);
      setRows([]);
    }
  };

  const dryRun = async () => {
    setChecking(true); setCheck(null);
    try {
      const { data } = await sApi.students.import({ rows, dryRun: true });
      setCheck({ ok: true, ...data });
    } catch (err) {
      const d = err.response?.data;
      setCheck({ ok: false, error: d?.error || 'Validation failed', details: d?.details || [], skipped: d?.skipped ?? 0 });
    } finally { setChecking(false); }
  };

  const commit = async () => {
    setImporting(true);
    try {
      const { data } = await sApi.students.import({ rows });
      setDone(data);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.error || 'The import failed');
    } finally { setImporting(false); }
  };

  const template = () => {
    const csv = IMPORT_COLUMNS.join(',') + '\n' +
      'Dela Cruz,Juan,Santos,,123456789012,2013-05-14,Male,"123 Rizal St., Tagum City",09171234567,,Maria Dela Cruz,Mother,09181234567\n';
    // A blob URL download is blocked in some embedded viewers, so open the CSV
    // in a new tab as a fallback the browser will always honour.
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'student-import-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold mb-1">Import a student roster</h3>
            <p className="text-sm text-gray-500">
              CSV with a header row. <code className="text-xs">lastName</code> and{' '}
              <code className="text-xs">firstName</code> are required; everything else is optional.
              Rows whose LRN is already on file are skipped, never duplicated.
            </p>
          </div>
          <button onClick={template} className="btn-secondary flex items-center gap-2 whitespace-nowrap">
            <Download className="h-4 w-4" /> Template
          </button>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <label className="btn-secondary flex items-center gap-2 cursor-pointer">
            <FileSpreadsheet className="h-4 w-4" />
            {fileName || 'Choose CSV file'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </label>
          {rows.length > 0 && (
            <>
              <span className="text-sm text-gray-500">{rows.length} rows read</span>
              <button onClick={dryRun} disabled={checking} className="btn-secondary flex items-center gap-2">
                {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Check file
              </button>
            </>
          )}
          {fileName && <button onClick={reset} className="text-xs text-gray-500 hover:underline">Clear</button>}
        </div>

        <p className="text-xs text-gray-400 mt-3">
          Recognised columns: {IMPORT_COLUMNS.join(', ')}
        </p>
      </div></div>

      {parseError && (
        <div className="card mb-4 border-red-300 dark:border-red-800"><div className="card-body flex gap-3">
          <AlertTriangle className="h-5 w-5 flex-none text-red-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">This file could not be read.</p>
            <p className="text-gray-500">{parseError}</p>
          </div>
        </div></div>
      )}

      {check && !check.ok && (
        <div className="card mb-4 border-red-300 dark:border-red-800"><div className="card-body">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 flex-none text-red-600 mt-0.5" />
            <div className="text-sm flex-1">
              <p className="font-medium">{check.error}</p>
              <p className="text-gray-500 mb-2">Nothing was imported. Fix these rows and choose the file again.</p>
              <ul className="space-y-0.5 text-xs text-gray-600 dark:text-gray-400">
                {check.details.map((d, i) => <li key={i}>Row {d.line}: {d.error}</li>)}
              </ul>
            </div>
          </div>
        </div></div>
      )}

      {check?.ok && !done && (
        <div className="card mb-4 border-blue-300 dark:border-blue-800"><div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">
                {check.wouldCreate} student{check.wouldCreate === 1 ? '' : 's'} ready to import
              </p>
              <p className="text-gray-500">
                {check.skipped > 0
                  ? `${check.skipped} already on file (matched by LRN) and will be skipped.`
                  : 'No duplicates found.'}
              </p>
            </div>
            <button onClick={commit} disabled={importing || check.wouldCreate === 0}
                    className="btn-primary flex items-center gap-2">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import {check.wouldCreate} student{check.wouldCreate === 1 ? '' : 's'}
            </button>
          </div>
        </div></div>
      )}

      {done && (
        <div className="card mb-4 border-green-300 dark:border-green-800"><div className="card-body flex gap-3">
          <CheckCircle2 className="h-5 w-5 flex-none text-green-600 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">{done.message}</p>
            <p className="text-gray-500">Each one now has a student number and a linked customer record.</p>
          </div>
        </div></div>
      )}

      {rows.length > 0 && (
        <div className="card"><div className="card-body p-0">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-gray-900">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                  <th className="px-4 py-3">#</th><th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">LRN</th><th className="px-4 py-3">Birth date</th>
                  <th className="px-4 py-3">Guardian</th><th className="px-4 py-3">Contact</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                    <td className="px-4 py-2">
                      {[r.lastName, r.firstName].filter(Boolean).join(', ')}
                      {r.middleName ? ` ${r.middleName}` : ''}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{r.lrn || '—'}</td>
                    <td className="px-4 py-2">{r.birthDate || '—'}</td>
                    <td className="px-4 py-2">{r.guardianName || '—'}</td>
                    <td className="px-4 py-2">{r.contactPhone || r.guardianPhone || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && (
            <p className="px-4 py-2 text-xs text-gray-500 border-t dark:border-gray-700">
              Showing the first 200 of {rows.length} rows. All of them will be imported.
            </p>
          )}
        </div></div>
      )}
    </>
  );
}

// ── School years ───────────────────────────────────────────────────────────
function SchoolYears() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', name: '', startDate: '', endDate: '', isCurrent: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems((await sApi.schoolYears.list()).data); }
    catch { toast.error('Could not load school years'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await sApi.schoolYears.create(form);
      toast.success('School year added');
      setForm({ code: '', name: '', startDate: '', endDate: '', isCurrent: false });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  const setCurrent = async (y) => {
    try { await sApi.schoolYears.update(y.id, { isCurrent: true }); toast.success(`${y.code} is now current`); load(); }
    catch { toast.error('Could not update'); }
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">Code *</label>
            <input className="input" required placeholder="SY2026-2027"
                   value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Name *</label>
            <input className="input" required placeholder="School Year 2026–2027"
                   value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Starts *</label>
            <input className="input" type="date" required
                   value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Ends *</label>
            <input className="input" type="date" required
                   value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
          <button className="btn-primary flex items-center justify-center gap-2" disabled={saving}>
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>
      </div></div>

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['Code', 'Name', 'Starts', 'Ends', 'Current', '']}>
            {items.map((y) => (
              <tr key={y.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{y.code}</td>
                <td className="px-4 py-2.5">{y.name}</td>
                <td className="px-4 py-2.5">{formatDate(y.startDate)}</td>
                <td className="px-4 py-2.5">{formatDate(y.endDate)}</td>
                <td className="px-4 py-2.5">{y.isCurrent && <span className="badge badge-green">Current</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  {!y.isCurrent && (
                    <button onClick={() => setCurrent(y)} className="text-xs text-blue-600 hover:underline">
                      Make current
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Grade levels ───────────────────────────────────────────────────────────
function GradeLevels() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', name: '', stage: 'ELEMENTARY', sortOrder: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems((await sApi.gradeLevels.list()).data); }
    catch { toast.error('Could not load grade levels'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await sApi.gradeLevels.create(form);
      toast.success('Grade level added');
      setForm({ code: '', name: '', stage: 'ELEMENTARY', sortOrder: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">Code *</label>
            <input className="input" required placeholder="G7" value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Name *</label>
            <input className="input" required placeholder="Grade 7" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Stage *</label>
            <select className="input" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
              {['PRESCHOOL', 'ELEMENTARY', 'JHS', 'SHS'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Sort</label>
            <input className="input" type="number" value={form.sortOrder}
                   onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </div>
          <button className="btn-primary flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </div></div>

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['Code', 'Name', 'Stage', 'Sort', 'Active']}>
            {items.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{l.code}</td>
                <td className="px-4 py-2.5">{l.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{l.stage}</td>
                <td className="px-4 py-2.5 tabular-nums">{l.sortOrder}</td>
                <td className="px-4 py-2.5">
                  <span className={`badge ${l.isActive ? 'badge-green' : 'badge-yellow'}`}>
                    {l.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────
function Sections() {
  const [items, setItems] = useState([]);
  const [years, setYears] = useState([]);
  const [levels, setLevels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ schoolYearId: '', gradeLevelId: '', name: '', adviser: '', capacity: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, y, l] = await Promise.all([sApi.sections.list(), sApi.schoolYears.list(), sApi.gradeLevels.list()]);
      setItems(s.data); setYears(y.data); setLevels(l.data.filter((x) => x.isActive));
      const current = y.data.find((x) => x.isCurrent);
      if (current) setForm((f) => ({ ...f, schoolYearId: f.schoolYearId || String(current.id) }));
    } catch { toast.error('Could not load sections'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await sApi.sections.create(form);
      toast.success('Section added');
      setForm({ ...form, name: '', adviser: '', capacity: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">School Year *</label>
            <select className="input" required value={form.schoolYearId}
                    onChange={(e) => setForm({ ...form, schoolYearId: e.target.value })}>
              <option value="">Select…</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Grade Level *</label>
            <select className="input" required value={form.gradeLevelId}
                    onChange={(e) => setForm({ ...form, gradeLevelId: e.target.value })}>
              <option value="">Select…</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Name *</label>
            <input className="input" required placeholder="St. Ignatius" value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Adviser</label>
            <input className="input" value={form.adviser}
                   onChange={(e) => setForm({ ...form, adviser: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Capacity</label>
            <input className="input" type="number" value={form.capacity}
                   onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
          </div>
          <button className="btn-primary flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </div></div>

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['School Year', 'Grade', 'Section', 'Adviser', 'Enrolled']}>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{s.schoolYear.code}</td>
                <td className="px-4 py-2.5">{s.gradeLevel.name}</td>
                <td className="px-4 py-2.5 font-medium">{s.name}</td>
                <td className="px-4 py-2.5">{s.adviser || '—'}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {s.enrolledCount}{s.capacity ? ` / ${s.capacity}` : ''}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Fee types ──────────────────────────────────────────────────────────────
function FeeTypes() {
  const [items, setItems] = useState([]);
  const [revenueAccounts, setRevenueAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ code: '', name: '', category: 'MISCELLANEOUS', accountId: '', vatCode: 'EXEMPT' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, a] = await Promise.all([sApi.feeTypes.list(), aApi.list({ type: 'REVENUE' })]);
      setItems(f.data);
      const list = Array.isArray(a.data) ? a.data : (a.data.items || []);
      setRevenueAccounts(list.filter((x) => x.isActive !== false));
    } catch { toast.error('Could not load fee types'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await sApi.feeTypes.create(form);
      toast.success('Fee type added');
      setForm({ code: '', name: '', category: 'MISCELLANEOUS', accountId: '', vatCode: 'EXEMPT' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <p className="text-xs text-gray-500 mb-3">
          Tuition and school fees are VAT-exempt under Sec. 109(H) NIRC. Books and uniforms are sales
          of goods and stay VATable — set the VAT code here, not on the invoice.
        </p>
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">Code *</label>
            <input className="input" required value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Name *</label>
            <input className="input" required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Category *</label>
            <select className="input" value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {['TUITION', 'MISCELLANEOUS', 'BOOKS', 'UNIFORM', 'OTHER'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Revenue Account *</label>
            <select className="input" required value={form.accountId}
                    onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
              <option value="">Select…</option>
              {revenueAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
              ))}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">VAT *</label>
            <select className="input" value={form.vatCode}
                    onChange={(e) => setForm({ ...form, vatCode: e.target.value })}>
              <option value="EXEMPT">Exempt</option>
              <option value="VAT">VATable</option>
              <option value="ZERO">Zero-rated</option>
            </select>
          </div>
          <button className="btn-primary flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </div></div>

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['Code', 'Name', 'Category', 'Account', 'VAT']}>
            {items.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{f.code}</td>
                <td className="px-4 py-2.5">{f.name}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{f.category}</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {f.account.accountCode} — {f.account.accountName}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`badge ${f.vatCode === 'VAT' ? 'badge-yellow' : 'badge-green'}`}>{f.vatCode}</span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Fee structures ─────────────────────────────────────────────────────────
function FeeStructures() {
  const [items, setItems] = useState([]);
  const [years, setYears] = useState([]);
  const [levels, setLevels] = useState([]);
  const [feeTypes, setFeeTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schoolYearId, setSchoolYearId] = useState('');

  const [editing, setEditing] = useState(null);
  const [cloneFrom, setCloneFrom] = useState('');
  const [cloneTo, setCloneTo] = useState('');
  const [increase, setIncrease] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [y, l, f] = await Promise.all([sApi.schoolYears.list(), sApi.gradeLevels.list(), sApi.feeTypes.list()]);
      setYears(y.data); setLevels(l.data.filter((x) => x.isActive)); setFeeTypes(f.data.filter((x) => x.isActive));
      const current = y.data.find((x) => x.isCurrent);
      const yId = schoolYearId || (current ? String(current.id) : '');
      setSchoolYearId(yId);
      const { data } = await sApi.feeStructures.list(yId ? { schoolYearId: yId } : {});
      setItems(data);
    } catch { toast.error('Could not load fee structures'); }
    finally { setLoading(false); }
  }, [schoolYearId]);
  useEffect(() => { load(); }, [load]);

  const startEdit = (gradeLevelId, existing) => {
    setEditing({
      gradeLevelId: String(gradeLevelId),
      name: existing?.name || `${levels.find((l) => l.id === gradeLevelId)?.name} — ${years.find((y) => String(y.id) === schoolYearId)?.code}`,
      lines: existing?.lines.map((l) => ({
        feeTypeId: String(l.feeTypeId), amount: String(l.amount), billingBasis: l.billingBasis,
      })) || feeTypes.map((f) => ({
        feeTypeId: String(f.id), amount: '',
        billingBasis: ['TUITION', 'MISCELLANEOUS'].includes(f.category) ? 'ANNUAL' : 'ONE_TIME',
      })),
    });
  };

  const save = async () => {
    // Without a year picked, Number('') is 0 and the save posts a school year
    // id that cannot exist — which reached the registrar as a raw foreign-key
    // error. Nothing auto-selects when no year is marked current, so this is
    // reachable on a school whose years are all still flagged not-current.
    if (!schoolYearId) return toast.error('Pick a school year first');
    try {
      await sApi.feeStructures.save({
        schoolYearId: Number(schoolYearId),
        gradeLevelId: Number(editing.gradeLevelId),
        name: editing.name,
        lines: editing.lines
          .filter((l) => Number(l.amount) > 0)
          .map((l) => ({ feeTypeId: Number(l.feeTypeId), amount: Number(l.amount), billingBasis: l.billingBasis })),
      });
      toast.success('Fee structure saved');
      setEditing(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };

  const clone = async () => {
    if (!cloneFrom || !cloneTo) return toast.error('Pick both school years');
    try {
      const { data } = await sApi.feeStructures.clone({
        fromSchoolYearId: Number(cloneFrom),
        toSchoolYearId: Number(cloneTo),
        increasePct: increase ? Number(increase) : 0,
      });
      toast.success(data.message);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not copy'); }
  };

  const editingTotal = editing
    ? editing.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    : 0;

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">School Year</label>
            <select className="input" value={schoolYearId} onChange={(e) => setSchoolYearId(e.target.value)}>
              {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <div className="form-group mb-0">
            <label className="label">Copy from</label>
            <select className="input" value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
              <option value="">Select…</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Copy to</label>
            <select className="input" value={cloneTo} onChange={(e) => setCloneTo(e.target.value)}>
              <option value="">Select…</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
            </select>
          </div>
          <div className="form-group mb-0">
            <label className="label">Increase %</label>
            <input className="input w-24" type="number" step="0.1" value={increase}
                   onChange={(e) => setIncrease(e.target.value)} placeholder="0" />
          </div>
          <button onClick={clone} className="btn-secondary flex items-center gap-2">
            <Copy className="h-4 w-4" /> Copy year
          </button>
        </div>
      </div></div>

      {editing && (
        <div className="card mb-4 border-blue-300 dark:border-blue-800"><div className="card-body">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">{editing.name}</h3>
            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
              <button onClick={save} className="btn-primary flex items-center gap-2">
                <Save className="h-4 w-4" /> Save structure
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                  <th className="py-2">Fee</th><th className="py-2">Billing</th><th className="py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {editing.lines.map((l, i) => {
                  const ft = feeTypes.find((f) => String(f.id) === l.feeTypeId);
                  return (
                    <tr key={l.feeTypeId}>
                      <td className="py-2">
                        {ft?.name}
                        {ft?.vatCode === 'VAT' && <span className="badge badge-yellow ml-2 text-[10px]">VAT</span>}
                      </td>
                      <td className="py-2">
                        <select className="input py-1 text-xs w-36" value={l.billingBasis}
                                onChange={(e) => setEditing((x) => ({
                                  ...x, lines: x.lines.map((y, j) => j === i ? { ...y, billingBasis: e.target.value } : y),
                                }))}>
                          <option value="ANNUAL">Spread over year</option>
                          <option value="ONE_TIME">On enrollment</option>
                        </select>
                      </td>
                      <td className="py-2 text-right">
                        <input className="input py-1 text-right w-32 tabular-nums" type="number" step="0.01"
                               value={l.amount} placeholder="0.00"
                               onChange={(e) => setEditing((x) => ({
                                 ...x, lines: x.lines.map((y, j) => j === i ? { ...y, amount: e.target.value } : y),
                               }))} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className="py-2" colSpan={2}>Total</td>
                  <td className="py-2 text-right tabular-nums">{formatCurrency(editingTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div></div>
      )}

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['Grade Level', 'Structure', 'Fee lines', 'Total', '']}>
            {levels.map((l) => {
              const existing = items.find((i) => i.gradeLevelId === l.id);
              return (
                <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-2.5 font-medium">{l.name}</td>
                  <td className="px-4 py-2.5">
                    {existing ? existing.name : <span className="text-gray-400">Not set up</span>}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{existing?.lines.length || 0}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {existing ? formatCurrency(existing.totalAmount) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => startEdit(l.id, existing)} className="text-xs text-blue-600 hover:underline">
                      {existing ? 'Edit' : 'Set up'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Payment schemes ────────────────────────────────────────────────────────
function PaymentSchemes() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    code: '', name: '', installmentCount: 10, downPaymentAmount: '', discountPct: '', surchargePct: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems((await sApi.paymentSchemes.list()).data); }
    catch { toast.error('Could not load payment plans'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    try {
      await sApi.paymentSchemes.create(form);
      toast.success('Payment plan added');
      setForm({ code: '', name: '', installmentCount: 10, downPaymentAmount: '', discountPct: '', surchargePct: '' });
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not save'); }
  };

  return (
    <>
      <div className="card mb-4"><div className="card-body">
        <p className="text-xs text-gray-500 mb-3">
          The discount applies to the tuition portion only — the way schools quote a cash discount.
        </p>
        <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-7 gap-3 items-end">
          <div className="form-group mb-0">
            <label className="label">Code *</label>
            <input className="input" required value={form.code}
                   onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>
          <div className="form-group mb-0 md:col-span-2">
            <label className="label">Name *</label>
            <input className="input" required value={form.name}
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Installments *</label>
            <input className="input" type="number" min="1" required value={form.installmentCount}
                   onChange={(e) => setForm({ ...form, installmentCount: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Down payment</label>
            <input className="input" type="number" step="0.01" value={form.downPaymentAmount}
                   onChange={(e) => setForm({ ...form, downPaymentAmount: e.target.value })} />
          </div>
          <div className="form-group mb-0">
            <label className="label">Discount %</label>
            <input className="input" type="number" step="0.01" value={form.discountPct}
                   onChange={(e) => setForm({ ...form, discountPct: e.target.value })} />
          </div>
          <button className="btn-primary flex items-center justify-center gap-2"><Plus className="h-4 w-4" /> Add</button>
        </form>
      </div></div>

      <div className="card"><div className="card-body p-0">
        {loading ? <Spinner /> : (
          <Table headers={['Code', 'Name', 'Installments', 'Down payment', 'Discount', 'Surcharge']}>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5 font-mono text-xs">{s.code}</td>
                <td className="px-4 py-2.5">{s.name}</td>
                <td className="px-4 py-2.5 tabular-nums">{s.installmentCount}</td>
                <td className="px-4 py-2.5 tabular-nums">{formatCurrency(s.downPaymentAmount)}</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(s.discountPct)}%</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(s.surchargePct)}%</td>
              </tr>
            ))}
          </Table>
        )}
      </div></div>
    </>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────────
function Spinner() {
  return <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div>;
}

function Table({ headers, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
            {headers.map((h, i) => <th key={i} className="px-4 py-3">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y dark:divide-gray-700">{children}</tbody>
      </table>
    </div>
  );
}
