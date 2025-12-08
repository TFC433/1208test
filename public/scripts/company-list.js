// views/scripts/company-list.js
// 職責：管理「公司總覽列表頁」的載入、圖表渲染、篩選與搜尋功能

// 全域變數，用於儲存當前頁面的公司資料與篩選狀態
let allCompaniesData = [];
let companyListFilters = { type: 'all', stage: 'all', rating: 'all' };

// 【新增】排序狀態 (預設依最後活動時間降序)
let currentSort = { field: 'lastActivity', direction: 'desc' };

/**
 * 載入並渲染公司列表頁面的主函式
 */
async function loadCompaniesListPage() {
    const container = document.getElementById('page-companies');
    if (!container) return;

    // 1. 渲染包含圖表容器和篩選器的頁面新骨架
    container.innerHTML = `
        <div id="companies-dashboard-container" class="dashboard-grid-flexible" style="margin-bottom: 24px;">
            <div class="loading show" style="grid-column: span 12;"><div class="spinner"></div><p>載入分析圖表中...</p></div>
        </div>
        <div class="dashboard-widget">
            <div class="widget-header">
                <h2 class="widget-title">公司總覽</h2>
            </div>
            <div class="search-pagination" style="padding: 0 1.5rem 1rem; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center;">
                <input type="text" class="search-box" id="company-list-search" placeholder="搜尋公司名稱..." style="flex-grow: 1;">
                <div id="company-list-filters" style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <select id="company-type-filter" class="form-select-sm" data-filter="type"><option value="all">所有類型</option></select>
                    <select id="company-stage-filter" class="form-select-sm" data-filter="stage"><option value="all">所有階段</option></select>
                    <select id="company-rating-filter" class="form-select-sm" data-filter="rating"><option value="all">所有評級</option></select>
                </div>
            </div>
            <div id="companies-list-content" class="widget-content">
                <div class="loading show"><div class="spinner"></div><p>載入公司列表中...</p></div>
            </div>
        </div>
    `;

    // 2. 一次性獲取圖表、列表和系統設定所需的所有數據
    try {
        const [dashboardResult, listResult, systemConfigResult] = await Promise.all([
            authedFetch(`/api/companies/dashboard`),
            authedFetch(`/api/companies`), // 使用已包含 lastActivity 和 opportunityCount 的 API
            authedFetch(`/api/config`) // 獲取系統設定以填充篩選器
        ]);

        // 渲染圖表
        if (dashboardResult.success && dashboardResult.data && dashboardResult.data.chartData) {
            // 在渲染圖表前，確保系統設定已載入 (如果需要的話)
             if (systemConfigResult && typeof systemConfigResult === 'object') {
                 // 確保全域的 systemConfig 更新
                 window.CRM_APP.systemConfig = systemConfigResult;
             }
            renderCompaniesDashboardCharts(dashboardResult.data.chartData);
        } else {
            console.warn('[Company List] 無法獲取圖表資料:', dashboardResult.error || '未知錯誤');
            document.getElementById('companies-dashboard-container').innerHTML = `<div class="alert alert-error" style="grid-column: span 12;">圖表資料載入失敗</div>`;
        }

        // 填充篩選器選項
        if (systemConfigResult && typeof systemConfigResult === 'object') {
             populateFilterOptions('company-type-filter', systemConfigResult['公司類型'], '所有類型');
             populateFilterOptions('company-stage-filter', systemConfigResult['客戶階段'], '所有階段');
             populateFilterOptions('company-rating-filter', systemConfigResult['互動評級'], '所有評級');

             // 綁定篩選器事件
             document.querySelectorAll('#company-list-filters select').forEach(select => {
                 select.addEventListener('change', handleCompanyFilterChange);
             });
        } else {
             console.warn('[Company List] 無法載入系統設定，篩選器選項可能不完整。');
        }

        // 渲染列表
        if (listResult.success) {
            allCompaniesData = listResult.data || []; 
            // 初始渲染
            filterAndRenderCompanyList();

            // 確保搜尋框存在後再綁定事件
            const searchInput = document.getElementById('company-list-search');
            if (searchInput) {
                searchInput.addEventListener('keyup', handleCompanyListSearch);
            } else {
                console.warn('[Company List] 搜尋框 #company-list-search 未找到。');
            }
        } else {
             throw new Error(listResult.error || '無法獲取公司列表');
        }

    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('載入公司列表失敗:', error);
            document.getElementById('companies-dashboard-container').innerHTML = ''; // 清空圖表區
            // 清空篩選器並顯示錯誤
             const filterContainer = document.getElementById('company-list-filters');
             if (filterContainer) filterContainer.innerHTML = '<span style="color: var(--accent-red);">篩選器載入失敗</span>';
            document.getElementById('companies-list-content').innerHTML = `<div class="alert alert-error">載入公司列表失敗: ${error.message}</div>`;
        }
    }
}

/**
 * 填充篩選下拉選單的選項
 * @param {string} selectId - 下拉選單的 ID
 * @param {Array<object>} options - 選項陣列 [{value: '...', note: '...'}]
 * @param {string} defaultText - 預設選項的文字 (e.g., '所有類型')
 */
function populateFilterOptions(selectId, options, defaultText) {
    const selectElement = document.getElementById(selectId);
    if (!selectElement) return;

    // 保留預設選項
    selectElement.innerHTML = `<option value="all">${defaultText}</option>`;

    if (options && Array.isArray(options)) {
        options.forEach(opt => {
            selectElement.innerHTML += `<option value="${opt.value}">${opt.note || opt.value}</option>`;
        });
    }
}


/**
 * 處理篩選條件變更事件
 */
function handleCompanyFilterChange(event) {
    const filterKey = event.target.dataset.filter;
    const filterValue = event.target.value;
    companyListFilters[filterKey] = filterValue; // 更新全域篩選狀態
    filterAndRenderCompanyList(); // 使用新的篩選條件重新渲染列表
}

/**
 * 處理公司列表頁面的搜尋事件 (使用 debounce)
 */
function handleCompanyListSearch(event) {
    handleSearch(() => {
        filterAndRenderCompanyList(); // 使用當前的篩選條件和新的搜尋詞重新渲染列表
    });
}

/**
 * 【新增】處理列表排序
 * @param {string} field - 排序欄位
 */
function handleCompanySort(field) {
    if (currentSort.field === field) {
        // 切換方向
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // 新欄位預設降序 (數值/時間類通常看大的/新的)
        currentSort.field = field;
        currentSort.direction = 'desc';
    }
    filterAndRenderCompanyList();
}

/**
 * 根據當前的篩選條件、搜尋詞和排序狀態，過濾並渲染公司列表
 */
function filterAndRenderCompanyList() {
    const query = document.getElementById('company-list-search')?.value.toLowerCase() || '';
    const { type, stage, rating } = companyListFilters;

    // 1. 篩選
    let filteredCompanies = allCompaniesData.filter(company => {
        const nameMatch = query ? (company.companyName || '').toLowerCase().includes(query) : true;
        const typeMatch = type === 'all' ? true : company.companyType === type;
        const stageMatch = stage === 'all' ? true : company.customerStage === stage;
        const ratingMatch = rating === 'all' ? true : company.engagementRating === rating;

        return nameMatch && typeMatch && stageMatch && ratingMatch;
    });

    // 2. 排序
    filteredCompanies.sort((a, b) => {
        let valA = a[currentSort.field];
        let valB = b[currentSort.field];

        // 處理 null/undefined
        if (valA === undefined || valA === null) valA = '';
        if (valB === undefined || valB === null) valB = '';

        // 數值比較
        if (typeof valA === 'number' && typeof valB === 'number') {
            return currentSort.direction === 'asc' ? valA - valB : valB - valA;
        }

        // 字串比較 (中文排序)
        valA = String(valA);
        valB = String(valB);
        return currentSort.direction === 'asc' 
            ? valA.localeCompare(valB, 'zh-Hant') 
            : valB.localeCompare(valA, 'zh-Hant');
    });

    // 3. 渲染
    const listContent = document.getElementById('companies-list-content');
    if (listContent) {
        listContent.innerHTML = renderCompaniesTable(filteredCompanies);
    } else {
        console.error('[Company List] 表格容器 #companies-list-content 未找到。');
    }
}


/**
 * 渲染公司儀表板的四個圖表
 */
function renderCompaniesDashboardCharts(chartData) {
    const container = document.getElementById('companies-dashboard-container');
    if (!container) {
        console.error('[Company List] 圖表容器 #companies-dashboard-container 未找到。');
        return;
    }
    container.innerHTML = `
        <div class="dashboard-widget grid-col-3">
            <div class="widget-header"><h2 class="widget-title">公司新增趨勢</h2></div>
            <div id="company-trend-chart" class="widget-content" style="height: 250px;"></div>
        </div>
        <div class="dashboard-widget grid-col-3">
            <div class="widget-header"><h2 class="widget-title">公司類型分佈</h2></div>
            <div id="company-type-chart" class="widget-content" style="height: 250px;"></div>
        </div>
        <div class="dashboard-widget grid-col-3">
            <div class="widget-header"><h2 class="widget-title">客戶階段分佈</h2></div>
            <div id="customer-stage-chart" class="widget-content" style="height: 250px;"></div>
        </div>
        <div class="dashboard-widget grid-col-3">
            <div class="widget-header"><h2 class="widget-title">互動評級</h2></div>
            <div id="engagement-rating-chart" class="widget-content" style="height: 250px;"></div>
        </div>
    `;

    // 確保 CRM_APP 和 systemConfig 存在
    const systemConfig = window.CRM_APP?.systemConfig;
    if (!systemConfig) {
        console.warn('[Company List] 系統設定尚未載入，圖表標籤可能不完整。');
    }
    const typeNameMap = new Map((systemConfig?.['公司類型'] || []).map(i => [i.value, i.note]));
    const stageNameMap = new Map((systemConfig?.['客戶階段'] || []).map(i => [i.value, i.note]));
    const ratingNameMap = new Map((systemConfig?.['互動評級'] || []).map(i => [i.value, i.note]));

    // 使用 setTimeout 確保 DOM 元素已渲染完成且 Highcharts 函式庫已載入
    setTimeout(() => {
        if (typeof Highcharts !== 'undefined' && chartData) {
            renderCompanyTrendChart(chartData.trend);
            // 傳遞 filterKey 給圓餅圖和長條圖
            createThemedChart('company-type-chart', getCompanyPieChartOptions('類型', chartData.type, 'companyType', typeNameMap));
            createThemedChart('customer-stage-chart', getCompanyPieChartOptions('階段', chartData.stage, 'customerStage', stageNameMap));
            createThemedChart('engagement-rating-chart', getCompanyBarChartOptions('評級', chartData.rating, 'engagementRating', ratingNameMap));
        } else if (typeof Highcharts === 'undefined') {
            console.error('[Company List] Highcharts 函式庫未載入。');
             ['company-trend-chart', 'company-type-chart', 'customer-stage-chart', 'engagement-rating-chart'].forEach(id => {
                 const chartContainer = document.getElementById(id);
                 if (chartContainer) chartContainer.innerHTML = '<div class="alert alert-error" style="text-align: center; padding: 10px;">圖表函式庫載入失敗</div>';
             });
        } else if (!chartData) {
            console.warn('[Company List] 圖表渲染被跳過，因為 chartData 為空。');
             ['company-trend-chart', 'company-type-chart', 'customer-stage-chart', 'engagement-rating-chart'].forEach(id => {
                 const chartContainer = document.getElementById(id);
                 if (chartContainer) chartContainer.innerHTML = '<div class="alert alert-warning" style="text-align: center; padding: 10px;">無圖表資料</div>';
             });
        }
    }, 0);
}

// 趨勢圖渲染函式 (保持不變)
function renderCompanyTrendChart(data) {
    if (!data || !Array.isArray(data)) { // 增加陣列檢查
        console.warn('[Company List] 公司趨勢圖渲染失敗：無效的 data。', data);
        const container = document.getElementById('company-trend-chart');
        if (container) container.innerHTML = '<div class="alert alert-warning" style="text-align: center; padding: 10px;">無趨勢資料</div>';
        return;
    }

    const specificOptions = {
        chart: { type: 'line' },
        title: { text: '' },
        xAxis: {
            categories: data.map(d => d[0] ? d[0].substring(5) : '') // 增加保護
        },
        yAxis: {
            title: {
               text: '數量'
            },
            allowDecimals: false
        },
        legend: { enabled: false },
        series: [{
             name: '新增公司數',
             data: data.map(d => d[1] || 0) // 增加保護
        }]
    };
    createThemedChart('company-trend-chart', specificOptions);
}


/**
 * 通用公司圓餅圖選項產生器 (包含點擊篩選邏輯)
 * @param {string} seriesName - 系列名稱 (e.g., '類型')
 * @param {Array} data - 圖表數據 [{ name: 'value', y: count }, ...]
 * @param {string} filterKey - 點擊時要篩選的欄位鍵名 (e.g., 'companyType')
 * @param {Map} nameMap - value 到 note 的映射 Map
 * @returns {object} Highcharts 選項物件 (只包含 specificOptions)
 */
function getCompanyPieChartOptions(seriesName, data, filterKey, nameMap) {
    if (!data || !Array.isArray(data)) {
        console.warn(`[Company List] ${seriesName} 圓餅圖選項生成失敗：無效的 data。`, data);
        data = [];
    }
    const chartData = data.map(d => ({
        name: nameMap.get(d.name) || d.name || '未分類', // 使用 note 作為顯示名稱
        y: d.y || 0,
        internalValue: d.name // 保存原始 value 以便篩選
    }));

    const specificOptions = {
        chart: { type: 'pie' },
        title: { text: '' },
        tooltip: { pointFormat: '{series.name}: <b>{point.percentage:.1f}%</b> ({point.y} 家)' },
        plotOptions: {
            pie: {
                allowPointSelect: true,
                cursor: 'pointer',
                dataLabels: {
                    enabled: true,
                    format: '<b>{point.name}</b>: {point.percentage:.1f} %',
                    distance: 20,
                },
                showInLegend: false,
                point: {
                    events: {
                        click: function() {
                            handleCompanyChartClick(this, filterKey);
                        }
                    }
                }
            }
        },
        series: [{ name: '家數', data: chartData }]
    };
    return specificOptions;
}

/**
 * 通用公司長條圖選項產生器 (包含點擊篩選邏輯)
 * @param {string} seriesName - 系列名稱 (e.g., '評級')
 * @param {Array} data - 圖表數據 [{ name: 'value', y: count }, ...]
 * @param {string} filterKey - 點擊時要篩選的欄位鍵名 (e.g., 'engagementRating')
 * @param {Map} nameMap - value 到 note 的映射 Map
 * @returns {object} Highcharts 選項物件 (只包含 specificOptions)
 */
function getCompanyBarChartOptions(seriesName, data, filterKey, nameMap) {
     if (!data || !Array.isArray(data)) {
        console.warn(`[Company List] ${seriesName} 長條圖選項生成失敗：無效的 data。`, data);
        data = [];
     }
      const chartData = data.map(d => ({
         name: nameMap.get(d.name) || d.name || '未分類', // 使用 note 作為顯示名稱
         y: d.y || 0,
         internalValue: d.name // 保存原始 value 以便篩選
     }));

     const specificOptions = {
        chart: { type: 'bar' },
        title: { text: '' },
        xAxis: {
            categories: chartData.map(d => d.name), // X軸顯示 note
            title: { text: null }
        },
        yAxis: {
            min: 0,
            title: { text: '公司數量', align: 'high' },
            allowDecimals: false
        },
        legend: { enabled: false },
        series: [{
            name: '數量',
            data: chartData // 將包含 internalValue 的物件傳入 series.data
        }],
        plotOptions: {
             bar: {
                 cursor: 'pointer',
                 point: {
                    events: {
                        click: function() {
                            // 注意：長條圖的 this.category 是 note (顯示名稱)
                            // 我們需要從 this.options.internalValue 獲取原始 value
                            handleCompanyChartClick(this, filterKey, true); // true 表示這是長條圖
                        }
                    }
                }
            }
        }
    };
    return specificOptions;
}

/**
 * 處理公司圖表點擊事件的共用函式
 * @param {object} point - Highcharts 點擊的 point 物件
 * @param {string} filterKey - 對應的篩選鍵名
 * @param {boolean} isBarChart - 是否為長條圖 (影響如何獲取 value)
 */
function handleCompanyChartClick(point, filterKey, isBarChart = false) {
    const filterValue = isBarChart ? point.options.internalValue : point.internalValue;
    const filterSelect = document.getElementById(`company-${filterKey.replace('company', '').toLowerCase()}-filter`); // 找到對應的下拉選單

    if (!filterSelect) {
        console.warn(`[Company List] 找不到對應的篩選下拉選單 for key: ${filterKey}`);
        return;
    }

    if (point.selected) { // 如果點擊的是已選中的點
        companyListFilters[filterKey] = 'all'; // 清除篩選
        filterSelect.value = 'all'; // 更新下拉選單
        point.select(false, true); // 取消圖表選中 (會觸發重繪)
    } else {
        companyListFilters[filterKey] = filterValue; // 應用篩選
        filterSelect.value = filterValue; // 更新下拉選單
        // 取消其他點的選中狀態 (Highcharts 會自動處理單選)
        point.select(true, true); // 選中點擊的點 (會觸發重繪)
    }

    filterAndRenderCompanyList(); // 根據新的篩選條件渲染列表
}


/**
 * 渲染公司列表的表格 (已更新：項次、機會數、排序、不換行)
 * @param {Array<object>} companies - 公司資料陣列
 * @returns {string} HTML 表格字串
 */
function renderCompaniesTable(companies) {
    // 1. 注入專屬樣式 (控制欄寬)
    const styleId = 'company-list-table-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.innerHTML = `
            /* 項次欄位固定寬度與置中 */
            .company-list-table .col-index { 
                width: 50px; 
                text-align: center; 
                color: var(--text-muted);
                font-weight: 700;
            }
            /* 強制表頭不換行 */
            .company-list-table th {
                white-space: nowrap;
            }
            /* 可排序表頭樣式 */
            .company-list-table th.sortable {
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .company-list-table th.sortable:hover {
                background-color: var(--glass-bg);
            }
            .sort-icon {
                display: inline-block;
                margin-left: 4px;
                font-size: 0.8em;
                color: var(--accent-blue);
            }
            
            /* 手機版設定 (RWD) */
            @media (max-width: 768px) {
                /* 在手機卡片模式下，讓項次顯示在最上方 */
                .company-list-table .col-index { 
                    width: auto; 
                    text-align: left;
                    border-bottom: 1px solid var(--border-color);
                    margin-bottom: 8px;
                    padding-bottom: 8px;
                    display: block; /* 確保在手機版是區塊顯示 */
                }
                /* 確保內容有正確的 label */
                .company-list-table .col-index::before {
                    content: attr(data-label);
                    font-weight: 600;
                    color: var(--text-secondary);
                    padding-right: var(--spacing-4);
                }
            }
        `;
        document.head.appendChild(style);
    }

    if (!companies || companies.length === 0) {
        return '<div class="alert alert-info" style="text-align:center;">找不到符合條件的公司資料</div>';
    }

    // 確保 CRM_APP 和 systemConfig 存在
    const systemConfig = window.CRM_APP?.systemConfig;
    if (!systemConfig) {
         console.warn('[Company List] 系統設定尚未載入，表格標籤可能不完整。');
    }

    // 讀取類型設定中的顏色和名稱
    const typeConfigMap = new Map((systemConfig?.['公司類型'] || []).map(t => [t.value, { note: t.note, color: t.color }]));
    const stageNameMap = new Map((systemConfig?.['客戶階段'] || []).map(t => [t.value, t.note]));
    const ratingNameMap = new Map((systemConfig?.['互動評級'] || []).map(t => [t.value, t.note]));

    // 2. 輔助函式：產生排序表頭 HTML
    const renderSortHeader = (field, label) => {
        let icon = '';
        if (currentSort.field === field) {
            icon = currentSort.direction === 'asc' ? '↑' : '↓';
        }
        return `<th class="sortable" onclick="handleCompanySort('${field}')">${label} <span class="sort-icon">${icon}</span></th>`;
    };

    // 3. 建立表格 HTML (表頭更新)
    let tableHTML = `
        <table class="data-table company-list-table">
            <thead>
                <tr>
                    <th class="col-index">項次</th>
                    ${renderSortHeader('companyName', '公司名稱')}
                    ${renderSortHeader('opportunityCount', '機會數')}
                    <th>公司類型</th>
                    <th>客戶階段</th>
                    <th>互動評級</th>
                    ${renderSortHeader('lastActivity', '最後活動')}
                </tr>
            </thead>
            <tbody>`;

    // 4. 遍歷資料產生內容
    companies.forEach((company, index) => {
        // 增加保護，防止 companyName 為空導致錯誤
        const companyName = company.companyName || '';
        const encodedCompanyName = encodeURIComponent(companyName);
        const typeConfig = typeConfigMap.get(company.companyType);
        const rowColor = typeConfig?.color || 'transparent'; // 從設定檔讀取顏色
        const typeName = typeConfig?.note || company.companyType || '-'; // 從設定檔讀取名稱

        // 計算序號 (從 1 開始)
        const rowNumber = index + 1;

        tableHTML += `
            <tr style="--card-brand-color: ${rowColor};">
                <td data-label="項次" class="col-index">${rowNumber}</td>
                <td data-label="公司名稱">
                    <a href="#" class="text-link" onclick="event.preventDefault(); CRM_APP.navigateTo('company-details', { companyName: '${encodedCompanyName}' })">
                        <strong>${companyName || '-'}</strong>
                    </a>
                </td>
                <td data-label="機會數" style="font-weight: 700; color: var(--text-primary); text-align: center;">${company.opportunityCount}</td>
                <td data-label="公司類型">${typeName}</td>
                <td data-label="客戶階段">${stageNameMap.get(company.customerStage) || company.customerStage || '-'}</td>
                <td data-label="互動評級">${ratingNameMap.get(company.engagementRating) || company.engagementRating || '-'}</td>
                <td data-label="最後活動">${formatDateTime(company.lastActivity)}</td>
            </tr>
        `;
    });

    tableHTML += '</tbody></table>';
    return tableHTML;
}

// 向主應用程式註冊此模組
if (window.CRM_APP) {
    // 確保 pageModules 物件存在
    if (!window.CRM_APP.pageModules) {
        window.CRM_APP.pageModules = {};
    }
    window.CRM_APP.pageModules.companies = loadCompaniesListPage;
} else {
    console.error('[Company List] CRM_APP 全域物件未定義，無法註冊頁面模組。');
}