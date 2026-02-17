const tableState = {}; // ต้องอยู่ก่อน renderTable เสมอ

const SERVER_SORT_TABLES = new Set(["result", "dash_geo", "dash_gov_lco"]);

function applySortParams(params, tableId) {
  const st = tableState[tableId];
  if (st?.sortKey) {
    params.set("sort_key", st.sortKey);
    params.set("sort_dir", st.sortDir || "desc");
  } else {
    params.delete("sort_key");
    params.delete("sort_dir");
  }
}

function onServerSort(tableId) {
  // ✅ กด sort แล้วกลับไปหน้า 1 เสมอ
  if (tableId === "result") {
    pagerState.main.page = 1;
    loadData();
    return;
  }
  if (tableId === "dash_geo") {
    pagerState.geo.page = 1;
    loadDashboardPaged(); // โหลดเฉพาะตาราง paged
    return;
  }
  if (tableId === "dash_gov_lco") {
    pagerState.lco.page = 1;
    loadDashboardPaged();
    return;
  }
}

// ===== Pagination State =====
const pagerState = {
  main: { page: 1, pageSize: 20, total: 0 }, // ตารางหลัก
  geo:  { page: 1, pageSize: 20, total: 0 }, // Geographic Distribution
  lco:  { page: 1, pageSize: 20, total: 0 }, // Workload by LCO
};

function resetPagesToFirst() {
  pagerState.main.page = 1;
  pagerState.geo.page = 1;
  pagerState.lco.page = 1;
}

let chartMarket = null;
let chartGovStatus = null;
let chartGeoPosts = null;
let chartHireGender = null;
let chartGenderRatio = null;

const API_BASE = "https://work-i-go-admin.onrender.com";

function resizeVisibleCharts() {
  // ถ้า tab_gov แสดงอยู่ ค่อย resize
  const govTab = document.getElementById("tab_gov");
  if (govTab && govTab.classList.contains("active")) {
    if (chartGovStatus) {
      chartGovStatus.resize();
      chartGovStatus.update();
    }
  }

  // เผื่ออยากให้ tab_dash ก็ชัวร์ด้วย
  const dashTab = document.getElementById("tab_dash");
  if (dashTab && dashTab.classList.contains("active")) {
    if (chartMarket) {
      chartMarket.resize();
      chartMarket.update();
    }
    if (chartGeoPosts) {
      chartGeoPosts.resize();
      chartGeoPosts.update();
    }
    if (chartGenderRatio) {
      chartGenderRatio.resize();
      chartGenderRatio.update();
    }

  }
}

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(b => b.classList.remove("active"));
      panels.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      document.getElementById(targetId)?.classList.add("active");

      // ✅ สำคัญ: ให้ Chart.js คำนวณขนาดใหม่หลังแท็บโชว์
      requestAnimationFrame(() => resizeVisibleCharts());
    });

  });
}

function initChartTableToggles() {
  const bindings = [
    // Dashboard tab
    { boxId: "market_chart_box", tableId: "dash_market" },
    { boxId: "hire_gender_chart_box", tableId: "dash_hire_gender" },
    { boxId: "gender_ratio_chart_box", tableId: "dash_gender_ratio" },
    { boxId: "geo_chart_box", tableId: "dash_geo", pagerId: "dash_geo_pager" },

    // Gov tab
    { boxId: "gov_status_chart_box", tableId: "dash_gov_status" },
  ];

  bindings.forEach(({ boxId, tableId, pagerId }) => {
    const box = document.getElementById(boxId);
    const table = document.getElementById(tableId);
    const pager = pagerId ? document.getElementById(pagerId) : null;

    if (!box || !table) return;

    // คลิกที่กราฟ -> toggle ตาราง (และ pager ถ้ามี)
    box.addEventListener("click", () => {
      // ถ้ากราฟยัง hidden อยู่ แปลว่ายังไม่มีกราฟ ไม่ต้องทำอะไร
      if (box.classList.contains("hidden")) return;

      table.classList.toggle("hidden");
      if (pager) pager.classList.toggle("hidden");
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await initGeographies();
  wireEvents();
  initTabs(); // ✅ เพิ่มบรรทัดนี้
  initChartTableToggles();
  loadGlobalSummary();
});

function wireEvents() {
  document.getElementById("geography").addEventListener("change", async (e) => {
    const geographyId = e.target.value;
    await loadProvincesByGeography(geographyId);

    // รีเซ็ตอำเภอทุกครั้งเมื่อภาคเปลี่ยน
    resetDistricts();
  });

  // เพิ่ม: พอเลือกจังหวัด → โหลดอำเภอ
  document.getElementById("province").addEventListener("change", async (e) => {
    const provinceId = e.target.value;
    await loadDistrictsByProvince(provinceId);
  });
}

function resetDistricts() {
  const distSelect = document.getElementById("district");
  distSelect.disabled = true;
  distSelect.innerHTML = `<option value="">ทุกอำเภอ</option>`;
}

function clearAllOutputs() {
  // เคลียร์ตารางหลัก
  const result = document.getElementById("result");
  if (result) result.innerHTML = "";

  // ✅ เคลียร์ pager ตารางหลัก
  const resultPager = document.getElementById("result_pager");
  if (resultPager) resultPager.innerHTML = "";

  const geoBox = document.getElementById("geo_chart_box");
  if (geoBox) geoBox.classList.add("hidden");

  const marketBox = document.getElementById("market_chart_box");
  if (marketBox) marketBox.classList.add("hidden");

  const govBox = document.getElementById("gov_status_chart_box");
  if (govBox) govBox.classList.add("hidden");

  // เคลียร์ตาราง dashboard
  ["dash_market","dash_geo","dash_gov_status","dash_gov_lco","dash_demo","dash_wage_dist","dash_hire_gender","dash_gender_ratio"].forEach(id => {
    const t = document.getElementById(id);
    if (t) t.innerHTML = "";
  });

  // ✅ เคลียร์ pager ใน dashboard ด้วย
  const geoPager = document.getElementById("dash_geo_pager");
  if (geoPager) geoPager.innerHTML = "";

  const lcoPager = document.getElementById("dash_gov_lco_pager");
  if (lcoPager) lcoPager.innerHTML = "";

  const hireGenderBox = document.getElementById("hire_gender_chart_box");
  if (hireGenderBox) hireGenderBox.classList.add("hidden");
  
  const grBox = document.getElementById("gender_ratio_chart_box");
  if (grBox) grBox.classList.add("hidden");

  /*const grTable = document.getElementById("dash_gender_ratio");
  if (grTable) grTable.innerHTML = ""; */
  // เคลียร์ overview
  const ov = document.getElementById("dash_overview");
  // if (ov) ov.innerHTML = `<div class="muted">กด Filter เพื่อแสดงข้อมูล</div>`;
  if (ov) ov.innerHTML = `<div class="muted"></div>`;

  // ✅ ซ่อนตาราง/pager ของโหมด A กลับไปเหมือนเดิม
  ["dash_market","dash_hire_gender","dash_gender_ratio","dash_geo","dash_gov_status"].forEach(id => {
    const t = document.getElementById(id);
    if (t) t.classList.add("hidden");
  });

  // const geoPager = document.getElementById("dash_geo_pager");
  if (geoPager) geoPager.classList.add("hidden");
  
  // ปิดกราฟ (destroy)
  if (chartMarket) { chartMarket.destroy(); chartMarket = null; }
  if (chartGovStatus) { chartGovStatus.destroy(); chartGovStatus = null; }
  if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }
  if (chartHireGender) { chartHireGender.destroy(); chartHireGender = null; }
  if (chartGenderRatio) { chartGenderRatio.destroy(); chartGenderRatio = null; }
  
}

async function resetFilters() {
  // reset ค่า inputs/select
  document.getElementById("geography").value = "";
  document.getElementById("job_type").value = "";
  document.getElementById("min_wage").value = "";
  document.getElementById("max_wage").value = "";
  document.getElementById("gender").value = "";

  // reset จังหวัด + อำเภอ (กลับไปเหมือนเริ่มต้น)
  const prov = document.getElementById("province");
  prov.innerHTML = `<option value="">ทุกจังหวัด</option>`;
  prov.disabled = true;

  resetDistricts();

  // ล้างสถานะ sort
  Object.keys(tableState).forEach(k => delete tableState[k]);

  // ✅ ล้างผลลัพธ์บนหน้าจอ (ไม่ยิง API)
  clearAllOutputs();
  resetPagesToFirst();

}

async function initGeographies() {
  const geoSelect = document.getElementById("geography");

  try {
    const res = await fetch(`${API_BASE}/geographies`);
    const geos = await res.json();

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

  resetDistricts();

  // ถ้าไม่เลือกภาค → ให้โหลดจังหวัดทั้งหมด (หรือจะปล่อยว่างก็ได้)
  const url = geographyId
    ? `${API_BASE}/provinces?geography_id=${encodeURIComponent(geographyId)}`
    : `${API_BASE}/provinces`;

  try {
    const res = await fetch(url);
    const provinces = await res.json();

    provinces.forEach(p => {
      provSelect.innerHTML += `<option value="${p.id}">${p.name_th}</option>`;
    });

    provSelect.disabled = false;
  } catch (err) {
    console.error(err);
    provSelect.innerHTML = `<option value="">โหลดจังหวัดไม่สำเร็จ</option>`;
  }
}

async function loadDistrictsByProvince(provinceId) {
  const distSelect = document.getElementById("district");
  distSelect.disabled = true;
  distSelect.innerHTML = `<option value="">ทุกอำเภอ</option>`;

  // ถ้ายังไม่เลือกจังหวัด → ไม่โหลด
  if (!provinceId) return;

  const url = `${API_BASE}/districts?province_id=${encodeURIComponent(provinceId)}`;

  try {
    const res = await fetch(url);
    const districts = await res.json();

    districts.forEach(d => {
      distSelect.innerHTML += `<option value="${d.id}">${d.name_th}</option>`;
    });

    distSelect.disabled = false;
  } catch (err) {
    console.error(err);
    distSelect.innerHTML = `<option value="">โหลดอำเภอไม่สำเร็จ</option>`;
  }
}


async function loadData() {
  const params = new URLSearchParams({
    geography: document.getElementById('geography').value,
    province: document.getElementById('province').value,
    district: document.getElementById('district').value,
    job_type: document.getElementById('job_type').value,
    gender: document.getElementById('gender').value,
    min_wage: document.getElementById('min_wage').value,
    max_wage: document.getElementById('max_wage').value,
    page: pagerState.main.page,
    page_size: pagerState.main.pageSize
  });

  // ✅ ส่ง sort ไปกับ API
  applySortParams(params, "result");

  const data = await fetchJson(`${API_BASE}/jobs?${params}`);

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  pagerState.main.total = Number(data?.total || 0);

  renderTable(
    "result",
    [
      { key: "geography", label: "ภาค", sortable: true },
      { key: "province",  label: "จังหวัด", sortable: true },
      { key: "district",  label: "อำเภอ", sortable: true },
      { key: "job_type",  label: "ประเภท", sortable: true },
      { key: "total_jobs", label: "จำนวนงาน", sortable: true },
      { key: "avg_wage",   label: "ค่าแรงเฉลี่ย", sortable: true },
    ],
    rows
  );

  renderPager(
    "result_pager",
    pagerState.main.page,
    pagerState.main.pageSize,
    pagerState.main.total,
    (newPage) => { pagerState.main.page = newPage; loadData(); }
  );
}

function escapeHtml(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderTable(tableId, columns, rows) {
  const table = document.getElementById(tableId);
  if (!table) return;

  // init state
  if (!tableState[tableId]) tableState[tableId] = { sortKey: null, sortDir: "desc", rows: [] };
  const state = tableState[tableId];

  state.rows = Array.isArray(rows) ? rows : [];

  // sort ก่อน render (ถ้ามี sortKey)
  const useServerSort = SERVER_SORT_TABLES.has(tableId);

  const displayRows = (!useServerSort && state.sortKey)
    ? sortRows(state.rows, state.sortKey, state.sortDir)
    : state.rows;


  // สร้าง thead/tbody ชัดเจน (กัน browser แทรก tbody แล้วพฤติกรรมแปลกๆ)
  const theadHtml = `
    <thead>
      <tr>
        ${columns.map(c => {
          const isSortable = !!c.sortable;
          const arrow = (state.sortKey === c.key)
            ? (state.sortDir === "asc" ? " ▲" : " ▼")
            : "";
          return `
            <th ${isSortable ? 'class="sortable"' : ""} data-key="${c.key}">
              ${escapeHtml(c.label)}${arrow}
            </th>
          `;
        }).join("")}
      </tr>
    </thead>
  `;

  const tbodyHtml = `
    <tbody>
      ${
        (!displayRows || displayRows.length === 0)
          ? `<tr><td class="muted" colspan="${columns.length}">ไม่มีข้อมูล</td></tr>`
          : displayRows.map(r => `
              <tr>
                ${columns.map(c => `<td>${escapeHtml(r[c.key])}</td>`).join("")}
              </tr>
            `).join("")
      }
    </tbody>
  `;

  table.innerHTML = theadHtml + tbodyHtml;

  // ✅ Event Delegation: ผูกคลิกครั้งเดียวที่ thead
  const thead = table.querySelector("thead");
  if (thead) {
    thead.onclick = (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;

      const key = th.dataset.key;

      if (state.sortKey === key) {
        state.sortDir = (state.sortDir === "asc") ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "desc"; // เริ่มต้น มาก -> น้อย
      }

      if (SERVER_SORT_TABLES.has(tableId)) {
        onServerSort(tableId);     // ✅ ให้ server เป็นคน sort ทั้ง dataset
      } else {
        renderTable(tableId, columns, state.rows); // ตารางที่ไม่ paged ค่อย sort client ได้
      }

    };
  }
}

//const tableState = {}; // เก็บสถานะ sort ของแต่ละ tableId

function parseNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  // รองรับ "1,234.56"
  const n = Number(String(v).replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

function sortRows(rows, key, dir) {
  const sign = dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = parseNumber(a[key]);
    const bv = parseNumber(b[key]);

    // ถ้าเป็นตัวเลขทั้งคู่ → sort แบบเลข
    if (av !== null && bv !== null) return (av - bv) * sign;

    // ถ้าอันใดอันหนึ่งเป็น null → ดันไปท้าย
    if (av === null && bv !== null) return 1;
    if (av !== null && bv === null) return -1;

    // ถ้าไม่ใช่เลข → sort แบบตัวอักษร
    return String(a[key] ?? "").localeCompare(String(b[key] ?? ""), "th") * sign;
  });
}

function renderPager(containerId, page, pageSize, total, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.classList.add("pager");

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const windowSize = 5;
  let from = Math.max(1, page - Math.floor(windowSize / 2));
  let to = Math.min(totalPages, from + windowSize - 1);
  from = Math.max(1, to - windowSize + 1);

  const nums = [];
  for (let i = from; i <= to; i++) nums.push(i);

  el.innerHTML = `
    <span class="info">แสดง ${start}-${end} จาก ${total} รายการ</span>
    <button ${page <= 1 ? "disabled" : ""} data-page="${page - 1}">Prev</button>
    ${from > 1 ? `<button data-page="1">1</button><span class="muted">...</span>` : ""}
    ${nums.map(p => `<button class="${p === page ? "active" : ""}" data-page="${p}">${p}</button>`).join("")}
    ${to < totalPages ? `<span class="muted">...</span><button data-page="${totalPages}">${totalPages}</button>` : ""}
    <button ${page >= totalPages ? "disabled" : ""} data-page="${page + 1}">Next</button>
  `;

  el.onclick = (e) => {
    const btn = e.target.closest("button[data-page]");
    if (!btn || btn.disabled) return;
    onPageChange(Number(btn.dataset.page));
  };
}

function renderOverviewCards(data) {
  const el = document.getElementById("dash_overview");
  if (!el) return;

  if (!data || data.error) {
    el.innerHTML = `<div class="muted">โหลดไม่สำเร็จ: ${escapeHtml(data?.error || "")}</div>`;
    return;
  }

  // ทำเป็นตารางเล็กๆ (ง่ายสุด)
  el.innerHTML = `
    <table>
      <tr><th>ตัวชี้วัด</th><th>ค่า</th></tr>
      <tr><td>จำนวน Job Posts ทั้งหมด</td><td>${escapeHtml(data.total_jobposts)}</td></tr>
      <tr><td>จำนวน Applications</td><td>${escapeHtml(data.total_applications)}</td></tr>
      <tr><td>จำนวน Employments (ได้งาน)</td><td>${escapeHtml(data.total_employments)}</td></tr>
      <tr><td>Conversion rate (สมัคร → ได้งาน)</td><td>${escapeHtml(data.conversion_rate)}</td></tr>
      <tr><td>จำนวน Jobseekers ทั้งหมด</td><td>${escapeHtml(data.total_jobseekers)}</td></tr>
      <tr><td>Jobseekers ใหม่ในช่วงเวลา</td><td>${escapeHtml(data.new_jobseekers_in_range)}</td></tr>
    </table>
  `;
}

async function fetchJson(url) {
  const r = await fetch(url);

  let data = null;
  try {
    data = await r.json();
  } catch (_) {
    // เผื่อ server ตอบไม่ใช่ JSON
  }

  if (!r.ok) {
    const msg = data?.error || `${r.status} ${r.statusText}`;
    throw new Error(`${url} -> ${msg}`);
  }
  return data;
}

function buildDashboardParams() {
  return new URLSearchParams({
    geography: document.getElementById('geography').value,
    province: document.getElementById('province').value,
    district: document.getElementById('district').value,
    job_type: document.getElementById('job_type').value,
    gender: document.getElementById('gender').value,
    min_wage: document.getElementById('min_wage').value,
    max_wage: document.getElementById('max_wage').value
  });
}

function renderGenderRatioSection(genderRatio) {
  const raw = Array.isArray(genderRatio) ? genderRatio : [];

  // ✅ แสดงผลเป็น % สำหรับตาราง (แต่กราฟใช้ raw ได้เลย)
  const rows = raw.map(r => ({
    ...r,
    male_share: (Number(r.male_share || 0) * 100).toFixed(1) + "%",
    female_share: (Number(r.female_share || 0) * 100).toFixed(1) + "%",
    male_to_female_ratio: (r.male_to_female_ratio === null || r.male_to_female_ratio === undefined)
      ? ""   // female=0 -> จะเป็น NULL ใน SQL
      : Number(r.male_to_female_ratio).toFixed(2)
  }));

  renderTable(
    "dash_gender_ratio",
    [
      { key: "job_type", label: "ประเภทงาน", sortable: true },
      { key: "male", label: "ชาย", sortable: true },
      { key: "female", label: "หญิง", sortable: true },
      { key: "total_known", label: "รวม(ไม่รวม Unknown)", sortable: true },
      { key: "male_share", label: "%ชาย", sortable: true },
      { key: "female_share", label: "%หญิง", sortable: true },
      { key: "male_to_female_ratio", label: "อัตราส่วน ชาย/หญิง", sortable: true },
    ],
    rows
  );

  // ✅ กราฟใช้ raw (male_share/female_share ยังเป็น 0-1 อยู่)
  renderGenderRatioChart(raw);
}

async function loadDashboardAll() {
  const params = buildDashboardParams();

  const geoParams = new URLSearchParams(params);
  applySortParams(geoParams, "dash_geo");

  const lcoParams = new URLSearchParams(params);
  applySortParams(lcoParams, "dash_gov_lco");

  try {
    const [
      overview,
      market,
      geo,
      govStatus,
      govLco,
      demo,
      wageDist,
      geoTop,
      hireGender,
      genderRatio
    ] = await Promise.all([
      fetchJson(`${API_BASE}/dashboard/overview?${params}`),
      fetchJson(`${API_BASE}/dashboard/market?${params}`),
      fetchJson(`${API_BASE}/dashboard/geo/area?${geoParams}&page=${pagerState.geo.page}&page_size=${pagerState.geo.pageSize}`),
      fetchJson(`${API_BASE}/dashboard/gov/status?${params}`),
      fetchJson(`${API_BASE}/dashboard/gov/lco?${lcoParams}&page=${pagerState.lco.page}&page_size=${pagerState.lco.pageSize}`),
      fetchJson(`${API_BASE}/dashboard/behavior/demographics?${params}`),
      fetchJson(`${API_BASE}/dashboard/wage-distribution?${params}`),
      fetchJson(`${API_BASE}/dashboard/geo/top?${params}`),
      fetchJson(`${API_BASE}/dashboard/hire-rate/gender?${params}`),
      fetchJson(`${API_BASE}/dashboard/gender-ratio/job-type?${params}`),

    ]);

    renderGeoTopChart(geoTop);

    // A overview
    renderOverviewCards(overview);

    // B market table
    renderTable("dash_market",
      [
        { key: "job_type", label: "ประเภทงาน", sortable: true },
        { key: "posts", label: "จำนวนโพสต์", sortable: true },
        { key: "applications", label: "จำนวนสมัคร", sortable: true },
        { key: "hired", label: "ได้งาน", sortable: true },
        { key: "apps_per_post", label: "สมัคร/โพสต์", sortable: true },
        { key: "hire_rate", label: "อัตราได้งาน", sortable: true },
      ],
      Array.isArray(market) ? market : []
    );

    // C geo area (paged)
    const geoRows = Array.isArray(geo?.rows) ? geo.rows : [];
    pagerState.geo.total = Number(geo?.total || 0);

    renderTable("dash_geo",
      [
        { key: "geography", label: "ภาค" },
        { key: "province", label: "จังหวัด" },
        { key: "district", label: "อำเภอ" },
        { key: "posts", label: "จำนวนโพสต์", sortable: true },
        { key: "applications", label: "จำนวนสมัคร", sortable: true },
        { key: "apps_per_post", label: "สมัคร/โพสต์", sortable: true },
        { key: "avg_wage", label: "ค่าแรงเฉลี่ย", sortable: true },
        { key: "avg_workers_needed", label: "รับคนเฉลี่ย", sortable: true },
      ],
      geoRows
    );

    renderPager(
      "dash_geo_pager",
      pagerState.geo.page,
      pagerState.geo.pageSize,
      pagerState.geo.total,
      (newPage) => { pagerState.geo.page = newPage; loadDashboardPaged(); }  // ✅ เปลี่ยนตรงนี้
    );

    // D gov status
    renderTable("dash_gov_status",
      [
        { key: "approval_status", label: "สถานะ", sortable: true },
        { key: "posts_count", label: "จำนวนโพสต์", sortable: true },
        { key: "share", label: "สัดส่วน", sortable: true },
      ],
      Array.isArray(govStatus) ? govStatus : []
    );

    // D gov lco (paged)
    const lcoRows = Array.isArray(govLco?.rows) ? govLco.rows : [];
    pagerState.lco.total = Number(govLco?.total || 0);

    renderTable("dash_gov_lco",
      [
        { key: "lco_id", label: "LCO ID" },
        { key: "total_assigned", label: "งานทั้งหมด", sortable: true },
        { key: "pending_count", label: "Pending", sortable: true },
        { key: "approved_count", label: "Approved", sortable: true },
        { key: "rejected_count", label: "Rejected", sortable: true },
        { key: "avg_review_hours", label: "ชั่วโมงตรวจเฉลี่ย", sortable: true },
        { key: "total_appeals", label: "Appeal รวม", sortable: true },
      ],
      lcoRows
    );

    renderPager(
      "dash_gov_lco_pager",
      pagerState.lco.page,
      pagerState.lco.pageSize,
      pagerState.lco.total,
      (newPage) => { pagerState.lco.page = newPage; loadDashboardPaged(); } // ✅ เปลี่ยนตรงนี้
    );

    // E demographics
    renderTable("dash_demo",
      [
        { key: "job_type", label: "ประเภทงาน" },
        { key: "gender", label: "เพศ" },
        { key: "age_bucket", label: "ช่วงอายุ", sortable: true },
        { key: "unique_applicants", label: "ผู้สมัครไม่ซ้ำ", sortable: true },
        { key: "applications", label: "จำนวนสมัคร", sortable: true },
      ],
      Array.isArray(demo) ? demo : []
    );

    // wage dist
    renderTable("dash_wage_dist",
      [
        { key: "job_type",   label: "ประเภทงาน", sortable: true },
        { key: "p25_wage",   label: "P25 ค่าแรง", sortable: true },
        { key: "median_wage",label: "Median ค่าแรง", sortable: true },
        { key: "p75_wage",   label: "P75 ค่าแรง", sortable: true },
        { key: "avg_wage",   label: "ค่าแรงเฉลี่ย", sortable: true },
        { key: "posts",      label: "จำนวนโพสต์", sortable: true },
      ],
      Array.isArray(wageDist) ? wageDist : []
    );

    const hgRaw = Array.isArray(hireGender) ? hireGender : [];

    // ✅ เอาเฉพาะ Male/Female (ไม่เอา Unknown/Other)
    const hgRows = hgRaw.filter(r => {
      const g = String(r.gender || "").toLowerCase();
      return g === "male" || g === "female";
    });

    renderTable("dash_hire_gender",
      [
        { key: "gender", label: "เพศ", sortable: true },
        { key: "applications", label: "จำนวนสมัคร", sortable: true },
        { key: "hired", label: "ได้งาน", sortable: true },
        { key: "hire_rate", label: "อัตราได้งาน", sortable: true },
      ],
      hgRows
    );

    renderHireGenderChart(hgRows);

    renderGenderRatioSection(genderRatio);

    // ✅ วาดกราฟ “เฉพาะตอน Filter / โหลดครบ”
    renderMarketChart(Array.isArray(market) ? market : []);
    renderGovStatusChart(Array.isArray(govStatus) ? govStatus : []);
    renderGeoTopChart(geoTop)

  } catch (err) {
    console.error("❌ loadDashboardAll error:", err);
    alert(err.message);
  }
}

async function loadDashboardPaged() {
  const params = buildDashboardParams();

  const geoParams = new URLSearchParams(params);
  applySortParams(geoParams, "dash_geo");

  const lcoParams = new URLSearchParams(params);
  applySortParams(lcoParams, "dash_gov_lco");

  try {
    const [geo, govLco] = await Promise.all([
      fetchJson(`${API_BASE}/dashboard/geo/area?${geoParams}&page=${pagerState.geo.page}&page_size=${pagerState.geo.pageSize}`),
      fetchJson(`${API_BASE}/dashboard/gov/lco?${lcoParams}&page=${pagerState.lco.page}&page_size=${pagerState.lco.pageSize}`),
    ]);

    // geo table + pager
    const geoRows = Array.isArray(geo?.rows) ? geo.rows : [];
    pagerState.geo.total = Number(geo?.total || 0);

    renderTable("dash_geo",
      [
        { key: "geography", label: "ภาค" },
        { key: "province", label: "จังหวัด" },
        { key: "district", label: "อำเภอ" },
        { key: "posts", label: "จำนวนโพสต์", sortable: true },
        { key: "applications", label: "จำนวนสมัคร", sortable: true },
        { key: "apps_per_post", label: "สมัคร/โพสต์", sortable: true },
        { key: "avg_wage", label: "ค่าแรงเฉลี่ย", sortable: true },
        { key: "avg_workers_needed", label: "รับคนเฉลี่ย", sortable: true },
      ],
      geoRows
    );

    renderPager(
      "dash_geo_pager",
      pagerState.geo.page,
      pagerState.geo.pageSize,
      pagerState.geo.total,
      (newPage) => { pagerState.geo.page = newPage; loadDashboardPaged(); }
    );

    // lco table + pager
    const lcoRows = Array.isArray(govLco?.rows) ? govLco.rows : [];
    pagerState.lco.total = Number(govLco?.total || 0);

    renderTable("dash_gov_lco",
      [
        { key: "lco_id", label: "LCO ID" },
        { key: "total_assigned", label: "งานทั้งหมด", sortable: true },
        { key: "pending_count", label: "Pending", sortable: true },
        { key: "approved_count", label: "Approved", sortable: true },
        { key: "rejected_count", label: "Rejected", sortable: true },
        { key: "avg_review_hours", label: "ชั่วโมงตรวจเฉลี่ย", sortable: true },
        { key: "total_appeals", label: "Appeal รวม", sortable: true },
      ],
      lcoRows
    );

    renderPager(
      "dash_gov_lco_pager",
      pagerState.lco.page,
      pagerState.lco.pageSize,
      pagerState.lco.total,
      (newPage) => { pagerState.lco.page = newPage; loadDashboardPaged(); }
    );

    // ✅ สำคัญ: ไม่เรียก renderMarketChart / renderGovStatusChart / renderGeoPostsChart ตรงนี้

  } catch (err) {
    console.error("❌ loadDashboardPaged error:", err);
    alert(err.message);
  }
}

function renderMarketChart(rows) {
  const ctx = document.getElementById("chart_market");
  const box = document.getElementById("market_chart_box");
  if (!ctx || !box) return;

  if (!rows || rows.length === 0) {
    if (chartMarket) { chartMarket.destroy(); chartMarket = null; }
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  const labels = rows.map(r => r.job_type);
  const posts = rows.map(r => Number(r.posts || 0));
  const applications = rows.map(r => Number(r.applications || 0));
  const hired = rows.map(r => Number(r.hired || 0));

  if (chartMarket) chartMarket.destroy();

  chartMarket = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Posts", data: posts },
        { label: "Applications", data: applications },
        { label: "Hired", data: hired },
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderGovStatusChart(rows) {
  const ctx = document.getElementById("chart_gov_status");
  const box = document.getElementById("gov_status_chart_box");
  if (!ctx || !box) return;

  if (!rows || rows.length === 0) {
    if (chartGovStatus) { chartGovStatus.destroy(); chartGovStatus = null; }
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  const labels = rows.map(r => r.approval_status);
  const counts = rows.map(r => Number(r.posts_count || 0));

  if (chartGovStatus) chartGovStatus.destroy();

  chartGovStatus = new Chart(ctx, {
    type: "pie",
    data: {
      labels,
      datasets: [{ label: "Posts", data: counts }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { position: "top" } }
    }
  });

    // ✅ ถ้าตอนนี้แท็บยังไม่ active ให้รอจนโชว์แล้วค่อย resize
    requestAnimationFrame(() => {
      if (chartGovStatus) {
        chartGovStatus.resize();
        chartGovStatus.update();
      }
    });

}

function renderGeoPostsChart(geoRows) {
  const box = document.getElementById("geo_chart_box");
  const ctx = document.getElementById("chart_geo_posts");

  // กันพัง
  if (!ctx || !box) return;

  // ถ้าไม่มีข้อมูล -> ซ่อน + ลบกราฟเดิม
  if (!geoRows || geoRows.length === 0) {
    if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }
    if (box) box.classList.add("hidden");
    return;
  }

  // ดึงรายชื่อจังหวัด/อำเภอที่มีในข้อมูล
  const provinces = [...new Set(geoRows.map(r => r.province).filter(Boolean))];
  const districts = [...new Set(geoRows.map(r => r.district).filter(Boolean))];

  // ✅ เลือกครบ ภาค+จังหวัด+อำเภอ (เหลืออำเภอเดียว) -> ซ่อนกราฟ
  if (districts.length === 1) {
    if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }
    if (box) box.classList.add("hidden");
  return;
  }

  // อย่างอื่นให้โชว์กราฟ
  if (box) box.classList.remove("hidden");

  // 🟡 จังหวัดเดียว + หลายอำเภอ → Top 10 อำเภอ
  if (provinces.length === 1 && districts.length > 1) {
    const byDistrict = new Map();
    geoRows.forEach(r => {
      const key = r.district || "ไม่ระบุอำเภอ";
      byDistrict.set(key, (byDistrict.get(key) || 0) + Number(r.posts || 0));
    });

    const sorted = [...byDistrict.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }

    chartGeoPosts = new Chart(ctx, {
      type: "bar",
      data: {
        labels: sorted.map(x => x[0]),
        datasets: [{ label: "Posts (Top 10 Districts)", data: sorted.map(x => x[1]) }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } }
      }
    });

    return;
  }

  // 🔵 หลายจังหวัด → Top 10 จังหวัด
  const byProvince = new Map();
  geoRows.forEach(r => {
    const key = r.province || "ไม่ระบุจังหวัด";
    byProvince.set(key, (byProvince.get(key) || 0) + Number(r.posts || 0));
  });

  const sorted = [...byProvince.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }

  chartGeoPosts = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map(x => x[0]),
      datasets: [{ label: "Posts (Top 10 Provinces)", data: sorted.map(x => x[1]) }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderGeoTopChart(geoTop) {
  const box = document.getElementById("geo_chart_box");
  const ctx = document.getElementById("chart_geo_posts");
  if (!ctx || !box) return;

  const mode = geoTop?.mode;
  const rows = Array.isArray(geoTop?.rows) ? geoTop.rows : [];

  // mode none หรือไม่มีข้อมูล -> ซ่อน
  if (mode === "none" || rows.length === 0) {
    if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  const labels = rows.map(r => r.label);
  const values = rows.map(r => Number(r.value || 0));

  if (chartGeoPosts) { chartGeoPosts.destroy(); chartGeoPosts = null; }

  chartGeoPosts = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: mode === "district" ? "Posts (Top 10 Districts)" : "Posts (Top 10 Provinces)",
        data: values
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderHireGenderChart(rows) {
  const ctx = document.getElementById("chart_hire_gender");
  const box = document.getElementById("hire_gender_chart_box");
  if (!ctx || !box) return;

  if (!rows || rows.length === 0) {
    if (chartHireGender) { chartHireGender.destroy(); chartHireGender = null; }
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  // เอาเฉพาะ Male/Female/Unknown/Other ตามที่ API ส่ง
  const labels = rows.map(r => r.gender);
  const rates = rows.map(r => Number(r.hire_rate || 0));

  if (chartHireGender) chartHireGender.destroy();

  chartHireGender = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Hire rate", data: rates }]
    },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}


function renderGenderRatioChart(rows) {
  const ctx = document.getElementById("chart_gender_ratio");
  const box = document.getElementById("gender_ratio_chart_box");
  if (!ctx || !box) return;

  if (!rows || rows.length === 0) {
    if (chartGenderRatio) { chartGenderRatio.destroy(); chartGenderRatio = null; }
    box.classList.add("hidden");
    return;
  }

  box.classList.remove("hidden");

  const labels = rows.map(r => r.job_type);

  // ใช้เปอร์เซ็นต์ (ไม่รวม Unknown อยู่แล้ว)
  const malePct = rows.map(r => Number(r.male_share || 0) * 100);
  const femalePct = rows.map(r => Number(r.female_share || 0) * 100);

  if (chartGenderRatio) chartGenderRatio.destroy();

  chartGenderRatio = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Male %", data: malePct },
        { label: "Female %", data: femalePct },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "top" } },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, max: 100 }
      }
    }
  });
}

function renderGlobalSummary(data) {
  const el = document.getElementById("global_summary");
  if (!el) return;

  if (!data || data.error) {
    el.innerHTML = `<tr><td class="muted">โหลดไม่สำเร็จ: ${escapeHtml(data?.error || "")}</td></tr>`;
    return;
  }

  el.innerHTML = `
    <tr><th>ตัวชี้วัด</th><th>ค่า</th></tr>
    <tr><td>ผู้ใช้ทั้งหมด (Jobseekers)</td><td>${escapeHtml(data.total_users)}</td></tr>
    <tr><td>Jobposts ทั้งหมด</td><td>${escapeHtml(data.total_jobposts)}</td></tr>
    <tr><td>Applications ทั้งหมด</td><td>${escapeHtml(data.total_applications)}</td></tr>
    <tr><td>ผู้ใช้เพศชายทั้งหมด</td><td>${escapeHtml(data.male_total)}</td></tr>
    <tr><td>ผู้ใช้เพศหญิงทั้งหมด</td><td>${escapeHtml(data.female_total)}</td></tr>
    <tr><td>รวมชายและหญิง</td><td>${escapeHtml(data.male_female_total)}</td></tr>
  `;
}

async function loadGlobalSummary() {
  try {
    const data = await fetchJson(`${API_BASE}/stats/global-summary`);
    renderGlobalSummary(data);
  } catch (err) {
    console.error("❌ loadGlobalSummary error:", err);
    const el = document.getElementById("global_summary");
    if (el) el.innerHTML = `<tr><td class="muted">${escapeHtml(err.message)}</td></tr>`;
  }
}

function onFilterClick() {
  resetPagesToFirst();
  loadData();
  loadDashboardAll();
  loadGlobalSummary();
}

