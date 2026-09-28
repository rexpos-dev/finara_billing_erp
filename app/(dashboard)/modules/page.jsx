'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { MODULES, setDisabledModules } from '@/lib/permissions';
import { permissions as permApi } from '@/lib/api';
import { getUser } from '@/lib/auth';

const DESCRIPTIONS = {
  dashboard:  'Overview, alerts and the getting-started checklist.',
  accounts:   'Chart of accounts for the business.',
  journal:    'General ledger and journal entries.',
  recurring:  'Journal entries that repeat on a schedule.',
  receivable: 'Customers, invoices, quotations and cash sales.',
  school:     'Students, assessments, fees and school billing.',
  payable:    'Vendors, bills, purchase orders, expenses and cash requests.',
  payroll:    'Employees, payroll periods, SSS / PhilHealth / Pag-IBIG.',
  inventory:  'Stock items, categories and stock movements.',
  assets:     'Fixed assets and depreciation.',
  bank:       'Bank accounts and reconciliation.',
  bir:        'BIR forms and tax compliance.',
  remittance: 'Government remittances and daily remittances.',
  budget:     'Budgets versus actuals.',
  reports:    'Financial and management reports.',
  audit:      'Who did what, and when.',
  settings:   'Users, permissions, company settings and this page.',
};

const Switch = ({ on, disabled, onClick, label }) => (
  <button
    type="button" role="switch" aria-checked={on} aria-label={label}
    disabled={disabled} onClick={onClick}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`}
  >
    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

export default function ModulesPage() {
  const router = useRouter();
  const [allowed, setAllowed]       = useState(false);
  const [disabled, setDisabled]     = useState(null); // string[] | null while loading
  const [adminExempt, setExempt]    = useState(false);
  const [saving, setSaving]         = useState(false);

  // Only a SUPER_ADMIN may change this (the API enforces it as well).
  useEffect(() => {
    if (getUser()?.role !== 'SUPER_ADMIN') { router.replace('/dashboard'); return; }
    setAllowed(true);
    permApi.getDisabled()
      .then(({ data }) => { setDisabled(data.disabled); setExempt(!!data.adminExempt); })
      .catch(() => toast.error('Failed to load modules'));
  }, [router]);

  // Save immediately, update the nav live, and roll back if the server refuses.
  async function save(nextDisabled, nextExempt) {
    const prev = { disabled, adminExempt };
    setDisabled(nextDisabled); setExempt(nextExempt); setSaving(true);
    try {
      const { data } = await permApi.saveDisabled({ disabled: nextDisabled, adminExempt: nextExempt });
      setDisabled(data.disabled); setExempt(data.adminExempt);
      setDisabledModules(data.disabled, data.adminExempt);
      return true;
    } catch (err) {
      setDisabled(prev.disabled); setExempt(prev.adminExempt);
      toast.error(err.response?.data?.error || 'Could not save');
      return false;
    } finally { setSaving(false); }
  }

  const toggle = async (m) => {
    const off = disabled.includes(m.key);
    const ok = await save(off ? disabled.filter((k) => k !== m.key) : [...disabled, m.key], adminExempt);
    if (ok) toast.success(`${m.label} ${off ? 'enabled' : 'disabled'}`);
  };

  if (!allowed) return null;

  const enabledCount = disabled ? MODULES.filter((m) => !disabled.includes(m.key)).length : 0;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Modules</h1>
          <p className="page-subtitle">
            Turn a module off to remove it from the navigation and block its pages for everyone.
            Nothing is deleted — turn it back on and everything returns.
          </p>
        </div>
        {disabled && <span className="badge-blue whitespace-nowrap flex-shrink-0">{enabledCount} of {MODULES.length} enabled</span>}
      </div>

      {!disabled ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading modules…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {MODULES.map((m) => {
              const locked = !!m.noDisable;
              const on = locked || !disabled.includes(m.key);
              return (
                <div key={m.key} className={`card ${on ? '' : 'opacity-70'}`}>
                  <div className="card-body flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{m.label}</p>
                        <span className={on ? 'badge-green' : 'badge-red'}>{on ? 'Enabled' : 'Disabled'}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{DESCRIPTIONS[m.key]}</p>
                      {locked && (
                        <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Always on
                        </p>
                      )}
                    </div>
                    <Switch on={on} disabled={locked || saving} label={`${m.label} module`} onClick={() => toggle(m)} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card">
            <div className="card-body flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900 dark:text-gray-100">Exempt Admin from disabled modules</p>
                <p className="text-xs text-gray-500 mt-1">
                  When on, the Admin role still sees every module even if it is disabled here — the same as
                  Super Admin. Off by default, so Admin is restricted like every other role.
                </p>
              </div>
              <Switch on={adminExempt} disabled={saving} label="Exempt Admin"
                onClick={() => save(disabled, !adminExempt)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
