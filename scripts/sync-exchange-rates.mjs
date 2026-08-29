#!/usr/bin/env node
/**
 * P2 数据补齐：汇率历史同步脚本
 * ------------------------------------------------------------
 * 功能：按日期区间从公开历史汇率源拉取每日快照，写入 exchange_rate_history 表
 *      （currency, rate, date, source），供 /api/exchange-rates 接口"有表数据优先用表"。
 *
 * 数据源：frankfurter.app（欧洲央行 ECB 汇率，免费、无需 key，支持 1999-01-04 至今，
 *      支持历史日期与区间查询，支持 from=USD 指定基准币种，覆盖 USD/CNY/MXN 等主流币种）
 *
 * 前置条件：
 *   1. 已执行迁移 047_exchange_rate_history.sql（Supabase SQL Editor 手动执行）
 *   2. 可用的 Supabase service_role 客户端凭据（环境变量）：
 *        SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *      或项目根目录 .env.local（VITE_SUPABASE_URL 可用作 URL 兜底）
 *     本地拉取 Vercel 环境变量：vercel env pull .env.local
 *
 * 用法：
 *   node scripts/sync-exchange-rates.mjs --from 2025-01-01 --to 2025-12-31
 *   node scripts/sync-exchange-rates.mjs --days 90                      # 最近 90 天
 *   node scripts/sync-exchange-rates.mjs --from 2025-01-01 --to 2025-12-31 --base USD --currencies USD,CNY,MXN
 *   node scripts/sync-exchange-rates.mjs --dry-run                      # 只拉取统计，不写库
 *
 * 输出：控制台摘要（新增/更新条数、失败日期）+ 每批失败详情
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ARGS = parseArgs(process.argv.slice(2));
const BASE = ARGS.base || 'USD';
const CURRENCIES = ARGS.currencies || ''; // 空 = 拉取源支持的全部币种
const SOURCE = 'frankfurter.app';
const BATCH_DAYS = 90; // frankfurter 大区间易超时，按 90 天分批

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function loadEnv() {
  const env = { ...process.env };
  // 兜底读取项目 .env.local（vercel env pull 产物）
  const localFile = path.join(ROOT, '.env.local');
  if (fs.existsSync(localFile)) {
    const lines = fs.readFileSync(localFile, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, k, v] = m;
      if (!env[k]) env[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseDate(s, fallback) {
  const d = new Date(s + 'T00:00:00');
  return isNaN(d.getTime()) ? fallback : d;
}

async function fetchRange(from, to) {
  const url = `https://api.frankfurter.app/${from}..${to}?from=${encodeURIComponent(BASE)}${CURRENCIES ? `&to=${encodeURIComponent(CURRENCIES)}` : ''}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`frankfurter HTTP ${resp.status}: ${url}`);
  const json = await resp.json();
  if (!json || typeof json.rates !== 'object') throw new Error(`frankfurter 返回格式异常: ${url}`);
  return json.rates; // { '2025-01-01': { CNY: x, MXN: y }, ... }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const env = loadEnv();
  const dryRun = !!ARGS['dry-run'];
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dryRun && (!url || !serviceKey)) {
    console.error('❌ 缺少环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或 .env.local 中 VITE_SUPABASE_URL 兜底）。');
    console.error('   本地可执行：vercel env pull .env.local');
    process.exit(2);
  }

  const now = new Date();
  let fromDate;
  let toDate;
  if (ARGS.from && ARGS.to) {
    fromDate = parseDate(ARGS.from, now);
    toDate = parseDate(ARGS.to, now);
  } else if (ARGS.days) {
    const n = Math.max(1, parseInt(ARGS.days, 10));
    toDate = now;
    fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - (n - 1));
  } else {
    console.error('❌ 请指定 --from/--to 或 --days 参数。');
    process.exit(2);
  }
  if (fromDate > toDate) {
    console.error('❌ --from 不能晚于 --to');
    process.exit(2);
  }
  const from = ymd(fromDate);
  const to = toDate.getTime() > now.getTime() ? todayUTC() : ymd(toDate);

  console.log(`🔁 汇率同步开始：${from} ~ ${to}，基准 ${BASE}，币种 ${CURRENCIES || '全部'}，数据源 ${SOURCE}`);
  console.log(`   批次窗口：${BATCH_DAYS} 天`);
  if (dryRun) console.log('   ⚠️ dry-run 模式：只拉取统计，不写库，不需要数据库凭据');

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failedBatches = [];
  const supabase = dryRun ? null : createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let cursor = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (cursor <= end) {
    const batchEnd = new Date(cursor);
    batchEnd.setDate(batchEnd.getDate() + BATCH_DAYS - 1);
    const bFrom = ymd(cursor);
    const bTo = ymd(batchEnd > end ? end : batchEnd);

    try {
      const ratesByDate = await fetchRange(bFrom, bTo);
      const rows = [];
      for (const [date, rates] of Object.entries(ratesByDate)) {
        for (const [currency, rate] of Object.entries(rates)) {
          const v = Number(rate);
          if (!Number.isFinite(v) || v <= 0) continue;
          rows.push({ currency: currency.toUpperCase(), rate: v, date, source: SOURCE });
        }
      }
      if (dryRun) {
        inserted += rows.length;
        console.log(`   [dry-run] ${bFrom}~${bTo}: ${rows.length} 条（不写库）`);
      } else if (rows.length) {
        const { error } = await supabase.from('exchange_rate_history').upsert(rows, { onConflict: 'currency,date' });
        if (error) throw error;
        const dateCount = new Set(rows.map((r) => r.date)).size;
        console.log(`   ✅ ${bFrom}~${bTo}: ${rows.length} 条 / ${dateCount} 天`);
        // 简化统计：表内不存在时 upsert 语义为 insert；此处按"源数据条数"计，明细以数据库为准
        inserted += rows.length;
      } else {
        skipped++;
        console.log(`   ⚠️ ${bFrom}~${bTo}: 无数据`);
      }
    } catch (e) {
      failedBatches.push({ from: bFrom, to: bTo, error: e.message || String(e) });
      console.error(`   ❌ ${bFrom}~${bTo}: ${e.message || e}`);
    }

    cursor = new Date(batchEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log('────────────────────────────');
  console.log(`✅ 完成。写入 ${inserted} 条（upsert，同 (currency,date) 自动覆盖更新；dry-run 为模拟数）`);
  console.log(`   批次失败 ${failedBatches.length} 个${failedBatches.length ? '：' + JSON.stringify(failedBatches) : ''}`);
  console.log(`   查询接口验证：GET /api/exchange-rates?from=${from}&to=${to}&currencies=USD,CNY,MXN`);
  if (dryRun) {
    console.log('   ⚠️ dry-run 模式未写库，去掉 --dry-run 实际执行。');
  }
}

main().catch((e) => {
  console.error('❌ 脚本异常：', e?.message || e);
  process.exit(1);
});
