// Marketing copy for the design catalogue (home and /designs). Colours are NOT here: they come from
// src/lib/themes.js, and scripts/build.mjs merges both into public/assets/js/catalogue.js (window.LC).

// Mirrors BUSINESSES in public/app/order.html. "style" opens the order flow with that category's first design.
export const categories = [
  { id: 'personal', name: 'Personal', sub: 'Any profession', style: '', theme: 'spark', person: 'Arjun Mehta', role: 'Creative Director · Mehta & Co', slug: 'arjunmehta', photo: '/assets/img/samples/portrait.jpg', pitch: 'Your portfolio, socials and WhatsApp on one card that looks like you. Share it in a DM, a pitch deck or across the table.' },
  { id: 'realestate', name: 'Real Estate', sub: 'Agents, brokers, builders', style: 're-poster', theme: 'harbour', person: 'Alex Morgan', role: 'Realtor · Skyline Realty', slug: 'alexmorgan', photo: '/assets/img/samples/people/alexmorgan.jpg', pitch: 'A Book a showing button up top and your listings one tap below. Put your QR on every yard sign and open-house table.' },
  { id: 'hc', name: 'Health & Clinics', sub: 'Doctors, dentists, clinics', style: 'hc-poster', theme: 'sage', person: 'Dana Reyes', role: 'Nurse Practitioner', slug: 'danareyes', photo: '/assets/img/samples/people/danareyes.jpg', pitch: 'Hours, address, qualifications and a booking button. Patients save you once and always have the right number.' },
  { id: 'bw', name: 'Beauty & Wellness', sub: 'Salons, stylists, spas, trainers', style: 'bw-poster', theme: 'blush', person: 'Meera Kapoor', role: 'Hair & Makeup Artist', slug: 'meerakapoor', photo: '/assets/img/samples/people/meerakapoor.jpg', pitch: 'Services, Instagram and a WhatsApp button for bookings. Hand it over at the chair and pin it in your bio.' },
  { id: 'lf', name: 'Legal & Finance', sub: 'Lawyers, CAs, insurance advisors', style: 'lf-poster', theme: 'evergreen', person: 'Sam Carter', role: 'Attorney at Law', slug: 'samcarter', photo: '/assets/img/samples/people/samcarter.jpg', pitch: 'Practice areas, office hours and a contact form, presented with the polish your clients expect.' },
  { id: 'hs', name: 'Home Services', sub: 'Plumbers, electricians, cleaners', style: 'hs-poster', theme: 'hivis', person: 'Rahul Verma', role: 'Master Electrician', slug: 'rahulverma', photo: '/assets/img/samples/portrait.jpg', pitch: 'One tap to call, WhatsApp or get directions. Stick your QR on the van and every invoice.' },
  { id: 'cc', name: 'Corporate & Consultants', sub: 'Sales, founders, freelancers', style: 'cc-poster', theme: 'folio', person: 'Priya Nair', role: 'Head of Sales · Northwind', slug: 'priyanair', photo: '/assets/img/samples/people/priyanair.jpg', pitch: 'A calm, polished card for first meetings. Your booking link sits right next to Save contact.' }
];

// Sample people for the /designs gallery: each design shows the next person in this list, so neighbouring
// designs never share a face. Photos in assets/img/samples/people/ (Unsplash, see its README). Five women, five men.
export const people = [
  { name: 'Ananya Iyer', photo: '/assets/img/samples/people/ananyaiyer.jpg', y: 30 },
  { name: 'Rohan Mehta', photo: '/assets/img/samples/people/rohanmehta.jpg', y: 28 },
  { name: 'Kavya Reddy', photo: '/assets/img/samples/people/kavyareddy.jpg', y: 26 },
  { name: 'Kabir Sharma', photo: '/assets/img/samples/people/kabirsharma.jpg', y: 30 },
  { name: 'Sunita Desai', photo: '/assets/img/samples/people/sunitadesai.jpg', y: 28 },
  { name: 'Aditya Rao', photo: '/assets/img/samples/people/adityarao.jpg', y: 28 },
  { name: 'Isha Verma', photo: '/assets/img/samples/people/ishaverma.jpg', y: 26 },
  { name: 'Vikram Singh', photo: '/assets/img/samples/people/vikramsingh.jpg', y: 26 },
  { name: 'Neha Gupta', photo: '/assets/img/samples/people/nehagupta.jpg', y: 30 },
  { name: 'Harish Patel', photo: '/assets/img/samples/people/harishpatel.jpg', y: 30 }
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
