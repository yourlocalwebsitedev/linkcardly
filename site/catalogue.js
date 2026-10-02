// Marketing copy for the design catalogue (home and /designs). Colours are NOT here: they come from
// src/lib/themes.js, and scripts/build.mjs merges both into public/assets/js/catalogue.js (window.LC).

// Mirrors BUSINESSES in public/app/order.html. "style" opens the order flow with that category's first design.
export const categories = [
  { id: 'personal', name: 'Personal', sub: 'Any profession', style: '', theme: 'spark', person: 'Arjun Mehta', role: 'Creative Director · Mehta & Co', slug: 'arjunmehta', pitch: 'Your portfolio, socials and WhatsApp on one card that looks like you. Share it in a DM, a pitch deck or across the table.' },
  { id: 'realestate', name: 'Real Estate', sub: 'Agents, brokers, builders', style: 're-poster', theme: 'harbour', person: 'Alex Morgan', role: 'Realtor · Skyline Realty', slug: 'alexmorgan', pitch: 'A Book a showing button up top and your listings one tap below. Put your QR on every yard sign and open-house table.' },
  { id: 'hc', name: 'Health & Clinics', sub: 'Doctors, dentists, clinics', style: 'hc-poster', theme: 'sage', person: 'Dana Reyes', role: 'Nurse Practitioner', slug: 'danareyes', pitch: 'Hours, address, qualifications and a booking button. Patients save you once and always have the right number.' },
  { id: 'bw', name: 'Beauty & Wellness', sub: 'Salons, stylists, spas, trainers', style: 'bw-poster', theme: 'blush', person: 'Meera Kapoor', role: 'Hair & Makeup Artist', slug: 'meerakapoor', pitch: 'Services, Instagram and a WhatsApp button for bookings. Hand it over at the chair and pin it in your bio.' },
  { id: 'lf', name: 'Legal & Finance', sub: 'Lawyers, CAs, insurance advisors', style: 'lf-poster', theme: 'evergreen', person: 'Sam Carter', role: 'Attorney at Law', slug: 'samcarter', pitch: 'Practice areas, office hours and a contact form, presented with the polish your clients expect.' },
  { id: 'hs', name: 'Home Services', sub: 'Plumbers, electricians, cleaners', style: 'hs-poster', theme: 'hivis', person: 'Rahul Verma', role: 'Master Electrician', slug: 'rahulverma', pitch: 'One tap to call, WhatsApp or get directions. Stick your QR on the van and every invoice.' },
  { id: 'cc', name: 'Corporate & Consultants', sub: 'Sales, founders, freelancers', style: 'cc-poster', theme: 'folio', person: 'Priya Nair', role: 'Head of Sales · Northwind', slug: 'priyanair', pitch: 'A calm, polished card for first meetings. Your booking link sits right next to Save contact.' }
];

// Colourway key (src/lib/themes.js) → [display name, category, sample person, sample role].
export const themeCopy = {
  spotlight: ['Spotlight', 'Personal', 'Arjun Mehta', 'Founder & CEO'],
  spark: ['Spark', 'Personal', 'Priya Nair', 'Product Designer'],
  folio: ['Folio', 'Professional', 'Sam Carter', 'Strategy Consultant'],
  original: ['Original', 'Corporate', 'Arjun Mehta', 'Head of Sales'],
  harbour: ['Harbour', 'Real estate', 'Alex Morgan', 'Realtor'],
  estate: ['Estate', 'Luxury estate', 'Alex Morgan', 'Luxury Property Advisor'],
  sage: ['Sage', 'Health', 'Dana Reyes', 'Nurse Practitioner'],
  blush: ['Blush', 'Beauty', 'Meera Kapoor', 'Hair & Makeup Artist'],
  evergreen: ['Evergreen', 'Legal & finance', 'Sam Carter', 'Attorney at Law'],
  hivis: ['Hi-Vis', 'Home services', 'Rahul Verma', 'Master Electrician']
};

export const cats = ['All', 'Personal', 'Professional', 'Corporate', 'Real estate', 'Luxury estate', 'Health', 'Beauty', 'Legal & finance', 'Home services'];
