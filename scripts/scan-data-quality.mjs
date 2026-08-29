#!/usr/bin/env node
/**
 * P2 数据补齐：成本字段与 SKU/link_id 规范校验扫描脚本
 * ------------------------------------------------------------
 * 功能：扫描 products / daily_sales 表，产出数据质量问题清单：
 *   - 成本字段：purchase_cost 缺失(NULL)/为 0/负数（成本利润计算会失真）
 *   - SKU/link_id/code 规范：空值、首尾空格、大小写不一致（疑似重复/脏数据）
 *   - daily_sales：platform/link_id 空串、首尾空格、疑似重复组
 *
 * 前置条件：同 sync-exchange-rates.mjs（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 或 .env.local）
 *
 * 用法：
 *   node scripts/scan-data-quality.mjs                     # 扫描并输出摘要 + 写清单到 temp/
 *   node scripts/scan-data-quality.mjs --out ./report.json # 指定清单输出路径
 *
 * 输出：控制台摘要 + 问题清单 JSON（含统计与明细，供 AI/人工跟进修复）
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ARGS = parseArgs(process.argv.slice(2));

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
      } else out[key] = true;
    }
  }
  return out;
}

function loadEnv() {
  const env = { ...process.env };
  const localFile = path.join(ROOT, '.env.local');
  if (fs.existsSync(localFile)) {
    for (const line of fs.readFileSync(localFile, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const [, k, v] = m;
      if (!env[k]) env[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('❌ 缺少环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（或 .env.local 中 VITE_SUPABASE_URL 兜底）。');
    process.exit(2);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const report = {
    generated_at: new Date().toISOString(),
    tables: {},
  };

  // ---------- products ----------
  console.log('🔍 扫描 products ...');
  const productsIssues = [];
  let productTotal = 0;
  let offset = 0;
  const BATCH = 500;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id,sku,name,code,link_id,purchase_cost,deleted_at')
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(`products 查询失败: ${error.message}`);
    if (!data || data.length === 0) break;
    productTotal += data.length;
    for (const row of data) {
      const issues = [];
      const cost = row.purchase_cost;
      if (cost === null || cost === undefined) issues.push('cost_missing');
      else if (Number(cost) === 0) issues.push('cost_zero');
      else if (Number(cost) < 0) issues.push('cost_negative');
      if (row.sku === null || row.sku === undefined || String(row.sku).trim() === '') issues.push('sku_empty');
      else if (String(row.sku) !== String(row.sku).trim()) issues.push('sku_whitespace');
      if (row.link_id === null || row.link_id === undefined || String(row.link_id).trim() === '') issues.push('link_id_empty');
      else if (String(row.link_id) !== String(row.link_id).trim()) issues.push('link_id_whitespace');
      if (row.code !== null && row.code !== undefined && String(row.code).trim() === '') issues.push('code_empty_string');
      if (issues.length) {
        productsIssues.push({
          id: row.id,
          sku: row.sku,
          name: row.name,
          code: row.code,
          link_id: row.link_id,
          purchase_cost: row.purchase_cost,
          deleted_at: row.deleted_at,
          issues,
        });
      }
    }
    offset += BATCH;
  }
  // 大小写不一致分组（按小写归一统计，>1 视为疑似重复）
  const skuNormMap = new Map();
  const linkNormMap = new Map();
  for (const it of productsIssues) {
    if (it.sku) {
      const k = String(it.sku).trim().toLowerCase();
      if (!skuNormMap.has(k)) skuNormMap.set(k, []);
      skuNormMap.get(k).push({ id: it.id, sku: it.sku });
    }
    if (it.link_id) {
      const k = String(it.link_id).trim().toLowerCase();
      if (!linkNormMap.has(k)) linkNormMap.set(k, []);
      linkNormMap.get(k).push({ id: it.id, link_id: it.link_id });
    }
  }
  const skuDupeGroups = [...skuNormMap.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ norm: k, count: v.length, rows: v }));
  const linkDupeGroups = [...linkNormMap.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ norm: k, count: v.length, rows: v }));

  report.tables.products = {
    total: productTotal,
    cost_missing: productsIssues.filter((i) => i.issues.includes('cost_missing')).length,
    cost_zero: productsIssues.filter((i) => i.issues.includes('cost_zero')).length,
    cost_negative: productsIssues.filter((i) => i.issues.includes('cost_negative')).length,
    sku_empty: productsIssues.filter((i) => i.issues.includes('sku_empty')).length,
    sku_whitespace: productsIssues.filter((i) => i.issues.includes('sku_whitespace')).length,
    link_id_empty: productsIssues.filter((i) => i.issues.includes('link_id_empty')).length,
    link_id_whitespace: productsIssues.filter((i) => i.issues.includes('link_id_whitespace')).length,
    code_empty_string: productsIssues.filter((i) => i.issues.includes('code_empty_string')).length,
    sku_duplicate_norm_groups: skuDupeGroups.length,
    link_id_duplicate_norm_groups: linkDupeGroups.length,
    issue_rows: productsIssues,
    sku_duplicate_groups: skuDupeGroups,
    link_id_duplicate_groups: linkDupeGroups,
  };

  // ---------- daily_sales ----------
  console.log('🔍 扫描 daily_sales ...');
  const dailyIssues = [];
  let dailyTotal = 0;
  offset = 0;
  const dupCheck = new Map(); // normKey -> {count, rows[]}
  for (;;) {
    const { data, error } = await supabase
      .from('daily_sales')
      .select('id,sale_date,platform,link_id,quantity,refund_qty')
      .range(offset, offset + BATCH - 1);
    if (error) throw new Error(`daily_sales 查询失败: ${error.message}`);
    if (!data || data.length === 0) break;
    dailyTotal += data.length;
    for (const row of data) {
      const issues = [];
      if (row.platform === null || row.platform === undefined || String(row.platform).trim() === '') issues.push('platform_empty');
      else if (String(row.platform) !== String(row.platform).trim()) issues.push('platform_whitespace');
      if (row.link_id === null || row.link_id === undefined || String(row.link_id).trim() === '') issues.push('link_id_empty');
      else if (String(row.link_id) !== String(row.link_id).trim()) issues.push('link_id_whitespace');
      if (issues.length) {
        dailyIssues.push({
          id: row.id,
          sale_date: row.sale_date,
          platform: row.platform,
          link_id: row.link_id,
          quantity: row.quantity,
          refund_qty: row.refund_qty,
          issues,
        });
      }
      // 疑似重复：同一天同平台同 link_id（归一化后）
      const normKey = `${row.sale_date}|${String(row.platform ?? '').trim().toLowerCase()}|${String(row.link_id ?? '').trim().toLowerCase()}`;
      if (!dupCheck.has(normKey)) dupCheck.set(normKey, { count: 0, rows: [] });
      dupCheck.get(normKey).count++;
      if (dupCheck.get(normKey).count <= 3) dupCheck.get(normKey).rows.push({ id: row.id, platform: row.platform, link_id: row.link_id, quantity: row.quantity });
    }
    offset += BATCH;
  }
  const dailyDupeGroups = [...dupCheck.entries()].filter(([, v]) => v.count > 1).map(([k, v]) => ({ key: k, count: v.count, rows: v.rows }));

  report.tables.daily_sales = {
    total: dailyTotal,
    platform_empty: dailyIssues.filter((i) => i.issues.includes('platform_empty')).length,
    platform_whitespace: dailyIssues.filter((i) => i.issues.includes('platform_whitespace')).length,
    link_id_empty: dailyIssues.filter((i) => i.issues.includes('link_id_empty')).length,
    link_id_whitespace: dailyIssues.filter((i) => i.issues.includes('link_id_whitespace')).length,
    duplicate_norm_groups: dailyDupeGroups.length,
    issue_rows: dailyIssues,
    duplicate_groups: dailyDupeGroups,
  };

  // ---------- 输出 ----------
  const outPath = ARGS.out
    ? path.resolve(ROOT, ARGS.out)
    : path.join(ROOT, 'temp', `data-quality-report-${new Date().toISOString().slice(0, 10)}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('────────────────────────────');
  const p = report.tables.products;
  console.log(`📦 products 共 ${p.total} 条：`);
  console.log(`   成本缺失 ${p.cost_missing} / 为0 ${p.cost_zero} / 负数 ${p.cost_negative}`);
  console.log(`   sku 空 ${p.sku_empty} / 含首尾空格 ${p.sku_whitespace} / 归一后疑似重复组 ${p.sku_duplicate_norm_groups}`);
  console.log(`   link_id 空 ${p.link_id_empty} / 含首尾空格 ${p.link_id_whitespace} / 归一后疑似重复组 ${p.link_id_duplicate_norm_groups}`);
  console.log(`   code 空串 ${p.code_empty_string}`);
  const d = report.tables.daily_sales;
  console.log(`📊 daily_sales 共 ${d.total} 条：`);
  console.log(`   platform 空 ${d.platform_empty} / 含首尾空格 ${d.platform_whitespace}`);
  console.log(`   link_id 空 ${d.link_id_empty} / 含首尾空格 ${d.link_id_whitespace} / 疑似重复组 ${d.duplicate_norm_groups}`);
  console.log('────────────────────────────');
  console.log(`✅ 问题清单已写入：${outPath}`);
}

main().catch((e) => {
  console.error('❌ 脚本异常：', e?.message || e);
  process.exit(1);
});
