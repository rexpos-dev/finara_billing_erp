'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Users, Check, X, Building2, Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { businesses as bizApi, settings as settingsApi } from '@/lib/api';
import { getUser } from '@/lib/auth';

// ── helpers ──────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────
export default function BusinessesPage() {
  const [list,    setList]    = useState([]);
  const [users,   setUsers]   = useState([]);     // all system users
  const [loading, setLoading] = useState(true);

  // Modal state
  const [editBiz,    setEditBiz]    = useState(null);   // business object or 'new'
  const [manageId,   setManageId]   = useState(null);   // businessId for user mgmt
  const [bizUsers,   setBizUsers]   = useState([]);     // users in manageId business
  const [form,       setForm]       = useState({ code:'', name:'', tin:'', address:'', phone:'', email:'', companyType:'', taxType:'', booksStartDate:'' });
  const [resetBiz,    setResetBiz]    = useState(null);   // business object mid-confirm
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetting,   setResetting]   = useState(false);

  const me = getUser();
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(me?.role);
  const router = useRouter();

  async function load() {
    try {
      const [bRes, uRes] = await Promise.all([
        bizApi.list(),
        settingsApi.listUsers(),
      ]);
      setList(bRes.data);
      setUsers(uRes.data);
    } catch { toast.error('Failed to load data'); }
    finally  { setLoading(false); }
  }

  // Non-admins have their own page; don't fire the admin-only calls at all.
  useEffect(() => {
    if (!isAdmin) { router.replace('/my-businesses'); return; }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Business create/update ──────────────────────────────────
  function openCreate() {
    setForm({ code:'', name:'', tin:'', address:'', phone:'', email:'', companyType:'', taxType:'', booksStartDate:'' });
    setEditBiz('new');
  }

  function openEdit(biz) {
    setForm({ code: biz.code, name: biz.name, tin: biz.tin||'', address: biz.address||'', phone: biz.phone||'', email: biz.email||'', taxType: biz.taxType||'', booksStartDate: biz.booksStartDate?.split('T')[0] || '' });
    setEditBiz(biz);
  }

  async function saveBiz(e) {
    e.preventDefault();
    try {
      if (editBiz === 'new') {
        await bizApi.create(form);
        toast.success('Business created — chart of accounts set up');
      } else {
        await bizApi.update(editBiz.id, form);
        toast.success('Business updated');
      }
      setEditBiz(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  }

  // ── Demo data reset ────────────────────────────────────────────
  async function confirmResetDemo() {
    if (resetPhrase !== 'RESET DEMO') return;
    setResetting(true);
    try {
      const { data } = await bizApi.resetDemo();
      toast.success(data.message || 'Demo account reset');
      setResetBiz(null);
      setResetPhrase('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  // ── User access management ──────────────────────────────────
  async function openManage(bizId) {
    setManageId(bizId);
    try {
      const { data } = await bizApi.listUsers(bizId);
      setBizUsers(data);
    } catch { toast.error('Failed to load users'); }
  }

  const bizUserIds = new Set(bizUsers.map((u) => u.id));

  async function toggleUser(userId) {
    try {
      if (bizUserIds.has(userId)) {
        await bizApi.revokeUser(manageId, userId);
        toast.success('Access revoked');
      } else {
        await bizApi.grantUser(manageId, userId);
        toast.success('Access granted');
      }
      const { data } = await bizApi.listUsers(manageId);
      setBizUsers(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update access');
    }
  }

  // ── Render ──────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-2">
        <Building2 className="w-10 h-10" />
        <p className="text-sm">Admin access required</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Businesses</h1>
          <p className="page-subtitle">Manage businesses and user access for multi-business mode</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openCreate}>
          <Plus className="w-4 h-4" /> New Business
        </button>
      </div>

      {loading ? (
        <div className="card card-body text-center text-gray-400 py-16">Loading…</div>
      ) : (
        <div className="card">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800">
                {['Code','Name','Type','TIN','Status','Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
              {list.map((biz) => (
                <tr key={biz.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">{biz.code}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{biz.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{biz.industry || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{biz.tin || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${biz.isActive ? 'badge-green' : 'badge-red'}`}>
                      {biz.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(biz)} className="btn-secondary py-1 px-2 text-xs flex items-center gap-1">
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <button onClick={() => openManage(biz.id)} className="btn-secondary py-1 px-2 text-xs flex items-center gap-1">
                        <Users className="w-3 h-3" /> Users
                      </button>
                      {biz.code === 'DEMO' && (
                        <button
                          onClick={() => setResetBiz(biz)}
                          className="py-1 px-2 text-xs flex items-center gap-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-900/20"
                          title="Wipe demo transactions and reseed a clean baseline"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset Demo Data
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No businesses found</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Create / Edit modal */}
      {editBiz !== null && (
        <Modal title={editBiz === 'new' ? 'New Business' : `Edit — ${editBiz.name}`} onClose={() => setEditBiz(null)}>
          <form onSubmit={saveBiz} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Code *</label>
                <input className="input" placeholder="e.g. BIZ-A" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                  disabled={editBiz !== 'new'} required />
              </div>
              <div>
                <label className="label">Name *</label>
                <input className="input" placeholder="Business name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div>
                <label className="label">TIN</label>
                <input className="input" placeholder="000-000-000-000" value={form.tin} onChange={e => setForm(f => ({ ...f, tin: e.target.value }))} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <label className="label">Phone</label>
                <input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="label">Address</label>
                <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
              {editBiz === 'new' && (
                <div>
                  <label className="label">Company Type *</label>
                  <select className="input" required value={form.companyType}
                    onChange={e => setForm(f => ({ ...f, companyType: e.target.value }))}>
                    <option value="">Select a type…</option>
                    <option value="SCHOOL">School</option>
                    <option value="SERVICES">Services / Agency</option>
                    <option value="TRADING">Retail / Trading</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">
                    A School gets the school chart of accounts, fee types, grade levels and payment
                    schemes. Any other type has the School module hidden. This can&apos;t be changed later.
                  </p>
                </div>
              )}
              <div>
                <label className="label">Tax Registration</label>
                <select className="input" value={form.taxType}
                  onChange={e => setForm(f => ({ ...f, taxType: e.target.value }))}>
                  <option value="">Not specified</option>
                  <option value="VAT">VAT-registered</option>
                  <option value="NON_VAT">Non-VAT (percentage tax)</option>
                </select>
              </div>
              <div>
                <label className="label">Books Start Date</label>
                <input className="input" type="date" value={form.booksStartDate}
                  onChange={e => setForm(f => ({ ...f, booksStartDate: e.target.value }))} />
                <p className="text-[11px] text-gray-500 mt-1">
                  The first day this business keeps its books in Finara. Documents dated before
                  it are recorded for history only and never post to the general ledger —
                  leave blank if you have no cutover.
                </p>
              </div>
            </div>
            {editBiz === 'new' && (
              <p className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                The full Chart of Accounts will be automatically cloned from the default business.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditBiz(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Save Business</button>
            </div>
          </form>
        </Modal>
      )}

      {/* User access modal */}
      {manageId !== null && (
        <Modal title={`User Access — ${list.find(b => b.id === manageId)?.name}`} onClose={() => setManageId(null)}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Toggle to grant or revoke access for each user. ADMIN users always have full access.</p>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {users.map((u) => {
              const hasAccess = ['ADMIN', 'SUPER_ADMIN'].includes(u.role) || bizUserIds.has(u.id);
              const isForced  = ['ADMIN', 'SUPER_ADMIN'].includes(u.role);
              return (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-gray-400">{u.email} · {u.role}</p>
                  </div>
                  <button
                    onClick={() => !isForced && toggleUser(u.id)}
                    disabled={isForced}
                    className={`w-8 h-5 rounded-full transition-colors relative ${hasAccess ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${isForced ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    title={isForced ? 'Admin always has access' : (hasAccess ? 'Revoke access' : 'Grant access')}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${hasAccess ? 'translate-x-3' : ''}`} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end pt-4">
            <button className="btn-secondary" onClick={() => setManageId(null)}>Done</button>
          </div>
        </Modal>
      )}

      {/* Reset demo data modal */}
      {resetBiz !== null && (
        <Modal title={`Reset Demo Data — ${resetBiz.name}`} onClose={() => { setResetBiz(null); setResetPhrase(''); }}>
          <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-3 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300">
              This permanently deletes every invoice, bill, journal entry, expense voucher, and
              daily remittance in <b>{resetBiz.name}</b>, then rebuilds it with a fresh Chart of
              Accounts and sample customers/vendors/employees — <b>AR and AP will be empty</b>,
              ready for a live demo. This only ever affects the demo business — no other business
              is touched.
            </p>
          </div>
          <label className="label">Type <span className="font-mono font-semibold">RESET DEMO</span> to confirm</label>
          <input
            className="input font-mono"
            value={resetPhrase}
            onChange={(e) => setResetPhrase(e.target.value)}
            placeholder="RESET DEMO"
            autoFocus
          />
          <div className="flex justify-end gap-3 pt-4">
            <button className="btn-secondary" onClick={() => { setResetBiz(null); setResetPhrase(''); }}>Cancel</button>
            <button
              className="btn-danger"
              disabled={resetPhrase !== 'RESET DEMO' || resetting}
              onClick={confirmResetDemo}
            >
              {resetting ? 'Resetting…' : 'Reset Demo Data'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
