-- Force SQLite to enforce foreign key constraints
PRAGMA foreign_keys = ON;

-- Drop new tables if they exist to allow clean resets (order matters: drop children tables first)
DROP TABLE IF EXISTS billing;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS sales_order_items;
DROP TABLE IF EXISTS sales_orders;
DROP TABLE IF EXISTS purchase_order_items;
DROP TABLE IF EXISTS purchase_orders;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS warehouses;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS users;

-- Drop views & triggers if they exist
DROP VIEW IF EXISTS low_stock_alerts_view;
DROP TRIGGER IF EXISTS after_po_receive;
DROP TRIGGER IF EXISTS after_so_item_insert;

-- 1. Users Table
CREATE TABLE users (
    UserID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT NOT NULL,
    Email TEXT NOT NULL UNIQUE,
    Password TEXT NOT NULL DEFAULT 'password123',
    Role TEXT NOT NULL CHECK(Role IN ('Admin', 'Warehouse Staff'))
);

-- 2. Suppliers Table
CREATE TABLE suppliers (
    SupplierID INTEGER PRIMARY KEY AUTOINCREMENT,
    SupplierName TEXT NOT NULL,
    Phone TEXT,
    Email TEXT NOT NULL UNIQUE,
    Address TEXT
);

-- 3. Products Table
CREATE TABLE products (
    ProductID INTEGER PRIMARY KEY AUTOINCREMENT,
    ProductName TEXT NOT NULL,
    Description TEXT,
    Category TEXT NOT NULL,
    UnitPrice REAL NOT NULL CHECK(UnitPrice > 0),
    SupplierID INTEGER NOT NULL,
    FOREIGN KEY (SupplierID) REFERENCES suppliers(SupplierID) ON DELETE CASCADE
);

-- 4. Warehouses Table
CREATE TABLE warehouses (
    WarehouseID INTEGER PRIMARY KEY AUTOINCREMENT,
    WarehouseName TEXT NOT NULL,
    Location TEXT NOT NULL,
    Capacity INTEGER NOT NULL CHECK(Capacity > 0)
);

-- 5. Inventory Table (M:N junction mapping products to warehouses)
CREATE TABLE inventory (
    InventoryID INTEGER PRIMARY KEY AUTOINCREMENT,
    ProductID INTEGER NOT NULL,
    WarehouseID INTEGER NOT NULL,
    Quantity INTEGER NOT NULL CHECK(Quantity >= 0) DEFAULT 0,
    MinimumStock INTEGER NOT NULL CHECK(MinimumStock >= 0) DEFAULT 10,
    UNIQUE(ProductID, WarehouseID),
    FOREIGN KEY (ProductID) REFERENCES products(ProductID) ON DELETE CASCADE,
    FOREIGN KEY (WarehouseID) REFERENCES warehouses(WarehouseID) ON DELETE CASCADE
);

-- 6. Purchase Orders Table
CREATE TABLE purchase_orders (
    PurchaseOrderID INTEGER PRIMARY KEY AUTOINCREMENT,
    SupplierID INTEGER NOT NULL,
    WarehouseID INTEGER NOT NULL, -- Added to track destination warehouse
    OrderDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    Status TEXT NOT NULL CHECK(Status IN ('Pending', 'Received')) DEFAULT 'Pending',
    TotalAmount REAL NOT NULL CHECK(TotalAmount >= 0) DEFAULT 0,
    FOREIGN KEY (SupplierID) REFERENCES suppliers(SupplierID) ON DELETE CASCADE,
    FOREIGN KEY (WarehouseID) REFERENCES warehouses(WarehouseID) ON DELETE CASCADE
);

-- 7. Purchase Order Line Items Table
CREATE TABLE purchase_order_items (
    ItemID INTEGER PRIMARY KEY AUTOINCREMENT,
    PurchaseOrderID INTEGER NOT NULL,
    ProductID INTEGER NOT NULL,
    Quantity INTEGER NOT NULL CHECK(Quantity > 0),
    UnitPrice REAL NOT NULL CHECK(UnitPrice > 0),
    FOREIGN KEY (PurchaseOrderID) REFERENCES purchase_orders(PurchaseOrderID) ON DELETE CASCADE,
    FOREIGN KEY (ProductID) REFERENCES products(ProductID) ON DELETE CASCADE
);

-- 8. Sales Orders Table
CREATE TABLE sales_orders (
    SalesOrderID INTEGER PRIMARY KEY AUTOINCREMENT,
    CustomerName TEXT NOT NULL,
    WarehouseID INTEGER NOT NULL, -- Added to track source warehouse
    OrderDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    Status TEXT NOT NULL CHECK(Status IN ('Pending', 'Shipped', 'Delivered')) DEFAULT 'Pending',
    TotalAmount REAL NOT NULL CHECK(TotalAmount >= 0) DEFAULT 0,
    FOREIGN KEY (WarehouseID) REFERENCES warehouses(WarehouseID) ON DELETE CASCADE
);

-- 9. Sales Order Line Items Table
CREATE TABLE sales_order_items (
    ItemID INTEGER PRIMARY KEY AUTOINCREMENT,
    SalesOrderID INTEGER NOT NULL,
    ProductID INTEGER NOT NULL,
    Quantity INTEGER NOT NULL CHECK(Quantity > 0),
    UnitPrice REAL NOT NULL CHECK(UnitPrice > 0),
    FOREIGN KEY (SalesOrderID) REFERENCES sales_orders(SalesOrderID) ON DELETE CASCADE,
    FOREIGN KEY (ProductID) REFERENCES products(ProductID) ON DELETE CASCADE
);

-- 10. Shipments Table
CREATE TABLE shipments (
    ShipmentID INTEGER PRIMARY KEY AUTOINCREMENT,
    SalesOrderID INTEGER NOT NULL UNIQUE,
    WarehouseID INTEGER NOT NULL,
    ShipmentDate DATETIME DEFAULT CURRENT_TIMESTAMP,
    Status TEXT NOT NULL CHECK(Status IN ('Processing', 'In Transit', 'Delivered')) DEFAULT 'Processing',
    FOREIGN KEY (SalesOrderID) REFERENCES sales_orders(SalesOrderID) ON DELETE CASCADE,
    FOREIGN KEY (WarehouseID) REFERENCES warehouses(WarehouseID) ON DELETE CASCADE
);

-- 11. Billing Table
CREATE TABLE billing (
    BillID INTEGER PRIMARY KEY AUTOINCREMENT,
    SalesOrderID INTEGER NOT NULL UNIQUE,
    Amount REAL NOT NULL CHECK(Amount > 0),
    PaymentMethod TEXT NOT NULL CHECK(PaymentMethod IN ('Card', 'Cash', 'Bank Transfer')),
    PaymentStatus TEXT NOT NULL CHECK(PaymentStatus IN ('Pending', 'Paid')) DEFAULT 'Pending',
    PaymentDate DATETIME,
    FOREIGN KEY (SalesOrderID) REFERENCES sales_orders(SalesOrderID) ON DELETE CASCADE
);

-- B-Tree Performance Indexes
CREATE INDEX idx_inventory_prod ON inventory(ProductID);
CREATE INDEX idx_inventory_wh ON inventory(WarehouseID);
CREATE INDEX idx_po_items_po ON purchase_order_items(PurchaseOrderID);
CREATE INDEX idx_so_items_so ON sales_order_items(SalesOrderID);


-- ====================================================================
-- DATABASE VIEWS (DBMS Requirements)
-- ====================================================================

-- Dynamic Low-Stock View
CREATE VIEW low_stock_alerts_view AS
SELECT i.WarehouseID, w.WarehouseName, i.ProductID, p.ProductName, i.Quantity, i.MinimumStock
FROM inventory i
INNER JOIN products p ON i.ProductID = p.ProductID
INNER JOIN warehouses w ON i.WarehouseID = w.WarehouseID
WHERE i.Quantity <= i.MinimumStock;


-- ====================================================================
-- DATABASE TRIGGERS (DBMS Requirements)
-- ====================================================================

-- Trigger A: Reduce Stock Level automatically when a Sales Order Item is added.
-- If the quantity drops below zero, the CHECK(Quantity >= 0) constraint on the inventory table
-- will fail, rolling back the entire insertion automatically!
CREATE TRIGGER after_so_item_insert
AFTER INSERT ON sales_order_items
BEGIN
    UPDATE inventory 
    SET Quantity = Quantity - NEW.Quantity 
    WHERE ProductID = NEW.ProductID 
      AND WarehouseID = (SELECT WarehouseID FROM sales_orders WHERE SalesOrderID = NEW.SalesOrderID);
END;

-- Trigger B: Replenish Stock automatically when a Purchase Order status is updated to 'Received'.
CREATE TRIGGER after_po_receive
AFTER UPDATE OF Status ON purchase_orders
FOR EACH ROW WHEN NEW.Status = 'Received' AND OLD.Status = 'Pending'
BEGIN
    INSERT INTO inventory (WarehouseID, ProductID, Quantity, MinimumStock)
    SELECT NEW.WarehouseID, poi.ProductID, poi.Quantity, 10
    FROM purchase_order_items poi
    WHERE poi.PurchaseOrderID = NEW.PurchaseOrderID
    ON CONFLICT(WarehouseID, ProductID) DO UPDATE SET
        Quantity = Quantity + excluded.Quantity;
END;


-- ====================================================================
-- SEED DATA SETUP
-- ====================================================================

-- A. Seed Users
INSERT INTO users (UserID, Name, Email, Password, Role) VALUES 
(1, 'Puneeth Kumar', 'puneeth.k@warehouse.com', 'adminpass', 'Admin'),
(2, 'Varshitha', 'varshitha@warehouse.com', 'varshpass', 'Admin'),
(3, 'Sarvesh', 'sarvesh@warehouse.com', 'sarvpass', 'Warehouse Staff');

-- B. Seed Suppliers
INSERT INTO suppliers (SupplierID, SupplierName, Phone, Email, Address) VALUES 
(1, 'Apex Semiconductor Corp', '9988776655', 'supply@apex.com', 'Silicon Valley Road, Bangalore'),
(2, 'Global Memory Logistics', '8877665544', 'orders@globalmemory.com', 'Industrial Tech Park, Chennai'),
(3, 'Pioneer Displays Ltd', '7766554433', 'sales@pioneer.com', 'OLED Manufacturing Zone, Hyderabad');

-- C. Seed Products
INSERT INTO products (ProductID, ProductName, Description, Category, UnitPrice, SupplierID) VALUES 
(1, 'Core i7 Octa-Core Processor', 'Intel 13th Gen Core i7 Desktop CPU', 'Processor', 28500.00, 1),
(2, '16GB DDR5 5600MHz RAM', 'Crucial DDR5 High Speed Desktop Memory', 'Memory', 4200.00, 2),
(3, '1TB PCIe Gen4 NVMe SSD', 'Samsung 990 Pro PCIe Gen4 Storage SSD', 'Storage', 8500.00, 2),
(4, 'GeForce RTX 4070 GPU', 'ASUS Dual GeForce RTX 4070 GPU', 'Graphics Card', 59900.00, 1);

-- D. Seed Warehouses
INSERT INTO warehouses (WarehouseID, WarehouseName, Location, Capacity) VALUES 
(1, 'Bangalore Central Hub', 'Electronic City, Bangalore', 50000),
(2, 'Chennai Port Depot', 'Ennore Port, Chennai', 75000),
(3, 'Hyderabad Logistics Central', 'Gachibowli, Hyderabad', 30000);

-- E. Seed Inventory Stock
INSERT INTO inventory (InventoryID, ProductID, WarehouseID, Quantity, MinimumStock) VALUES 
(1, 1, 1, 50, 15), (2, 2, 1, 120, 20), (3, 3, 1, 85, 10), (4, 4, 1, 18, 5),
(5, 1, 2, 30, 15), (6, 2, 2, 70, 20),  (7, 3, 2, 50, 10), (8, 4, 2, 12, 5),
(9, 1, 3, 10, 15),  (10, 2, 3, 85, 20),  (11, 3, 3, 8, 10),  (12, 4, 3, 2, 5);

-- F. Seed Purchase Orders
INSERT INTO purchase_orders (PurchaseOrderID, SupplierID, WarehouseID, Status, TotalAmount, OrderDate) VALUES 
(1, 1, 1, 'Received', 1425000.00, '2026-07-10 10:00:00'),
(2, 2, 1, 'Received', 504000.00, '2026-07-11 09:30:00'),
(3, 3, 3, 'Pending', 340000.00, '2026-07-16 10:00:00');

-- Seed PO Items
INSERT INTO purchase_order_items (ItemID, PurchaseOrderID, ProductID, Quantity, UnitPrice) VALUES 
(1, 1, 1, 50, 28500.00), -- 50 CPUs to WH 1
(2, 2, 2, 120, 4200.00), -- 120 RAMs to WH 1
(3, 3, 3, 40, 8500.00);  -- 40 SSDs to WH 3 (Pending)

-- G. Seed Sales Orders
INSERT INTO sales_orders (SalesOrderID, CustomerName, WarehouseID, Status, TotalAmount, OrderDate) VALUES 
(1, 'Tagur Misra', 1, 'Delivered', 57000.00, '2026-07-14 10:15:00'),
(2, 'Tagur Misra', 3, 'Delivered', 171000.00, '2026-07-14 11:15:00'),
(3, 'Tagur Misra', 1, 'Shipped', 59900.00, '2026-07-16 08:30:00');

-- Seed SO Items
INSERT INTO sales_order_items (ItemID, SalesOrderID, ProductID, Quantity, UnitPrice) VALUES 
(1, 1, 1, 2, 28500.00),
(2, 2, 1, 6, 28500.00),
(3, 3, 4, 1, 59900.00);

-- H. Seed Shipments
INSERT INTO shipments (ShipmentID, SalesOrderID, WarehouseID, ShipmentDate, Status) VALUES 
(1, 3, 1, '2026-07-16 08:35:00', 'In Transit');

-- I. Seed Billing (Linked to Sales Orders)
INSERT INTO billing (BillID, SalesOrderID, Amount, PaymentMethod, PaymentStatus, PaymentDate) VALUES 
(1, 1, 57000.00, 'Card', 'Paid', '2026-07-14 10:20:00'),
(2, 2, 171000.00, 'Card', 'Paid', '2026-07-14 11:20:00');
