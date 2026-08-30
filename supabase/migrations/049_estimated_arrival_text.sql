-- shipments.estimated_arrival 由 date 改为 text
-- 背景：前端已将该字段改为文本输入框（placeholder: 可填任意格式，如 2026-09-15、9月中旬），
-- 原 date 类型无法存储任意文本（如「9月中旬」），导致保存时报 invalid input syntax for type date。
alter table shipments alter column estimated_arrival drop not null;
alter table shipments alter column estimated_arrival type text using estimated_arrival::text;
