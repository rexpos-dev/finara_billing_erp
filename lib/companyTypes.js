// Company types offered at signup / onboarding. Keys must match
// server/utils/companyTypes.js — the server decides what each one sets up.
export const COMPANY_TYPES = [
  { key: 'SCHOOL',   label: 'School',            hint: 'Includes the School Billing module: tuition and fees, students, grade levels, payment schemes.' },
  { key: 'SERVICES', label: 'Services / Agency', hint: 'Bill clients for services; sales, purchases, and payroll. School Billing is turned off.' },
  { key: 'TRADING',  label: 'Retail / Trading',  hint: 'Buy and sell goods; inventory, sales, and purchases. School Billing is turned off.' },
  { key: 'OTHER',    label: 'Other',             hint: 'Start with the standard chart of accounts and set up your own way. School Billing is turned off.' },
];

// Chosen on the signup form, read again on /onboarding so it is asked only once.
const PENDING_KEY = 'pendingCompanyType';

export const setPendingCompanyType = (key) => {
  try { sessionStorage.setItem(PENDING_KEY, key); } catch { /* storage unavailable */ }
};

export const takePendingCompanyType = () => {
  try {
    const key = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    return COMPANY_TYPES.some((t) => t.key === key) ? key : '';
  } catch { return ''; }
};
