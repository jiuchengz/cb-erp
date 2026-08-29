-- 047_exchange_rate_history.sql
-- P2 数据补齐：汇率历史落库
-- 说明：新增 exchange_rate_history 表，按 (currency, date) 唯一存储每日汇率快照。
--   服务端汇率接口改为「有表数据优先用表，缺失再实时拉取并回填」；
--   历史区间数据由 scripts/sync-exchange-rates.mjs 同步脚本拉取入库。
-- 执行方式：在 Supabase SQL Editor 手动执行，成功显示 "Success. No rows returned" 即可。

create table if not exists public.exchange_rate_history (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  rate numeric(18,6) not null,
  date date not null,
  source text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exchange_rate_history_unique unique (currency, date)
);

create index if not exists idx_exchange_rate_currency_date on public.exchange_rate_history (currency, date);
create index if not exists idx_exchange_rate_date on public.exchange_rate_history (date);

-- 与全库 RLS 策略一致（014_rls.sql）：默认 deny，仅 service_role 绕行。
-- 前端不直连本表，统一走 /api/exchange-rates 接口（requireAuth 保护）。
alter table public.exchange_rate_history enable row level security;

-- 校验：执行后应能看到新表
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='exchange_rate_history' ORDER BY ordinal_position;
