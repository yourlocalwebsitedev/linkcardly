-- Linkcardly, 2026-10: functions from linkcardly.sql that the live databases were missing.
--   production: claim_upi_payment, mark_order_paid_manual · staging: the same plus mark_order_refunded
-- Without them: UPI payment references can't be recorded, "Mark paid" in admin fails, and (staging) refund webhooks fail.
-- Same text as linkcardly.sql. Run on both databases (safe where they already exist), then re-run the check at the
-- end of 2026-10-media-url-ok.sql: it should return no rows.
begin;

-- Refund webhooks (Razorpay refund.processed, Stripe charge.refunded) mark a paid order refunded. Worker only;
-- only paid → refunded, so a replayed webhook changes nothing. The trigger above then takes the card offline and
-- the partner trigger reverses any commission.
create or replace function public.mark_order_refunded(p_order_no text, p_provider text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; c record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select * into o from orders where order_no = p_order_no for update;
  if not found then raise exception 'order not found'; end if;
  if o.pay_status <> 'paid' then return jsonb_build_object('ok', true, 'changed', false, 'pay_status', o.pay_status); end if;
  update orders set pay_status = 'refunded', notes = left(coalesce(notes, '') || case when coalesce(notes, '') = '' then '' else E'\n' end
    || 'Refunded via ' || left(coalesce(p_provider, ''), 20) || ' ' || left(coalesce(p_ref, ''), 120), 2000) where id = o.id;
  select slug, public_id into c from cards where id = o.card_id;   -- so the Worker can drop the card from its cache
  return jsonb_build_object('ok', true, 'changed', true, 'order_no', o.order_no, 'customer_email', o.customer_email, 'customer_name', o.customer_name,
    'slug', c.slug, 'public_id', c.public_id);
end $$;
revoke all on function public.mark_order_refunded(text, text, text) from public;
grant execute on function public.mark_order_refunded(text, text, text) to anon, authenticated;

-- own total, card live, fresh edit link for the "card is live" email.
create or replace function public.mark_order_paid_manual(p_order_no text, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  select order_no, total, price, currency into o from orders where order_no = p_order_no;
  if not found then raise exception 'order not found'; end if;
  return mark_order_paid(o.order_no, 'manual', left(coalesce(nullif(trim(p_ref), ''), 'manual'), 120), round(coalesce(o.total, o.price) * 100)::bigint, o.currency);
end $$;
revoke all on function public.mark_order_paid_manual(text, text) from public;
grant execute on function public.mark_order_paid_manual(text, text) to anon, authenticated;

-- UPI (India): the customer's 12-digit UPI reference (UTR), one order per UTR; an admin then presses Mark paid.
alter table public.orders add column if not exists upi_utr text;
alter table public.orders add column if not exists upi_claimed_at timestamptz;
create unique index if not exists orders_upi_utr_key on public.orders (upi_utr) where upi_utr is not null;

create or replace function public.claim_upi_payment(p_order_no text, p_idem text, p_utr text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; v_first boolean;
begin
  if not from_worker() then raise exception 'not allowed'; end if;
  if coalesce(p_utr, '') !~ '^[0-9]{12}$' then raise exception 'invalid utr'; end if;
  select * into o from orders where order_no = p_order_no and idem is not null and idem = p_idem for update;
  if not found then raise exception 'order not found'; end if;
  if o.pay_status <> 'unpaid' then return jsonb_build_object('ok', true, 'first', false, 'pay_status', o.pay_status); end if;
  if exists (select 1 from orders where upi_utr = p_utr and id <> o.id) then raise exception 'utr used'; end if;
  v_first := o.upi_utr is distinct from p_utr;
  update orders set upi_utr = p_utr, upi_claimed_at = now() where id = o.id;
  return jsonb_build_object('ok', true, 'first', v_first, 'pay_status', o.pay_status, 'order_no', o.order_no, 'total', o.total, 'currency', o.currency,
    'customer_name', o.customer_name, 'customer_email', o.customer_email, 'customer_phone', o.customer_phone);
end $$;
revoke all on function public.claim_upi_payment(text, text, text) from public;
grant execute on function public.claim_upi_payment(text, text, text) to anon, authenticated;

commit;
notify pgrst, 'reload schema';
