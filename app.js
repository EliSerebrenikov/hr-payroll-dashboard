// Global Datasets & Charts Instances
let employeesData = [];
let reconciliationData = [];
let charts = {};

// Constant Business Thresholds & Date
const LATEST_MONTH = '2024-12';

// Helper to check for ghost employee leakage dynamically across schema versions
function isGhostLeak(row) {
    if ('system_alert_flag' in row) {
        return row.system_alert_flag === 'Severe Leak: Paid Terminated Account';
    } else if ('ghost_employee_alert' in row) {
        return row.ghost_employee_alert === true || row.ghost_employee_alert === 'True' || row.ghost_employee_alert === 'true';
    }
    return false;
}

// Document Ready
document.addEventListener("DOMContentLoaded", () => {
    loadData();
});

// Switch Dashboard Tabs
function switchTab(tabId) {
    // Update Menu Items active state
    document.querySelectorAll(".menu-item").forEach(btn => {
        btn.classList.remove("active");
    });
    event.currentTarget.classList.add("active");
    
    // Toggle Tab Panels
    document.querySelectorAll(".tab-panel").forEach(panel => {
        panel.classList.remove("active");
    });
    document.getElementById(`tab-${tabId}`).classList.add("active");
}

// Load CSV Datasets from server
function loadData() {
    // Load Consolidated Employees
    Papa.parse('consolidated_employees.csv', {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            employeesData = results.data;
            
            // Load Site Reconciliation
            Papa.parse('site_reconciliation.csv', {
                download: true,
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: function(resultsRecon) {
                    reconciliationData = resultsRecon.data;
                    
                    // Initialize Filters and Render Dashboard
                    initializeFilters();
                    applyFilters();
                }
            });
        }
    });
}

// Populate Filter Selection Dropdowns dynamically
function initializeFilters() {
    const sites = new Set();
    const depts = new Set();
    const titles = new Set();
    
    employeesData.forEach(row => {
        if (row.site) sites.add(row.site);
        if (row.department) depts.add(row.department);
        if (row.job_title) titles.add(row.job_title);
    });
    
    populateDropdown('filter-site', Array.from(sites).sort());
    populateDropdown('filter-dept', Array.from(depts).sort());
    populateDropdown('filter-title', Array.from(titles).sort());
}

// Helper to populate select elements
function populateDropdown(elementId, values) {
    const dropdown = document.getElementById(elementId);
    dropdown.innerHTML = `<option value="ALL">${dropdown.options[0].text}</option>`;
    
    values.forEach(val => {
        const option = document.createElement("option");
        option.value = val;
        option.textContent = val;
        dropdown.appendChild(option);
    });
}

// Reset Global Filters
function resetFilters() {
    document.getElementById("filter-site").value = "ALL";
    document.getElementById("filter-dept").value = "ALL";
    document.getElementById("filter-title").value = "ALL";
    applyFilters();
}

// Apply Filters & Recalculate KPIs/Charts
function applyFilters() {
    const selectedSite = document.getElementById("filter-site").value;
    const selectedDept = document.getElementById("filter-dept").value;
    const selectedTitle = document.getElementById("filter-title").value;
    
    // 1. Filter Employees Dataset
    const filteredEmployees = employeesData.filter(row => {
        const matchSite = (selectedSite === "ALL" || row.site === selectedSite);
        const matchDept = (selectedDept === "ALL" || row.department === selectedDept);
        const matchTitle = (selectedTitle === "ALL" || row.job_title === selectedTitle);
        return matchSite && matchDept && matchTitle;
    });
    
    // 2. Filter Reconciliation Dataset
    const filteredRecon = reconciliationData.filter(row => {
        return (selectedSite === "ALL" || row.site === selectedSite);
    });
    
    // Update dashboard components
    updateKPIs(filteredEmployees, filteredRecon, selectedSite, selectedDept, selectedTitle);
    renderCharts(filteredEmployees, filteredRecon, selectedSite);
    renderTables(filteredEmployees);
    updateDataQualityCards(filteredEmployees);
}

// Calculate & Render KPI Cards
function updateKPIs(employees, recon, siteFilter, deptFilter, titleFilter) {
    // A. Active Headcount (For Latest Month)
    const latestActive = employees.filter(row => row.year_month === LATEST_MONTH && row.consolidated_status === 'Active');
    const headcount = latestActive.length;
    document.getElementById("kpi-headcount").textContent = headcount.toLocaleString();
    
    // B. Ghost Leakage Cost (Sum of gross salary for Severe Leak alerts across all months)
    const ghostRecords = employees.filter(isGhostLeak);
    const ghostCost = ghostRecords.reduce((sum, row) => sum + (row.gross_salary || 0), 0);
    document.getElementById("kpi-ghost").textContent = `$${ghostCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const ghostCard = document.querySelector('[data-kpi="ghost"]');
    const ghostTrend = document.getElementById("kpi-ghost-trend");
    if (ghostCost > 0) {
        ghostCard.classList.add("warning-card");
        ghostTrend.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Action Required (${ghostRecords.length} leaks)`;
    } else {
        ghostCard.classList.remove("warning-card");
        ghostTrend.innerHTML = `<i class="fa-solid fa-circle-check"></i> System Secured`;
    }
    
    // C. Payroll Overruns (Sum of salary variance for non-ghost accounts across all months)
    const normalPayroll = employees.filter(row => !isGhostLeak(row));
    const overrun = normalPayroll.reduce((sum, row) => sum + (row.salary_variance || 0), 0);
    const overrunEl = document.getElementById("kpi-overrun");
    const overrunTrend = document.getElementById("kpi-overrun-trend");
    
    overrunEl.textContent = `${overrun < 0 ? '-' : ''}$${Math.abs(overrun).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (overrun > 0) {
        overrunEl.className = "value text-amber";
        overrunTrend.innerHTML = `<i class="fa-solid fa-chart-line"></i> Cumulative Overrun`;
    } else {
        overrunEl.className = "value text-teal";
        overrunTrend.innerHTML = `<i class="fa-solid fa-circle-check"></i> Budget Surplus`;
    }
    
    // D. Turnover Rate 2024
    const terms2024 = employees.filter(row => row.status_hcm === 'Terminated' && row.year_month.startsWith('2024'));
    const uniqueTerms = new Set(terms2024.map(r => r.employee_id)).size;
    
    const monthlyActiveCounts = {};
    const months2024 = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'];
    months2024.forEach(m => {
        monthlyActiveCounts[m] = employees.filter(row => row.year_month === m && row.consolidated_status === 'Active').length;
    });
    
    const activeValues = Object.values(monthlyActiveCounts);
    const sumActive = activeValues.reduce((a, b) => a + b, 0);
    const avgActive = activeValues.length > 0 ? (sumActive / activeValues.length) : 0;
    
    const turnoverRate = avgActive > 0 ? (uniqueTerms / avgActive) * 100 : 0;
    document.getElementById("kpi-turnover").textContent = `${turnoverRate.toFixed(2)}%`;
    
    // E. Open Roles (Latest Month)
    if (deptFilter !== "ALL" || titleFilter !== "ALL") {
        document.getElementById("kpi-open-roles").textContent = "N/A";
    } else {
        const latestRecon = recon.filter(row => row.year_month === LATEST_MONTH);
        const openRoles = latestRecon.reduce((sum, row) => sum + (row.open_roles || 0), 0);
        document.getElementById("kpi-open-roles").textContent = openRoles.toLocaleString();
    }
}

// Render Dashboard Charts
function renderCharts(employees, recon, siteFilter) {
    // Destroy existing charts to prevent rendering overlapping errors
    Object.keys(charts).forEach(key => {
        if (charts[key]) charts[key].destroy();
    });
    
    // A. Headcount Trend Line Chart (HCM Active vs Site Reported)
    // Always use the full list of 24 months to keep the X-axis stable!
    const months = Array.from(new Set(employeesData.map(row => row.year_month))).sort();
    
    const selectedSite = document.getElementById("filter-site").value;
    const selectedDept = document.getElementById("filter-dept").value;
    const selectedTitle = document.getElementById("filter-title").value;
    
    const hcmTrend = months.map(m => {
        return employees.filter(row => row.year_month === m && row.consolidated_status === 'Active').length;
    });
    
    const siteTrend = months.map(m => {
        // Calculate total active HCM employees for the selected site (unfiltered by dept/title)
        const siteHcmRows = employeesData.filter(row => 
            row.year_month === m && 
            row.consolidated_status === 'Active' && 
            (selectedSite === "ALL" || row.site === selectedSite)
        );
        const totalHcmActive = siteHcmRows.length;
        
        // Calculate filtered active HCM employees (filtered by site, dept, title)
        const filteredHcmRows = employees.filter(row => 
            row.year_month === m && 
            row.consolidated_status === 'Active'
        );
        const filteredHcmActive = filteredHcmRows.length;
        
        // Ratio of this subset in the site/company headcount
        const ratio = totalHcmActive > 0 ? (filteredHcmActive / totalHcmActive) : 0;
        
        // Raw reported headcount for the selected site
        const reconForMonth = reconciliationData.filter(row => 
            row.year_month === m && 
            (selectedSite === "ALL" || row.site === selectedSite)
        );
        const rawSiteCount = reconForMonth.reduce((sum, row) => sum + (row.reported_headcount || 0), 0);
        
        // Apportioned reported headcount
        return Math.round(rawSiteCount * ratio);
    });
    
    const ctxHeadcount = document.getElementById('chart-headcount').getContext('2d');
    charts.headcount = new Chart(ctxHeadcount, {
        type: 'line',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Central Active Headcount (HCM)',
                    data: hcmTrend,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Manual Reported Headcount (Site)',
                    data: siteTrend,
                    borderColor: '#f59e0b',
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // B. Annual Turnover Rate by Site Bar Chart
    const sites = Array.from(new Set(employeesData.map(row => row.site))).sort();
    const siteTurnovers = sites.map(s => {
        const siteTerms = employeesData.filter(row => row.site === s && row.status_hcm === 'Terminated' && row.year_month.startsWith('2024'));
        const uniqueSiteTerms = new Set(siteTerms.map(r => r.employee_id)).size;
        
        const monthlyActive = [];
        const months2024 = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'];
        months2024.forEach(m => {
            monthlyActive.push(employeesData.filter(row => row.site === s && row.year_month === m && row.consolidated_status === 'Active').length);
        });
        
        const sumActive = monthlyActive.reduce((a, b) => a + b, 0);
        const avgActive = monthlyActive.length > 0 ? (sumActive / monthlyActive.length) : 0;
        
        return avgActive > 0 ? ((uniqueSiteTerms / avgActive) * 100).toFixed(2) : 0;
    });

    const ctxTurnover = document.getElementById('chart-turnover').getContext('2d');
    charts.turnover = new Chart(ctxTurnover, {
        type: 'bar',
        data: {
            labels: sites,
            datasets: [{
                label: 'Turnover Rate (%)',
                data: siteTurnovers,
                backgroundColor: ['#6366f1', '#14b8a6', '#0ea5e9', '#f59e0b', '#ec4899'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // C. Recruitment Velocity: Open Roles vs New Hires by Site
    const openRolesTrend = sites.map(s => {
        const siteRecon = reconciliationData.filter(row => row.site === s);
        const total = siteRecon.reduce((sum, row) => sum + (row.open_roles || 0), 0);
        return siteRecon.length > 0 ? (total / siteRecon.length).toFixed(1) : 0;
    });
    
    const newHiresTrend = sites.map(s => {
        const siteRecon = reconciliationData.filter(row => row.site === s);
        const total = siteRecon.reduce((sum, row) => sum + (row.new_hires || 0), 0);
        return siteRecon.length > 0 ? (total / siteRecon.length).toFixed(1) : 0;
    });
    
    const ctxRecruitment = document.getElementById('chart-recruitment').getContext('2d');
    charts.recruitment = new Chart(ctxRecruitment, {
        type: 'bar',
        data: {
            labels: sites,
            datasets: [
                {
                    label: 'Avg Open Roles Requisitions',
                    data: openRolesTrend,
                    backgroundColor: '#ec4899',
                    borderRadius: 6
                },
                {
                    label: 'Avg Monthly New Hires',
                    data: newHiresTrend,
                    backgroundColor: '#10b981',
                    borderRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // D. Monthly Terminations & Turnover Rate Trend (Dual Y-Axis Line/Bar Chart)
    const termTrendData = months.map(m => {
        const terms = employees.filter(row => row.year_month === m && row.status_hcm === 'Terminated').length;
        const active = employees.filter(row => row.year_month === m && row.consolidated_status === 'Active').length;
        const rate = active > 0 ? (terms / active) * 100 : 0;
        return { terms, rate };
    });
    const termCounts = termTrendData.map(d => d.terms);
    const termRates = termTrendData.map(d => d.rate);

    const ctxTermsTrend = document.getElementById('chart-terminations-trend').getContext('2d');
    charts.terminationsTrend = new Chart(ctxTermsTrend, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [
                {
                    label: 'Terminations (Count)',
                    data: termCounts,
                    backgroundColor: 'rgba(244, 63, 94, 0.6)',
                    borderColor: '#f43f5e',
                    borderWidth: 1,
                    yAxisID: 'y',
                    borderRadius: 4
                },
                {
                    label: 'Turnover Rate (%)',
                    data: termRates,
                    borderColor: '#14b8a6',
                    backgroundColor: 'transparent',
                    borderWidth: 2.5,
                    type: 'line',
                    yAxisID: 'y1',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8' } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'Terminations Count', color: '#94a3b8' }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'Turnover Rate (%)', color: '#94a3b8' }
                }
            }
        }
    });

    // E. Annual Employee Turnover Rate by Department Bar Chart (2024)
    const departments = Array.from(new Set(employees.map(row => row.department))).filter(Boolean).sort();
    const months2024 = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06', '2024-07', '2024-08', '2024-09', '2024-10', '2024-11', '2024-12'];
    const deptTurnovers = departments.map(d => {
        const deptEmp2024 = employees.filter(row => row.department === d && row.year_month.startsWith('2024'));
        const deptTerms = deptEmp2024.filter(row => row.status_hcm === 'Terminated');
        const uniqueTerms = new Set(deptTerms.map(r => r.employee_id)).size;
        
        const monthlyActive = [];
        months2024.forEach(m => {
            monthlyActive.push(deptEmp2024.filter(row => row.year_month === m && row.consolidated_status === 'Active').length);
        });
        const sumActive = monthlyActive.reduce((a, b) => a + b, 0);
        const avgActive = monthlyActive.length > 0 ? (sumActive / monthlyActive.length) : 0;
        
        return avgActive > 0 ? ((uniqueTerms / avgActive) * 100).toFixed(2) : 0;
    });

    const ctxTurnoverDept = document.getElementById('chart-turnover-dept').getContext('2d');
    charts.turnoverDept = new Chart(ctxTurnoverDept, {
        type: 'bar',
        data: {
            labels: departments,
            datasets: [{
                label: 'Turnover Rate (%)',
                data: deptTurnovers,
                backgroundColor: ['#6366f1', '#14b8a6', '#0ea5e9', '#f59e0b', '#ec4899', '#10b981', '#f43f5e'],
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // F. Cumulative Payroll Budget Variance by Department
    const deptVariances = departments.map(d => {
        const deptEmployees = employees.filter(row => row.department === d && !isGhostLeak(row));
        return deptEmployees.reduce((sum, row) => sum + (row.salary_variance || 0), 0).toFixed(0);
    });

    const ctxSalaryVariance = document.getElementById('chart-salary-variance').getContext('2d');
    charts.salaryVariance = new Chart(ctxSalaryVariance, {
        type: 'bar',
        data: {
            labels: departments,
            datasets: [{
                label: 'Cumulative Salary Variance ($)',
                data: deptVariances,
                backgroundColor: deptVariances.map(v => v >= 0 ? '#10b981' : '#f43f5e'),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    // G. Monthly Ghost Employee Leakage Cost Trend
    const ghostMonthlyTrend = months.map(m => {
        const monthlyGhosts = employees.filter(row => row.year_month === m && isGhostLeak(row));
        return monthlyGhosts.reduce((sum, row) => sum + (row.gross_salary || 0), 0);
    });

    const ctxGhostTrend = document.getElementById('chart-ghost-trend').getContext('2d');
    charts.ghostTrend = new Chart(ctxGhostTrend, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Leakage Cost ($)',
                data: ghostMonthlyTrend,
                backgroundColor: '#f43f5e',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
            }
        }
    });
}

// Render dynamic tables
function renderTables(employees) {
    // 1. Cost Center Budget Efficiency Table
    const costCenterData = {};
    employees.forEach(row => {
        if (!row.cost_center) return;
        if (!costCenterData[row.cost_center]) {
            costCenterData[row.cost_center] = { headcount: 0, expected: 0, paid: 0, variance: 0 };
        }
        
        costCenterData[row.cost_center].expected += (row.expected_monthly_salary || 0);
        costCenterData[row.cost_center].paid += (row.gross_salary || 0);
        costCenterData[row.cost_center].variance += (row.salary_variance || 0);
        
        if (row.year_month === LATEST_MONTH && row.consolidated_status === 'Active') {
            costCenterData[row.cost_center].headcount++;
        }
    });
    
    const ccTableBody = document.querySelector("#cost-center-table tbody");
    ccTableBody.innerHTML = "";
    
    const sortedCCs = Object.keys(costCenterData).sort((a, b) => costCenterData[b].variance - costCenterData[a].variance);
    
    sortedCCs.forEach(cc => {
        const metrics = costCenterData[cc];
        const row = document.createElement("tr");
        
        const isOverrun = metrics.variance > 0;
        const statusBadge = isOverrun 
            ? `<span class="badge badge-rose"><i class="fa-solid fa-caret-up"></i> Overrun</span>`
            : `<span class="badge" style="background-color: rgba(16,185,129,0.15); color: #10b981;"><i class="fa-solid fa-caret-down"></i> Under</span>`;
            
        row.innerHTML = `
            <td><strong>${cc}</strong></td>
            <td>${metrics.headcount}</td>
            <td>$${metrics.expected.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            <td>$${metrics.paid.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            <td class="${isOverrun ? 'text-rose' : 'text-teal'}">${isOverrun ? '+' : ''}$${metrics.variance.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            <td>${statusBadge}</td>
        `;
        ccTableBody.appendChild(row);
    });
    
    // 2. Salary Benchmarking Table
    const titleSalaries = {};
    employees.filter(row => row.consolidated_status === 'Active').forEach(row => {
        if (!row.job_title || !row.site) return;
        const key = `${row.site}_${row.job_title}`;
        if (!titleSalaries[key]) {
            titleSalaries[key] = { site: row.site, job_title: row.job_title, salaries: [] };
        }
        titleSalaries[key].salaries.push(row.expected_monthly_salary || 0);
    });
    
    Object.keys(titleSalaries).forEach(key => {
        const vals = titleSalaries[key].salaries;
        titleSalaries[key].avg = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });
    
    let belowAvgTotalCount = 0;
    const belowAvgByTitle = {};
    
    employees.filter(row => row.year_month === LATEST_MONTH && row.consolidated_status === 'Active').forEach(row => {
        const key = `${row.site}_${row.job_title}`;
        if (titleSalaries[key] && row.expected_monthly_salary < titleSalaries[key].avg) {
            belowAvgTotalCount++;
            if (!belowAvgByTitle[row.job_title]) {
                belowAvgByTitle[row.job_title] = { job_title: row.job_title, avg: titleSalaries[key].avg, count: 0 };
            }
            belowAvgByTitle[row.job_title].count++;
        }
    });
    
    document.getElementById("below-avg-count").textContent = belowAvgTotalCount.toLocaleString();
    
    const benchmarkTableBody = document.querySelector("#salary-benchmarking-table tbody");
    benchmarkTableBody.innerHTML = "";
    
    const sortedTitles = Object.keys(belowAvgByTitle).sort((a, b) => belowAvgByTitle[b].count - belowAvgByTitle[a].count);
    sortedTitles.forEach(t => {
        const item = belowAvgByTitle[t];
        const row = document.createElement("tr");
        row.innerHTML = `
            <td><strong>${item.job_title}</strong></td>
            <td>$${item.avg.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
            <td class="text-amber"><i class="fa-solid fa-arrow-down-long"></i> ${item.count} employees</td>
        `;
        benchmarkTableBody.appendChild(row);
    });
    
    // 3. Active Ghost Employees Interventions Table
    const activeGhosts = employees.filter(row => row.year_month === LATEST_MONTH && isGhostLeak(row));
    document.getElementById("ghost-alert-count").textContent = `${activeGhosts.length} Alerts Pending`;
    
    const ghostTableBody = document.querySelector("#ghost-employees-table tbody");
    ghostTableBody.innerHTML = "";
    
    if (activeGhosts.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = `<td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">No active ghost employee leakage payroll records detected. System is clean.</td>`;
        ghostTableBody.appendChild(row);
    } else {
        activeGhosts.forEach(g => {
            const row = document.createElement("tr");
            row.className = "row-warning";
            row.innerHTML = `
                <td><code>${g.employee_id}</code></td>
                <td><strong>${g.full_name || 'Ghost Employee'}</strong></td>
                <td>${g.department || 'N/A'}</td>
                <td>${g.site || 'N/A'}</td>
                <td><span class="badge" style="background-color: rgba(244,63,94,0.15); color: #f43f5e;">Terminated</span></td>
                <td><span class="badge" style="background-color: rgba(16,185,129,0.15); color: #10b981;">Active Paid</span></td>
                <td class="text-rose" style="font-weight: 700;">$${(g.gross_salary || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                <td><span class="badge badge-rose"><i class="fa-solid fa-hand-holding-dollar"></i> Hold Payment & Audit</span></td>
            `;
            ghostTableBody.appendChild(row);
        });
    }
}

// Update Data Quality Metric Cards
function updateDataQualityCards(employees) {
    document.getElementById("dq-duplicates").textContent = "329";
    document.getElementById("dq-cost-centers").textContent = "705";
    document.getElementById("dq-managers").textContent = "1,053";
    
    const activeGhostsCount = employees.filter(isGhostLeak).length;
    document.getElementById("dq-ghosts").textContent = activeGhostsCount.toLocaleString();
}
