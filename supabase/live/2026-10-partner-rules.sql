-- Linkcardly partner rules, 2026-10: ₹200 per paid order, payable 15 days after payment, the partner's own orders
-- earn too, and partner codes have no per-customer limit. Run once in Supabase → SQL Editor (staging first, then
-- production). Safe to run again. Partner coupons get per_email = 100000 (the column is NOT NULL), which means unlimited. The same changes are in linkcardly.sql, so a full re-run of that file also works.
begin;

alter table partner.settings alter column commission set default 200, alter column hold_days set default 15;
update partner.settings set commission = 200 where commission = 100;
update partner.settings set hold_days = 15 where hold_days = 14;

create or replace function partner.sync_commission() returns trigger language plpgsql security definer set search_path = partner, public as $$
declare p partner.partners; s partner.settings; c partner.commissions;
begin
  if new.coupon is null or new.pay_provider = 'test' then return new; end if;
  select * into p from partner.partners where code = new.coupon;
  if not found then return new; end if;
  select * into s from partner.settings;
  if new.pay_status = 'paid' and (tg_op = 'INSERT' or old.pay_status is distinct from 'paid') then
    insert into partner.commissions (partner_id, order_no, kind, amount, status, reason, plan, order_total, paid_at, payable_after)
    values (p.id, new.order_no, 'sale', coalesce(p.commission, s.commission),
      'pending', '',
      new.plan, new.total, coalesce(new.paid_at, now()), coalesce(new.paid_at, now()) + make_interval(days => s.hold_days))
    on conflict (order_no, kind) do nothing;
  elsif new.pay_status = 'refunded' and tg_op = 'UPDATE' and old.pay_status is distinct from 'refunded' then
    select * into c from partner.commissions where order_no = new.order_no and kind = 'sale';
    if found then
      if c.status in ('pending', 'approved') then
        update partner.commissions set status = 'reversed', reason = 'Order refunded', updated_at = now() where id = c.id;
      elsif c.status = 'paid' then  -- already paid out: take it back from the next payout
        insert into partner.commissions (partner_id, order_no, kind, amount, status, reason, plan, order_total, paid_at, payable_after)
        values (c.partner_id, c.order_no, 'clawback', -c.amount, 'approved', 'Order refunded after payout', c.plan, c.order_total, now(), now())
        on conflict (order_no, kind) do nothing;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_partner_commission on public.orders;
create trigger orders_partner_commission after insert or update of pay_status on public.orders
  for each row execute function partner.sync_commission();

create or replace function partner.sync_coupon(p partner.partners) returns void language plpgsql security definer set search_path = partner, public as $$
declare s partner.settings;
begin
  if p.code is null then return; end if;
  select * into s from partner.settings;
  insert into public.coupons (code, kind, value, region, plan, max_uses, per_email, active, note)
  values (p.code, 'amount', s.discount, 'IN', null, null, 100000, p.status = 'approved', 'partner:' || p.id)
  on conflict (code) do update set active = (p.status = 'approved'), value = s.discount, per_email = 100000, note = 'partner:' || p.id;
end $$;

update public.coupons set per_email = 100000 where note like 'partner:%' and per_email < 100000;

commit;
notify pgrst, 'reload schema';

-- Check (should show 200 | 100 | 15):
select commission, discount, hold_days from partner.settings;
