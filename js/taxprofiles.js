// Tax numbers as data (Money v2 plan D7): year-stamped profiles, each with
// the date it was checked and where the numbers come from. No logic here
// (js/tax.js uses them). Rates are whole basis points (1200 = 12%), money is
// in bani (cents). The owner's own numbers go in settings.tax.overrides and
// always win. NOT TAX ADVICE: laws change every year; check with the State
// Tax Service (sfs.md) or an accountant.

export const CHECKED = '2026-11-12';

const SOURCES = {
  pit: 'Moldova Tax Code art. 15 (12% income tax) and art. 33 (personal exemption); KPMG and PwC Moldova tax summaries',
  cet18: 'State Tax Service (monitorul.fisc.md): the yearly CET18 declaration is due 30 April of the next year',
  entrepreneur: 'Moldova Tax Code (income tax of individual entrepreneurs, declaration by 25 March); logos-pres.md',
  exemption2026: 'State Tax Service (monitorul.fisc.md/scutirile-personale-pentru-anul-2026-nu-au-fost-revizuite/, checked 2026-11-13): the 2026 personal exemption was not revised, MDL 29,700 a year (since 1 Jan 2025, Law 214/2024), for residents with taxable income under MDL 360,000 (Tax Code art. 33)',
  itpark: 'Law 77/2016 on IT parks (mitp.md, invest.gov.md): single tax 7% of sales revenue, IU17 by the 25th of each month',
};

// The fields a profile can have (the screen lists them in this order).
export const FIELDS = [
  { id: 'pitBp', label: 'Income tax', unit: 'bp' },
  { id: 'exemption', label: 'Personal exemption a year', unit: 'money' },
  { id: 'exemptionCap', label: 'No exemption once income reaches', unit: 'money' },
  { id: 'turnoverBp', label: 'Single tax on sales', unit: 'bp' },
];

export const PROFILES = {
  none: {
    id: 'none',
    label: 'Not set (totals only)',
    line: 'Tagged totals only, no estimate.',
    years: { 2026: { checked: CHECKED, sources: [], deadlines: [] } },
  },
  entrepreneur: {
    id: 'entrepreneur',
    label: 'Individual entrepreneur',
    line: '12% of taxable income minus deductible costs.',
    // Owner, 2026-11-12: he is an individual entrepreneur; this is the default.
    years: {
      2026: {
        pitBp: 1200,
        checked: CHECKED,
        sources: [SOURCES.entrepreneur, SOURCES.pit],
        deadlines: [{ md: '03-25', next: true, label: 'Income tax declaration' }],
        unconfirmed: [],
      },
    },
  },
  individual: {
    id: 'individual',
    label: 'Individual (foreign clients, no tax withheld)',
    line: '12% of taxable income minus the personal exemption.',
    years: {
      2026: {
        pitBp: 1200,
        // Confirmed 2026-11-13: the State Tax Service says the 2026 exemption is unchanged from
        // 2025, MDL 29,700 (27,000 was the 2024 figure). See SOURCES.exemption2026.
        exemption: 2970000,
        exemptionCap: 36000000,
        checked: CHECKED,
        sources: [SOURCES.exemption2026, SOURCES.pit, SOURCES.cet18],
        deadlines: [{ md: '04-30', next: true, label: 'CET18 yearly declaration' }],
        unconfirmed: [],
      },
    },
  },
  itpark: {
    id: 'itpark',
    label: 'IT Park resident',
    line: '7% of sales revenue (a monthly minimum per employee is not counted here).',
    years: {
      2026: {
        turnoverBp: 700,
        checked: CHECKED,
        sources: [SOURCES.itpark],
        deadlines: [{ monthly: 25, label: 'IU17 single tax, each month' }],
        unconfirmed: [],
      },
    },
  },
};

export const DEFAULT_PROFILE = 'entrepreneur';
export const PROFILE_IDS = Object.keys(PROFILES);
