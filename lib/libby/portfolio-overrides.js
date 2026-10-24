// Bills and instruments the automatic tagging gets wrong or cannot place (lib/bill-tags.js).
// Key: the title as Parliament writes it (capital letters, [HL] and curly quotes do not matter).
// Value: the portfolio codes it should have (see lib/portfolios-data.js). A title listed here always gets exactly these.
// Used for Bills on the Legislation page and for the department of each division on the Voting Data page.
// The Legislation page marks Bills tagged by default, and the Voting Data page lists divisions under "Other", so you can see what to add.
export default {
 "bills": {
  "Non-Domestic Rating (Multipliers and Private Schools) Bill": [
   "MHCLG"
  ],
  "Business of the House": [
   "CO"
  ],
  "Business of the House motion on Arrangement of the Order Paper 22 July": [
   "CO"
  ],
  "Plant Health, Seeds, Seed Potatoes and Plant Propagating Material (Amendment) (Northern Ireland) Regulations 2026": [
   "DEFRA"
  ],
  "National Insurance Contributions (Employer Pensions Contributions) Bill": [
   "HMT"
  ],
  "Diego Garcia Military Base and British Indian Ocean Territory Bill": [
   "FCDO"
  ],
  "Local Authorities (Changes to Years of Ordinary Elections) (England) Order 2025": [
   "MHCLG"
  ]
 }
};
