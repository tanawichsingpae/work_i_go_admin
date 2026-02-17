const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/*app.get('/jobs', async (req, res) => {
  const {
    geography,
    province,
    district,
    job_type,   // ตัวเลข id ที่ส่งมาจาก dropdown
    min_wage,
    max_wage
  } = req.query;

  let sql = `
    SELECT
      g.name AS geography,
      p.name_th AS province,
      d.name_th AS district,
      jt.job_type AS job_type,
      COUNT(*) AS total_jobs,
      ROUND(AVG(jp.wage_amount), 2) AS avg_wage,
      ROUND(AVG(jp.workers_needed), 2) AS avg_workers
    FROM jobposts jp
    JOIN sub_districts sd ON jp.sub_district_id = sd.id
    JOIN districts d ON sd.district_id = d.id
    JOIN provinces p ON d.province_id = p.id
    JOIN geographies g ON p.geography_id = g.id
    JOIN job_types jt ON jp.job_type_id = jt.job_type_id
    WHERE 1=1
  `;

  const params = [];

  if (geography) {
    params.push(geography);
    sql += ` AND p.geography_id = $${params.length}`;
  }

  if (province) {
    params.push(province);
    sql += ` AND p.id = $${params.length}`;
  }

  if (district) {
    params.push(district);
    sql += ` AND d.id = $${params.length}`;
  }

  // กรองด้วย id (ของ jobposts)
  if (job_type) {
    params.push(job_type);
    sql += ` AND jp.job_type_id = $${params.length}`;
  }

  if (min_wage) {
    params.push(min_wage);
    sql += ` AND jp.wage_amount >= $${params.length}`;
  }

  if (max_wage) {
    params.push(max_wage);
    sql += ` AND jp.wage_amount <= $${params.length}`;
  }

  sql += `
    GROUP BY g.name, p.name_th, d.name_th, jt.job_type
    ORDER BY g.name, p.name_th, d.name_th, jt.job_type
  `;

  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /jobs error:", err);
    res.status(500).json({ error: err.message });
  }
}); */

app.get('/jobs', async (req, res) => {
  const { geography, province, district, job_type, min_wage, max_wage } = req.query;
  const { page, pageSize, offset } = getPaging(req);

  let where = `WHERE 1=1`;
  const params = [];

  if (geography) { params.push(geography); where += ` AND p.geography_id = $${params.length}`; }
  if (province)  { params.push(province);  where += ` AND p.id = $${params.length}`; }
  if (district)  { params.push(district);  where += ` AND d.id = $${params.length}`; }
  if (job_type)  { params.push(job_type);  where += ` AND jp.job_type_id = $${params.length}`; }
  if (min_wage)  { params.push(min_wage);  where += ` AND jp.wage_amount >= $${params.length}`; }
  if (max_wage)  { params.push(max_wage);  where += ` AND jp.wage_amount <= $${params.length}`; }

  const baseCte = `
    WITH agg AS (
      SELECT
        g.name AS geography,
        p.name_th AS province,
        d.name_th AS district,
        jt.job_type AS job_type,
        COUNT(*)::int AS total_jobs,
        ROUND(AVG(jp.wage_amount)::numeric, 2) AS avg_wage
      FROM jobposts jp
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      JOIN geographies g ON p.geography_id = g.id
      JOIN job_types jt ON jp.job_type_id = jt.job_type_id
      ${where}
      GROUP BY g.name, p.name_th, d.name_th, jt.job_type
    )
  `;

  try {
    // total จำนวน "แถวหลัง group"
    const totalSql = `${baseCte} SELECT COUNT(*)::int AS total FROM agg;`;
    const totalResult = await pool.query(totalSql, params);
    const total = totalResult.rows?.[0]?.total || 0;

    const allowedSort = {
      geography: "geography",
      province: "province",
      district: "district",
      job_type: "job_type",
      total_jobs: "total_jobs",
      avg_wage: "avg_wage",
    };

    const defaultOrder = "geography, province, district, job_type";
    const orderSql = getSort(req, allowedSort, defaultOrder);

    // rows
    const rowsSql = `
      ${baseCte}
      SELECT *
      FROM agg
      ORDER BY ${orderSql}
      LIMIT ${addParam(params, pageSize)}
      OFFSET ${addParam(params, offset)}
    `;
    const rowsResult = await pool.query(rowsSql, params);

    res.json({ page, page_size: pageSize, total, rows: rowsResult.rows });
  } catch (err) {
    console.error("❌ /jobs error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ที่เพิ่มมาใหม่
app.get('/geographies', async (req, res) => {
  const sql = `
    SELECT id, name
    FROM geographies
    ORDER BY id
  `;
  const { rows } = await pool.query(sql);
  res.json(rows);
});

app.get('/provinces', async (req, res) => {
  const { geography_id } = req.query;

  let sql = `
    SELECT id, name_th, geography_id
    FROM provinces
    WHERE 1=1
  `;
  const params = [];

  if (geography_id) {
    params.push(geography_id);
    sql += ` AND geography_id = $${params.length}`;
  }

  sql += ` ORDER BY name_th`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

app.get('/districts', async (req, res) => {
  const { province_id } = req.query;

  let sql = `
    SELECT id, name_th, province_id
    FROM districts
    WHERE 1=1
  `;
  const params = [];

  if (province_id) {
    params.push(province_id);
    sql += ` AND province_id = $${params.length}`;
  }

  sql += ` ORDER BY name_th`;

  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// สิ้นสุดส่วนที่เพิ่มมาใหม่

// เพิ่มใหม่ 2

function addParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function getPaging(req) {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.page_size || "20", 10), 1), 200);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function getSort(req, allowedMap, defaultOrderSql) {
  const key = req.query.sort_key;
  const dirRaw = String(req.query.sort_dir || "desc").toLowerCase();
  const dir = dirRaw === "asc" ? "ASC" : "DESC";

  const col = allowedMap[key];
  if (!col) return defaultOrderSql; // ไม่มี sort_key หรือไม่อยู่ใน allowlist

  // stable pagination: ใส่ tie-breaker ต่อท้ายเสมอ
  return `${col} ${dir} NULLS LAST, ${defaultOrderSql}`;
}

app.get("/dashboard/market", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    const sql = `
      SELECT
        jt.job_type_id,
        jt.job_type,
        COUNT(DISTINCT jp.jobpost_id)::int AS posts,
        COUNT(ja.job_application_id)::int AS applications,
        COUNT(DISTINCT e.employment_id)::int AS hired,
        CASE WHEN COUNT(DISTINCT jp.jobpost_id) = 0 THEN 0
             ELSE ROUND(COUNT(ja.job_application_id)::numeric / COUNT(DISTINCT jp.jobpost_id)::numeric, 2)
        END AS apps_per_post,
        CASE WHEN COUNT(ja.job_application_id) = 0 THEN 0
             ELSE ROUND(COUNT(DISTINCT e.employment_id)::numeric / COUNT(ja.job_application_id)::numeric, 2)
        END AS hire_rate
      FROM jobposts jp
      JOIN job_types jt ON jp.job_type_id = jt.job_type_id
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
      LEFT JOIN employments e ON e.job_application_id = ja.job_application_id
      ${where}
      GROUP BY jt.job_type_id, jt.job_type
      ORDER BY posts DESC, jt.job_type
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/market error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/wage-distribution", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    const sql = `
      WITH base AS (
        SELECT
          TRIM(jt.job_type) AS job_type,
          jp.wage_amount::numeric AS wage_amount
        FROM jobposts jp
        JOIN job_types jt ON jp.job_type_id = jt.job_type_id
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
        AND jp.wage_amount IS NOT NULL
      )
      SELECT
        job_type,
        ROUND( (percentile_cont(0.25) WITHIN GROUP (ORDER BY wage_amount))::numeric, 2) AS p25_wage,
        ROUND( (percentile_cont(0.50) WITHIN GROUP (ORDER BY wage_amount))::numeric, 2) AS median_wage,
        ROUND( (percentile_cont(0.75) WITHIN GROUP (ORDER BY wage_amount))::numeric, 2) AS p75_wage,
        ROUND(AVG(wage_amount), 2) AS avg_wage,
        COUNT(*)::int AS posts
      FROM base
      GROUP BY job_type
      ORDER BY posts DESC, job_type;
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/wage-distribution error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/geo/provinces", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    const sql = `
      SELECT
        g.name AS geography,
        p.name_th AS province,
        COUNT(DISTINCT jp.jobpost_id)::int AS posts,
        COUNT(ja.job_application_id)::int AS applications,
        CASE WHEN COUNT(DISTINCT jp.jobpost_id)=0 THEN 0
             ELSE ROUND(COUNT(ja.job_application_id)::numeric / COUNT(DISTINCT jp.jobpost_id)::numeric, 2)
        END AS apps_per_post,
        ROUND(AVG(jp.wage_amount), 2) AS avg_wage
      FROM jobposts jp
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      JOIN geographies g ON p.geography_id = g.id
      LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
      ${where}
      GROUP BY g.name, p.name_th
      ORDER BY posts DESC, p.name_th
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/geo/provinces error:", err);
    res.status(500).json({ error: err.message });
  }
});

async function hasTable(pool, tableName) {
  const sql = `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [tableName]);
  return rows.length > 0;
}

async function hasColumn(pool, tableName, columnName) {
  const sql = `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [tableName, columnName]);
  return rows.length > 0;
}

/**
 * Filter สำหรับ jobposts-based endpoints
 * ใช้กับ jp.created_at เป็นช่วงเวลา
 */
function buildJobpostFilters(req) {
  const {
    geography, province, district, job_type,
    min_wage, max_wage,
    start_date, end_date, // YYYY-MM-DD หรือ timestamp ก็ได้
    approval_status
  } = req.query;

  const params = [];
  let where = "WHERE 1=1";

  if (start_date) where += ` AND jp.created_at >= ${addParam(params, start_date)}`;
  if (end_date)   where += ` AND jp.created_at <  ${addParam(params, end_date)}`;

  if (geography) where += ` AND p.geography_id = ${addParam(params, geography)}`;
  if (province)  where += ` AND p.id = ${addParam(params, province)}`;
  if (district)  where += ` AND d.id = ${addParam(params, district)}`;

  if (job_type)  where += ` AND jp.job_type_id = ${addParam(params, job_type)}`;

  if (min_wage)  where += ` AND jp.wage_amount >= ${addParam(params, min_wage)}`;
  if (max_wage)  where += ` AND jp.wage_amount <= ${addParam(params, max_wage)}`;

  if (approval_status) where += ` AND jp.approval_status = ${addParam(params, approval_status)}`;

  return { where, params };
}

/**
 * Filter สำหรับ endpoints ที่ time-based เป็น applied_at (พฤติกรรมผู้สมัคร)
 */
function buildApplicationFilters(req, opts = {}) {
  const useGenderFilter = opts.useGenderFilter !== false;

  const {
    geography, province, district, job_type,
    gender,
    min_wage, max_wage,
    start_date, end_date
  } = req.query;

  const params = [];
  let where = "WHERE 1=1";

  if (start_date) where += ` AND ja.applied_at >= ${addParam(params, start_date)}`;
  if (end_date)   where += ` AND ja.applied_at <  ${addParam(params, end_date)}`;

  if (geography) where += ` AND p.geography_id = ${addParam(params, geography)}`;
  if (province)  where += ` AND p.id = ${addParam(params, province)}`;
  if (district)  where += ` AND d.id = ${addParam(params, district)}`;

  if (job_type)  where += ` AND jp.job_type_id = ${addParam(params, job_type)}`;

  if (min_wage)  where += ` AND jp.wage_amount >= ${addParam(params, min_wage)}`;
  if (max_wage)  where += ` AND jp.wage_amount <= ${addParam(params, max_wage)}`;

  // ✅ ใช้ gender filter เฉพาะ endpoint ที่ต้องการจริงๆ
  if (useGenderFilter && gender) {
    where += ` AND EXISTS (
      SELECT 1
      FROM job_seekers js2
      WHERE js2.job_seeker_id = ja.job_seeker_id
      AND (
        CASE
          WHEN lower(trim(COALESCE(js2.gender,''))) IN ('male','m','ชาย','man') THEN 'male'
          WHEN lower(trim(COALESCE(js2.gender,''))) IN ('female','f','หญิง','woman') THEN 'female'
          WHEN COALESCE(trim(js2.gender), '') = '' THEN 'unknown'
          ELSE 'other'
        END
      ) = ${addParam(params, gender)}
    )`;
  }

  return { where, params };
}

app.get("/dashboard/overview", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    // ตรวจ employments ก่อน (กันพัง)
    const employmentExists = await hasTable(pool, "employments");
    let hireCte = `SELECT 0::int AS total_employments`; // default ถ้าไม่มี table

    if (employmentExists) {
      const hasJobpostId = await hasColumn(pool, "employments", "jobpost_id");
      const hasJobApplicationId = await hasColumn(pool, "employments", "job_application_id");

      if (hasJobpostId) {
        hireCte = `
          SELECT COUNT(*)::int AS total_employments
          FROM employments e
          JOIN base b ON e.jobpost_id = b.jobpost_id
        `;
      } else if (hasJobApplicationId) {
        hireCte = `
          SELECT COUNT(*)::int AS total_employments
          FROM employments e
          JOIN job_applications ja ON e.job_application_id = ja.job_application_id
          JOIN base b ON ja.jobpost_id = b.jobpost_id
        `;
      } else {
        // มี table แต่ไม่รู้จะ join ยังไง -> คืน 0
        hireCte = `SELECT 0::int AS total_employments`;
      }
    }

    const sql = `
      WITH base AS (
        SELECT jp.jobpost_id
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
      ),
      posts AS (
        SELECT COUNT(*)::int AS total_jobposts FROM base
      ),
      apps AS (
        SELECT
          COUNT(*)::int AS total_applications,
          COUNT(DISTINCT ja.job_seeker_id)::int AS unique_applicants
        FROM job_applications ja
        JOIN base b ON ja.jobpost_id = b.jobpost_id
      ),
      hires AS (
        ${hireCte}
      ),
      seekers AS (
        SELECT
          COUNT(*)::int AS total_jobseekers,
          COUNT(*) FILTER (
            WHERE (
              $${params.length + 1}::timestamptz IS NULL
              OR js.created_at >= $${params.length + 1}::timestamptz
            )
            AND (
              $${params.length + 2}::timestamptz IS NULL
              OR js.created_at <  $${params.length + 2}::timestamptz
            )
          )::int AS new_jobseekers_in_range
        FROM job_seekers js
      )

      SELECT
        (SELECT total_jobposts FROM posts) AS total_jobposts,
        (SELECT total_applications FROM apps) AS total_applications,
        (SELECT unique_applicants FROM apps) AS unique_applicants,
        (SELECT total_employments FROM hires) AS total_employments,
        CASE
          WHEN (SELECT total_applications FROM apps)=0 THEN 0
          ELSE ROUND(
            (SELECT total_employments FROM hires)::numeric
            / (SELECT total_applications FROM apps)::numeric
          , 4)
        END AS conversion_rate,
        (SELECT total_jobseekers FROM seekers) AS total_jobseekers,
        (SELECT new_jobseekers_in_range FROM seekers) AS new_jobseekers_in_range
    `;

    // ใช้ start_date/end_date เดิมให้ seekers ด้วย (ถ้าไม่ได้ส่งมา = null)
    const start_date = req.query.start_date || null;
    const end_date = req.query.end_date || null;

    const { rows } = await pool.query(sql, [...params, start_date, end_date]);
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ /dashboard/overview error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/geo/area", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);
    const { page, pageSize, offset } = getPaging(req);

    const baseCte = `
      WITH agg AS (
        SELECT
          g.name AS geography,
          p.name_th AS province,
          d.name_th AS district,
          COUNT(DISTINCT jp.jobpost_id)::int AS posts,
          COUNT(ja.job_application_id)::int AS applications,
          CASE WHEN COUNT(DISTINCT jp.jobpost_id)=0 THEN 0
               ELSE ROUND(COUNT(ja.job_application_id)::numeric / COUNT(DISTINCT jp.jobpost_id)::numeric, 2)
          END AS apps_per_post,
          ROUND(AVG(jp.wage_amount)::numeric, 2) AS avg_wage,
          ROUND(AVG(jp.workers_needed)::numeric, 2) AS avg_workers_needed
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        JOIN geographies g ON p.geography_id = g.id
        LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
        ${where}
        GROUP BY g.name, p.name_th, d.name_th
      )
    `;

    const totalSql = `${baseCte} SELECT COUNT(*)::int AS total FROM agg;`;
    const totalResult = await pool.query(totalSql, params);
    const total = totalResult.rows?.[0]?.total || 0;

    const allowedSort = {
      geography: "geography",
      province: "province",
      district: "district",
      posts: "posts",
      applications: "applications",
      apps_per_post: "apps_per_post",
      avg_wage: "avg_wage",
      avg_workers_needed: "avg_workers_needed",
    };

    const defaultOrder = "posts DESC, geography, province, district";
    const orderSql = getSort(req, allowedSort, defaultOrder);

    const rowsSql = `
      ${baseCte}
      SELECT *
      FROM agg
      ORDER BY ${orderSql}
      LIMIT ${addParam(params, pageSize)}
      OFFSET ${addParam(params, offset)}
    `;
    const rowsResult = await pool.query(rowsSql, params);

    res.json({ page, page_size: pageSize, total, rows: rowsResult.rows });
  } catch (err) {
    console.error("❌ /dashboard/geo/area error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/geo/top", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    // ถ้าเลือกจังหวัดแล้ว แต่ยังไม่ได้เลือกอำเภอ -> ให้ทำ Top 10 อำเภอในจังหวัดนั้น
    // ถ้ายังไม่ได้เลือกจังหวัด -> ให้ทำ Top 10 จังหวัด (ในภาคที่เลือก/หรือทั้งประเทศ)
    const provinceSelected = !!req.query.province;
    const districtSelected = !!req.query.district;

    // ถ้าเลือก district แล้ว จริงๆ ไม่ต้องมีกราฟ (มันเหลือจุดเดียว)
    if (districtSelected) {
      return res.json({ mode: "none", rows: [] });
    }

    let sql = "";
    if (provinceSelected) {
      // Top 10 districts within selected province (respect other filters)
      sql = `
        SELECT
          d.name_th AS label,
          COUNT(DISTINCT jp.jobpost_id)::int AS value
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
        GROUP BY d.name_th
        ORDER BY value DESC, label
        LIMIT 10
      `;
      const { rows } = await pool.query(sql, params);
      return res.json({ mode: "district", rows });
    } else {
      // Top 10 provinces (respect other filters)
      sql = `
        SELECT
          p.name_th AS label,
          COUNT(DISTINCT jp.jobpost_id)::int AS value
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        JOIN geographies g ON p.geography_id = g.id
        ${where}
        GROUP BY p.name_th
        ORDER BY value DESC, label
        LIMIT 10
      `;
      const { rows } = await pool.query(sql, params);
      return res.json({ mode: "province", rows });
    }
  } catch (err) {
    console.error("❌ /dashboard/geo/top error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/gov/status", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);

    const sql = `
      WITH x AS (
        SELECT
          jp.approval_status,
          COUNT(*)::int AS posts_count
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
        GROUP BY jp.approval_status
      ),
      total AS (
        SELECT SUM(posts_count)::numeric AS total_posts FROM x
      )
      SELECT
        approval_status,
        posts_count,
        CASE WHEN (SELECT total_posts FROM total)=0 THEN 0
             ELSE ROUND(posts_count::numeric / (SELECT total_posts FROM total), 4)
        END AS share
      FROM x
      ORDER BY posts_count DESC
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/gov/status error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/gov/lco", async (req, res) => {
  try {
    const { where, params } = buildJobpostFilters(req);
    const { page, pageSize, offset } = getPaging(req);

    const hasName = await hasColumn(pool, "legal_compliance_officers", "name");
    const nameSelect = hasName ? ", lco.name AS lco_name" : "";
    const groupByName = hasName ? ", lco.name" : "";

    const allowedSort = {
      lco_id: "lco_id",
      total_assigned: "total_assigned",
      pending_count: "pending_count",
      approved_count: "approved_count",
      rejected_count: "rejected_count",
      avg_review_hours: "avg_review_hours",
      total_appeals: "total_appeals",
      // ถ้ามีคอลัมน์ lco_name แล้วอยาก sort ได้ด้วย ค่อยเปิด:
      // lco_name: "lco_name",
    };

    const defaultOrder = "pending_count DESC, total_assigned DESC, lco_id";
    const orderSql = getSort(req, allowedSort, defaultOrder);

    const baseCte = `
      WITH agg AS (
        SELECT
          jp.lco_id
          ${nameSelect},
          COUNT(*)::int AS total_assigned,
          COUNT(*) FILTER (WHERE jp.approval_status = 'Pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE jp.approval_status = 'Approved')::int AS approved_count,
          COUNT(*) FILTER (WHERE jp.approval_status = 'Rejected')::int AS rejected_count,
          ROUND(
            (AVG(EXTRACT(EPOCH FROM (jp.approval_date - jp.created_at)) / 3600)
              FILTER (WHERE jp.approval_date IS NOT NULL)
            )::numeric
          , 2) AS avg_review_hours,

          COALESCE(SUM(jp.appeal_count), 0)::int AS total_appeals
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        LEFT JOIN legal_compliance_officers lco ON jp.lco_id = lco.lco_id
        ${where}
        GROUP BY jp.lco_id ${groupByName}
      )
    `;

    const totalSql = `${baseCte} SELECT COUNT(*)::int AS total FROM agg;`;
    const totalResult = await pool.query(totalSql, params);
    const total = totalResult.rows?.[0]?.total || 0;

    const rowsSql = `
      ${baseCte}
      SELECT *
      FROM agg
      ORDER BY ${orderSql}
      LIMIT ${addParam(params, pageSize)}
      OFFSET ${addParam(params, offset)}
    `;
    const rowsResult = await pool.query(rowsSql, params);

    res.json({ page, page_size: pageSize, total, rows: rowsResult.rows });
  } catch (err) {
    console.error("❌ /dashboard/gov/lco error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/behavior/demographics", async (req, res) => {
  try {
    const { where, params } = buildApplicationFilters(req);

    const sql = `
      SELECT
        jt.job_type,
        COALESCE(js.gender, 'Unknown') AS gender,
        CASE
          WHEN js.birth_date IS NULL THEN 'Unknown'
          WHEN DATE_PART('year', AGE(CURRENT_DATE, js.birth_date)) < 20 THEN '<20'
          WHEN DATE_PART('year', AGE(CURRENT_DATE, js.birth_date)) BETWEEN 20 AND 29 THEN '20-29'
          WHEN DATE_PART('year', AGE(CURRENT_DATE, js.birth_date)) BETWEEN 30 AND 39 THEN '30-39'
          WHEN DATE_PART('year', AGE(CURRENT_DATE, js.birth_date)) BETWEEN 40 AND 49 THEN '40-49'
          WHEN DATE_PART('year', AGE(CURRENT_DATE, js.birth_date)) BETWEEN 50 AND 59 THEN '50-59'
          ELSE '60+'
        END AS age_bucket,
        COUNT(DISTINCT ja.job_seeker_id)::int AS unique_applicants,
        COUNT(*)::int AS applications
      FROM job_applications ja
      JOIN job_seekers js ON ja.job_seeker_id = js.job_seeker_id
      JOIN jobposts jp ON ja.jobpost_id = jp.jobpost_id
      JOIN job_types jt ON jp.job_type_id = jt.job_type_id
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      ${where}
      GROUP BY jt.job_type, gender, age_bucket
      ORDER BY jt.job_type, gender, age_bucket
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/behavior/demographics error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/behavior/apps-per-user", async (req, res) => {
  try {
    const { where, params } = buildApplicationFilters(req);

    const sql = `
      SELECT
        ja.job_seeker_id,
        COUNT(*)::int AS applications
      FROM job_applications ja
      JOIN jobposts jp ON ja.jobpost_id = jp.jobpost_id
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      ${where}
      GROUP BY ja.job_seeker_id
      ORDER BY applications DESC
      LIMIT 50
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/behavior/apps-per-user error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/hire-rate/gender", async (req, res) => {
  try {
    // ต้องมี employments + job_application_id ถึงจะนับ "ได้งาน" แบบผูกกับผู้สมัครได้
    const employmentExists = await hasTable(pool, "employments");
    const hasJobApplicationId = employmentExists && await hasColumn(pool, "employments", "job_application_id");

    if (!hasJobApplicationId) {
      return res.status(400).json({
        error: "Cannot compute hire rate by gender because employments.job_application_id not found"
      });
    }

    const { where, params } = buildApplicationFilters(req);

    const sql = `
      WITH base AS (
        SELECT
          ja.job_application_id,
          CASE
            WHEN lower(trim(COALESCE(js.gender,''))) IN ('male','m','ชาย','man') THEN 'Male'
            WHEN lower(trim(COALESCE(js.gender,''))) IN ('female','f','หญิง','woman') THEN 'Female'
            WHEN COALESCE(trim(js.gender), '') = '' THEN 'Unknown'
            ELSE 'Other'
          END AS gender
        FROM job_applications ja
        JOIN job_seekers js ON ja.job_seeker_id = js.job_seeker_id
        JOIN jobposts jp ON ja.jobpost_id = jp.jobpost_id
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
      )
      SELECT
        gender,
        COUNT(*)::int AS applications,
        COUNT(*) FILTER (WHERE e.employment_id IS NOT NULL)::int AS hired,
        CASE WHEN COUNT(*) = 0 THEN 0
             ELSE ROUND(
               (COUNT(*) FILTER (WHERE e.employment_id IS NOT NULL))::numeric
               / COUNT(*)::numeric
             , 4)
        END AS hire_rate
      FROM base b
      LEFT JOIN employments e ON e.job_application_id = b.job_application_id
      GROUP BY gender
      ORDER BY applications DESC, gender;
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/hire-rate/gender error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/gender-ratio/job-type", async (req, res) => {
  try {
    // ✅ ไม่ใช้ gender filter จาก dropdown เพื่อให้ ratio ถูกต้อง
    const { where, params } = buildApplicationFilters(req, { useGenderFilter: false });

    const sql = `
      WITH base AS (
        SELECT
          TRIM(jt.job_type) AS job_type,
          CASE
            WHEN lower(trim(COALESCE(js.gender,''))) IN ('male','m','ชาย','man') THEN 'male'
            WHEN lower(trim(COALESCE(js.gender,''))) IN ('female','f','หญิง','woman') THEN 'female'
            ELSE 'unknown'
          END AS gender
        FROM job_applications ja
        JOIN job_seekers js ON ja.job_seeker_id = js.job_seeker_id
        JOIN jobposts jp ON ja.jobpost_id = jp.jobpost_id
        JOIN job_types jt ON jp.job_type_id = jt.job_type_id
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        ${where}
      ),
      agg AS (
        SELECT
          job_type,
          COUNT(*) FILTER (WHERE gender = 'male')::int   AS male,
          COUNT(*) FILTER (WHERE gender = 'female')::int AS female
        FROM base
        GROUP BY job_type
      )
      SELECT
        job_type,
        male,
        female,
        (male + female)::int AS total_known,
        CASE WHEN (male + female) = 0 THEN 0
             ELSE ROUND(male::numeric / (male + female)::numeric, 4)
        END AS male_share,
        CASE WHEN (male + female) = 0 THEN 0
             ELSE ROUND(female::numeric / (male + female)::numeric, 4)
        END AS female_share,
        CASE WHEN female = 0 THEN NULL
             ELSE ROUND(male::numeric / female::numeric, 4)
        END AS male_to_female_ratio
      FROM agg
      WHERE (male + female) > 0   -- ✅ ตัด Unknown ออกโดยอ้อม (ใช้เฉพาะ known)
      ORDER BY total_known DESC, job_type;
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /dashboard/gender-ratio/job-type error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/stats/global-summary", async (req, res) => {
  try {
    const sql = `
      WITH js AS (
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (
            WHERE lower(trim(COALESCE(gender,''))) IN ('male','m','ชาย','man')
          )::int AS male_total,
          COUNT(*) FILTER (
            WHERE lower(trim(COALESCE(gender,''))) IN ('female','f','หญิง','woman')
          )::int AS female_total
        FROM job_seekers
      ),
      jp AS (
        SELECT COUNT(*)::int AS total_jobposts
        FROM jobposts
      ),
      ja AS (
        SELECT COUNT(*)::int AS total_applications
        FROM job_applications
      )
      SELECT
        (SELECT total_users FROM js) AS total_users,
        (SELECT total_jobposts FROM jp) AS total_jobposts,
        (SELECT total_applications FROM ja) AS total_applications,
        (SELECT male_total FROM js) AS male_total,
        (SELECT female_total FROM js) AS female_total,
        ((SELECT male_total FROM js) + (SELECT female_total FROM js))::int AS male_female_total
    `;

    const { rows } = await pool.query(sql);
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ /stats/global-summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

// สิ้นสุดเพิ่มใหม่ 2

app.use(express.static("public"));

app.listen(3000, () => {
  console.log('✅ API connected to Neon at http://localhost:3000');
});
