from flask import Flask, jsonify, request, send_from_directory, session, Response
import db_manager
import os
import csv
import io
import time
from datetime import datetime

app = Flask(__name__, static_folder="static")
app.secret_key = "stockmaster_fresh_auth_session_v3"

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

# ====================================================================
# LIVE SQL QUERY CONSOLE (REVIEW 2 VIVA SPOT EXECUTION)
# ====================================================================

@app.route("/api/sql/execute", methods=["POST"])
def api_sql_execute():
    data = request.json or {}
    query = (data.get("sql") or "").strip()
    if not query:
        return jsonify({"error": "Empty query string. Please type an SQL query."}), 400
    
    conn = db_manager.get_db_connection()
    conn.execute("PRAGMA foreign_keys = ON;")
    cursor = conn.cursor()
    start = time.time()
    try:
        cursor.execute(query)
        if query.lower().startswith(("select", "pragma", "with", "explain")):
            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            data_rows = [list(r) for r in rows]
            elapsed = round((time.time() - start) * 1000, 2)
            return jsonify({
                "success": True,
                "columns": columns,
                "rows": data_rows,
                "row_count": len(data_rows),
                "elapsed_ms": elapsed
            })
        else:
            conn.commit()
            elapsed = round((time.time() - start) * 1000, 2)
            return jsonify({
                "success": True,
                "columns": ["Status"],
                "rows": [[f"Statement executed successfully. {cursor.rowcount} row(s) affected."]],
                "row_count": cursor.rowcount,
                "elapsed_ms": elapsed
            })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

# ====================================================================
# REVIEW 2: AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
# ====================================================================

@app.route("/api/auth/me")
def api_auth_me():
    user_id = session.get("user_id")
    if user_id:
        user = db_manager.get_user_by_id(user_id)
        if user:
            return jsonify({"authenticated": True, "user": user})
    return jsonify({"authenticated": False, "user": None})

@app.route("/api/auth/login", methods=["POST"])
def api_auth_login():
    data = request.json or {}
    email = data.get("email") or data.get("identifier") or ""
    password = data.get("password", "")
    portal_role = data.get("portal_role")  # Optional "Admin" or "Warehouse Staff"
    res = db_manager.authenticate_user(email, password, required_role=portal_role)
    if res.get("success"):
        session["user_id"] = res["user"]["UserID"]
        session["user_role"] = res["user"]["Role"]
        return jsonify(res)
    return jsonify({"error": res.get("error", "Invalid email or password")}), 401

@app.route("/api/auth/logout", methods=["GET", "POST"])
def api_auth_logout():
    session.clear()
    return jsonify({"success": True})

@app.route("/api/auth/switch", methods=["POST"])
def api_auth_switch():
    data = request.json or {}
    user_id = data.get("user_id")
    role = data.get("role")
    
    if role:
        # Quick switch helper for Review 2 presentation
        if role == "Admin":
            user = db_manager.get_user_by_id(1)
        else:
            user = db_manager.get_user_by_id(2)
    elif user_id:
        user = db_manager.get_user_by_id(user_id)
    else:
        return jsonify({"error": "No user or role specified"}), 400

    if user:
        session["user_id"] = user["UserID"]
        return jsonify({"success": True, "user": user})
    return jsonify({"error": "User not found"}), 404

@app.route("/api/users")
def api_users():
    return jsonify(db_manager.get_all_users())

# ====================================================================
# REVIEW 2: SMART DEMAND FORECASTING & PREDICTIVE RESTOCKING
# ====================================================================

@app.route("/api/analytics/forecasting")
def api_analytics_forecasting():
    return jsonify(db_manager.get_demand_forecasting())

@app.route("/api/analytics/quick-restock", methods=["POST"])
def api_quick_restock():
    data = request.json or {}
    prod_id = data.get("product_id")
    wh_id = data.get("warehouse_id", 1)
    qty = data.get("quantity")
    try:
        res = db_manager.quick_restock_po(prod_id, wh_id, qty)
        return jsonify(res)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ====================================================================
# REVIEW 2: SPREADSHEET OPERATIONS (CSV EXPORT)
# ====================================================================

@app.route("/api/export/<dataset>")
def api_export_csv(dataset):
    output = io.StringIO()
    writer = csv.writer(output)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"stockmaster_{dataset}_{timestamp}.csv"

    if dataset == "inventory":
        writer.writerow(["Warehouse Location", "Product Name", "Category", "Quantity (Units)", "Price (INR)", "Min Stock Limit", "Status"])
        items = db_manager.get_inventory()
        for i in items:
            status = "LOW STOCK" if i["Quantity"] <= i["MinimumStock"] else "IN STOCK"
            writer.writerow([i.get("WarehouseName"), i.get("ProductName"), i.get("ProductCategory"), i.get("Quantity"), i.get("Price"), i.get("MinimumStock"), status])

    elif dataset == "products":
        writer.writerow(["Product ID", "Product Name", "Category", "Unit Price (INR)", "Supplier Name"])
        items = db_manager.get_products()
        for p in items:
            writer.writerow([f"PRD-{p.get('ProductID')}", p.get("ProductName"), p.get("Category"), p.get("UnitPrice"), p.get("SupplierName")])

    elif dataset == "orders":
        writer.writerow(["Order Type", "Order ID", "Counterparty / Customer", "Warehouse", "Quantity", "Total Amount (INR)", "Status", "Date"])
        pos = db_manager.get_purchase_orders()
        for po in pos:
            writer.writerow(["PURCHASE", f"PO-{po.get('PurchaseOrderID')}", po.get("SupplierName"), po.get("WarehouseName"), po.get("Quantity"), po.get("TotalAmount"), po.get("Status"), po.get("OrderDate")])
        sos = db_manager.get_sales_orders()
        for so in sos:
            writer.writerow(["SALES", f"SO-{so.get('SalesOrderID')}", so.get("CustomerName"), so.get("WarehouseName"), so.get("Quantity"), so.get("TotalAmount"), so.get("Status"), so.get("OrderDate")])

    elif dataset == "billing":
        writer.writerow(["Bill ID", "Sales Order ID", "Customer Name", "Product Name", "Amount Due (INR)", "Payment Method", "Payment Status", "Payment Date"])
        bills = db_manager.get_billing()
        for b in bills:
            writer.writerow([f"BILL-{b.get('BillID')}", f"SO-{b.get('SalesOrderID')}", b.get("CustomerName"), b.get("ProductName"), b.get("Amount"), b.get("PaymentMethod"), b.get("PaymentStatus"), b.get("PaymentDate") or "Pending"])

    elif dataset == "forecasting":
        writer.writerow(["Product Name", "Category", "Unit Price (INR)", "Supplier", "Current Warehouse Stock", "Units Sold (Historic)", "Daily Burn Rate", "Days of Stock Remaining", "Stockout Risk Tier", "Suggested Reorder Qty", "Estimated PO Cost (INR)"])
        forecast = db_manager.get_demand_forecasting()
        for f in forecast:
            writer.writerow([f.get("ProductName"), f.get("Category"), f.get("UnitPrice"), f.get("SupplierName"), f.get("CurrentStock"), f.get("UnitsSold"), f.get("DailyVelocity"), f.get("DaysRemaining"), f.get("RiskLabel"), f.get("SuggestedQty"), f.get("EstimatedCost")])

    else:
        return jsonify({"error": f"Unknown export dataset: {dataset}"}), 404

    output.seek(0)
    return Response(
        output.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-type": "text/csv"
        }
    )

# 1. Dashboard summary route
@app.route("/api/summary")
def api_summary():
    return jsonify(db_manager.get_dashboard_summary())

# 2. Products catalog routes
@app.route("/api/products", methods=["GET", "POST"])
def api_products():
    if request.method == "GET":
        return jsonify(db_manager.get_products())
    data = request.json or {}
    try:
        db_manager.create_product(
            data.get("name"), data.get("category"), data.get("price"), data.get("supplier_id"), data.get("min_stock_threshold", 10)
        )
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 3. Suppliers routes
@app.route("/api/suppliers", methods=["GET", "POST"])
def api_suppliers():
    if request.method == "GET":
        return jsonify(db_manager.get_suppliers())
    data = request.json or {}
    try:
        db_manager.create_supplier(
            data.get("name"), data.get("phone"), data.get("email"), data.get("address")
        )
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 4. Warehouses routes
@app.route("/api/warehouses", methods=["GET", "POST"])
def api_warehouses():
    if request.method == "GET":
        return jsonify(db_manager.get_warehouses())
    data = request.json or {}
    try:
        db_manager.create_warehouse(data.get("name"), data.get("location"), data.get("capacity_sqft"))
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 5. Inventory dynamic routes
@app.route("/api/inventory")
def api_inventory():
    wh_id = request.args.get("warehouse_id", type=int)
    return jsonify(db_manager.get_inventory(warehouse_id=wh_id))

@app.route("/api/inventory/alerts")
def api_inventory_alerts():
    return jsonify(db_manager.get_low_stock_alerts())

# 6. Purchase Orders routes
@app.route("/api/orders/purchase", methods=["GET", "POST"])
def api_purchase_orders():
    if request.method == "GET":
        return jsonify(db_manager.get_purchase_orders())
    data = request.json or {}
    try:
        db_manager.create_purchase_order(
            data.get("supplier_id"), data.get("product_id"), data.get("warehouse_id"), data.get("quantity"), data.get("total_cost")
        )
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/orders/purchase/<int:po_id>/receive", methods=["POST"])
def api_receive_purchase(po_id):
    try:
        success = db_manager.receive_purchase_order(po_id)
        return jsonify({"success": success})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 7. Sales Orders routes
@app.route("/api/orders/sales", methods=["GET", "POST"])
def api_sales_orders():
    if request.method == "GET":
        return jsonify(db_manager.get_sales_orders())
    data = request.json or {}
    try:
        db_manager.create_sales_order(
            data.get("customer_name"), data.get("product_id"), data.get("warehouse_id"), data.get("quantity"), data.get("total_price"), data.get("payment_method")
        )
        return jsonify({"success": True})
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 8. Shipments routes
@app.route("/api/shipments")
def api_shipments():
    return jsonify(db_manager.get_shipments())

@app.route("/api/shipments/<int:shipment_id>/status", methods=["POST"])
def api_shipment_status(shipment_id):
    data = request.json or {}
    try:
        db_manager.update_shipment_status(shipment_id, data.get("status"))
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 9. Billing Ledger routes
@app.route("/api/billing")
def api_billing():
    return jsonify(db_manager.get_billing())

if __name__ == "__main__":
    db_manager.init_db(force=False)
    db_manager.ensure_demo_users()
    print("Starting 11-Table Inventory System backend with Review 2 Extensions...")
    app.run(host="0.0.0.0", port=5000, debug=True)
