// Product names for emails and checkout descriptions. Prices are set by the database only
// (plan_price and shipping_fee in supabase/live/linkcardly.sql); see docs/PRODUCT.md.
export const PRODUCT_NAMES = { digital: 'Digital Card', nfc: 'NFC Card · Basic', nfc_custom: 'NFC Card · Custom' };

// o: an order with `product` ('digital' | 'nfc' | 'nfc_custom'); older orders only have `plan` ('basic' | 'motion').
export const productName = o => PRODUCT_NAMES[o && o.product] || (o && o.plan === 'motion' ? 'Motion Card' : PRODUCT_NAMES.digital);
