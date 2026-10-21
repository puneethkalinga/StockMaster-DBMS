// ====================================================================
// STOCKMASTER - COMPLETE FRONTEND CLIENT & ROUTER
// Full 11-Table RBAC, Event Triggers, Multi-Depot Inventory & Analytics
// ====================================================================

// DOM Elements Cache
const views = document.querySelectorAll(".view-section");
const navItems = document.querySelectorAll(".nav-item");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const primaryActionBtn = document.getElementById("primary-action-btn");
const secondaryActionBtn = document.getElementById("secondary-action-btn");
const globalWarehouseFilter = document.getElementById("global-warehouse-filter");
const lowStockBanner = document.getElementById("low-stock-banner");
const lowStockBannerMessage = document.getElementById("low-stock-banner-message");
const loginGateway = document.getElementById("login-gateway-view");
const mainAppContainer = document.getElementById("main-app-container");

let activeView = "dashboard";
let selectedWarehouse = "all";
let filterLowStockOnly = false;
let currentUser = null;

// Safe Lucide icon rendering wrapper with microtask debouncing
let iconRefreshTimeout = null;
function refreshIcons() {
    if (iconRefreshTimeout) return;
    iconRefreshTimeout = requestAnimationFrame(() => {
        iconRefreshTimeout = null;
        if (window.lucide && typeof window.lucide.createIcons === "function") {
            try {
                window.lucide.createIcons();
            } catch (e) {
                console.warn("Lucide render notice:", e);
            }
        }
    });
}

// Global initialization on DOM ready
document.addEventListener("DOMContentLoaded", () => {
    registerEvents();
    initRouter();
    loadCurrentUser().then((isAuth) => {
        if (isAuth) {
            loadWarehouseFilter();
            loadViewData();
        }
    });
});

// ====================================================================
// AUTHENTICATION & SEPARATE LOGIN PORTALS (ADMIN & STAFF)
// ====================================================================

function showLoginGateway() {
    if (loginGateway) loginGateway.style.display = "flex";
    if (mainAppContainer) mainAppContainer.style.display = "none";
    refreshIcons();
}

function showApp() {
    if (loginGateway) loginGateway.style.display = "none";
    if (mainAppContainer) mainAppContainer.style.display = "grid";
    refreshIcons();
}

function loadCurrentUser() {
    return fetch("/api/auth/me")
        .then(res => res.json())
        .then(data => {
            if (data.authenticated && data.user) {
                currentUser = data.user;
                showApp();
                applyRBAC(currentUser);
                return true;
            } else {
                currentUser = null;
                showLoginGateway();
                return false;
            }
        })
        .catch(err => {
            console.error("Auth status error:", err);
            showLoginGateway();
            return false;
        });
}

function switchLoginPortal(role) {
    const adminTab = document.getElementById("tab-admin-portal");
    const staffTab = document.getElementById("tab-staff-portal");
    const adminForm = document.getElementById("portal-form-admin");
    const staffForm = document.getElementById("portal-form-staff");

    const adminErr = document.getElementById("admin-login-error");
    const staffErr = document.getElementById("staff-login-error");
    if (adminErr) adminErr.style.display = "none";
    if (staffErr) staffErr.style.display = "none";

    if (role === "Admin") {
        if (adminTab) adminTab.className = "portal-tab-btn active admin-tab";
        if (staffTab) staffTab.className = "portal-tab-btn staff-tab";
        if (adminForm) adminForm.style.display = "block";
        if (staffForm) staffForm.style.display = "none";
    } else {
        if (staffTab) staffTab.className = "portal-tab-btn active staff-tab";
        if (adminTab) adminTab.className = "portal-tab-btn admin-tab";
        if (staffForm) staffForm.style.display = "block";
        if (adminForm) adminForm.style.display = "none";
    }
    refreshIcons();
}



function submitPortalLogin(e, role) {
    e.preventDefault();
    if (role === "Admin") {
        const ident = document.getElementById("admin-login-email").value.trim();
        const pwd = document.getElementById("admin-login-password").value.trim();
        doPortalLogin(ident, pwd, "Admin");
    } else {
        const ident = document.getElementById("staff-login-email").value.trim();
        const pwd = document.getElementById("staff-login-password").value.trim();
        doPortalLogin(ident, pwd, "Warehouse Staff");
    }
}

function doPortalLogin(identifier, password, role) {
    const errorEl = role === "Admin" 
        ? document.getElementById("admin-login-error") 
        : document.getElementById("staff-login-error");
    
    if (errorEl) {
        errorEl.style.display = "none";
        errorEl.innerText = "";
    }

    fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password, portal_role: role })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success && data.user) {
            currentUser = data.user;
            showApp();
            applyRBAC(currentUser);
            loadWarehouseFilter();
            navigateTo("dashboard");
            loadViewData();
        } else {
            if (errorEl) {
                errorEl.innerText = data.error || "Authentication failed. Please verify credentials.";
                errorEl.style.display = "block";
            }
        }
    })
    .catch(err => {
        console.error("Login request error:", err);
        if (errorEl) {
            errorEl.innerText = "Network or server connection error. Please try again.";
            errorEl.style.display = "block";
        }
    });
}

function handleLogout() {
    fetch("/api/auth/logout", { method: "POST" })
        .then(() => {
            currentUser = null;
            // Close any open modals
            document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
            
            // Clear input fields so user types them manually
            const adminEmail = document.getElementById("admin-login-email");
            const adminPwd = document.getElementById("admin-login-password");
            const staffEmail = document.getElementById("staff-login-email");
            const staffPwd = document.getElementById("staff-login-password");
            if (adminEmail) adminEmail.value = "";
            if (adminPwd) adminPwd.value = "";
            if (staffEmail) staffEmail.value = "";
            if (staffPwd) staffPwd.value = "";

            // Reset errors
            const adminErr = document.getElementById("admin-login-error");
            const staffErr = document.getElementById("staff-login-error");
            if (adminErr) adminErr.style.display = "none";
            if (staffErr) staffErr.style.display = "none";

            showLoginGateway();
        })
        .catch(err => {
            console.warn("Logout error:", err);
            currentUser = null;
            showLoginGateway();
        });
}

function applyRBAC(user) {
    if (!user) return;

    // Update sidebar user badge
    const avatar = document.getElementById("current-user-avatar");
    const nameEl = document.getElementById("current-user-name");
    const roleBadge = document.getElementById("current-user-role-badge");

    if (nameEl) nameEl.innerText = user.Name;
    if (avatar) {
        const parts = user.Name.trim().split(" ");
        const initials = parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
        avatar.innerText = initials;
    }

    const isStaff = user.Role === "Warehouse Staff";
    if (roleBadge) {
        roleBadge.innerText = user.Role;
        roleBadge.className = isStaff ? "badge badge-amber" : "badge badge-green";
    }

    // Role-Based UI visibility
    // 1. Dashboard Financial Aggregates
    const financeIncome = document.getElementById("finance-income");
    const financeExpense = document.getElementById("finance-expense");
    const financeNet = document.getElementById("finance-net");

    if (financeIncome && financeExpense && financeNet) {
        if (isStaff) {
            financeIncome.innerText = "••••••";
            financeIncome.title = "Access Restricted: System Admin Only";
            financeExpense.innerText = "••••••";
            financeExpense.title = "Access Restricted: System Admin Only";
            financeNet.innerText = "••••••";
            financeNet.title = "Access Restricted: System Admin Only";
        }
    }

    // 2. Billing ledger sub-tab in Orders
    const billingTab = document.querySelector(".sub-tab-btn[data-sub-view='billing']");
    if (billingTab) {
        billingTab.style.display = isStaff ? "none" : "block";
    }

    // 3. Header Action buttons & permissions
    updateHeader();
    refreshIcons();
}



// ====================================================================
// ROUTER & NAVIGATION SYSTEM (NO RELOAD, INSTANT RESPONSE)
// ====================================================================

function initRouter() {
    // 1. Direct click listeners on sidebar navigation items
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetView = item.getAttribute("data-view");
            if (targetView) {
                navigateTo(targetView, true);
            }
        });
    });

    // 2. Hash change listener for browser back/forward buttons
    window.addEventListener("hashchange", () => {
        const hash = window.location.hash.replace("#", "") || "dashboard";
        if (hash !== activeView) {
            navigateTo(hash, false);
        }
    });

    // 3. Initial route resolution
    const initialHash = window.location.hash.replace("#", "") || "dashboard";
    navigateTo(initialHash, false);
}

function navigateTo(viewName, updateHash = true) {
    if (viewName === "inventory-low") {
        filterLowStockOnly = true;
        viewName = "inventory";
    } else {
        filterLowStockOnly = false;
    }

    activeView = viewName;

    // Update active class on nav items
    document.querySelectorAll(".nav-item").forEach(item => {
        if (item.getAttribute("data-view") === viewName) {
            item.classList.add("active");
        } else {
            item.classList.remove("active");
        }
    });

    // Update active class on view sections
    document.querySelectorAll(".view-section").forEach(sec => {
        if (sec.id === `${viewName}-view`) {
            sec.classList.add("active");
        } else {
            sec.classList.remove("active");
        }
    });

    if (updateHash && window.location.hash !== `#${viewName}`) {
        history.replaceState(null, "", `#${viewName}`);
    }

    updateHeader();
    if (currentUser) {
        loadViewData();
    }
    refreshIcons();
}

function updateHeader() {
    if (!primaryActionBtn || !secondaryActionBtn) return;

    primaryActionBtn.style.display = "flex";
    secondaryActionBtn.style.display = "flex";
    if (globalWarehouseFilter) globalWarehouseFilter.style.display = "block";

    const isStaff = currentUser && currentUser.Role === "Warehouse Staff";

    if (activeView === "dashboard") {
        if (pageTitle) pageTitle.innerText = "Dashboard";
        if (pageSubtitle) pageSubtitle.innerText = isStaff
            ? "Warehouse operations hub: live storage capacity, stock tracking, and demand forecasting."
            : "Central hub for warehouse statistics, stock levels, and ledger financials.";

        if (isStaff) {
            primaryActionBtn.style.display = "none";
            secondaryActionBtn.style.display = "none";
        } else {
            primaryActionBtn.innerHTML = `<i data-lucide="plus"></i> Add Product`;
            primaryActionBtn.onclick = () => openModal("product");
            secondaryActionBtn.innerHTML = "Add Warehouse";
            secondaryActionBtn.onclick = () => openModal("warehouse");
        }
    } else if (activeView === "products") {
        if (pageTitle) pageTitle.innerText = "Products Catalog";
        if (pageSubtitle) pageSubtitle.innerText = "Manage corporate product catalog specifications and alert limits.";
        if (isStaff) {
            primaryActionBtn.style.display = "none";
            secondaryActionBtn.style.display = "none";
        } else {
            primaryActionBtn.innerHTML = `<i data-lucide="plus"></i> Register SKU`;
            primaryActionBtn.onclick = () => openModal("product");
            secondaryActionBtn.innerHTML = "Add Supplier";
            secondaryActionBtn.onclick = () => openModal("supplier");
        }
    } else if (activeView === "inventory") {
        if (pageTitle) pageTitle.innerText = "Inventory Stock";
        if (pageSubtitle) pageSubtitle.innerText = filterLowStockOnly 
            ? "Check live stock quantities (Filtered: Low Stock Alert Items only)."
            : "Check live stock quantities currently housed in warehouse facilities.";
        if (isStaff) {
            primaryActionBtn.style.display = "none";
            secondaryActionBtn.style.display = "none";
        } else {
            primaryActionBtn.innerHTML = `<i data-lucide="plus"></i> Add Product`;
            primaryActionBtn.onclick = () => openModal("product");
            secondaryActionBtn.innerHTML = "Add Warehouse";
            secondaryActionBtn.onclick = () => openModal("warehouse");
        }
    } else if (activeView === "orders") {
        if (pageTitle) pageTitle.innerText = "Orders & Ledger";
        if (pageSubtitle) pageSubtitle.innerText = isStaff
            ? "Review stock purchase orders, dispatch shipments, and track fulfillment."
            : "Raise purchase orders, dispatch sales orders, and manage billings.";

        if (isStaff) {
            primaryActionBtn.style.display = "none";
            secondaryActionBtn.innerHTML = `<i data-lucide="plus"></i> Add PO`;
            secondaryActionBtn.onclick = () => openModal("po");
        } else {
            primaryActionBtn.innerHTML = `<i data-lucide="plus"></i> Place Sale`;
            primaryActionBtn.onclick = () => openModal("so");
            secondaryActionBtn.innerHTML = "Add PO";
            secondaryActionBtn.onclick = () => openModal("po");
        }
    } else if (activeView === "reports") {
        if (pageTitle) pageTitle.innerText = "Reports Summary";
        if (pageSubtitle) pageSubtitle.innerText = "Audit and print current inventory holdings and accounting levels.";
        primaryActionBtn.innerHTML = `<i data-lucide="printer"></i> Print Summary`;
        primaryActionBtn.onclick = () => window.print();
        secondaryActionBtn.style.display = "none";
    } else if (activeView === "sql-console") {
        if (pageTitle) pageTitle.innerText = "Live Relational SQL Console";
        if (pageSubtitle) pageSubtitle.innerText = "Execute ad-hoc SQL queries on the spot (PRAGMA foreign_keys = ON).";
        primaryActionBtn.style.display = "none";
        secondaryActionBtn.style.display = "none";
        if (globalWarehouseFilter) globalWarehouseFilter.style.display = "none";
    }
    refreshIcons();
}

// ====================================================================
// EVENT LISTENERS & MODAL MANAGEMENT (FAST, NO-STUCK CLICKS)
// ====================================================================

function registerEvents() {
    // 1. Global Warehouse Filter
    if (globalWarehouseFilter) {
        globalWarehouseFilter.addEventListener("change", (e) => {
            selectedWarehouse = e.target.value;
            loadViewData();
        });
    }

    // 2. Orders View Sub-Tabs Routing
    document.querySelectorAll(".sub-tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const subView = btn.getAttribute("data-sub-view");
            document.querySelectorAll(".sub-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            document.querySelectorAll(".sub-view-section").forEach(v => v.classList.remove("active"));
            const targetSection = document.getElementById(`subview-${subView}`);
            if (targetSection) targetSection.classList.add("active");

            loadSubView(subView);
        });
    });

    // 3. Modal Close Buttons (Specific targeting, no accidental secondary button closure)
    document.querySelectorAll("[data-close], .modal-close").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const modal = btn.closest(".modal-overlay");
            if (modal) modal.classList.remove("active");
        });
    });

    // 4. Modal Backdrop Clicks (Instant dismissal on clicking outside the card)
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                overlay.classList.remove("active");
            }
        });
    });

    // 5. Escape Key to dismiss modals
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".modal-overlay.active").forEach(m => m.classList.remove("active"));
        }
    });

    // 6. Form submissions
    const formWh = document.getElementById("form-warehouse");
    if (formWh) formWh.addEventListener("submit", submitWarehouse);

    const formProd = document.getElementById("form-product");
    if (formProd) formProd.addEventListener("submit", submitProduct);

    const formSupp = document.getElementById("form-supplier");
    if (formSupp) formSupp.addEventListener("submit", submitSupplier);

    const formPo = document.getElementById("form-po");
    if (formPo) formPo.addEventListener("submit", submitPO);

    const formSo = document.getElementById("form-so");
    if (formSo) formSo.addEventListener("submit", submitSO);

    // 7. Live SQL Console shortcut (Ctrl + Enter)
    const sqlArea = document.getElementById("sql-query-input");
    if (sqlArea) {
        sqlArea.addEventListener("keydown", (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                runLiveSQLQuery();
            }
        });
    }

}

// Modal open helper
function openModal(type) {
    const modal = document.getElementById(`modal-${type}`);
    if (!modal) return;

    modal.classList.add("active");

    if (type === "product") {
        fetch("/api/suppliers").then(res => res.json()).then(data => {
            const s = document.getElementById("prod-supplier");
            if (s) {
                let html = "";
                data.forEach(x => html += `<option value="${x.SupplierID}">${x.SupplierName}</option>`);
                s.innerHTML = html;
            }
        });
    } else if (type === "po") {
        fetch("/api/suppliers").then(res => res.json()).then(data => {
            const s = document.getElementById("po-supplier");
            if (s) {
                let html = "";
                data.forEach(x => html += `<option value="${x.SupplierID}">${x.SupplierName}</option>`);
                s.innerHTML = html;
            }
        });
        fetch("/api/products").then(res => res.json()).then(data => {
            const p = document.getElementById("po-product");
            if (p) {
                let html = "";
                data.forEach(x => html += `<option value="${x.ProductID}">${x.ProductName} (₹${x.UnitPrice.toFixed(2)})</option>`);
                p.innerHTML = html;
            }
        });
        fetch("/api/warehouses").then(res => res.json()).then(data => {
            const w = document.getElementById("po-warehouse");
            if (w) {
                let html = "";
                data.forEach(x => html += `<option value="${x.WarehouseID}">${x.WarehouseName}</option>`);
                w.innerHTML = html;
            }
        });
    } else if (type === "so") {
        fetch("/api/products").then(res => res.json()).then(data => {
            const p = document.getElementById("so-product");
            if (p) {
                let html = "";
                data.forEach(x => html += `<option value="${x.ProductID}">${x.ProductName} (₹${x.UnitPrice.toFixed(2)})</option>`);
                p.innerHTML = html;
            }
        });
        fetch("/api/warehouses").then(res => res.json()).then(data => {
            const w = document.getElementById("so-warehouse");
            if (w) {
                let html = "";
                data.forEach(x => html += `<option value="${x.WarehouseID}">${x.WarehouseName}</option>`);
                w.innerHTML = html;
            }
        });
    }
    refreshIcons();
}

function exportCSV(dataset) {
    window.location.href = `/api/export/${dataset}`;
}

// ====================================================================
// DATA LOADERS & API CONSUMPTION
// ====================================================================

function loadWarehouseFilter() {
    if (!globalWarehouseFilter) return;
    fetch("/api/warehouses")
        .then(res => res.json())
        .then(warehouses => {
            let html = '<option value="all">All Warehouses</option>';
            warehouses.forEach(w => {
                html += `<option value="${w.WarehouseID}">${w.WarehouseName}</option>`;
            });
            globalWarehouseFilter.innerHTML = html;
            if (selectedWarehouse) {
                globalWarehouseFilter.value = selectedWarehouse;
            }
        })
        .catch(err => console.error("Filter loading error:", err));
}

function checkAlerts() {
    fetch("/api/inventory/alerts")
        .then(res => res.json())
        .then(alerts => {
            if (lowStockBanner && lowStockBannerMessage) {
                if (alerts.length > 0) {
                    lowStockBanner.style.display = "flex";
                    lowStockBannerMessage.innerHTML = `<i data-lucide="alert-triangle" style="width: 14px; vertical-align: middle; margin-right: 6px; color: var(--error);"></i> Warning: <strong>${alerts.length}</strong> items are running below minimum stock alert thresholds!`;
                    refreshIcons();
                } else {
                    lowStockBanner.style.display = "none";
                }
            }
        })
        .catch(err => console.error("Alerts error:", err));
}

function loadViewData() {
    checkAlerts();
    if (activeView === "dashboard") loadDashboard();
    else if (activeView === "products") loadProducts();
    else if (activeView === "inventory") loadInventory();
    else if (activeView === "orders") {
        const activeSubBtn = document.querySelector(".sub-tab-btn.active");
        const activeSub = activeSubBtn ? activeSubBtn.getAttribute("data-sub-view") : "purchase";
        loadSubView(activeSub);
    }
    else if (activeView === "reports") loadReports();
}

// 1. Dashboard View Loader
function loadDashboard() {
    fetch("/api/summary")
        .then(res => res.json())
        .then(data => {
            const elWh = document.getElementById("kpi-warehouses");
            const elProd = document.getElementById("kpi-products");
            const elStock = document.getElementById("kpi-stock");
            const elShip = document.getElementById("kpi-shipments");

            if (elWh) elWh.innerText = data.warehouses_count || 0;
            if (elProd) elProd.innerText = data.products_count || 0;
            if (elStock) elStock.innerText = (data.total_stock || 0).toLocaleString();
            if (elShip) elShip.innerText = data.shipments_count || 0;

            const isStaff = currentUser && currentUser.Role === "Warehouse Staff";
            const financeIncome = document.getElementById("finance-income");
            const financeExpense = document.getElementById("finance-expense");
            const financeNet = document.getElementById("finance-net");

            if (financeIncome && financeExpense && financeNet) {
                if (isStaff) {
                    financeIncome.innerText = "••••••";
                    financeIncome.title = "Restricted: System Admin Only";
                    financeExpense.innerText = "••••••";
                    financeExpense.title = "Restricted: System Admin Only";
                    financeNet.innerText = "••••••";
                    financeNet.title = "Restricted: System Admin Only";
                } else {
                    financeIncome.innerText = `₹${(data.total_income || 0).toLocaleString()}`;
                    financeExpense.innerText = `₹${(data.total_expense || 0).toLocaleString()}`;
                    financeNet.innerText = `₹${(data.net_revenue || 0).toLocaleString()}`;
                    financeNet.style.color = (data.net_revenue || 0) < 0 ? "var(--error)" : "var(--accent-cyan)";
                }
            }

            if (typeof drawWarehouseCapacity === "function" && data.warehouses_utilization) {
                drawWarehouseCapacity("dashboard-capacity-chart", data.warehouses_utilization);
            }

            const list = document.getElementById("activity-feed-list");
            if (list) {
                let itemsHtml = "";
                (data.recent_activities || []).forEach(act => {
                    itemsHtml += `
                        <li class="activity-item">
                            <div class="activity-icon"><i data-lucide="activity"></i></div>
                            <div class="activity-details">
                                <span class="activity-title">${act.activity_type}: <strong>${act.details}</strong></span>
                                <span class="activity-time">${act.activity_date}</span>
                            </div>
                        </li>
                    `;
                });
                list.innerHTML = itemsHtml;
            }

            loadForecasting();
            refreshIcons();
        })
        .catch(err => console.error("Dashboard loading error:", err));
}

// 2. Predictive Demand Forecasting Loader
function loadForecasting() {
    const body = document.getElementById("forecasting-table-body");
    if (!body) return;

    fetch("/api/analytics/forecasting")
        .then(res => res.json())
        .then(items => {
            if (!items || items.length === 0) {
                body.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-muted); padding:24px;">No product velocity data available yet.</td></tr>`;
                return;
            }

            let html = "";
            items.forEach(f => {
                let badgeClass = "badge-green";
                let badgeIcon = "check-circle";
                if (f.Risk === "CRITICAL") {
                    badgeClass = "badge-red pulsing";
                    badgeIcon = "alert-octagon";
                } else if (f.Risk === "MODERATE") {
                    badgeClass = "badge-amber";
                    badgeIcon = "alert-triangle";
                }

                const safeName = (f.ProductName || "").replace(/'/g, "\\'");
                const autoDraftBtn = `<button class="btn btn-primary btn-small" onclick="autoDraftPO(${f.ProductID}, '${safeName}', ${f.SupplierID}, ${f.SuggestedQty}, ${f.UnitPrice})" style="white-space:nowrap;"><i data-lucide="shopping-cart"></i> Auto-Draft PO</button>`;

                html += `
                    <tr>
                        <td><strong>${f.ProductName}</strong></td>
                        <td><span class="badge badge-gray">${f.Category}</span></td>
                        <td style="font-weight:700;">${f.CurrentStock} units</td>
                        <td>${f.DailyVelocity} units/day</td>
                        <td style="font-weight:700; color:${f.DaysRemaining <= 7 ? 'var(--error)' : 'var(--text-white)'};">${f.DaysRemaining} days</td>
                        <td><span class="badge ${badgeClass}"><i data-lucide="${badgeIcon}" style="width:12px; height:12px; vertical-align:middle; margin-right:4px;"></i>${f.RiskLabel}</span></td>
                        <td style="color:var(--accent-cyan); font-weight:600;">+${f.SuggestedQty} units <span style="font-size:10px; color:var(--text-muted);">(₹${f.EstimatedCost.toLocaleString()})</span></td>
                        <td>${autoDraftBtn}</td>
                    </tr>
                `;
            });
            body.innerHTML = html;
            refreshIcons();
        })
        .catch(err => {
            console.error("Forecasting error:", err);
            body.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--error); padding:20px;">Failed to load predictive analytics.</td></tr>`;
        });
}

function autoDraftPO(productId, productName, supplierId, suggestedQty, unitPrice) {
    openModal('po');
    setTimeout(() => {
        const suppSelect = document.getElementById("po-supplier");
        const prodSelect = document.getElementById("po-product");
        const qtyInput = document.getElementById("po-qty");
        const costInput = document.getElementById("po-cost");

        if (suppSelect) suppSelect.value = supplierId;
        if (prodSelect) prodSelect.value = productId;
        if (qtyInput) qtyInput.value = suggestedQty;
        if (costInput) costInput.value = (suggestedQty * unitPrice).toFixed(2);
    }, 200);
}

// 3. Products Catalog View Loader
function loadProducts() {
    fetch("/api/products")
        .then(res => res.json())
        .then(products => {
            const body = document.getElementById("products-table-body");
            if (!body) return;
            let html = "";
            products.forEach(p => {
                html += `
                    <tr>
                        <td><code>PRD-${p.ProductID}</code></td>
                        <td><strong>${p.ProductName}</strong></td>
                        <td><span class="badge badge-gray">${p.Category}</span></td>
                        <td>₹${p.UnitPrice.toLocaleString()}</td>
                        <td>${p.SupplierName}</td>
                    </tr>
                `;
            });
            body.innerHTML = html;
            refreshIcons();
        })
        .catch(err => console.error("Products error:", err));
}

// 4. Inventory Stock View Loader
function loadInventory() {
    const url = selectedWarehouse === "all" ? "/api/inventory" : `/api/inventory?warehouse_id=${selectedWarehouse}`;
    fetch(url)
        .then(res => res.json())
        .then(inventory => {
            const body = document.getElementById("inventory-table-body");
            if (!body) return;

            let filtered = inventory;
            if (filterLowStockOnly) {
                filtered = inventory.filter(i => i.Quantity <= i.MinimumStock);
            }

            if (!filtered || filtered.length === 0) {
                body.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">No stock recorded matching criteria.</td></tr>`;
                return;
            }

            let html = "";
            filtered.forEach(i => {
                const isLow = i.Quantity <= i.MinimumStock;
                html += `
                    <tr>
                        <td><strong>${i.WarehouseName}</strong></td>
                        <td>${i.ProductName}</td>
                        <td><span class="badge badge-gray">${i.ProductCategory}</span></td>
                        <td style="font-weight:700; ${isLow ? 'color:var(--error);' : ''}">${i.Quantity} units</td>
                        <td>₹${i.Price.toLocaleString()}</td>
                        <td>${isLow ? '<span class="badge badge-red pulsing">LOW STOCK</span>' : '<span class="badge badge-green">IN STOCK</span>'}</td>
                    </tr>
                `;
            });
            body.innerHTML = html;
            refreshIcons();
        })
        .catch(err => console.error("Inventory error:", err));
}

// 5. Orders Sub-Tabs Loader
function loadSubView(sub) {
    if (sub === "purchase") {
        fetch("/api/orders/purchase")
            .then(res => res.json())
            .then(orders => {
                const body = document.getElementById("po-table-body");
                if (!body) return;
                let html = "";
                orders.forEach(o => {
                    const action = o.Status === "Pending" 
                        ? `<button class="btn btn-amber btn-small" onclick="receivePO(${o.PurchaseOrderID})">Mark Received</button>` 
                        : `<span style="color:var(--text-muted); font-style:italic;">Received</span>`;
                    html += `
                        <tr>
                            <td><code>PO-${o.PurchaseOrderID}</code></td>
                            <td><strong>${o.SupplierName}</strong></td>
                            <td>${o.ProductName}</td>
                            <td>${o.WarehouseName}</td>
                            <td>${o.Quantity} units</td>
                            <td>₹${o.TotalAmount.toLocaleString()}</td>
                            <td><span class="badge ${o.Status === 'Received' ? 'badge-green' : 'badge-blue pulsing'}">${o.Status}</span></td>
                            <td>${new Date(o.OrderDate).toLocaleDateString()}</td>
                            <td>${action}</td>
                        </tr>
                    `;
                });
                body.innerHTML = html;
                refreshIcons();
            });
    } else if (sub === "sales") {
        fetch("/api/orders/sales")
            .then(res => res.json())
            .then(orders => {
                const body = document.getElementById("sales-table-body");
                if (!body) return;
                let html = "";
                orders.forEach(o => {
                    html += `
                        <tr>
                            <td><code>SO-${o.SalesOrderID}</code></td>
                            <td><strong>${o.CustomerName}</strong></td>
                            <td>${o.ProductName}</td>
                            <td>${o.WarehouseName}</td>
                            <td>${o.Quantity} units</td>
                            <td>₹${o.TotalAmount.toLocaleString()}</td>
                            <td><span class="badge ${o.Status === 'Delivered' ? 'badge-green' : 'badge-blue'}">${o.Status}</span></td>
                            <td>${new Date(o.OrderDate).toLocaleDateString()}</td>
                        </tr>
                    `;
                });
                body.innerHTML = html;
                refreshIcons();
            });
    } else if (sub === "shipments") {
        fetch("/api/shipments")
            .then(res => res.json())
            .then(shipments => {
                const body = document.getElementById("shipments-table-body");
                if (!body) return;
                let html = "";
                shipments.forEach(s => {
                    const isDelivered = s.Status === "Delivered";
                    const action = isDelivered 
                        ? `<span style="color:var(--text-muted); font-style:italic;">Concluded</span>` 
                        : `<button class="btn btn-amber btn-small" onclick="progressShipment(${s.ShipmentID}, '${s.Status}')">Progress Status</button>`;
                    html += `
                        <tr>
                            <td><code>SH-${s.ShipmentID}</code></td>
                            <td><code>SO-${s.SalesOrderID}</code></td>
                            <td>${s.WarehouseName}</td>
                            <td>${new Date(s.ShipmentDate).toLocaleDateString()}</td>
                            <td><span class="badge ${isDelivered ? 'badge-green' : 'badge-blue pulsing'}">${s.Status}</span></td>
                            <td>${action}</td>
                        </tr>
                    `;
                });
                body.innerHTML = html;
                refreshIcons();
            });
    } else if (sub === "billing") {
        fetch("/api/billing")
            .then(res => res.json())
            .then(billing => {
                const body = document.getElementById("billing-table-body");
                if (!body) return;
                let html = "";
                billing.forEach(b => {
                    html += `
                        <tr>
                            <td><code>INV-${b.BillID}</code></td>
                            <td><code>SO-${b.SalesOrderID}</code></td>
                            <td><strong>${b.CustomerName}</strong></td>
                            <td style="font-weight:700; color:var(--success);">+ ₹${b.Amount.toLocaleString()}</td>
                            <td><code>${b.PaymentMethod}</code></td>
                            <td><span class="badge badge-green">${b.PaymentStatus}</span></td>
                        </tr>
                    `;
                });
                body.innerHTML = html;
                refreshIcons();
            });
    }
}

function receivePO(poId) {
    fetch(`/api/orders/purchase/${poId}/receive`, { method: "POST" })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                loadViewData();
            }
        });
}

function progressShipment(id, currentStatus) {
    const nextStatus = currentStatus === "Processing" ? "In Transit" : "Delivered";
    fetch(`/api/shipments/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            loadSubView("shipments");
        }
    });
}

// 6. Reports Summary View
function loadReports() {
    const dateEl = document.getElementById("report-date-string");
    if (dateEl) dateEl.innerText = new Date().toLocaleString();

    fetch("/api/summary")
        .then(res => res.json())
        .then(data => {
            const whEl = document.getElementById("report-wh-count");
            const prodEl = document.getElementById("report-prod-count");
            const suppEl = document.getElementById("report-supp-count");
            const stockEl = document.getElementById("report-stock-sum");
            const warnEl = document.getElementById("report-warnings-count");

            if (whEl) whEl.innerText = data.warehouses_count;
            if (prodEl) prodEl.innerText = data.products_count;
            if (suppEl) suppEl.innerText = data.suppliers_count;
            if (stockEl) stockEl.innerText = (data.total_stock || 0) + " units";
            if (warnEl) warnEl.innerText = data.low_stock_count;

            const revEl = document.getElementById("report-revenue-sum");
            const expEl = document.getElementById("report-expense-sum");
            const netEl = document.getElementById("report-net-balance");

            if (revEl) revEl.innerText = `₹${(data.total_income || 0).toLocaleString()}`;
            if (expEl) expEl.innerText = `₹${(data.total_expense || 0).toLocaleString()}`;
            if (netEl) netEl.innerText = `₹${(data.net_revenue || 0).toLocaleString()}`;

            const body = document.getElementById("report-warehouse-summary-body");
            if (body && data.warehouses_utilization) {
                let html = "";
                data.warehouses_utilization.forEach(wh => {
                    const usage = wh.current_stock * 10;
                    const pct = Math.min(Math.round((usage / wh.capacity_sqft) * 100), 100);
                    html += `
                        <tr style="border-bottom:1px solid rgba(255,255,255,0.03);">
                            <td><strong>${wh.name}</strong></td>
                            <td style="text-align:right;">${wh.capacity_sqft.toLocaleString()} SqFt</td>
                            <td style="text-align:right;">${wh.current_stock} units</td>
                            <td style="text-align:right; font-weight:600; color:${pct > 85 ? 'var(--error)' : 'var(--success)'}">${pct}%</td>
                        </tr>
                    `;
                });
                body.innerHTML = html;
            }
            refreshIcons();
        });
}

// ====================================================================
// FORM SUBMISSION HANDLERS
// ====================================================================

function submitWarehouse(e) {
    e.preventDefault();
    fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: document.getElementById("wh-name").value,
            location: document.getElementById("wh-location").value,
            capacity_sqft: document.getElementById("wh-capacity").value
        })
    }).then(res => res.json()).then(() => {
        document.getElementById("modal-warehouse").classList.remove("active");
        document.getElementById("form-warehouse").reset();
        loadWarehouseFilter();
        loadViewData();
    });
}

function submitProduct(e) {
    e.preventDefault();
    fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: document.getElementById("prod-name").value,
            category: document.getElementById("prod-category").value,
            price: document.getElementById("prod-price").value,
            supplier_id: document.getElementById("prod-supplier").value,
            min_stock_threshold: document.getElementById("prod-threshold").value
        })
    }).then(res => res.json()).then(() => {
        document.getElementById("modal-product").classList.remove("active");
        document.getElementById("form-product").reset();
        loadViewData();
    });
}

function submitSupplier(e) {
    e.preventDefault();
    fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: document.getElementById("supp-name").value,
            phone: document.getElementById("supp-phone").value,
            email: document.getElementById("supp-email").value,
            address: document.getElementById("supp-address").value
        })
    }).then(res => res.json()).then(() => {
        document.getElementById("modal-supplier").classList.remove("active");
        document.getElementById("form-supplier").reset();
        loadViewData();
    });
}

function submitPO(e) {
    e.preventDefault();
    fetch("/api/orders/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            supplier_id: document.getElementById("po-supplier").value,
            product_id: document.getElementById("po-product").value,
            warehouse_id: document.getElementById("po-warehouse").value,
            quantity: document.getElementById("po-qty").value,
            total_cost: document.getElementById("po-cost").value
        })
    }).then(res => res.json()).then(() => {
        document.getElementById("modal-po").classList.remove("active");
        document.getElementById("form-po").reset();
        loadSubView("purchase");
    });
}

function submitSO(e) {
    e.preventDefault();
    fetch("/api/orders/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            customer_name: document.getElementById("so-customer").value,
            product_id: document.getElementById("so-product").value,
            warehouse_id: document.getElementById("so-warehouse").value,
            quantity: document.getElementById("so-qty").value,
            total_price: document.getElementById("so-price").value,
            payment_method: document.getElementById("so-pay").value
        })
    }).then(res => res.json()).then(data => {
        if (data.error) {
            alert(data.error);
        } else {
            document.getElementById("modal-so").classList.remove("active");
            document.getElementById("form-so").reset();
            loadSubView("sales");
            checkAlerts();
        }
    });
}

// ====================================================================
// LIVE SQL QUERY CONSOLE ENGINE
// ====================================================================

const SQL_TEMPLATES = {
    "4way": `SELECT 
    p.ProductID, p.ProductName, p.Category, w.WarehouseName, 
    s.SupplierName, i.Quantity AS StockOnHand, p.UnitPrice, 
    (i.Quantity * p.UnitPrice) AS TotalValueINR 
FROM inventory i 
INNER JOIN products p ON i.ProductID = p.ProductID 
INNER JOIN warehouses w ON i.WarehouseID = w.WarehouseID 
INNER JOIN suppliers s ON p.SupplierID = s.SupplierID 
WHERE i.Quantity > 0 
ORDER BY TotalValueINR DESC 
LIMIT 10;`,

    "capacity": `SELECT 
    w.WarehouseID, w.WarehouseName, w.Location, w.Capacity,
    COUNT(DISTINCT i.ProductID) AS DistinctProducts,
    SUM(i.Quantity) AS TotalStockUnits,
    ROUND((SUM(i.Quantity) * 100.0) / w.Capacity, 2) AS OccupancyPct
FROM warehouses w
INNER JOIN inventory i ON w.WarehouseID = i.WarehouseID
GROUP BY w.WarehouseID, w.WarehouseName, w.Location, w.Capacity
ORDER BY OccupancyPct DESC;`,

    "alerts": `SELECT 
    w.WarehouseName, p.ProductName, p.Category, 
    i.Quantity AS CurrentStock, i.MinimumStock,
    (i.MinimumStock - i.Quantity) AS DeficitUnits
FROM inventory i
JOIN products p ON i.ProductID = p.ProductID
JOIN warehouses w ON i.WarehouseID = w.WarehouseID
WHERE i.Quantity <= i.MinimumStock
ORDER BY DeficitUnits DESC;`,

    "deadstock": `SELECT 
    p.ProductID, p.ProductName, p.Category, p.UnitPrice, s.SupplierName
FROM products p
JOIN suppliers s ON p.SupplierID = s.SupplierID
WHERE NOT EXISTS (
    SELECT 1 FROM sales_order_items soi WHERE soi.ProductID = p.ProductID
);`,

    "tables": `SELECT name AS TableName, type AS ObjectType 
FROM sqlite_master 
WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' 
ORDER BY type, name;`
};

function setSQLTemplate(type) {
    const input = document.getElementById("sql-query-input");
    if (input && SQL_TEMPLATES[type]) {
        input.value = SQL_TEMPLATES[type];
        runLiveSQLQuery();
    }
}

function clearSQLConsole() {
    const input = document.getElementById("sql-query-input");
    if (input) input.value = "";
    const thead = document.getElementById("sql-results-thead");
    const tbody = document.getElementById("sql-results-tbody");
    const metrics = document.getElementById("sql-result-metrics");
    const status = document.getElementById("sql-status-indicator");
    if (thead) thead.innerHTML = "<tr><th>Result</th></tr>";
    if (tbody) tbody.innerHTML = "<tr><td style='text-align:center; color:var(--text-muted); padding:30px;'>Query cleared. Type a new query above.</td></tr>";
    if (metrics) metrics.innerText = "0 rows";
    if (status) status.innerHTML = "Press <strong>Execute Query</strong> or <strong>Ctrl + Enter</strong> to run.";
}

function runLiveSQLQuery() {
    const input = document.getElementById("sql-query-input");
    const status = document.getElementById("sql-status-indicator");
    const metrics = document.getElementById("sql-result-metrics");
    const thead = document.getElementById("sql-results-thead");
    const tbody = document.getElementById("sql-results-tbody");
    const btn = document.getElementById("btn-run-sql");

    if (!input) return;
    const sql = input.value.trim();
    if (!sql) {
        if (status) status.innerHTML = "<span style='color:var(--error);'>Please enter an SQL query first.</span>";
        return;
    }

    if (btn) btn.disabled = true;
    if (status) status.innerHTML = "<span style='color:var(--accent-cyan);'>Executing query against database...</span>";

    fetch("/api/sql/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql })
    })
    .then(res => res.json())
    .then(data => {
        if (btn) btn.disabled = false;
        if (data.error) {
            if (status) status.innerHTML = `<span style='color:var(--error);'>Error: ${data.error}</span>`;
            if (thead) thead.innerHTML = "<tr><th style='color:var(--error);'>SQL Error</th></tr>";
            if (tbody) tbody.innerHTML = `<tr><td style='color:var(--error); padding:20px; font-family:monospace;'>${data.error}</td></tr>`;
            if (metrics) metrics.innerText = "Execution failed";
            return;
        }

        if (status) status.innerHTML = `<span style='color:var(--success);'>Execution successful in ${data.elapsed_ms} ms (${data.row_count} rows).</span>`;
        if (metrics) metrics.innerText = `${data.row_count} row${data.row_count !== 1 ? 's' : ''} in ${data.elapsed_ms} ms`;

        // Build Table Header
        let thHtml = "<tr>";
        (data.columns || []).forEach(col => {
            thHtml += `<th>${col}</th>`;
        });
        thHtml += "</tr>";
        if (thead) thead.innerHTML = thHtml;

        // Build Table Body
        if (!data.rows || data.rows.length === 0) {
            if (tbody) tbody.innerHTML = "<tr><td colspan='100%' style='text-align:center; color:var(--text-muted); padding:20px;'>0 records matched query.</td></tr>";
            return;
        }

        let tbHtml = "";
        data.rows.forEach(row => {
            tbHtml += "<tr>";
            row.forEach(cell => {
                const val = cell === null ? "<span style='color:var(--text-muted); font-style:italic;'>NULL</span>" : cell;
                tbHtml += `<td>${val}</td>`;
            });
            tbHtml += "</tr>";
        });
        if (tbody) tbody.innerHTML = tbHtml;
        refreshIcons();
    })
    .catch(err => {
        if (btn) btn.disabled = false;
        if (status) status.innerHTML = `<span style='color:var(--error);'>Network error: ${err.message}</span>`;
    });
}
