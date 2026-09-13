import type { VercelRequest, VercelResponse } from '@vercel/node';
import authMe from './_handlers/auth';
import authProfile from './_handlers/auth/profile';
import authPassword from './_handlers/auth/password';
import authLogin from './_handlers/auth/login';
import exportXlsx from './_handlers/export-xlsx';
import afterSales from './_handlers/after-sales';
import auditLogs from './_handlers/audit-logs';
import dbUsage from './_handlers/db-usage';
import inventory from './_handlers/inventory';
import stocktakes from './_handlers/stocktakes';
import permissions from './_handlers/permissions';
import products from './_handlers/products';
import productTotal from './_handlers/product-total';
import productsTracking from './_handlers/products/tracking';
import costProfit from './_handlers/cost-profit';
import productsBatchDelete from './_handlers/products/batch-delete';
import productsBatchEdit from './_handlers/products/batch-edit';
import productsBatchStock from './_handlers/products/batch-stock';
import inventoryAlerts from './_handlers/inventory/alerts';
import systemBackup from './_handlers/system/backup';
import systemLogo from './_handlers/system/logo';
import stocktakesSummary from './_handlers/stocktakes/summary';
import uploadImage from './_handlers/upload-image';
import purchaseOrders from './_handlers/purchase-orders';
import purchaseOrdersBatch from './_handlers/purchase-orders/batch';
import replenishment from './_handlers/replenishment';
import roles from './_handlers/roles';
import rolesId from './_handlers/roles/[id]';
import sales from './_handlers/sales';
import shipments from './_handlers/shipments';
import transfers from './_handlers/transfers';
import users from './_handlers/users';
import visit from './_handlers/visit';
import visits from './_handlers/visits';
import warehouses from './_handlers/warehouses';
import dailySales from './_handlers/daily-sales';
import dailySalesSummary from './_handlers/daily-sales/summary';
import analysis from './_handlers/analysis';
import dashboard from './_handlers/dashboard';
import recycleBin from './_handlers/recycle-bin';
import systemSettings from './_handlers/system-settings';
import exchangeRates from './_handlers/exchange-rates';
import forwarders from './_handlers/forwarders';
import forwardersId from './_handlers/forwarders/[id]';
import cargoStatuses from './_handlers/cargo-statuses';
import cargoStatusesId from './_handlers/cargo-statuses/[id]';
import afterSaleTypes from './_handlers/after-sale-types';
import afterSaleTypesId from './_handlers/after-sale-types/[id]';
import afterSalesId from './_handlers/after-sales/[id]';
import inventoryId from './_handlers/inventory/[id]';
import inventoryAdjust from './_handlers/inventory/adjust';
import inventoryTransactions from './_handlers/inventory/transactions';
import productsId from './_handlers/products/[id]';
import purchaseOrdersId from './_handlers/purchase-orders/[id]';
import replenishmentId from './_handlers/replenishment/[id]';
import replenishmentStats from './_handlers/replenishment/stats';
import replenishmentSnapshots from './_handlers/replenishment/snapshots';
import salesId from './_handlers/sales/[id]';
import shipmentsId from './_handlers/shipments/[id]';
import shipmentsImport from './_handlers/shipments/import';
import shipmentsConfirmInbound from './_handlers/shipments/confirm-inbound';
import shipmentsReceive from './_handlers/shipments/receive';
import transfersId from './_handlers/transfers/[id]';
import usersId from './_handlers/users/[id]';
import warehousesId from './_handlers/warehouses/[id]';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown> | unknown;

interface Route {
  pattern: RegExp;
  handler: Handler;
  params?: string[];
}

const routes: Route[] = [
  { pattern: /^\/auth\/login$/, handler: authLogin },
  { pattern: /^\/auth\/password$/, handler: authPassword },
  { pattern: /^\/auth\/profile$/, handler: authProfile },
  { pattern: /^\/auth\/me$/, handler: authMe },
  { pattern: /^\/dashboard\/stats$/, handler: dashboard },
  { pattern: /^\/recycle-bin\/restore$/, handler: recycleBin },
  { pattern: /^\/recycle-bin\/purge$/, handler: recycleBin },
  { pattern: /^\/recycle-bin$/, handler: recycleBin },
  { pattern: /^\/analysis$/, handler: analysis },
  { pattern: /^\/daily-sales\/summary$/, handler: dailySalesSummary },
  { pattern: /^\/daily-sales$/, handler: dailySales },
  { pattern: /^\/cargo-statuses\/([^/]+)$/, handler: cargoStatusesId, params: ['id'] },
  { pattern: /^\/cargo-statuses$/, handler: cargoStatuses },
  { pattern: /^\/after-sale-types\/([^/]+)$/, handler: afterSaleTypesId, params: ['id'] },
  { pattern: /^\/after-sale-types$/, handler: afterSaleTypes },
  { pattern: /^\/forwarders\/([^/]+)$/, handler: forwardersId, params: ['id'] },
  { pattern: /^\/forwarders$/, handler: forwarders },
  { pattern: /^\/after-sales\/([^/]+)$/, handler: afterSalesId, params: ['id'] },
  { pattern: /^\/after-sales$/, handler: afterSales },
  { pattern: /^\/audit-logs$/, handler: auditLogs },
  { pattern: /^\/visit$/, handler: visit },
  { pattern: /^\/visits$/, handler: visits },
  { pattern: /^\/system-settings$/, handler: systemSettings },
  { pattern: /^\/exchange-rates$/, handler: exchangeRates },
  { pattern: /^\/db-usage$/, handler: dbUsage },
  { pattern: /^\/inventory\/alerts$/, handler: inventoryAlerts },
  { pattern: /^\/inventory\/adjust$/, handler: inventoryAdjust },
  { pattern: /^\/inventory\/transactions$/, handler: inventoryTransactions },
  { pattern: /^\/inventory\/([^/]+)$/, handler: inventoryId, params: ['id'] },
  { pattern: /^\/inventory$/, handler: inventory },
  { pattern: /^\/permissions$/, handler: permissions },
  { pattern: /^\/products\/batch-edit$/, handler: productsBatchEdit },
  { pattern: /^\/products\/batch-stock$/, handler: productsBatchStock },
  { pattern: /^\/products\/batch-delete$/, handler: productsBatchDelete },
  { pattern: /^\/products\/upload-image$/, handler: uploadImage },
  { pattern: /^\/products\/tracking$/, handler: productsTracking },
  { pattern: /^\/cost-profit\/settings$/, handler: costProfit },
  { pattern: /^\/cost-profit\/save$/, handler: costProfit },
  { pattern: /^\/cost-profit$/, handler: costProfit },
  { pattern: /^\/product-total$/, handler: productTotal },
  { pattern: /^\/products\/([^/]+)$/, handler: productsId, params: ['id'] },
  { pattern: /^\/products$/, handler: products },
  { pattern: /^\/purchase-orders\/batch$/, handler: purchaseOrdersBatch },
  { pattern: /^\/purchase-orders\/([^/]+)$/, handler: purchaseOrdersId, params: ['id'] },
  { pattern: /^\/purchase-orders$/, handler: purchaseOrders },
  { pattern: /^\/replenishment\/stats$/, handler: replenishmentStats },
  { pattern: /^\/replenishment\/snapshots$/, handler: replenishmentSnapshots },
  { pattern: /^\/replenishment\/([^/]+)$/, handler: replenishmentId, params: ['id'] },
  { pattern: /^\/replenishment$/, handler: replenishment },
  { pattern: /^\/roles\/([^/]+)$/, handler: rolesId, params: ['id'] },
  { pattern: /^\/roles$/, handler: roles },
  { pattern: /^\/sales\/([^/]+)$/, handler: salesId, params: ['id'] },
  { pattern: /^\/sales$/, handler: sales },
  { pattern: /^\/shipments\/import$/, handler: shipmentsImport },
  { pattern: /^\/shipments\/([^/]+)\/confirm-inbound$/, handler: shipmentsConfirmInbound, params: ['id'] },
  { pattern: /^\/shipments\/([^/]+)\/receive$/, handler: shipmentsReceive, params: ['id'] },
  { pattern: /^\/shipments\/([^/]+)$/, handler: shipmentsId, params: ['id'] },
  { pattern: /^\/shipments$/, handler: shipments },
  { pattern: /^\/stocktakes\/summary$/, handler: stocktakesSummary },
  { pattern: /^\/stocktakes\/([^/]+)\/audit$/, handler: stocktakes, params: ['id'] },
  { pattern: /^\/stocktakes\/([^/]+)$/, handler: stocktakes, params: ['id'] },
  { pattern: /^\/stocktakes$/, handler: stocktakes },
  { pattern: /^\/transfers\/([^/]+)$/, handler: transfersId, params: ['id'] },
  { pattern: /^\/transfers$/, handler: transfers },
  { pattern: /^\/users\/([^/]+)$/, handler: usersId, params: ['id'] },
  { pattern: /^\/users$/, handler: users },
  { pattern: /^\/export\/xlsx$/, handler: exportXlsx },
  { pattern: /^\/system\/backup$/, handler: systemBackup },
  { pattern: /^\/system\/logo$/, handler: systemLogo },
  { pattern: /^\/warehouses\/([^/]+)$/, handler: warehousesId, params: ['id'] },
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
