/* Card form fields: the one list shared by the order flow (order.html) and the admin page (admin.html).
 * Loaded as a plain script before either page's runtime; read as window.LC_FIELDS.
 *
 *   PROFESSIONS  card categories ("What's your business?"), in display order
 *   PROF_PRESET  category -> card preset (label above the name and tagline defaults)
 *   FIELDS       every customer field. k = draft key; biz / notBiz / re / alsoBiz / usOnly / tx / dfmOnly decide
 *                where it shows (see shown()); BIZ_LABEL and RE_REGION change its label and placeholder by
 *                category and country (see label()).
 *   EXTRAS       draft key -> key inside cards.extras, for fields that aren't their own column.
 */
(function () {
const PROFESSIONS = ['Entrepreneur / Business owner', 'Real Estate', 'Healthcare', 'Beauty & Wellness', 'Home Services', 'Interior / Design services', 'Consultant / Coach', 'Legal / Finance', 'Retail / Shop', 'Other'];
const PROF_PRESET = { 'Entrepreneur / Business owner': 'entrepreneur', 'Real Estate': 'realEstate', 'Healthcare': 'healthcare', 'Beauty & Wellness': 'services', 'Home Services': 'services', 'Interior / Design services': 'services', 'Consultant / Coach': 'entrepreneur', 'Legal / Finance': 'entrepreneur', 'Retail / Shop': 'services', 'Other': 'entrepreneur' };
/* Real estate fields that change by the client's country: [label, placeholder]. null keeps the default. */
const RE_REGION = {
  IN: { brokerage: ['Agency / firm', 'Skyline Realty'], licenseNo: ['RERA number', 'A51800012345'], listingsUrl: [null, '99acres, MagicBricks, Housing.com or your site'], bookingUrl: ['Site visit booking link', null], officeAddress: [null, 'Hill Road, Bandra West, Mumbai 400050'] },
  US: { licenseNo: ['License number', '0712345'] },
};
/* Business fields: labels by business and country. */
const BIZ_LABEL = {
  'Entrepreneur / Business owner': { title: [null, 'Founder · Designer · Coach'], company: [null, 'Your business (optional)'] },
  'Real Estate': { title: [null, 'Property Consultant'], company: [null, 'Skyline Realty'] },
  'Consultant / Coach': { meetingUrl: ['Meeting booking link', 'Calendly or booking page (optional)'], title: [null, 'Sales Director · Consultant'], company: [null, 'Northstar Advisory'] },
  'Healthcare': { title: [null, 'Dentist · Orthodontist'], company: ['Clinic / hospital name', { IN: 'Smile Dental Clinic', US: 'Bright Smile Dental' }], officeAddress: ['Clinic address', { IN: 'Indiranagar 100 Ft Rd, Bengaluru 560038', US: '1200 Main St, Suite 4, Omaha, NE 68102' }],  regNo: { IN: ['Medical Council reg. no.', 'KMC 12345'], US: ['NPI or state license no.', '1234567890'] }, bookingUrl: ['Appointment booking link', 'Practo, Calendly or clinic site'] },
  'Legal / Finance': { title: [null, { IN: 'Advocate · Chartered Accountant', US: 'Attorney · CPA' }], company: ['Firm name', { IN: 'Mehta & Associates', US: 'Carter & Reed LLP' }], officeAddress: ['Office address', { IN: 'Nariman Point, Mumbai 400021', US: '200 S 10th St, Suite 300, Omaha, NE 68102' }],  regNo: { IN: ['Bar / CA / ARN no.', 'K/1234/2008'], US: ['State Bar / license no.', 'NE Bar #24561'] }, bookingUrl: ['Consultation booking link', 'Calendly or booking page'] },
  'Home Services': { title: [null, { IN: 'Plumber · Electrician', US: 'Licensed Plumber' }], company: [null, 'Rapid Fix Plumbing'], hours: [null, 'Mon–Sat · 8 am – 8 pm'], services: [null, 'Leak repair, drain cleaning, water heaters'],  regNo: { IN: ['GST no. (optional)', '29ABCDE1234F1Z5'], US: ['Contractor license no.', 'NE #54321'] }, bookingUrl: ['Quote request link', 'Form or booking page (optional)'] },
  'Beauty & Wellness': { title: [null, 'Hair Stylist · Salon Owner'], company: ['Salon / studio name', 'Glow Studio'], hours: [null, 'Tue–Sun · 10 am – 8 pm'], services: ['Services & starting prices', 'Haircut from $30, Colour from $80, Facial from $60'], bookingUrl: ['Booking link', 'Fresha, Booksy or Calendly'] },
};
const FIELDS = [
  { k: 'firstName', label: 'First name', req: 'all', ph: '', ac: 'given-name', span: 1 },
  { k: 'lastName', label: 'Last name', ph: '', ac: 'family-name', span: 1 },
  { k: 'title', label: 'Job title', req: 'builder', ph: 'Property Consultant', ac: 'organization-title', span: 1 },
  { k: 'company', label: 'Business name', notBiz: ['Real Estate'], ph: 'Skyline Realty', ac: 'organization', span: 1, max: 60 },
  { k: 'phone', label: 'Mobile', req: 'all', ph: '', type: 'tel', ac: 'tel', span: 1, live: 'phone' },
  { k: 'whatsapp', label: 'WhatsApp', ph: '', type: 'tel', ac: 'off', span: 1, live: 'phone' },
  { k: 'email', label: 'Email', req: 'all', ph: '', type: 'email', ac: 'email', span: 1 },
  { k: 'city', label: 'City', ph: '', ac: 'address-level2', span: 1 },
  { k: 'website', url: true, label: 'Website', ph: '', type: 'text', ac: 'url', span: 2 },
  { k: 'instagram', notBiz: ['Consultant / Coach', 'Legal / Finance'], label: 'Instagram', ph: 'yourname', type: 'text', ac: 'off', span: 2, handle: 'ig/' },
  { k: 'linkedin', notBiz: ['Beauty & Wellness', 'Healthcare', 'Home Services'], label: 'LinkedIn', ph: 'yourname', type: 'text', ac: 'off', span: 2, handle: 'in/' },
  { k: 'facebook', url: true, fbish: true, label: 'Facebook', ph: 'yourpage', type: 'text', ac: 'off', span: 2, handle: 'fb/' },
  { k: 'xHandle', notBiz: ['Beauty & Wellness', 'Healthcare', 'Home Services'], label: 'X', ph: 'yourname', type: 'text', ac: 'off', span: 2, handle: 'x/' },
  { k: 'brokerage', label: 'Brokerage', req: 'all', inOptional: true, re: true, ph: 'Lone Star Realty Group', ac: 'organization', span: 1 },
  { k: 'licenseNo', label: 'License number', req: 'all', re: true, ph: '0712345', ac: 'off', span: 1 },
  { k: 'licenseState', label: 'License state', re: true, usOnly: true, ph: 'TX', ac: 'off', span: 1 },
  
  { k: 'listingsUrl', url: true, label: 'Listings page', re: true, ph: 'Zillow, Realtor.com or your site', type: 'text', ac: 'url', span: 2 },
  { k: 'bookingUrl', url: true, label: 'Showing booking link', biz: ['Real Estate', 'Healthcare', 'Beauty & Wellness', 'Legal / Finance', 'Home Services'], ph: 'Calendly or booking page (optional)', type: 'text', ac: 'url', span: 2 },
  { k: 'meetingUrl', label: 'Meeting booking link', biz: ['Consultant / Coach'], ph: 'Calendly or booking page (optional)', type: 'text', ac: 'url', span: 2, url: true },
  { k: 'regNo', label: 'Registration number', biz: ['Healthcare', 'Legal / Finance', 'Home Services'], ph: '', ac: 'off', span: 1 },
  { k: 'quals', label: 'Qualifications', biz: ['Healthcare'], ph: 'BDS, MDS', phUS: 'DDS, MS', ac: 'off', span: 1 },
  { k: 'practice', label: 'Practice areas', biz: ['Legal / Finance'], ph: 'Property, GST, tax filing', phUS: 'Real estate, contracts, family law', ac: 'off', span: 2 },
  { k: 'services', label: 'Services', biz: ['Beauty & Wellness', 'Home Services'], ph: 'Separate with commas', ac: 'off', span: 2 },
  { k: 'serviceArea', label: 'Service area', biz: ['Home Services'], ph: 'Whitefield and nearby areas', phUS: 'Omaha and 20 miles around', ac: 'off', span: 1 },
  { k: 'insured', label: 'Insured?', biz: ['Home Services'], yn: true, ac: 'off', span: 1, usOnly: true },
  { k: 'emergency', label: '24×7 emergency?', biz: ['Home Services'], yn: true, ac: 'off', span: 1 },
  { k: 'hours', label: 'Opening hours', biz: ['Healthcare', 'Beauty & Wellness', 'Home Services'], ph: 'Mon–Sat · 10 am – 7 pm', ac: 'off', span: 2 },
  { k: 'officeAddress', label: 'Office address', re: true, alsoBiz: ['Healthcare', 'Legal / Finance'], ph: '401 Congress Ave, Austin, TX 78701', ac: 'street-address', span: 2 },
  { k: 'iabsUrl', url: true, label: 'Texas IABS form link', re: true, tx: true, usOnly: true, ph: 'Link to your IABS PDF', type: 'text', ac: 'off', span: 2 },
  { k: 'bio', label: 'Short bio', ph: 'One or two sentences about what you do.', area: true, span: 2 },
  { k: 'notes', label: 'Notes for our designer', ph: 'Colours you like, services to list, tagline ideas…', area: true, span: 2, dfmOnly: true },
];
const EXTRAS = { xHandle: 'x_url', meetingUrl: 'meeting_url', bookingUrl: 'booking_url', regNo: 'reg_no', quals: 'quals', hours: 'hours', services: 'services', practice: 'practice', serviceArea: 'service_area', insured: 'insured', emergency: 'emergency', officeAddress: 'office_address', brokerage: 'brokerage', licenseNo: 'license_no', licenseState: 'license_state', facebook: 'facebook', listingsUrl: 'listings_url', iabsUrl: 'iabs_url' };
/* o = { prof, region, dfm, licenseState } */
const shown = (f, o) => (!f.dfmOnly || o.dfm) && (!f.re || o.prof === 'Real Estate' || (f.alsoBiz || []).includes(o.prof)) && !(f.notBiz || []).includes(o.prof) && (!f.biz || f.biz.includes(o.prof)) && (!f.usOnly || o.region !== 'IN') && (!f.tx || String(o.licenseState || '').trim().toUpperCase() === 'TX');
/* [label, placeholder] for this category and country; either may be missing (use the field's own). */
const label = (f, prof, region) => { const bl = (BIZ_LABEL[prof] || {})[f.k]; const rr0 = (bl ? (Array.isArray(bl) ? bl : bl[region] || bl.US) : null), rr1 = rr0 && rr0[1] && typeof rr0[1] === 'object' ? [rr0[0], rr0[1][region] || rr0[1].US] : rr0, rrB = rr1 && f.k === 'services' && region === 'IN' && prof === 'Beauty & Wellness' ? [rr1[0], 'Haircut from ₹500, Colour from ₹2,000, Facial from ₹1,200'] : rr1; return rrB || (prof === 'Real Estate' ? ((RE_REGION[region] || {})[f.k]) : null) || []; };
window.LC_FIELDS = { PROFESSIONS, PROF_PRESET, BIZ_LABEL, RE_REGION, FIELDS, EXTRAS, shown, label };
})();
