import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { requireAuth } from './_lib/auth';
import { requirePermission, bindProductWarehouseFilter, fetchProductBindingsVisible } from './_lib/rbac';
import { parse, paginationSchema } from './_lib/validation';
import { getAdminClient } from './_lib/db';
import { writeAudit } from './_lib/audit';
import { handleError } from './_lib/error';
import { rateLimit } from './_lib/rate-limit';

// ========== 利润公式默认参数（与 Excel 模板一致，可在设置中调整） ==========
export const DEFAULT_SETTINGS = {
  rate: 0.38,      // 汇率 MXN -> CNY
  tax_rate: 1.13,  // 含税系数（13% 增值税）
  storage: 0.8,    // FULL 仓储费率 %
  loss: 5,         // 货损费率 %
  ad: 8,           // 广告费率 %
  tax9: 9,         // 9% 平台代扣税 %
  tax7: 7,         // 7% 额外补税 %
  comm: 16.5,      // 默认 ML 佣金比例 %
  sea_rate: 3000,  // 海运费单价（元/方）
  air_rate: 95,    // 空运费单价（元/kg）
};

const settingsSchema = z.object({
  rate: z.coerce.number().min(0.01).max(10).optional(),
  tax_rate: z.coerce.number().min(1).max(2).optional(),
  storage: z.coerce.number().min(0).max(100).optional(),
  loss: z.coerce.number().min(0).max(100).optional(),
  ad: z.coerce.number().min(0).max(100).optional(),
  tax9: z.coerce.number().min(0).max(100).optional(),
  tax7: z.coerce.number().min(0).max(100).optional(),
  comm: z.coerce.number().min(0).max(100).optional(),
  sea_rate: z.coerce.number().min(0).max(100000).optional(),
  air_rate: z.coerce.number().min(0).max(100000).optional(),
});

const saveSchema = z.object({
  id: z.string().min(1),
  unit_price: z.coerce.number().min(0).optional(),
  purchase_cost: z.coerce.number().min(0).optional(),
  first_leg_freight: z.coerce.number().min(0).optional(),
  last_mile_delivery_peso: z.coerce.number().min(0).optional(),
  ml_commission_rate: z.coerce.number().min(0).max(1).optional(),
  add_fee: z.coerce.number().min(0).optional(),
  length_cm: z.coerce.number().min(0).optional(),
  width_cm: z.coerce.number().min(0).optional(),
  height_cm: z.coerce.number().min(0).optional(),
  weight_g: z.coerce.number().min(0).optional(),
});

async function loadSettings(supabase: any): Promise<typeof DEFAULT_SETTINGS> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'cost_profit_settings')
    .maybeSingle();
  if (error) throw error;
  if (!data?.value) return { ...DEFAULT_SETTINGS };
  const raw = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  return { ...DEFAULT_SETTINGS, ...(raw || {}) };
}

// ========== 按 Excel 模板公式计算一行利润 ==========
// J 售价比索 | L 不含税采购成本(元) | O 头程运费(元) | I ML佣金比例
// 售价元=J*rate；13%含税= L*tax_rate；含税比索=M/rate；头程比索=O/rate；货值=P+N
// 仓储=R?=货值*0.8%；货损=货值*5%；佣金=J*I；尾程/附加手工；广告=J*8%；代扣=J*9%；补税=J*7%
// 总成本=货值+仓储+货损+佣金+尾程+附加+广告+代扣+补税；利润比索=J-总成本；利润元=利润比索*rate
export function calcProfitFields(p: any, s: typeof DEFAULT_SETTINGS) {
  const J = Number(p.unit_price || 0);
  const L = Number(p.purchase_cost || 0);
  const O = Number(p.first_leg_freight || 0);
  const I = p.ml_commission_rate != null && p.ml_commission_rate !== '' ? Number(p.ml_commission_rate) : s.comm / 100;
  const U = Number(p.last_mile_delivery_peso || 0);
  const V = Number(p.add_fee || 0);

  const K = J * s.rate;                                   // 售价(元)
  const M = L * s.tax_rate;                               // 13%含税采购成本(元)
  const N = s.rate > 0 ? M / s.rate : 0;                  // 含税采购成本(比索)
  const P = s.rate > 0 ? O / s.rate : 0;                  // 头程运费(比索)
  const Q = N + P;                                        // 货值(比索)
  const R = Q * (s.storage / 100);                        // FULL仓储
  const S = Q * (s.loss / 100);                           // 货损
  const T = J * I;                                        // ML佣金
  const W = J * (s.ad / 100);                             // 广告
  const X = J * (s.tax9 / 100);                           // 9%代扣税
  const Y = J * (s.tax7 / 100);                           // 7%补税
  const Z = Q + R + S + T + U + V + W + X + Y;            // 总成本
  const AA = J > 0 ? Z / J : 0;                           // 总成本占比
  const AB = J - Z;                                       // 平台利润(比索)
  const AC = AB * s.rate;                                 // 平台利润(元)
  const AD = K > 0 ? AC / K : 0;                          // 平台利润率
  const AE = K - M;                                       // 销售毛利(元)
  const AF = K > 0 ? AE / K : 0;                          // 销售毛利率

  // 海运费自动计算：长x宽x高(cm) / 1000000 x 海运单价(元/方)
  const sea_freight_calc = (Number(p.length_cm || 0) * Number(p.width_cm || 0) * Number(p.height_cm || 0)) / 1000000 * s.sea_rate;
  // 空运费自动计算：重量(g) / 1000 x 空运单价(元/kg)
  const air_freight_calc = (Number(p.weight_g || 0) / 1000) * s.air_rate;

  return {
    sale_price_cny: round2(K),
    taxed_cost_cny: round2(M),
    taxed_cost_peso: round2(N),
    first_freight_peso: round2(P),
    goods_value_peso: round2(Q),
    storage_peso: round2(R),
    loss_peso: round2(S),
    commission_peso: round2(T),
    ad_peso: round2(W),
    tax9_peso: round2(X),
    tax7_peso: round2(Y),
    total_cost_peso: round2(Z),
    total_cost_ratio: AA,
    profit_peso: round2(AB),
    profit_cny: round2(AC),
    profit_ratio: AD,
    gross_profit_cny: round2(AE),
    gross_profit_ratio: AF,
    sea_freight: round2(sea_freight_calc),
    air_freight: round2(air_freight_calc),
  };
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    rateLimit(((req.headers['x-forwarded-for'] as string) || 'unknown') + ':' + (req.url || ''));
    const ctx = await requireAuth(req);
    const supabase = getAdminClient();

    if (req.method === 'GET') {
      requirePermission(ctx, 'cost_profit.read');
      const q = parse(paginationSchema, req.query);
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const settings = await loadSettings(supabase);

      // 一货多仓可见性：商品为公司级主档，受限账号仅能查看其绑定任一可见仓的商品（成本利润属商品主档数据）
      const bindFilter = bindProductWarehouseFilter(ctx);
      let query: any = supabase
        .from('products')
        .select(`*, ${bindFilter.selectBind}`, { count: 'exact' })
        .is('deleted_at', null);
      query = bindFilter.filter(query);
      if (search) {
        query = query.or(
          `sku.ilike.%${search}%,name.ilike.%${search}%,barcode.ilike.%${search}%,code.ilike.%${search}%,link_id.ilike.%${search}%`
        );
      }
      query = query.order('created_at', { ascending: false }).range((q.page - 1) * q.pageSize, q.page * q.pageSize - 1);
      const { data, error, count } = await query;
      if (error) throw error;

      const rows = (data || []).map((p: any) => {
        // 载荷不含内嵌绑定行（绑定仅用于可见过滤）
        const { product_warehouses: _pw, ...rest } = p;
        return { ...rest, ...calcProfitFields(p, settings) };
      });
      return res.status(200).json({ data: rows, count: count || 0, settings });
    }

    if (req.method === 'PUT' && req.url?.includes('/settings')) {
      requirePermission(ctx, 'products.update');
      const body = parse(settingsSchema, req.body || {});
      const current = await loadSettings(supabase);
      const merged = { ...current, ...body };
      const { error } = await supabase.from('system_settings').upsert({
        key: 'cost_profit_settings',
        value: merged,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId || null,
      });
      if (error) throw error;
      await writeAudit(ctx, req, 'update', 'system_settings', null, null, { key: 'cost_profit_settings', ...body });
      return res.status(200).json({ data: merged });
    }

    if (req.method === 'PUT' && req.url?.includes('/save')) {
      requirePermission(ctx, 'products.update');
      const body = parse(saveSchema, req.body || {});
      const { id, ...fields } = body;
      const settings = await loadSettings(supabase);

      // 一货多仓可见校验：商品需绑定任一当前账号可见仓（不可见按不存在处理，防越权写主档成本利润字段）
      const { row: existing } = await fetchProductBindingsVisible(supabase, ctx, id);

      const merged = { ...existing, ...fields };
      const profit = calcProfitFields(merged, settings);
      const updateFields = {
        ...fields,
        sea_freight: profit.sea_freight,
        air_freight: profit.air_freight,
        platform_profit: profit.profit_cny,
        updated_at: new Date().toISOString(),
      };

      const { error: updErr } = await supabase
        .from('products')
        .update(updateFields)
        .eq('id', id);
      if (updErr) throw updErr;
      await writeAudit(ctx, req, 'update', 'products', id, null, { ...fields, platform_profit: profit.profit_cny });
      return res.status(200).json({ data: { ...merged, ...profit } });
    }

    return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  } catch (e) {
    return handleError(res, e);
  }
}
