// Company types offered at self-service onboarding. `industry` on the business
// stores the label; the key drives what gets set up.
//
// Only SCHOOL has type-specific setup today (school COA, fee types, grade
// levels, payment schemes). Every other type gets the default cloned COA and
// has the School module switched off, since it would only get in the way.
const COMPANY_TYPES = {
  SCHOOL:   { label: 'School' },
  SERVICES: { label: 'Services / Agency' },
  TRADING:  { label: 'Retail / Trading' },
  OTHER:    { label: 'Other' },
};

// The default COA already carries the retail/trading accounts (1210 Merchandise
// Inventory, 4200-4250 sales, 5010-5014 COGS and purchases) and the inventory
// module posts to them. What a trading company doesn't want is the
// advertising-agency set, so onboarding deactivates it. Deactivated, never
// deleted, so it can be turned back on from the Chart of Accounts.
const TRADING_RETIRE_CODES = [
  '1220', '1230',                                                      // agency materials / production supplies
  '4100', '4110', '4120', '4130', '4131', '4132', '4133', '4140',
  '4150', '4160', '4170', '4171', '4172', '4173', '4180', '4190',      // agency service revenue
  '5020', '5021', '5022', '5023', '5024', '5025', '5026', '5027',
  '5028', '5029',                                                      // direct production costs
];

// Tax registration. VAT = 12% VAT-registered; NON_VAT = percentage tax.
const TAX_TYPES = ['VAT', 'NON_VAT'];

module.exports = { COMPANY_TYPES, TAX_TYPES, TRADING_RETIRE_CODES };
