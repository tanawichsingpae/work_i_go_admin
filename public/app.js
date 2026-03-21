const API_BASE = window.location.origin.startsWith("http")
  ? window.location.origin
  : "http://localhost:3000";

if (window.ChartDataLabels) {
  Chart.register(window.ChartDataLabels);
}

const COLORS = {
  blue900: '#1e3a8a',
  blue800: '#1d4ed8',
  blue700: '#2563eb',
  blue600: '#3b82f6',
  blue500: '#60a5fa',
  blue400: '#93c5fd',
  blue300: '#bfdbfe',
  slate: '#64748b',
  grid: 'rgba(148, 163, 184, 0.22)'
};

const charts = {
  revenuePackage: null,
  revenueMix: null,
  revenueTrend: null,
  market: null,
  wage: null,
  geo: null,
  genderRatio: null,
  govStatus: null,
};

// cache full trend data for month filter re-render
let trendCache = [];

function renderTrendFromCache() {
  if (!trendCache.length) return;
  const monthVal = document.getElementById('month_filter')?.value || 'all';
  const trendData = monthVal === 'all'
    ? trendCache
    : trendCache.slice(-parseInt(monthVal));

  createOrReplaceChart('revenueTrend', 'chart_revenue_trend', {
    type: 'line',
    data: {
      labels: trendData.map(r => r.label),
      datasets: [{
        label: 'รายได้โดยประมาณ',
        data: trendData.map(r => r.value),
        borderColor: COLORS.blue700,
        backgroundColor: 'rgba(59,130,246,0.18)',
        pointBackgroundColor: COLORS.blue700,
        pointRadius: 4,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3
      }]
    },
    options: baseOptions({
      scales: { y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } },
      plugins: {
        datalabels: {
          color: COLORS.blue900,
          align: 'top',
          anchor: 'end',
          formatter: (v) => moneyFmt(v)
        },
        tooltip: { callbacks: { label: (ctx) => moneyFmt(ctx.raw) } }
      }
    })
  });
  requestAnimationFrame(resizeAllCharts);
}

function buildCommonParams() {
  return new URLSearchParams({
    geography: document.getElementById('geography').value,
    province: document.getElementById('province').value,
    job_type: document.getElementById('job_type').value
  });
}

function buildMarketParams() {
  const params = buildCommonParams();
  const marketGender = document.getElementById('market_gender').value;
  const marketAgeMin = document.getElementById('market_age_min').value;
  const marketAgeMax = document.getElementById('market_age_max').value;

  if (marketGender) params.set('gender', marketGender);
  if (marketAgeMin) params.set('age_min', marketAgeMin);
  if (marketAgeMax) params.set('age_max', marketAgeMax);

  return params;
}

async function fetchJson(url) {
  const res = await fetch(url);
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);
  return data;
}

async function initGeographies() {
  const geoSelect = document.getElementById("geography");
  try {
    const geos = await fetchJson(`${API_BASE}/geographies`);
    geoSelect.innerHTML = `<option value="">ทุกภาค</option>`;
    geos.forEach(g => {
      geoSelect.innerHTML += `<option value="${g.id}">${g.name}</option>`;
    });
  } catch (err) {
    console.error(err);
    geoSelect.innerHTML = `<option value="">โหลดภาคไม่สำเร็จ</option>`;
  }
}

async function loadProvincesByGeography(geographyId) {
  const provSelect = document.getElementById("province");
  provSelect.disabled = true;
  provSelect.innerHTML = `<option value="">ทุกจังหวัด</option>`;

  const url = geographyId
    ? `${API_BASE}/provinces?geography_id=${encodeURIComponent(geographyId)}`
    : `${API_BASE}/provinces`;

  try {
    const provinces = await fetchJson(url);
    provinces.forEach(p => {
      provSelect.innerHTML += `<option value="${p.id}">${p.name_th}</option>`;
    });
    provSelect.disabled = false;
  } catch (err) {
    console.error(err);
    provSelect.innerHTML = `<option value="">โหลดจังหวัดไม่สำเร็จ</option>`;
  }
}

function wireEvents() {
  document.getElementById("geography").addEventListener("change", async (e) => {
    await loadProvincesByGeography(e.target.value);
  });

  document.getElementById('marketFilterBtn').addEventListener('click', loadMarketChartOnly);

  document.getElementById('month_filter')?.addEventListener('change', renderTrendFromCache);
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab)?.classList.add("active");
      requestAnimationFrame(resizeAllCharts);
    });
  });
}

function destroyChart(name) {
  if (charts[name]) {
    charts[name].destroy();
    charts[name] = null;
  }
}

function destroyAllCharts() {
  Object.keys(charts).forEach(destroyChart);
}

function resizeAllCharts() {
  Object.values(charts).forEach(ch => {
    if (ch) {
      ch.resize();
      ch.update();
    }
  });
}

function renderEmpty(canvasId, message = "ไม่มีข้อมูลสำหรับเงื่อนไขที่เลือก") {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const box = canvas.closest('.chart-box');
  if (!box) return;
  box.innerHTML = `<div class="empty-state">${message}</div><canvas id="${canvasId}"></canvas>`;
  const newCanvas = box.querySelector(`#${canvasId}`);
  newCanvas.style.display = 'none';
}

function resetCanvasBox(canvasId) {
  const canvas = document.getElementById(canvasId);
  const box = canvas?.closest('.chart-box');
  if (!box) return;
  const hiddenCanvas = box.querySelector('canvas[style*="display: none"]');
  const empty = box.querySelector('.empty-state');
  if (empty) empty.remove();
  if (hiddenCanvas) hiddenCanvas.removeAttribute('style');
}

function createOrReplaceChart(key, canvasId, config) {
  resetCanvasBox(canvasId);
  destroyChart(key);
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  charts[key] = new Chart(ctx, config);
  return charts[key];
}

function numberFmt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

function moneyFmt(n) {
  return `฿${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function pctFmtFromNumber(n, digits = 1) {
  return `${Number(n || 0).toFixed(digits)}%`;
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: '#334155' }
      },
      datalabels: {
        color: COLORS.blue900,
        anchor: 'end',
        align: 'end',
        offset: 2,
        clip: false,
        font: { weight: '700', size: 11 },
        formatter: (value) => numberFmt(value)
      }
    },
    scales: {
      x: {
        grid: { color: COLORS.grid },
        ticks: { color: '#475569' }
      },
      y: {
        grid: { color: COLORS.grid },
        ticks: { color: '#475569' }
      }
    },
    ...extra
  };
}

function pieOptions(valueFormatter) {
  return baseOptions({
    scales: {},
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, padding: 12, color: '#334155' } },
      datalabels: {
        color: '#0f172a',
        font: { weight: '700', size: 11 },
        formatter: (value, ctx) => {
          const data = ctx.chart.data.datasets[0].data || [];
          const total = data.reduce((a, b) => a + Number(b || 0), 0);
          const pct = total ? (Number(value || 0) / total) * 100 : 0;
          return `${numberFmt(value)}\n(${pct.toFixed(1)}%)`;
        }
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.label}: ${valueFormatter ? valueFormatter(ctx.raw) : numberFmt(ctx.raw)}`
        }
      }
    }
  });
}

function updateRevenueKpis(metrics) {
  document.getElementById('kpi_mrr').textContent = moneyFmt(metrics.mrr);
  document.getElementById('kpi_arr').textContent = moneyFmt(metrics.arr);
  document.getElementById('kpi_paid_ratio').textContent = pctFmtFromNumber(metrics.paidRatio * 100, 1);
  document.getElementById('kpi_verified').textContent = moneyFmt(metrics.verifiedRevenue);
}

function normalizePackageLabel(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw || raw === 'basic') return 'Basic';
  if (raw === 'pro') return 'Pro';
  if (raw === 'business') return 'Business';
  return name;
}

function buildRevenueMetrics(revenue) {
  const packageBreakdown = Array.isArray(revenue?.packageBreakdown) ? revenue.packageBreakdown : [];
  const packageMap = new Map(
    packageBreakdown.map(item => [normalizePackageLabel(item.package_name), Number(item.revenue || 0)])
  );

  let trend = Array.isArray(revenue?.trend) ? revenue.trend.map(item => ({
    label: item.label,
    value: Number(item.value || 0)
  })) : [];

  if (!trend.length) {
    const currentLabel = new Date().toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
    trend = [{ label: currentLabel, value: Number(revenue?.mrr || 0) }];
  }

  return {
    mrr: Number(revenue?.mrr || 0),
    arr: Number(revenue?.arr || 0),
    paidRatio: Number(revenue?.paidRatio || 0),
    verifiedRevenue: Number(revenue?.verifiedRevenue || 0),
    packageBreakdown,
    proRevenue: Number(packageMap.get('Pro') || 0),
    businessRevenue: Number(packageMap.get('Business') || 0),
    basicRevenue: Number(packageMap.get('Basic') || 0),
    trend,
  };
}

function renderRevenueCharts(revenue) {
  const metrics = buildRevenueMetrics(revenue);
  updateRevenueKpis(metrics);

  const packageLabels = ['Pro', 'Business', 'Verified Add-on'];
  const packageValues = [metrics.proRevenue, metrics.businessRevenue, metrics.verifiedRevenue];
  if (packageValues.every(v => v === 0)) {
    destroyChart('revenuePackage');
    destroyChart('revenueMix');
    destroyChart('revenueTrend');
    renderEmpty('chart_revenue_package');
    renderEmpty('chart_revenue_mix');
    renderEmpty('chart_revenue_trend');
    return;
  }

  createOrReplaceChart('revenuePackage', 'chart_revenue_package', {
    type: 'bar',
    data: {
      labels: packageLabels,
      datasets: [{
        label: 'รายได้ต่อเดือน',
        data: packageValues,
        backgroundColor: [COLORS.blue700, COLORS.blue500, COLORS.blue300],
        borderRadius: 10,
        maxBarThickness: 56
      }]
    },
    options: baseOptions({
      scales: { y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } },
      plugins: {
        legend: { display: false },
        datalabels: {
          color: COLORS.blue900,
          anchor: 'end',
          align: 'end',
          formatter: (v) => moneyFmt(v)
        },
        tooltip: { callbacks: { label: (ctx) => moneyFmt(ctx.raw) } }
      }
    })
  });

  createOrReplaceChart('revenueMix', 'chart_revenue_mix', {
    type: 'doughnut',
    data: {
      labels: packageLabels,
      datasets: [{
        data: packageValues,
        backgroundColor: [COLORS.blue700, COLORS.blue500, COLORS.blue300],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: pieOptions(moneyFmt)
  });

  trendCache = metrics.trend;
  const monthVal = document.getElementById('month_filter')?.value || 'all';
  const trendData = monthVal === 'all'
    ? trendCache
    : trendCache.slice(-parseInt(monthVal));

  createOrReplaceChart('revenueTrend', 'chart_revenue_trend', {
    type: 'line',
    data: {
      labels: trendData.map(r => r.label),
      datasets: [{
        label: 'รายได้ต่อเดือน',
        data: trendData.map(r => r.value),
        borderColor: COLORS.blue700,
        backgroundColor: 'rgba(59,130,246,0.18)',
        pointBackgroundColor: COLORS.blue700,
        pointRadius: 4,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3
      }]
    },
    options: baseOptions({
      scales: { y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } },
      plugins: {
        datalabels: {
          color: COLORS.blue900,
          align: 'top',
          anchor: 'end',
          formatter: (v) => moneyFmt(v)
        },
        tooltip: { callbacks: { label: (ctx) => moneyFmt(ctx.raw) } }
      }
    })
  });
}

function renderMarketChart(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    destroyChart('market');
    renderEmpty('chart_market');
    return;
  }

  createOrReplaceChart('market', 'chart_market', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.job_type),
      datasets: [
        { label: 'จำนวนโพสต์', data: rows.map(r => Number(r.posts || 0)), backgroundColor: COLORS.blue700, borderRadius: 8, maxBarThickness: 34 },
        { label: 'จำนวนการสมัคร', data: rows.map(r => Number(r.applications || 0)), backgroundColor: COLORS.blue500, borderRadius: 8, maxBarThickness: 34 },
        { label: 'จำนวนที่ได้งาน', data: rows.map(r => Number(r.hired || 0)), backgroundColor: COLORS.blue300, borderRadius: 8, maxBarThickness: 34 },
      ]
    },
    options: baseOptions({ scales: { y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } } })
  });
}

function renderWageChart(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    destroyChart('wage');
    renderEmpty('chart_wage');
    return;
  }

  createOrReplaceChart('wage', 'chart_wage', {
    type: 'line',
    data: {
      labels: rows.map(r => r.job_type),
      datasets: [
        { label: 'เปอร์เซ็นไทล์ 25', data: rows.map(r => Number(r.p25_wage || 0)), borderColor: COLORS.blue300, backgroundColor: COLORS.blue300, tension: 0.25, pointRadius: 3 },
        { label: 'มัธยฐาน', data: rows.map(r => Number(r.median_wage || 0)), borderColor: COLORS.blue700, backgroundColor: COLORS.blue700, tension: 0.25, pointRadius: 4 },
        { label: 'เปอร์เซ็นไทล์ 75', data: rows.map(r => Number(r.p75_wage || 0)), borderColor: COLORS.blue500, backgroundColor: COLORS.blue500, tension: 0.25, pointRadius: 3 },
      ]
    },
    options: baseOptions({
      scales: { y: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } },
      plugins: {
        datalabels: {
          display: (ctx) => ctx.dataset.label === 'มัธยฐาน',
          color: COLORS.blue900,
          align: 'top',
          anchor: 'end',
          formatter: (v) => numberFmt(v)
        }
      }
    })
  });
}

function renderGeoChart(geoTop) {
  const rows = Array.isArray(geoTop?.rows) ? geoTop.rows : [];
  if (!rows.length || geoTop?.mode === 'none') {
    destroyChart('geo');
    renderEmpty('chart_geo_posts', 'ไม่มีกราฟเพิ่มเติมในระดับอำเภอที่เลือก');
    return;
  }

  createOrReplaceChart('geo', 'chart_geo_posts', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{
        label: geoTop.mode === 'district' ? 'จำนวนโพสต์ (อำเภอสูงสุด)' : 'จำนวนโพสต์ (จังหวัดสูงสุด)',
        data: rows.map(r => Number(r.value || 0)),
        backgroundColor: COLORS.blue500,
        borderRadius: 8,
        maxBarThickness: 24
      }]
    },
    options: baseOptions({
      indexAxis: 'y',
      scales: { x: { beginAtZero: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } } },
      plugins: {
        legend: { display: false },
        datalabels: {
          color: COLORS.blue900,
          anchor: 'end',
          align: 'right',
          formatter: (v) => numberFmt(v)
        }
      }
    })
  });
}

function renderGenderRatioChart(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    destroyChart('genderRatio');
    renderEmpty('chart_gender_ratio');
    return;
  }

  createOrReplaceChart('genderRatio', 'chart_gender_ratio', {
    type: 'bar',
    data: {
      labels: rows.map(r => r.job_type),
      datasets: [
        { label: 'ชาย %', data: rows.map(r => Number(r.male_share || 0) * 100), backgroundColor: COLORS.blue700, borderRadius: 6 },
        { label: 'หญิง %', data: rows.map(r => Number(r.female_share || 0) * 100), backgroundColor: COLORS.blue300, borderRadius: 6 }
      ]
    },
    options: baseOptions({
      scales: {
        x: { stacked: true, grid: { color: COLORS.grid }, ticks: { color: '#475569' } },
        y: { stacked: true, beginAtZero: true, max: 100, grid: { color: COLORS.grid }, ticks: { color: '#475569', callback: (v) => `${v}%` } }
      },
      plugins: {
        datalabels: {
          color: COLORS.blue900,
          formatter: (v) => `${Number(v || 0).toFixed(0)}%`
        }
      }
    })
  });
}

function renderGovStatusChart(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    destroyChart('govStatus');
    renderEmpty('chart_gov_status');
    return;
  }

  createOrReplaceChart('govStatus', 'chart_gov_status', {
    type: 'doughnut',
    data: {
      labels: rows.map(r => ({Pending:'รออนุมัติ', Approved:'อนุมัติแล้ว', Rejected:'ไม่อนุมัติ'}[r.approval_status] || r.approval_status)),
      datasets: [{
        data: rows.map(r => Number(r.posts_count || 0)),
        backgroundColor: [COLORS.blue700, COLORS.blue500, COLORS.blue300, COLORS.blue900],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: pieOptions(numberFmt)
  });
}

async function loadMarketChartOnly() {
  try {
    const market = await fetchJson(`${API_BASE}/dashboard/market?${buildMarketParams()}`);
    renderMarketChart(market);
    requestAnimationFrame(resizeAllCharts);
  } catch (err) {
    console.error('❌ loadMarketChartOnly error:', err);
    alert(`โหลดกราฟตลาดแรงงานไม่สำเร็จ: ${err.message}`);
  }
}

async function loadAllCharts() {
  const commonParams = buildCommonParams();
  const marketParams = buildMarketParams();

  try {
    const [revenue, overview, market, wageDist, geoTop, genderRatio, govStatus] = await Promise.all([
      fetchJson(`${API_BASE}/dashboard/revenue/summary?${commonParams}`),
      fetchJson(`${API_BASE}/dashboard/overview?${commonParams}`),
      fetchJson(`${API_BASE}/dashboard/market?${marketParams}`),
      fetchJson(`${API_BASE}/dashboard/wage-distribution?${commonParams}`),
      fetchJson(`${API_BASE}/dashboard/geo/top?${commonParams}`),
      fetchJson(`${API_BASE}/dashboard/gender-ratio/job-type?${commonParams}`),
      fetchJson(`${API_BASE}/dashboard/gov/status?${commonParams}`),
    ]);

    renderRevenueCharts(revenue);
    renderMarketChart(market);
    renderWageChart(wageDist);
    renderGeoChart(geoTop);
    renderGenderRatioChart(genderRatio);
    renderGovStatusChart(govStatus);

    requestAnimationFrame(resizeAllCharts);
  } catch (err) {
    console.error('❌ loadAllCharts error:', err);
    alert(`โหลดข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

async function resetFilters() {
  document.getElementById('geography').value = '';
  document.getElementById('job_type').value = '';
  document.getElementById('market_gender').value = '';
  document.getElementById('market_age_min').value = '';
  document.getElementById('market_age_max').value = '';

  const prov = document.getElementById('province');
  prov.innerHTML = `<option value="">ทุกจังหวัด</option>`;
  prov.disabled = true;

  destroyAllCharts();
  await loadAllCharts();
}

function onFilterClick() {
  loadAllCharts();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const filterBtn = document.getElementById('filterBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (filterBtn) filterBtn.addEventListener('click', onFilterClick);
    if (resetBtn) resetBtn.addEventListener('click', resetFilters);

    await initGeographies();
    wireEvents();
    initTabs();
    await loadAllCharts();
  } catch (err) {
    console.error('DOMContentLoaded init error:', err);
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(resizeAllCharts);
});