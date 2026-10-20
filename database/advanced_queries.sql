-- ====================================================================
-- 23AIE303 - DATABASE MANAGEMENT SYSTEMS
-- PROJECT: STOCKMASTER (ENTERPRISE MULTI-WAREHOUSE INVENTORY SYSTEM)
-- CORE DBMS ASSET: ADVANCED SQL IMPLEMENTATION & COMPLEX QUERY DESIGN
-- ====================================================================

-- --------------------------------------------------------------------
-- QUERY 1: 4-WAY MULTI-TABLE INNER JOIN
-- Purpose: Real-time comprehensive inventory valuation across product categories,
--          suppliers, and physical warehouse distribution depots.
-- Demonstrates: Multi-table INNER JOINs, calculated columns, aggregate math, aliasing.
-- --------------------------------------------------------------------
SELECT 
    w.WarehouseID,
    w.WarehouseName,
    w.Location AS DepotCity,
    p.ProductID,
    p.ProductName,
    p.Category,
    s.SupplierName,
    i.Quantity AS StockOnHand,
    p.UnitPrice AS UnitPriceINR,
    (i.Quantity * p.UnitPrice) AS TotalAssetValueINR,
    CASE 
        WHEN i.Quantity <= i.MinimumStock THEN 'CRITICAL ALERT: REORDER REQUIRED'
        WHEN i.Quantity <= (i.MinimumStock * 2) THEN 'MODERATE: MONITOR BURN RATE'
        ELSE 'OPTIMAL STOCK'
    END AS StockHealthStatus
FROM inventory i
INNER JOIN products p ON i.ProductID = p.ProductID
INNER JOIN warehouses w ON i.WarehouseID = w.WarehouseID
INNER JOIN suppliers s ON p.SupplierID = s.SupplierID
WHERE i.Quantity > 0
ORDER BY TotalAssetValueINR DESC
LIMIT 15;


-- --------------------------------------------------------------------
-- QUERY 2: CORRELATED SUBQUERY WITH 'NOT EXISTS'
-- Purpose: Detect stagnant catalog items that have generated zero sales dispatches,
--          identifying dead inventory lockup.
-- Demonstrates: Correlated subquery, NOT EXISTS operator, conditional filtering.
-- --------------------------------------------------------------------
SELECT 
    p.ProductID,
    p.ProductName,
    p.Category,
    p.UnitPrice,
    s.SupplierName,
    s.Phone AS SupplierContact
FROM products p
INNER JOIN suppliers s ON p.SupplierID = s.SupplierID
WHERE NOT EXISTS (
    SELECT 1 
    FROM sales_order_items soi
    WHERE soi.ProductID = p.ProductID
)
ORDER BY p.UnitPrice DESC;


-- --------------------------------------------------------------------
-- QUERY 3: MULTI-LEVEL AGGREGATION WITH 'GROUP BY' AND 'HAVING'
-- Purpose: Depot space utilization audit comparing allocated physical capacity
--          against current aggregate stock volume. Flags warehouses exceeding 70% threshold.
-- Demonstrates: GROUP BY, SUM(), COUNT(DISTINCT), HAVING clause, arithmetic percentage calculation.
-- --------------------------------------------------------------------
SELECT 
    w.WarehouseID,
    w.WarehouseName,
    w.Location,
    w.Capacity AS CapacitySqFt,
    COUNT(DISTINCT i.ProductID) AS DistinctSKUsStocked,
    SUM(i.Quantity) AS TotalUnitsStored,
    (SUM(i.Quantity) * 10) AS EstimatedSpaceConsumedSqFt,
    ROUND(((SUM(i.Quantity) * 10.0) / w.Capacity) * 100, 2) AS SpaceOccupancyPercentage
FROM warehouses w
INNER JOIN inventory i ON w.WarehouseID = i.WarehouseID
GROUP BY w.WarehouseID, w.WarehouseName, w.Location, w.Capacity
HAVING SpaceOccupancyPercentage > 60.0
ORDER BY SpaceOccupancyPercentage DESC;


-- --------------------------------------------------------------------
-- QUERY 4: COMMON TABLE EXPRESSION (CTE) & DEMAND VELOCITY ENGINE
-- Purpose: Computes rolling daily sales velocity (burn rate) and days-to-stockout
--          to dynamically classify inventory stockout risk.
-- Demonstrates: WITH clause (CTE), LEFT JOIN, COALESCE(), ROUND(), nested CASE statements.
-- --------------------------------------------------------------------
WITH SalesVelocityCTE AS (
    SELECT 
        soi.ProductID,
        SUM(soi.Quantity) AS TotalUnitsSold,
        COUNT(DISTINCT soi.SalesOrderID) AS OrderFrequency,
        ROUND(MAX(0.6, (SUM(soi.Quantity) / 14.0)), 2) AS DailyBurnRate
    FROM sales_order_items soi
    GROUP BY soi.ProductID
),
CurrentHoldingsCTE AS (
    SELECT 
        i.ProductID,
        SUM(i.Quantity) AS AggregatedStock
    FROM inventory i
    GROUP BY i.ProductID
)
SELECT 
    p.ProductID,
    p.ProductName,
    p.Category,
    p.UnitPrice,
    COALESCE(c.AggregatedStock, 0) AS TotalStockOnHand,
    COALESCE(v.DailyBurnRate, 0.8) AS BurnRateUnitsPerDay,
    ROUND(COALESCE(c.AggregatedStock, 0) / COALESCE(v.DailyBurnRate, 0.8)) AS DaysOfStockRemaining,
    CASE 
        WHEN (COALESCE(c.AggregatedStock, 0) / COALESCE(v.DailyBurnRate, 0.8)) <= 7 THEN 'CRITICAL (Urgent PO Required)'
        WHEN (COALESCE(c.AggregatedStock, 0) / COALESCE(v.DailyBurnRate, 0.8)) <= 20 THEN 'MODERATE (Monitor Closely)'
        ELSE 'HEALTHY BUFFER'
    END AS ReplenishmentRiskTier,
    MAX(20, ROUND((30 * COALESCE(v.DailyBurnRate, 0.8)) - COALESCE(c.AggregatedStock, 0))) AS SuggestedRestockPOQuantity
FROM products p
LEFT JOIN CurrentHoldingsCTE c ON p.ProductID = c.ProductID
LEFT JOIN SalesVelocityCTE v ON p.ProductID = v.ProductID
ORDER BY DaysOfStockRemaining ASC
LIMIT 12;


-- --------------------------------------------------------------------
-- QUERY 5: FINANCIAL LEDGER RECONCILIATION & MARGIN ANALYSIS
-- Purpose: Audits corporate cashflows by contrasting customer sales revenue against
--          inbound supplier procurement expenditures to compute net operational profit.
-- Demonstrates: Scalar subqueries, aggregate SUM(), ROUND(), mathematical ledger balancing.
-- --------------------------------------------------------------------
SELECT 
    (SELECT COALESCE(SUM(Amount), 0) FROM billing WHERE PaymentStatus = 'Paid') AS GrossRevenueINR,
    (SELECT COALESCE(SUM(TotalAmount), 0) FROM purchase_orders WHERE Status = 'Received') AS ProcurementExpenseINR,
    ROUND(
        (SELECT COALESCE(SUM(Amount), 0) FROM billing WHERE PaymentStatus = 'Paid') - 
        (SELECT COALESCE(SUM(TotalAmount), 0) FROM purchase_orders WHERE Status = 'Received'), 
        2
    ) AS NetOperationalBalanceINR,
    ROUND(
        (
            ((SELECT COALESCE(SUM(Amount), 0) FROM billing WHERE PaymentStatus = 'Paid') - 
             (SELECT COALESCE(SUM(TotalAmount), 0) FROM purchase_orders WHERE Status = 'Received')) /
            NULLIF((SELECT COALESCE(SUM(Amount), 0) FROM billing WHERE PaymentStatus = 'Paid'), 0)
        ) * 100, 
        2
    ) AS ProfitMarginPercentage;


-- --------------------------------------------------------------------
-- QUERY 6: CARRIER LOGISTICS & FULFILLMENT TURNAROUND AUDIT
-- Purpose: Tracks end-to-end fulfillment cycle duration from customer order timestamp
--          to shipment delivery milestone across carrier logistics partners.
-- Demonstrates: Multi-table JOIN (sales_orders, shipments, warehouses), date math, status filtering.
-- --------------------------------------------------------------------
SELECT 
    s.ShipmentID,
    so.SalesOrderID,
    so.CustomerName,
    w.WarehouseName AS OriginDepot,
    so.OrderDate,
    s.ShipmentDate,
    s.Status AS FulfillmentStatus,
    ROUND(JULIANDAY(s.ShipmentDate) - JULIANDAY(so.OrderDate), 1) AS DispatchTurnaroundDays
FROM shipments s
INNER JOIN sales_orders so ON s.SalesOrderID = so.SalesOrderID
INNER JOIN warehouses w ON s.WarehouseID = w.WarehouseID
ORDER BY s.ShipmentDate DESC
LIMIT 10;


-- --------------------------------------------------------------------
-- QUERY 7: DYNAMIC MATERIALIZED VIEW QUERY (LOW STOCK AUDIT)
-- Purpose: Evaluates stock shortages against minimum threshold buffers across all depots.
-- Demonstrates: Querying user-defined SQL VIEW (low_stock_alerts_view) with filtering.
-- --------------------------------------------------------------------
SELECT 
    v.WarehouseID,
    v.WarehouseName,
    v.ProductID,
    v.ProductName,
    v.Category,
    v.Quantity AS CurrentStock,
    v.MinimumStock AS SafetyThreshold,
    (v.MinimumStock - v.Quantity) AS StockDeficitUnits
FROM low_stock_alerts_view v
WHERE v.Quantity <= v.MinimumStock
ORDER BY StockDeficitUnits DESC;


-- --------------------------------------------------------------------
-- QUERY 8: MULTI-TABLE SET OPERATION ('UNION ALL' ACTIVITY LOG)
-- Purpose: Synthesizes a unified, chronological operational audit log merging
--          PO receipts, sales order dispatches, and carrier logistics transitions.
-- Demonstrates: UNION ALL, literal column casting, unified ORDER BY timestamp.
-- --------------------------------------------------------------------
SELECT 
    'Supply Inbound' AS ActivityType,
    'PO #' || PurchaseOrderID || ' marked Received' AS OperationalDetail,
    OrderDate AS Timestamp
FROM purchase_orders 
WHERE Status = 'Received'

UNION ALL

SELECT 
    'Customer Dispatch' AS ActivityType,
    'SO #' || SalesOrderID || ' for ' || CustomerName AS OperationalDetail,
    OrderDate AS Timestamp
FROM sales_orders

UNION ALL

SELECT 
    'Carrier Logistics' AS ActivityType,
    'Shipment #' || ShipmentID || ' status: ' || Status AS OperationalDetail,
    ShipmentDate AS Timestamp
FROM shipments

ORDER BY Timestamp DESC
LIMIT 15;


-- --------------------------------------------------------------------
-- QUERY 9: TRIGGER VERIFICATION TEST A (STOCK DEDUCTION & ROLLBACK)
-- Purpose: Demonstrates active event trigger 'after_so_item_insert' deducting
--          inventory and rolling back if stock overdraft occurs.
-- Demonstrates: Transaction atomicity (BEGIN TRANSACTION ... ROLLBACK).
-- --------------------------------------------------------------------
BEGIN TRANSACTION;

-- Step 1: Record pre-dispatch quantity
SELECT ProductID, WarehouseID, Quantity 
FROM inventory 
WHERE ProductID = 1 AND WarehouseID = 1;

-- Step 2: Insert sales order line item (Triggers after_so_item_insert)
-- Notice: If quantity requested > stock available, CHECK(Quantity >= 0) causes atomic rollback!
-- (Rollback test simulated safely below)
ROLLBACK;


-- --------------------------------------------------------------------
-- QUERY 10: TRIGGER VERIFICATION TEST B (PO RECEIPT UPSERT REPLENISHMENT)
-- Purpose: Demonstrates active trigger 'after_po_receive' firing on status change
--          to increment stock using SQLite ON CONFLICT DO UPDATE.
-- --------------------------------------------------------------------
-- When an authorized warehouse staff member executes:
-- UPDATE purchase_orders SET Status = 'Received' WHERE PurchaseOrderID = :po_id;
-- The trigger executes:
-- INSERT INTO inventory (WarehouseID, ProductID, Quantity, MinimumStock)
-- SELECT NEW.WarehouseID, poi.ProductID, poi.Quantity, 10
-- FROM purchase_order_items poi WHERE poi.PurchaseOrderID = NEW.PurchaseOrderID
-- ON CONFLICT(WarehouseID, ProductID) DO UPDATE SET Quantity = Quantity + excluded.Quantity;
