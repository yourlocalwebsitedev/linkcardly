-- Linkcardly, 2026-10: partners see each sale with the customer's first name only (no surname, phone, email or card link).
-- Run once (staging, then production). Safe to run again. Already part of linkcardly.sql.
create or replace function partner.me_json(p partner.partners) returns jsonb language plpgsql security definer set search_path = partner, public as $$
declare d partner.payout_details; s partner.settings; v_fy date := partner.fy_start(now()); v_year numeric;
begin
  perform partner.approve_due();
  select * into d from partner.payout_details where partner_id = p.id;
  select * into s from partner.settings;
  select coalesce(sum(amount), 0) into v_year from partner.commissions
    where partner_id = p.id and status in ('pending', 'approved', 'paid') and paid_at >= v_fy;
  return jsonb_build_object(
    'partner', jsonb_build_object('name', p.full_name, 'email', p.email, 'status', p.status, 'code', p.code,
      'link', 'https://linkcardly.com/r/' || lower(coalesce(p.code, '')), 'commission', coalesce(p.commission, s.commission), 'discount', s.discount, 'joined', p.created_at),
    'payout_details', jsonb_build_object(
      'upi', case when d.upi_id = '' then '' else left(d.upi_id, 2) || '•••@' || split_part(d.upi_id, '@', 2) end,
      'bank', case when d.account_no = '' then '' else d.bank_name || ' ••••' || right(d.account_no, 4) end,
      'pan', case when d.pan = '' then '' else left(d.pan, 2) || '•••••' || right(d.pan, 3) end),
    'rules', jsonb_build_object('hold_days', s.hold_days, 'min_payout', s.min_payout, 'pan_threshold', s.pan_threshold, 'tds_rate', s.tds_rate),
    'totals', (select jsonb_build_object(
        'clicks', (select count(*) from partner.clicks where partner_id = p.id),
        'clicks_30d', (select count(*) from partner.clicks where partner_id = p.id and at > now() - interval '30 days'),
        'orders', count(*) filter (where kind = 'sale' and status <> 'rejected'),
        'sales_value', coalesce(sum(order_total) filter (where kind = 'sale' and status in ('pending', 'approved', 'paid')), 0),
        'earned', coalesce(sum(amount) filter (where status in ('pending', 'approved', 'paid')), 0),
        'pending', coalesce(sum(amount) filter (where status = 'pending'), 0),
        'ready', coalesce(sum(amount) filter (where status = 'approved'), 0),
        'paid', coalesce(sum(amount) filter (where status = 'paid'), 0),
        'this_year', v_year,
        'pan_needed', v_year > s.pan_threshold and d.pan = '')
      from partner.commissions where partner_id = p.id),
    -- The customer's first name only. Nothing else about customers (surname, phone, email, card link) goes to partners.
    'commissions', coalesce((select jsonb_agg(jsonb_build_object('order', c.order_no, 'kind', c.kind, 'plan', c.plan, 'amount', c.amount, 'status', c.status,
        'reason', c.reason, 'paid_at', c.paid_at, 'payable_after', c.payable_after,
        'customer', (select left(split_part(trim(o.customer_name), ' ', 1), 30) from public.orders o where o.order_no = c.order_no)) order by c.created_at desc)
      from (select * from partner.commissions where partner_id = p.id order by created_at desc limit 100) c), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(jsonb_build_object('period', o.period, 'gross', o.gross, 'tds', o.tds, 'net', o.net, 'status', o.status,
        'hold_reason', o.hold_reason, 'paid_at', o.paid_at, 'reference', o.reference) order by o.created_at desc)
      from partner.payouts o where o.partner_id = p.id), '[]'::jsonb));
end $$;
revoke all on function partner.me_json(partner.partners) from public, anon, authenticated;
notify pgrst, 'reload schema';
