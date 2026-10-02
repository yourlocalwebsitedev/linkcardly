// Card colourways. bg / ink / button / button ink. Extend per design family.
export const THEMES = {
  spotlight: { family: 'cover', bg: '#17181B', ink: '#FFFFFF', btn: '#FFFFFF', btnInk: '#17181B' },
  harbour: { family: 'cover', bg: '#0E1A2E', ink: '#FFFFFF', btn: '#E7C27D', btnInk: '#0E1A2E' },
  sage: { family: 'cover', bg: '#EEF4F0', ink: '#12332A', btn: '#1F6B55', btnInk: '#FFFFFF' },
  blush: { family: 'cover', bg: '#FBEFEA', ink: '#3B1F1A', btn: '#8A3B2E', btnInk: '#FFFFFF' },
  folio: { family: 'cover', bg: '#FAF7F2', ink: '#14213D', btn: '#14213D', btnInk: '#FFFFFF' },
  spark: { family: 'cover', bg: '#17181B', ink: '#FFFFFF', btn: '#FFC400', btnInk: '#17181B' },
  evergreen: { family: 'cover', bg: '#102A22', ink: '#F4EBD9', btn: '#F4EBD9', btnInk: '#102A22' },
  original: { family: 'personal', bg: '#06120d', ink: '#F4EBD9', btn: '#f2c98a', btnInk: '#06120d' }
};
export const theme = key => THEMES[key] || THEMES.folio;
