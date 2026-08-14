import type { VercelRequest, VercelResponse } from '@vercel/node';
import afterSales from './_handlers/after-sales';
import auditLogs from './_handlers/audit-logs';
import inventory from './_handlers/inventory';
import permissions from './_handlers/permissions';
import products from './_handlers/products';
import purchaseOrders from './_handlers/purchase-orders';
import replenishment from './_handlers/replenishment';
import roles from './_handlers/roles';
import sales from './_handlers/sales';
import shipments from './_handlers/shipments';
import transfers from './_handlers/transfers';
import users from './_handlers/users';
import warehouses from './_handlers/warehouses';
import afterSalesId from './_handlers/after-sales/[id]';
import inventoryAdjust from './_handlers/inventory/adjust';
import inventoryTransactions from './_handlers/inventory/transactions';
import productsId from './_handlers/products/[id]';
import purchaseOrdersId from './_handlers/purchase-orders/[id]';
import replenishmentId from './_handlers/replenishment/[id]';
import salesId from './_handlers/sales/[id]';
import shipmentsId from './_handlers/shipments/[id]';
import transfersId from './_handlers/transfers/[id]';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

interface Route {
  pattern: RegExp;
  handler: Handler;
  params?: string[];
}

const routes: Route[] = [
  { pattern: /^\/after-sales\/([^/]+)$/, handler: afterSalesId, params: ['id'] },
  { pattern: /^\/after-sales$/, handler: afterSales },
  { pattern: /^\/audit-logs$/, handler: auditLogs },
  { pattern: /^\/inventory\/adjust$/, handler: inventoryAdjust },
  { pattern: /^\/inventory\/transactions$/, handler: inventoryTransactions },
  { pattern: /^\/inventory$/, handler: inventory },
  { pattern: /^\/permissions$/, handler: permissions },
  { pattern: /^\/products\/([^/]+)$/, handler: productsId, params: ['id'] },
  { pattern: /^\/products$/, handler: products },
  { pattern: /^\/purchase-orders\/([^/]+)$/, handler: purchaseOrdersId, params: ['id'] },
  { pattern: /^\/purchase-orders$/, handler: purchaseOrders },
  { pattern: /^\/replenishment\/([^/]+)$/, handler: replenishmentId, params: ['id'] },
  { pattern: /^\/replenishment$/, handler: replenishment },
  { pattern: /^\/roles$/, handler: roles },
  { pattern: /^\/sales\/([^/]+)$/, handler: salesId, params: ['id'] },
  { pattern: /^\/sales$/, handler: sales },
  { pattern: /^\/shipments\/([^/]+)$/, handler: shipmentsId, params: ['id'] },
  { pattern: /^\/shipments$/, handler: shipments },
  { pattern: /^\/transfers\/([^/]+)$/, handler: transfersId, params: ['id'] },
  { pattern: /^\/transfers$/, handler: transfers },
  { pattern: /^\/users$/, handler: users },
  { pattern: /^\/warehouses$/, handler: warehouses },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const url = new URL(req.url || '/', 'http://internal');
    const path = url.pathname.replace(/^\/api/, '') || '/';

    for (const route of routes) {
      const m = path.match(route.pattern);
      if (m) {
        if (route.params) {
          const q: Record<string, string | string[]> = { ...(req.query as Record<string, string | string[]>) };
          route.params.forEach((p, i) => {
            q[p] = m[i + 1];
          });
          (req as any).query = q;
        }
        return route.handler(req, res);
      }
    }

    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  } catch (e) {
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  }
}
