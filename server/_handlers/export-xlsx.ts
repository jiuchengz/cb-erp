import type { VercelRequest, VercelResponse } from '@vercel/node';
import ExcelJS from 'exceljs';
import { requireAuth } from './_lib/auth';
import { requireAnyPermission } from './_lib/rbac';
import { handleError, Errors } from './_lib/error';

// 导出接口权限：任一读权限即可（与 system/backup 收紧策略不同，
// 前端大量导出场景依赖这些业务读权限）
const READ_PERMISSIONS = [
  'products.read',
  'inventory.read',
  'sales.read',
  'shipment.read',
  'procurement.read',
  'transfer.read',
  'after_sales.read',
  'replenishment.read',
  'product_total.read',
  'cost_profit.read',
  'stocktake.read',
];

// 单次导出行数上限，防止超大 aoa 撑爆内存/响应
const MAX_ROWS = 50000;
// 图片 URL 并发拉取上限，避免同时发起大量外部请求
const IMAGE_CONCURRENCY = 5;

// 受控并发的批量处理：限制同时进行的异步任务数
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ImageCell {
  r: number;
  c: number;
  url: string;
}

interface RowHeightRange {
  s: number;
  e: number;
  h: number;
}

async function loadImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('data:image/')) {
      const b64 = url.slice(url.indexOf(',') + 1);
      return Buffer.from(b64, 'base64');
    }
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const ab = await resp.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function extOf(url: string): 'png' | 'jpeg' | 'gif' | 'webp' {
  const lower = (url.split('?')[0] || '').toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.webp')) return 'webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpeg';
  if (url.startsWith('data:image/png')) return 'png';
  if (url.startsWith('data:image/gif')) return 'gif';
  if (url.startsWith('data:image/webp')) return 'webp';
  return 'jpeg';
}

// 统一导出接口：前端传 aoa（二维数组）、merges（合并单元格）、cols（列宽）、imageCells（图片单元格）
// withImages=true 时后端拉取图片插入单元格；false 时图片列由前端直接写 URL 文本
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const ctx = await requireAuth(req);
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    }
    requireAnyPermission(ctx, READ_PERMISSIONS);

    const body = req.body || {};
    const fileName: string = body.fileName || 'export.xlsx';
    const sheetName: string = body.sheetName || 'Sheet1';
    const aoa: unknown[][] = Array.isArray(body.aoa) ? body.aoa : [];
    if (aoa.length > MAX_ROWS) {
      throw Errors.badRequest('单次导出行数不能超过 ' + MAX_ROWS + ' 行，请分批导出');
    }
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = Array.isArray(body.merges) ? body.merges : [];
    const cols: { wch?: number }[] = Array.isArray(body.cols) ? body.cols : [];
    const widths: (number | null | undefined)[] = Array.isArray(body.widths) ? body.widths : [];
    const rowHeightRanges: RowHeightRange[] = Array.isArray(body.rowHeightRanges) ? body.rowHeightRanges : [];
    const titleRows: number[] = Array.isArray(body.titleRows) ? body.titleRows : [];
    const styled: boolean = !!body.styled;
    const withImages: boolean = !!body.withImages;
    const imageCells: ImageCell[] = Array.isArray(body.imageCells) ? body.imageCells : [];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);

    for (const row of aoa) {
      ws.addRow((row || []).map((v) => (v === null || v === undefined ? '' : v)));
    }

    if (widths.length) {
      ws.columns = widths.map((w) => ({ width: w == null || Number.isNaN(Number(w)) ? 12 : Math.max(2, Number(w)) }));
    } else if (cols.length) {
      ws.columns = cols.map((c) => ({ width: Math.max(6, (c.wch || 12) * 1.1) }));
    }

    for (const rg of rowHeightRanges) {
      for (let row = rg.s; row <= rg.e; row++) {
        try {
          ws.getRow(row + 1).height = rg.h;
        } catch {
          // 忽略越界行
        }
      }
    }

    for (const m of merges) {
      try {
        ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
      } catch {
        // 忽略非法合并
      }
    }

    // styled 模式：整表应用 宋体11 / 居中 / thin 边框，与「调整后的表格」参考文件一致
    // 标题行（titleRows）额外使用 宋体24 大字号
    if (styled) {
      const baseFont = { name: '宋体', size: 11 };
      const titleFont = { name: '宋体', size: 24 };
      const align = { horizontal: 'center' as const, vertical: 'middle' as const };
      const border = {
        top: { style: 'thin' as const },
        left: { style: 'thin' as const },
        bottom: { style: 'thin' as const },
        right: { style: 'thin' as const },
      };
      const titleSet = new Set(titleRows);
      // 注意：eachRow 不会遍历 addRow([]) 创建的空行，空行也需要样式，故按 rowCount 遍历
      for (let rr = 1; rr <= ws.rowCount; rr++) {
        const row = ws.getRow(rr);
        const font = titleSet.has(rr - 1) ? titleFont : baseFont;
        for (let c = 1; c <= 8; c++) {
          try {
            const cell = row.getCell(c);
            cell.font = font;
            cell.alignment = align;
            cell.border = border;
          } catch {
            // 合并区域内非锚点单元格样式设置可能失败，忽略
          }
        }
      }
    }

    if (withImages && imageCells.length) {
      await mapLimit(imageCells, IMAGE_CONCURRENCY, async (cell) => {
        const buf = await loadImageBuffer(cell.url);
        if (!buf) return;
        try {
          const imageId = wb.addImage({ buffer: buf, extension: extOf(cell.url) });
          ws.addImage(imageId, {
            tl: { col: cell.c, row: cell.r },
            ext: { width: 56, height: 56 },
          });
        } catch {
          // 单张图片失败不影响整体导出
        }
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    return handleError(res, e);
  }
}
