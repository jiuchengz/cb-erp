import type { VercelRequest, VercelResponse } from '@vercel/node';
import afterSales from '../server/_handlers/after-sales';
import auditLogs from '../server/_handlers/audit-logs';
import inventory from '../server/_handlers/inventory';
import permissions from '../server/_handlers/permissions';
import products from '../server/_handlers/products';
import purchaseOrders from '../server/_handlers/purchase-orders';
import replenishment from '../server/_handlers/replenishment';
import roles from '../server/_handlers/roles';
import sales from '../server/_handlers/sales';
import shipments from '../server/_handlers/shipments';
import transfers from '../server/_handlers/transfers';
import users from '../server/_handlers/users';
import warehouses from '../server/_handlers/warehouses';
import afterSalesId from '../server/_handlers/after-sales/[id]';
import inventoryAdjust from '../server/_handlers/inventory/adjust';
import inventoryTransactions from '../server/_handlers/inventory/transactions';
import productsId from '../server/_handlers/products/[id]';
import purchaseOrdersId from '../server/_handlers/purchase-orders/[id]';
import replenishmentId from '../server/_handlers/replenishment/[id]';
import salesId from '../server/_handlers/sales/[id]';
import shipmentsId from '../server/_handlers/shipments/[id]';
import transfersId from '../server/_handlers/transfers/[id]';

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
