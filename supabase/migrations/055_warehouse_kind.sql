-- 仓库类型: head=总仓(国内), sub=子仓(国内), overseas=海外仓
alter table public.warehouses add column if not exists warehouse_kind text;

-- 回填: 海外仓 -> overseas; 名称/编码含 总/总部/HEAD -> head; 其余国内仓 -> sub
update public.warehouses set warehouse_kind = case
  when wh_type = 'overseas' then 'overseas'
  when name like '%总%' or code like '%HEAD%' then 'head'
  else 'sub'
end
where warehouse_kind is null or warehouse_kind = '';

alter table public.warehouses alter column warehouse_kind set not null;
alter table public.warehouses alter column warehouse_kind set default 'sub';
alter table public.warehouses add constraint warehouses_warehouse_kind_check check (warehouse_kind in ('head','sub','overseas'));
