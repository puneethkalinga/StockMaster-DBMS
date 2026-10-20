import sqlite3
import os
import random

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "inventory_system.db")
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.row_factory = sqlite3.Row
    return conn

def init_db(force=False):
    if force or not os.path.exists(DB_PATH):
        conn = get_db_connection()
        try:
            with open(SCHEMA_PATH, 'r') as f:
                conn.executescript(f.read())
            conn.commit()
        finally:
            conn.close()

def execute_query(query, args=(), one=False):
    conn = get_db_connection()
    try:
        cur = conn.execute(query, args)
        rv = cur.fetchall()
        conn.commit()
        return (rv[0] if rv else None) if one else [dict(row) for row in rv]
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

# CRUD operations mapping directly to Report Database Keys
def get_products():
    return execute_query("""SELECT p.*, s.SupplierName 
                            FROM products p 
                            INNER JOIN suppliers s ON p.SupplierID = s.SupplierID 
                            ORDER BY p.ProductName ASC;""")

def get_suppliers(): return execute_query("SELECT * FROM suppliers ORDER BY SupplierName ASC;")
def get_warehouses(): return execute_query("SELECT * FROM warehouses ORDER BY WarehouseID ASC;")

def create_product(name, category, price, supplier_id, min_stock=10):
    conn = get_db_connection()
    try:
        cur = conn.execute("INSERT INTO products(ProductName, Description, Category, UnitPrice, SupplierID) VALUES(?,?,?,?,?);", 
                           (name, f"{name} {category}", category, float(price), int(supplier_id)))
        prod_id = cur.lastrowid
        # Seed inventory mapping for this product in all warehouses with 0 quantity
        whs = conn.execute("SELECT WarehouseID FROM warehouses;").fetchall()
        for wh in whs:
            conn.execute("INSERT INTO inventory(ProductID, WarehouseID, Quantity, MinimumStock) VALUES(?,?,0,?);",
                         (prod_id, wh['WarehouseID'], int(min_stock)))
        conn.commit()
        return prod_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def create_warehouse(name, location, capacity):
    conn = get_db_connection()
    try:
        cur = conn.execute("INSERT INTO warehouses(WarehouseName, Location, Capacity) VALUES(?,?,?);", 
                           (name, location, int(capacity)))
        wh_id = cur.lastrowid
        # Seed inventory mapping for all existing products in this new warehouse with 0 quantity
        prods = conn.execute("SELECT ProductID FROM products;").fetchall()
        for p in prods:
            conn.execute("INSERT INTO inventory(ProductID, WarehouseID, Quantity, MinimumStock) VALUES(?,?,0,10);",
                         (p['ProductID'], wh_id))
        conn.commit()
        return wh_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def create_supplier(name, phone, email, address):
    return execute_query("INSERT INTO suppliers(SupplierName, Phone, Email, Address) VALUES(?,?,?,?);", 
                         (name, phone, email, address))

# Dynamic inventory lists (using standard tables)
def get_inventory(warehouse_id=None):
    q = """SELECT i.WarehouseID, w.WarehouseName, i.ProductID, p.ProductName, 
                  p.Category as ProductCategory, p.UnitPrice as Price, i.Quantity, i.MinimumStock
           FROM inventory i
           INNER JOIN products p ON i.ProductID = p.ProductID
           INNER JOIN warehouses w ON i.WarehouseID = w.WarehouseID"""
    return execute_query(q + " WHERE i.WarehouseID = ?;" if warehouse_id else q + ";", (warehouse_id,) if warehouse_id else ())

# low stock alert reads directly from view
def get_low_stock_alerts():
    return execute_query("SELECT * FROM low_stock_alerts_view;")

# Purchase Orders Restocking Transaction (11 tables model)
def get_purchase_orders():
    q = """SELECT po.PurchaseOrderID, po.SupplierID, s.SupplierName, po.WarehouseID, w.WarehouseName, po.OrderDate, po.Status, po.TotalAmount,
                  poi.ProductID, p.ProductName, poi.Quantity, poi.UnitPrice
           FROM purchase_orders po
           INNER JOIN suppliers s ON po.SupplierID = s.SupplierID
           INNER JOIN warehouses w ON po.WarehouseID = w.WarehouseID
           LEFT JOIN purchase_order_items poi ON po.PurchaseOrderID = poi.PurchaseOrderID
           LEFT JOIN products p ON poi.ProductID = p.ProductID
           ORDER BY po.PurchaseOrderID DESC;"""
    return execute_query(q)

def create_purchase_order(supplier_id, product_id, warehouse_id, qty, cost):
    conn = get_db_connection()
    try:
        # 1. Create Purchase Order header
        cur = conn.execute("INSERT INTO purchase_orders(SupplierID, WarehouseID, Status, TotalAmount) VALUES(?,?, 'Pending', ?);",
                           (int(supplier_id), int(warehouse_id), float(cost)))
        po_id = cur.lastrowid
        # 2. Insert PO line items
        unit_price = float(cost) / int(qty)
        conn.execute("INSERT INTO purchase_order_items(PurchaseOrderID, ProductID, Quantity, UnitPrice) VALUES(?,?,?,?);",
                     (po_id, int(product_id), int(qty), unit_price))
        conn.commit()
        return po_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def receive_purchase_order(po_id):
    """Fulfills a PO: sets status to 'Received' (automatic stock increment is handled by SQL triggers!)."""
    conn = get_db_connection()
    try:
        po = conn.execute("SELECT * FROM purchase_orders WHERE PurchaseOrderID = ?;", (po_id,)).fetchone()
        if not po or po['Status'] == 'Received':
            return False
            
        # Update PO Status to Received. The after_po_receive Trigger handles stock updates dynamically!
        conn.execute("UPDATE purchase_orders SET Status = 'Received' WHERE PurchaseOrderID = ?;", (po_id,))
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

# Sales Orders Dispatch Transaction (11 tables model)
def get_sales_orders():
    q = """SELECT so.SalesOrderID, so.CustomerName, so.WarehouseID, w.WarehouseName, so.OrderDate, so.Status, so.TotalAmount,
                  soi.ProductID, p.ProductName, soi.Quantity, soi.UnitPrice
           FROM sales_orders so
           INNER JOIN warehouses w ON so.WarehouseID = w.WarehouseID
           LEFT JOIN sales_order_items soi ON so.SalesOrderID = soi.SalesOrderID
           LEFT JOIN products p ON soi.ProductID = p.ProductID
           ORDER BY so.SalesOrderID DESC;"""
    return execute_query(q)

def create_sales_order(customer_name, product_id, warehouse_id, qty, price, pay_method):
    """
    ACID Transaction dispatching SO: 
    1. Inserts sales order headers.
    2. Inserts sales order line items. The SQL Trigger after_so_item_insert handles stock reduction.
       If quantity drops below zero, SQLite constraint fails and rolls back everything!
    """
    conn = get_db_connection()
    try:
        # 1. Create Sales Order header
        cur = conn.execute("INSERT INTO sales_orders(CustomerName, WarehouseID, Status, TotalAmount) VALUES(?,?, 'Pending', ?);",
                           (customer_name, int(warehouse_id), float(price)))
        so_id = cur.lastrowid
        
        # 2. Insert Sales Order line item (Triggers auto-stock check and reduction)
        unit_price = float(price) / int(qty)
        try:
            conn.execute("INSERT INTO sales_order_items(SalesOrderID, ProductID, Quantity, UnitPrice) VALUES(?,?,?,?);",
                         (so_id, int(product_id), int(qty), unit_price))
        except sqlite3.IntegrityError as ie:
            # Handle check constraint violation on inventory.Quantity
            raise ValueError(f"Sufficient stock not available in this warehouse. Check quantity limits.")

        # 3. Create Shipping log
        conn.execute("INSERT INTO shipments(SalesOrderID, WarehouseID, Status) VALUES(?,?, 'Processing');",
                     (so_id, int(warehouse_id)))
                     
        # 4. Generate Billing Invoice record
        conn.execute("INSERT INTO billing(SalesOrderID, Amount, PaymentMethod, PaymentStatus) VALUES(?,?,?,'Paid');",
                     (so_id, float(price), pay_method))
                     
        conn.commit()
        return so_id
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

# Shipments and Billing Invoices
def get_shipments():
    return execute_query("""SELECT s.*, w.WarehouseName, p.ProductName, so.CustomerName
                            FROM shipments s
                            INNER JOIN warehouses w ON s.WarehouseID = w.WarehouseID
                            INNER JOIN sales_orders so ON s.SalesOrderID = so.SalesOrderID
                            LEFT JOIN sales_order_items soi ON so.SalesOrderID = soi.SalesOrderID
                            LEFT JOIN products p ON soi.ProductID = p.ProductID
                            ORDER BY s.ShipmentID DESC;""")

def update_shipment_status(shipment_id, status):
    conn = get_db_connection()
    try:
        conn.execute("UPDATE shipments SET Status = ? WHERE ShipmentID = ?;", (status, shipment_id))
        if status == "Delivered":
            # Sync Sales Order delivery status
            conn.execute("UPDATE sales_orders SET Status = 'Delivered' WHERE SalesOrderID = (SELECT SalesOrderID FROM shipments WHERE ShipmentID = ?);",
                         (shipment_id,))
            # Sync invoice payment date
            conn.execute("UPDATE billing SET PaymentDate = CURRENT_TIMESTAMP WHERE SalesOrderID = (SELECT SalesOrderID FROM shipments WHERE ShipmentID = ?);",
                         (shipment_id,))
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        conn.close()

def get_billing():
    return execute_query("""SELECT b.*, so.CustomerName, p.ProductName
                            FROM billing b
                            INNER JOIN sales_orders so ON b.SalesOrderID = so.SalesOrderID
                            LEFT JOIN sales_order_items soi ON so.SalesOrderID = soi.SalesOrderID
                            LEFT JOIN products p ON soi.ProductID = p.ProductID
                            ORDER BY b.BillID DESC;""")

# Dashboard aggregation statistics
def get_dashboard_summary():
    summary = {}
    summary['warehouses_count'] = execute_query("SELECT COUNT(*) FROM warehouses;", one=True)[0]
    summary['products_count'] = execute_query("SELECT COUNT(*) FROM products;", one=True)[0]
    summary['suppliers_count'] = execute_query("SELECT COUNT(*) FROM suppliers;", one=True)[0]
    summary['shipments_count'] = execute_query("SELECT COUNT(*) FROM shipments WHERE Status != 'Delivered';", one=True)[0]
    summary['total_stock'] = execute_query("SELECT SUM(Quantity) FROM inventory;", one=True)[0] or 0
    summary['low_stock_count'] = len(get_low_stock_alerts())
    
    rev = execute_query("SELECT SUM(Amount) FROM billing WHERE PaymentStatus='Paid';", one=True)[0] or 0
    spd = execute_query("SELECT SUM(TotalAmount) FROM purchase_orders WHERE Status='Received';", one=True)[0] or 0
    summary['total_income'] = round(rev, 2)
    summary['total_expense'] = round(spd, 2)
    summary['net_revenue'] = round(rev - spd, 2)

    summary['warehouses_utilization'] = execute_query(
        "SELECT w.WarehouseID as id, w.WarehouseName as name, w.Capacity as capacity_sqft, COALESCE(SUM(i.Quantity),0) as current_stock FROM warehouses w LEFT JOIN inventory i ON w.WarehouseID = i.WarehouseID GROUP BY w.WarehouseID;"
    )
    
    summary['recent_activities'] = execute_query("""
        SELECT 'Supply Receipt' as activity_type, 'PO #' || PurchaseOrderID || ' received' as details, OrderDate as activity_date FROM purchase_orders WHERE Status = 'Received'
        UNION ALL
        SELECT 'Product Sale' as activity_type, 'SO #' || SalesOrderID || ' registered' as details, OrderDate as activity_date FROM sales_orders
        UNION ALL
        SELECT 'Carrier Shipment' as activity_type, 'Shipment #' || ShipmentID || ' - ' || Status as details, ShipmentDate as activity_date FROM shipments
        ORDER BY activity_date DESC LIMIT 6;""")
        
    return summary

# ====================================================================
# REVIEW 2 EXTENSIONS: AUTHENTICATION, RBAC & DEMAND FORECASTING
# ====================================================================

def ensure_demo_users():
    """Ensures primary demo accounts for Admin and Warehouse Staff exist with distinct, clean credentials."""
    conn = get_db_connection()
    try:
        # Check if Admin account exists
        admin = conn.execute("SELECT * FROM users WHERE Email = 'admin@warehouse.com' OR UserID = 1;").fetchone()
        if admin:
            conn.execute("UPDATE users SET Name = 'Puneeth Kumar', Email = 'admin@warehouse.com', Password = 'admin123', Role = 'Admin' WHERE UserID = ?;", (admin['UserID'],))
        else:
            conn.execute("INSERT INTO users (Name, Email, Password, Role) VALUES ('Puneeth Kumar', 'admin@warehouse.com', 'admin123', 'Admin');")
        
        # Check if Staff account exists
        staff = conn.execute("SELECT * FROM users WHERE Email = 'staff@warehouse.com' OR UserID = 2;").fetchone()
        if staff:
            conn.execute("UPDATE users SET Name = 'Vikram Singh', Email = 'staff@warehouse.com', Password = 'staff123', Role = 'Warehouse Staff' WHERE UserID = ?;", (staff['UserID'],))
        else:
            conn.execute("INSERT INTO users (Name, Email, Password, Role) VALUES ('Vikram Singh', 'staff@warehouse.com', 'staff123', 'Warehouse Staff');")
        
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"ensure_demo_users note: {e}")
    finally:
        conn.close()

def authenticate_user(identifier, password, required_role=None):
    """Validates user login credentials against the database with optional role enforcement."""
    conn = get_db_connection()
    try:
        ident = identifier.strip().lower() if identifier else ""
        pwd = password.strip() if password else ""
        
        # Check for user by email, or alias 'admin' / 'staff'
        user = conn.execute("""
            SELECT UserID, Name, Email, Password, Role 
            FROM users 
            WHERE (LOWER(Email) = ? OR (? = 'admin' AND Role = 'Admin') OR (? = 'staff' AND Role = 'Warehouse Staff'))
              AND Password = ?;
        """, (ident, ident, ident, pwd)).fetchone()
        
        if not user:
            # Fallback check by raw email without alias
            user = conn.execute("SELECT UserID, Name, Email, Password, Role FROM users WHERE LOWER(Email) = ? AND Password = ?;", (ident, pwd)).fetchone()

        if not user:
            return {"error": "Invalid email or password. Please verify your credentials."}
            
        u_dict = dict(user)
        if required_role and u_dict['Role'] != required_role:
            return {"error": f"Access Denied: This portal requires '{required_role}' credentials. Your account is '{u_dict['Role']}'."}
            
        del u_dict['Password']
        return {"success": True, "user": u_dict}
    finally:
        conn.close()

def get_user_by_id(user_id):
    """Retrieves safe user profile without returning sensitive password."""
    conn = get_db_connection()
    try:
        user = conn.execute("SELECT UserID, Name, Email, Role FROM users WHERE UserID = ?;", (int(user_id),)).fetchone()
        return dict(user) if user else None
    finally:
        conn.close()

def get_all_users():
    """Lists users for quick role switching during demo/testing."""
    return execute_query("SELECT UserID, Name, Email, Role FROM users ORDER BY UserID ASC LIMIT 25;")

def get_demand_forecasting():
    """Calculates product sales velocity, days until stockout, and smart restock recommendations."""
    query = """
        SELECT 
            p.ProductID,
            p.ProductName,
            p.Category,
            p.UnitPrice,
            s.SupplierID,
            s.SupplierName,
            COALESCE(SUM(i.Quantity), 0) AS CurrentTotalStock,
            COALESCE(sales_summary.TotalUnitsSold, 0) AS TotalUnitsSold,
            COALESCE(sales_summary.OrderCount, 0) AS OrderCount
        FROM products p
        INNER JOIN suppliers s ON p.SupplierID = s.SupplierID
        LEFT JOIN inventory i ON p.ProductID = i.ProductID
        LEFT JOIN (
            SELECT 
                soi.ProductID, 
                SUM(soi.Quantity) AS TotalUnitsSold,
                COUNT(DISTINCT soi.SalesOrderID) AS OrderCount
            FROM sales_order_items soi
            GROUP BY soi.ProductID
        ) sales_summary ON p.ProductID = sales_summary.ProductID
        GROUP BY p.ProductID
        ORDER BY CurrentTotalStock ASC;
    """
    products_data = execute_query(query)
    forecast_list = []

    for item in products_data:
        stock = item['CurrentTotalStock']
        sold = item['TotalUnitsSold']
        
        # Calculate daily burn rate (assume 14-day observation window, min baseline 0.6 units/day)
        daily_velocity = round(max(0.6, (sold / 14.0) if sold > 0 else 0.8), 1)
        
        # Days of coverage remaining
        days_left = round(stock / daily_velocity)
        
        # Determine risk tier
        if days_left <= 7 or stock <= 15:
            risk = "CRITICAL"
            risk_label = "Urgent Reorder"
        elif days_left <= 20:
            risk = "MODERATE"
            risk_label = "Moderate Run-rate"
        else:
            risk = "HEALTHY"
            risk_label = "Adequate Buffer"
            
        # Suggested PO Restock Quantity to provide 30-day buffer
        suggested_qty = max(20, round((30 * daily_velocity) - stock))
        estimated_po_cost = round(suggested_qty * item['UnitPrice'], 2)

        forecast_list.append({
            "ProductID": item['ProductID'],
            "ProductName": item['ProductName'],
            "Category": item['Category'],
            "UnitPrice": item['UnitPrice'],
            "SupplierID": item['SupplierID'],
            "SupplierName": item['SupplierName'],
            "CurrentStock": stock,
            "UnitsSold": sold,
            "DailyVelocity": daily_velocity,
            "DaysRemaining": days_left,
            "Risk": risk,
            "RiskLabel": risk_label,
            "SuggestedQty": suggested_qty,
            "EstimatedCost": estimated_po_cost
        })

    # Sort so that CRITICAL items appear first, then MODERATE, then HEALTHY
    priority_order = {"CRITICAL": 0, "MODERATE": 1, "HEALTHY": 2}
    forecast_list.sort(key=lambda x: (priority_order.get(x["Risk"], 3), x["DaysRemaining"]))
    return forecast_list

def quick_restock_po(product_id, warehouse_id=1, quantity=None):
    """Automatically drafts a purchase order based on predictive demand recommendation."""
    conn = get_db_connection()
    try:
        prod = conn.execute("SELECT ProductID, ProductName, UnitPrice, SupplierID FROM products WHERE ProductID = ?;", (product_id,)).fetchone()
        if not prod:
            raise ValueError(f"Product #{product_id} not found.")
            
        qty = int(quantity) if quantity else 30
        total_cost = round(qty * prod['UnitPrice'], 2)
        
        po_id = create_purchase_order(
            supplier_id=prod['SupplierID'],
            product_id=prod['ProductID'],
            warehouse_id=warehouse_id,
            quantity=qty,
            total_cost=total_cost
        )
        return {
            "success": True,
            "PurchaseOrderID": po_id,
            "ProductName": prod['ProductName'],
            "Quantity": qty,
            "TotalCost": total_cost
        }
    finally:
        conn.close()
