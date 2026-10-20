/**
 * Stock Master Native SVG Charting Engine
 * Draws responsive vector capacity bars and occupancy indicators with live hover tooltips.
 */

// Color Palette for Stock Capacity Utilizations (Slate Emerald Theme)
const CHART_COLORS = {
    low: "#10b981",      // Safe Emerald Green
    medium: "#fbbf24",   // Warning Amber Orange
    high: "#f43f5e"      // Congested Rose Red
};

// Global dynamic tooltip helpers
let tooltipDiv = null;
function getTooltip() {
    if (!tooltipDiv) {
        tooltipDiv = document.getElementById("chart-tooltip");
        if (!tooltipDiv) {
            tooltipDiv = document.createElement("div");
            tooltipDiv.id = "chart-tooltip";
            tooltipDiv.className = "chart-tooltip";
            document.body.appendChild(tooltipDiv);
        }
    }
    return tooltipDiv;
}

function showTooltip(e, content) {
    const t = getTooltip();
    t.innerHTML = content;
    t.style.opacity = "1";
    t.style.left = `${e.pageX + 15}px`;
    t.style.top = `${e.pageY - 15}px`;
}

function hideTooltip() {
    const t = getTooltip();
    if (t) t.style.opacity = "0";
}

function drawWarehouseCapacity(svgId, warehouses) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    // Clear old elements
    svg.innerHTML = "";

    const svgWidth = svg.clientWidth || 400;
    const barHeight = 8;
    const rowGap = 52;
    
    // Set SVG height dynamically based on the number of warehouses
    const totalHeight = warehouses.length * rowGap;
    svg.setAttribute("height", `${totalHeight}px`);
    svg.setAttribute("viewBox", `0 0 ${svgWidth} ${totalHeight}`);

    warehouses.forEach((wh, index) => {
        const yOffset = index * rowGap;
        
        // Assume each unit takes approximately 10 SqFt of warehouse volume space
        const spaceUsed = wh.current_stock * 10;
        const capacity = wh.capacity_sqft;
        const percent = Math.min(Math.round((spaceUsed / capacity) * 100), 100);

        // Determine color based on threshold boundaries
        let barColor = CHART_COLORS.low;
        if (percent >= 60 && percent < 85) {
            barColor = CHART_COLORS.medium;
        } else if (percent >= 85) {
            barColor = CHART_COLORS.high;
        }

        // 1. Group container
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.style.cursor = "pointer";
        
        // 2. Text: Warehouse Title
        const titleText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        titleText.setAttribute("x", "0");
        titleText.setAttribute("y", `${yOffset + 16}`);
        titleText.setAttribute("fill", "#ffffff");
        titleText.setAttribute("font-size", "12px");
        titleText.setAttribute("font-weight", "600");
        titleText.setAttribute("style", "transition: fill 0.2s ease;");
        titleText.textContent = wh.name;

        // 3. Text: Occupancy numbers
        const detailsText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        detailsText.setAttribute("x", `${svgWidth}`);
        detailsText.setAttribute("y", `${yOffset + 16}`);
        detailsText.setAttribute("fill", "#64748b");
        detailsText.setAttribute("font-size", "11px");
        detailsText.setAttribute("text-anchor", "end");
        detailsText.textContent = `${wh.current_stock} items (${percent}% space occupied)`;

        // 4. Background Track Rect
        const trackRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        trackRect.setAttribute("x", "0");
        trackRect.setAttribute("y", `${yOffset + 28}`);
        trackRect.setAttribute("width", `${svgWidth}`);
        trackRect.setAttribute("height", `${barHeight}`);
        trackRect.setAttribute("rx", "4");
        trackRect.setAttribute("fill", "rgba(255, 255, 255, 0.03)");
        trackRect.setAttribute("stroke", "rgba(255, 255, 255, 0.02)");
        trackRect.setAttribute("style", "transition: all 0.2s ease;");

        // 5. Fill Progress Rect (with transition animation)
        const fillWidth = (percent / 100) * svgWidth;
        const fillRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        fillRect.setAttribute("x", "0");
        fillRect.setAttribute("y", `${yOffset + 28}`);
        fillRect.setAttribute("width", "0"); // Start at 0 for load animation
        fillRect.setAttribute("height", `${barHeight}`);
        fillRect.setAttribute("rx", "4");
        fillRect.setAttribute("fill", barColor);
        
        // Add subtle drop shadow glows
        fillRect.setAttribute("style", `filter: drop-shadow(0px 0px 4px ${barColor}55); transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1), y 0.2s ease, height 0.2s ease;`);

        // Interactive mouse events on hover
        g.addEventListener("mouseenter", () => {
            titleText.setAttribute("fill", barColor);
            fillRect.setAttribute("height", `${barHeight + 3}`);
            fillRect.setAttribute("y", `${yOffset + 26.5}`);
            trackRect.setAttribute("height", `${barHeight + 3}`);
            trackRect.setAttribute("y", `${yOffset + 26.5}`);
        });

        g.addEventListener("mouseleave", () => {
            titleText.setAttribute("fill", "#ffffff");
            fillRect.setAttribute("height", `${barHeight}`);
            fillRect.setAttribute("y", `${yOffset + 28}`);
            trackRect.setAttribute("height", `${barHeight}`);
            trackRect.setAttribute("y", `${yOffset + 28}`);
            hideTooltip();
        });

        g.addEventListener("mousemove", (e) => {
            // Assume 1 unit = 10 SqFt limit calculations
            const freeSpace = capacity - spaceUsed;
            showTooltip(e, `
                <strong>${wh.name}</strong><br/>
                Stock Level: <strong>${wh.current_stock} units</strong><br/>
                Space Occupied: <strong>${spaceUsed.toLocaleString()} / ${capacity.toLocaleString()} SqFt</strong><br/>
                Usage Density: <strong>${percent}% space utilized</strong><br/>
                Free Space: <strong>${freeSpace.toLocaleString()} SqFt remaining</strong>
            `);
        });

        // Append to hierarchy
        g.appendChild(titleText);
        g.appendChild(detailsText);
        g.appendChild(trackRect);
        g.appendChild(fillRect);
        svg.appendChild(g);

        // Trigger transition layout frame
        setTimeout(() => {
            fillRect.setAttribute("width", `${fillWidth}`);
        }, 100);
    });
}
