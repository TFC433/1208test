// public/scripts/opportunities.js
// 職責：管理「機會案件列表頁」的圖表、篩選、列表渲染與操作
// (V-Integrated: 整合晶片牆篩選器、包含項次與排序功能)

// ==================== 全域變數 (此頁面專用) ====================
let opportunitiesData = [];
// 用於反向查找篩選鍵值
let reverseNameMaps = {};

// 篩選與排序狀態
// 注意：現在 year, type, source, time 都可能從 ChipWall 傳入
let opportunitiesListFilters = { type: 'all', source: 'all', stage: 'all', probability: 'all', channel: 'all', scale: 'all', year: 'all', time: 'all' };
let currentOppSort = { field: 'effectiveLastActivity', direction: 'desc' };

// ==================== 主要功能函式 ====================

/**
 * 載入並渲染所有機會案件，並支援搜尋功能
 * @param {string} [query=''] - 搜尋關鍵字
 */
async function loadOpportunities(query = '') {
    const container = document.getElementById('page-opportunities');
    if (!container) return;

    // 渲染頁面骨架 (移除 #opportunities-list-filters 下拉選單)
    container.innerHTML = `
        <div id="opportunities-dashboard-container" class="dashboard-grid-flexible" style="margin-bottom: 24px;">
            <div class="loading show" style="grid-column: span 12;"><div class="spinner"></div><p>載入分析圖表中...</p></div>
        </div>

        <div id="opportunity-chip-wall-container" class="dashboard-widget" style="margin-bottom: 24px;">
            <div class="widget-header"><h2 class="widget-title">機會階段總覽 (晶片牆)</h2></div>
            <div class="widget-content">
                <div class="loading show"><div class="spinner"></div><p>載入晶片牆資料中...</p></div>
            </div>
        </div>

        <div class="dashboard-widget">
            <div class="widget-header">
                <h2 class="widget-title">機會案件列表</h2>
                <div id="opportunities-filter-status" style="display: none; align-items: center; gap: 10px;">
                    <span id="opportunities-filter-text" style="font-weight: 600;"></span>
                    <button class="action-btn small danger" onclick="clearAllOppFilters()">清除篩選</button>
                </div>
            </div>
            <div class="search-pagination" style="padding: 0 1.5rem 1rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
                <input type="text" class="search-box" id="opportunities-list-search" placeholder="搜尋機會名稱或客戶公司..." onkeyup="handleOpportunitiesSearch(event)" value="${query}" style="flex-grow: 1;">
                </div>
            <div id="opportunities-page-content" class="widget-content">
                <div class="loading show"><div class="spinner"></div><p>載入機會資料中...</p></div>
            </div>
        </div>
    `;

    try {
        const [dashboardResult, opportunitiesResult, interactionsResult, systemConfigResult] = await Promise.all([
            authedFetch(`/api/opportunities/dashboard`),
            authedFetch(`/api/opportunities?page=0`), 
            authedFetch(`/api/interactions/all?fetchAll=true`), 
            authedFetch(`/api/config`)
        ]);

        if (systemConfigResult) {
            window.CRM_APP.systemConfig = systemConfigResult;
        }

        if (dashboardResult.success && dashboardResult.data && dashboardResult.data.chartData) {
            const systemConfig = window.CRM_APP?.systemConfig; 
            if (systemConfig) {
                reverseNameMaps = {
                    opportunitySource: new Map((systemConfig['機會來源'] || []).map(i => [i.note || i.value, i.value])), 
                    opportunityType: new Map((systemConfig['機會種類'] || []).map(i => [i.note || i.value, i.value])),
                    currentStage: new Map((systemConfig['機會階段'] || []).map(i => [i.note || i.value, i.value])),
                    orderProbability: new Map((systemConfig['下單機率'] || []).map(i => [i.note || i.value, i.value])),
                    potentialSpecification: new Map((systemConfig['可能下單規格'] || []).map(i => [i.note || i.value, i.value])),
                    salesChannel: new Map((systemConfig['可能銷售管道'] || []).map(i => [i.note || i.value, i.value])),
                    deviceScale: new Map((systemConfig['設備規模'] || []).map(i => [i.note || i.value, i.value]))
                };
            }
            renderOpportunityCharts(dashboardResult.data.chartData);
        }

        let opportunities = opportunitiesResult || [];
        const interactions = interactionsResult.data || [];

        const latestInteractionMap = new Map();
        interactions.forEach(interaction => {
            const id = interaction.opportunityId;
            const existing = latestInteractionMap.get(id) || 0;
            const current = new Date(interaction.interactionTime || interaction.createdTime).getTime();
            if (current > existing) latestInteractionMap.set(id, current);
        });

        opportunities.forEach(opp => {
             const selfUpdate = new Date(opp.lastUpdateTime || opp.createdTime).getTime();
             const lastInteraction = latestInteractionMap.get(opp.opportunityId) || 0;
             opp.effectiveLastActivity = Math.max(selfUpdate, lastInteraction);
             if (isNaN(opp.effectiveLastActivity)) {
                 opp.effectiveLastActivity = new Date(opp.createdTime || 0).getTime();
             }
             // 【新增】計算建立年份，供篩選使用
             const createdDate = new Date(opp.createdTime);
             opp.creationYear = isNaN(createdDate.getTime()) ? null : createdDate.getFullYear();
        });

        opportunitiesData = opportunities;

        // 渲染 Chip Wall
        const chipWallContainer = document.getElementById('opportunity-chip-wall-container');
        if (typeof ChipWall !== 'undefined' && chipWallContainer) {
            const ongoingOpportunities = opportunitiesData.filter(opp => opp.currentStatus === '進行中');
            const chipWall = new ChipWall('#opportunity-chip-wall-container', {
                stages: window.CRM_APP?.systemConfig?.['機會階段'] || [], 
                items: ongoingOpportunities,
                interactions: interactions, 
                colorConfigKey: '機會種類',
                useDynamicSize: true,
                isCollapsible: true,
                isDraggable: true,
                showControls: true, 
                onItemUpdate: () => {
                    if(window.CRM_APP?.pageConfig) window.CRM_APP.pageConfig.dashboard.loaded = false; 
                },
                // 【新增】監聽晶片牆篩選變更
                onFilterChange: (filters) => {
                    // filters: { year, type, source, time }
                    // 將晶片牆的篩選狀態同步到列表的篩選狀態
                    opportunitiesListFilters.year = filters.year;
                    opportunitiesListFilters.type = filters.type; // 晶片牆叫 'type'
                    opportunitiesListFilters.source = filters.source;
                    opportunitiesListFilters.time = filters.time;
                    
                    // 重新渲染列表
                    filterAndRenderOpportunities();
                }
            });
            chipWall.render();
        }

        // 初始渲染列表
        filterAndRenderOpportunities();

    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('❌ 載入機會案件頁面失敗:', error);
            const contentEl = document.getElementById('opportunities-page-content');
            if (contentEl) contentEl.innerHTML = `<div class="alert alert-error">載入資料失敗: ${error.message}</div>`;
        }
    }
}

/**
 * 清除所有篩選條件
 */
function clearAllOppFilters() {
    opportunitiesListFilters = { type: 'all', source: 'all', stage: 'all', year: 'all', time: 'all' };
    
    // 清除圖表選取
    Highcharts.charts.forEach(chart => {
        if (chart && chart.series && chart.series[0] && chart.series[0].points) {
             chart.series[0].points.forEach(point => {
                 if (point && typeof point.select === 'function') point.select(false, true);
             });
        }
    });
    
    // 注意：這裡無法直接清除晶片牆內部的下拉選單狀態 (因為它們封裝在 ChipWall 內部)
    // 但列表會恢復顯示全部

    filterAndRenderOpportunities();
}

/**
 * 篩選並重新渲染機會列表的核心函式
 * @param {string|null} filterKey - 來自圖表的欄位鍵名 (可選)
 * @param {string|null} filterDisplayValue - 來自圖表的顯示值 (可選)
 */
function filterAndRenderOpportunities(filterKey, filterDisplayValue) {
    const listContent = document.getElementById('opportunities-page-content');
    const filterStatus = document.getElementById('opportunities-filter-status');
    const filterText = document.getElementById('opportunities-filter-text');
    const query = document.getElementById('opportunities-list-search')?.value.toLowerCase() || '';

    if (!listContent) return;

    // 1. 更新篩選狀態 (如果有從圖表傳入)
    if (filterKey && filterDisplayValue) {
        const filterValue = reverseNameMaps[filterKey]?.get(filterDisplayValue) || filterDisplayValue;
        
        if (opportunitiesListFilters[filterKey] === filterValue) {
             delete opportunitiesListFilters[filterKey]; 
        } else {
             opportunitiesListFilters[filterKey] = filterValue;
        }
        
        // 修正：這裡因為下拉選單移除了，不需要同步下拉選單
        // 如果需要同步晶片牆，邏輯會比較複雜，這裡先單向由晶片牆控制列表
    }

    // 2. 顯示/隱藏篩選狀態條 (過濾掉值為 'all' 的)
    const activeFilters = Object.entries(opportunitiesListFilters).filter(([k, v]) => v !== 'all' && v !== undefined);
    
    if (activeFilters.length > 0) {
        if (filterStatus) filterStatus.style.display = 'flex';
        if (filterText) filterText.textContent = `已套用 ${activeFilters.length} 個篩選條件`;
    } else {
        if (filterStatus) filterStatus.style.display = 'none';
    }

    // 3. 執行篩選
    let filteredData = [...opportunitiesData];

    // 3a. 套用通用篩選
    const now = Date.now();
    const timeThresholds = { '7': 7, '30': 30, '90': 90 };

    // 處理特殊篩選 (Year, Time)
    if (opportunitiesListFilters.year !== 'all') {
        filteredData = filteredData.filter(opp => String(opp.creationYear) === String(opportunitiesListFilters.year));
    }
    if (opportunitiesListFilters.time !== 'all') {
        const days = timeThresholds[opportunitiesListFilters.time];
        const threshold = days ? now - days * 24 * 60 * 60 * 1000 : 0;
        filteredData = filteredData.filter(opp => opp.effectiveLastActivity >= threshold);
    }

    // 3b. 套用物件屬性篩選 (Type, Source, Stage 等)
    // 映射表：晶片牆的 key 可能跟機會物件屬性名略有不同
    const keyMapping = {
        'type': 'opportunityType',
        'source': 'opportunitySource'
        // stage, probability 等名稱一致
    };

    for (const [key, value] of Object.entries(opportunitiesListFilters)) {
        if (value === 'all' || value === undefined) continue;
        if (key === 'year' || key === 'time') continue; // 已處理

        const dataKey = keyMapping[key] || key;

        if (dataKey === 'potentialSpecification') {
            filteredData = filteredData.filter(opp => {
                const specData = opp.potentialSpecification;
                if (!specData) return false;
                try {
                    const parsedJson = JSON.parse(specData);
                    return typeof parsedJson === 'object' && parsedJson[value] > 0;
                } catch (e) {
                    return typeof specData === 'string' && specData.includes(value);
                }
            });
        } else {
            filteredData = filteredData.filter(opp => opp[dataKey] === value);
        }
    }

    // 3c. 套用搜尋框
    if (query) {
        filteredData = filteredData.filter(o =>
            (o.opportunityName && o.opportunityName.toLowerCase().includes(query)) ||
            (o.customerCompany && o.customerCompany.toLowerCase().includes(query))
        );
    }

    // 4. 執行排序
    filteredData.sort((a, b) => {
        let valA = a[currentOppSort.field];
        let valB = b[currentOppSort.field];

        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        if (typeof valA === 'number' && typeof valB === 'number') {
            return currentOppSort.direction === 'asc' ? valA - valB : valB - valA;
        }
        
        valA = String(valA);
        valB = String(valB);
        return currentOppSort.direction === 'asc' 
            ? valA.localeCompare(valB, 'zh-Hant') 
            : valB.localeCompare(valA, 'zh-Hant');
    });

    // 5. 渲染表格
    listContent.innerHTML = renderOpportunitiesTable(filteredData);
}

function handleOpportunitiesSearch(event) {
    handleSearch(() => filterAndRenderOpportunities());
}

/**
 * 處理列表排序點擊
 */
function handleOppSort(field) {
    if (currentOppSort.field === field) {
        currentOppSort.direction = currentOppSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentOppSort.field = field;
        currentOppSort.direction = 'desc'; // 預設降序
    }
    filterAndRenderOpportunities();
}

/**
 * 渲染機會案件列表的表格 HTML
 */
function renderOpportunitiesTable(opportunities) {
    // 注入專屬樣式 (控制欄寬與換行)
    const styleId = 'opportunity-list-table-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            .opportunity-list-table .col-index { width: 50px; text-align: center; color: var(--text-muted); font-weight: 700; }
            .opportunity-list-table .col-last-activity { min-width: 140px; }
            .opportunity-list-table .col-opportunity-name,
            .opportunity-list-table .col-company-name { max-width: 200px; }
            .opportunity-list-table .col-actions { min-width: 80px; overflow: visible; }
            .opportunity-list-table td { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            /* 強制表頭不換行 */
            .opportunity-list-table th { white-space: nowrap; }
            /* 可排序表頭樣式 */
            .opportunity-list-table th.sortable { cursor: pointer; transition: background-color 0.2s; }
            .opportunity-list-table th.sortable:hover { background-color: var(--glass-bg); }
            .sort-icon { display: inline-block; margin-left: 4px; font-size: 0.8em; color: var(--accent-blue); }
            
            @media (max-width: 768px) {
                .opportunity-list-table .col-index { 
                    width: auto; text-align: left; border-bottom: 1px solid var(--border-color); margin-bottom: 8px; padding-bottom: 8px; display: block; 
                }
                .opportunity-list-table .col-index::before {
                    content: attr(data-label); font-weight: 600; color: var(--text-secondary); padding-right: var(--spacing-4);
                }
            }
        `;
        document.head.appendChild(style);
    }

    if (!opportunities || opportunities.length === 0) {
        return '<div class="alert alert-info" style="text-align:center;">暫無符合條件的機會案件資料</div>';
    }

    // 輔助函式：產生排序表頭 HTML
    const renderSortHeader = (field, label) => {
        let icon = '';
        if (currentOppSort.field === field) {
            icon = currentOppSort.direction === 'asc' ? '↑' : '↓';
        }
        return `<th class="sortable" onclick="handleOppSort('${field}')">${label} <span class="sort-icon">${icon}</span></th>`;
    };

    let html = `<table class="data-table opportunity-list-table"><thead><tr>
                    <th class="col-index">項次</th>
                    ${renderSortHeader('effectiveLastActivity', '最後活動')}
                    ${renderSortHeader('opportunityName', '機會名稱')}
                    ${renderSortHeader('customerCompany', '客戶公司')}
                    <th>負責業務</th>
                    <th>目前階段</th>
                    <th>操作</th>
                </tr></thead><tbody>`;

    const systemConfig = window.CRM_APP?.systemConfig;
    const stageNotes = new Map((systemConfig?.['機會階段'] || []).map(s => [s.value, s.note || s.value]));
    const typeConfigs = new Map((systemConfig?.['機會種類'] || []).map(t => [t.value, { note: t.note, color: t.color }]));

    opportunities.forEach((opp, index) => {
        const stageDisplayName = stageNotes.get(opp.currentStage) || opp.currentStage || '未分類';
        const companyName = opp.customerCompany || '';
        const encodedCompanyName = encodeURIComponent(companyName);
        const opportunityName = opp.opportunityName || '(未命名)';
        const safeOpportunityName = opportunityName.replace(/'/g, "\\'").replace(/"/g, '&quot;');

        const companyCell = companyName
            ? `<td data-label="客戶公司" class="col-company-name" title="${companyName}"><a href="#" class="text-link" onclick="event.preventDefault(); CRM_APP.navigateTo('company-details', { companyName: '${encodedCompanyName}' })">${companyName}</a></td>`
            : `<td data-label="客戶公司">-</td>`;

        const oppId = opp.opportunityId || '';
        const deleteButtonOnClick = `confirmDeleteOpportunity(${opp.rowIndex}, '${safeOpportunityName}')`;

        const typeConfig = typeConfigs.get(opp.opportunityType);
        const rowColor = typeConfig?.color || 'transparent';
        
        // 計算序號 (從 1 開始)
        const rowNumber = index + 1;

        html += `
            <tr style="--card-brand-color: ${rowColor};">
                <td data-label="項次" class="col-index">${rowNumber}</td>
                <td data-label="最後活動" class="col-last-activity">${formatDateTime(opp.effectiveLastActivity)}</td>
                <td data-label="機會名稱" class="col-opportunity-name" title="${opportunityName}">
                    <a href="#" class="text-link" onclick="event.preventDefault(); CRM_APP.navigateTo('opportunity-details', { opportunityId: '${oppId}' })">
                        <strong>${opportunityName}</strong>
                    </a>
                </td>
                ${companyCell}
                <td data-label="負責業務">${opp.assignee || '-'}</td>
                <td data-label="目前階段">${stageDisplayName}</td>
                <td data-label="操作" class="col-actions"><div class="action-buttons-container">
                    <button class="action-btn small danger" onclick="${deleteButtonOnClick}">🗑️ 刪除</button>
                </div></td>
            </tr>`;
    });
    html += '</tbody></table>';
    return html;
}

// ==================== 圖表相關 (保持不變) ====================

function renderOpportunityCharts(chartData) {
    const container = document.getElementById('opportunities-dashboard-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會趨勢 (近30天)</h2></div><div id="opp-trend-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會來源分佈</h2></div><div id="opp-source-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會種類分佈</h2></div><div id="opp-type-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">機會階段分佈</h2></div><div id="opp-stage-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">下單機率</h2></div><div id="opp-probability-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">可能下單規格</h2></div><div id="opp-spec-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">可能銷售管道</h2></div><div id="opp-channel-chart" class="widget-content" style="height: 250px;"></div></div>
        <div class="dashboard-widget grid-col-3"><div class="widget-header"><h2 class="widget-title">設備規模</h2></div><div id="opp-scale-chart" class="widget-content" style="height: 250px;"></div></div>
    `;

    setTimeout(() => {
        if (typeof Highcharts !== 'undefined' && typeof createThemedChart === 'function' && chartData) {
            renderOppTrendChart(chartData.trend);
            createThemedChart('opp-source-chart', getPieChartOptions('來源', chartData.source, 'opportunitySource'));
            createThemedChart('opp-type-chart', getPieChartOptions('種類', chartData.type, 'opportunityType'));
            renderOppStageChart(chartData.stage);
            createThemedChart('opp-probability-chart', getPieChartOptions('機率', chartData.probability, 'orderProbability'));
            createThemedChart('opp-spec-chart', getPieChartOptions('規格', chartData.specification, 'potentialSpecification'));
            createThemedChart('opp-channel-chart', getPieChartOptions('管道', chartData.channel, 'salesChannel'));
            createThemedChart('opp-scale-chart', getPieChartOptions('規模', chartData.scale, 'deviceScale'));
        }
    }, 0);
}

function getPieChartOptions(seriesName, data, filterKey) {
    if (!Array.isArray(data)) data = [];
     const validatedData = data.map(d => ({
        name: d.name || '未分類',
        y: d.y || 0
     }));

    const specificOptions = {
        chart: { type: 'pie' },
        title: { text: '' },
        tooltip: { pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b> ({point.y} 件)' },
        plotOptions: {
            pie: {
                allowPointSelect: true,
                cursor: 'pointer',
                dataLabels: { enabled: true, format: '<b>{point.name}</b>: {point.percentage:.1f}%', distance: 20 },
                showInLegend: false,
                point: {
                    events: {
                        click: function() {
                            const isCurrentlySelected = this.selected;
                            if (isCurrentlySelected) {
                                filterAndRenderOpportunities(filterKey, this.name); 
                            } else {
                                filterAndRenderOpportunities(filterKey, this.name);
                            }
                        }
                    }
                }
            }
        },
        series: [{ name: seriesName, data: validatedData }]
    };
    return specificOptions;
}

function renderOppTrendChart(data) {
     if (!data || !Array.isArray(data)) return;
     const specificOptions = {
        chart: { type: 'line' },
        title: { text: '' },
        xAxis: { categories: data.map(d => d[0] ? d[0].substring(5) : '') },
        yAxis: { title: { text: '數量' }, allowDecimals: false },
        legend: { enabled: false },
        series: [{ name: '機會數', data: data.map(d => d[1] || 0) }]
    };
    createThemedChart('opp-trend-chart', specificOptions);
}

function renderOppStageChart(data) {
     if (!data || !Array.isArray(data)) return;
     const validatedData = data.map(d => [d[0] || '未分類', d[1] || 0]);

    const specificOptions = {
        chart: { type: 'bar' },
        title: { text: '' },
        xAxis: { categories: validatedData.map(d => d[0]), title: { text: null } },
        yAxis: { min: 0, title: { text: '案件數量', align: 'high' }, allowDecimals: false },
        legend: { enabled: false },
        series: [{ name: '數量', data: validatedData.map(d => d[1]) }],
        plotOptions: {
            bar: {
                 cursor: 'pointer',
                 point: {
                    events: {
                        click: function() {
                           filterAndRenderOpportunities('currentStage', this.category);
                        }
                    }
                }
            }
        }
    };
    createThemedChart('opp-stage-chart', specificOptions);
}

async function confirmDeleteOpportunity(rowIndex, opportunityName) {
    if (!rowIndex) {
        showNotification('無法刪除：缺少必要的紀錄索引。', 'error');
        return;
    }
    const safeOpportunityName = opportunityName || '(未命名)';
    const message = `您確定要"永久刪除"\n機會案件 "${safeOpportunityName}" 嗎？\n此操作無法復原！!`;

    showConfirmDialog(message, async () => {
        showLoading('正在刪除...');
        try {
            const result = await authedFetch(`/api/opportunities/${rowIndex}`, { method: 'DELETE' });
            if (result.success) {
                const searchInput = document.getElementById('opportunities-list-search');
                const currentQuery = searchInput ? searchInput.value : '';
                await loadOpportunities(currentQuery);
            } else {
                 throw new Error(result.details || '刪除操作失敗');
            }
        } catch (error) {
            if (error.message !== 'Unauthorized') console.error('刪除機會失敗:', error);
        } finally {
             hideLoading();
        }
    });
}

// 載入待追蹤清單頁面 (無變更)
async function loadFollowUpPage() {
    const container = document.getElementById('page-follow-up');
    if (!container) return;
    container.innerHTML = '<div class="loading show"><div class="spinner"></div><p>載入待追蹤清單中...</p></div>';
    try {
        const result = await authedFetch('/api/dashboard');
        if (!result.success || !result.data) throw new Error(result.error || '無法獲取儀表板資料');

        const dashboardData = result.data;
        const followUpFullList = dashboardData.followUpList || [];
        followUpFullList.sort((a, b) => (a.effectiveLastActivity || 0) - (b.effectiveLastActivity || 0));

        if (followUpFullList.length === 0) {
            container.innerHTML = '<div class="alert alert-success" style="padding: 2rem; text-align: center;">🎉 太棒了！目前沒有需要追蹤的機會案件。</div>';
        } else {
            const thresholdDays = window.CRM_APP?.systemConfig?.FOLLOW_UP?.DAYS_THRESHOLD || 7;
            container.innerHTML = `<div class="dashboard-widget"><div class="widget-header"><h2 class="widget-title">待追蹤機會案件 (${followUpFullList.length})</h2></div><div class="widget-content"><div class="alert alert-warning">⚠️ 以下機會案件已超過 ${thresholdDays} 天未有新活動，建議盡快跟進。</div>${renderOpportunitiesTable(followUpFullList)}</div></div>`;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('❌ 載入待追蹤清單失敗:', error);
            container.innerHTML = '<div class="alert alert-error">載入待追蹤清單失敗，請稍後再試。</div>';
        }
    }
}

// 向主應用程式註冊此模組
if (window.CRM_APP) {
    if (!window.CRM_APP.pageModules) window.CRM_APP.pageModules = {};
    window.CRM_APP.pageModules.opportunities = loadOpportunities;
    window.CRM_APP.pageModules['follow-up'] = loadFollowUpPage;
} else {
    console.error('[Opportunities] CRM_APP 全域物件未定義，無法註冊頁面模組。');
}