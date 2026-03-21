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

const schemaCache = {
  appDateColumn: null,
  applicantLink: null,
  employerCreatedAtSource: null,
};

app.get('/jobs', async (req, res) => {
  try {
    const { page, pageSize, offset } = getPaging(req);

    // ✅ ใช้ filter กลาง (รวม cohort EXISTS แล้ว)
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: true });

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


async function getApplicantLink() {
  if (schemaCache.applicantLink) return schemaCache.applicantLink;

  const candidates = [
    { jaColumn: 'job_seeker_id', jsColumn: 'job_seeker_id' },
    { jaColumn: 'worker_id', jsColumn: 'job_seeker_id' },
    { jaColumn: 'user_id', jsColumn: 'user_id' },
    { jaColumn: 'job_seeker_user_id', jsColumn: 'user_id' },
    { jaColumn: 'profile_id', jsColumn: 'user_id' },
    { jaColumn: 'job_seeker_profile_id', jsColumn: 'user_id' },
  ];

  for (const candidate of candidates) {
    const jaHas = await hasColumn(pool, 'job_applications', candidate.jaColumn);
    const jsHas = await hasColumn(pool, 'job_seekers', candidate.jsColumn);
    if (jaHas && jsHas) {
      schemaCache.applicantLink = candidate;
      return candidate;
    }
  }

  throw new Error('Cannot link job_applications to job_seekers. Expected one of: job_seeker_id, worker_id, user_id, job_seeker_user_id, profile_id, job_seeker_profile_id');
}

function applicantJoinCondition(link, jaAlias = 'ja', jsAlias = 'js') {
  return `${jsAlias}.${link.jsColumn} = ${jaAlias}.${link.jaColumn}`;
}

function applicantIdExpr(link, jaAlias = 'ja') {
  return `${jaAlias}.${link.jaColumn}::text`;
}

async function getApplicationDateColumn() {
  if (schemaCache.appDateColumn) return schemaCache.appDateColumn;

  if (await hasColumn(pool, 'job_applications', 'applied_at')) {
    schemaCache.appDateColumn = 'applied_at';
    return schemaCache.appDateColumn;
  }

  if (await hasColumn(pool, 'job_applications', 'created_at')) {
    schemaCache.appDateColumn = 'created_at';
    return schemaCache.appDateColumn;
  }

  schemaCache.appDateColumn = null;
  return null;
}

function getDateFilterExpr(alias, columnName) {
  return columnName ? `${alias}.${columnName}` : null;
}

function addDateRangeFilter(where, params, expr, startDate, endDate) {
  if (!expr) return where;
  if (startDate) where += ` AND ${expr} >= ${addParam(params, startDate)}`;
  if (endDate)   where += ` AND ${expr} <  ${addParam(params, endDate)}`;
  return where;
}

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
    const applicantLink = await getApplicantLink();
    // ✅ เอาแค่ jobpost filters (ไม่เอา cohort EXISTS)
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: false });

    // ✅ cohort ที่ระดับผู้สมัคร
    const cohort = applicantCohortInlineClause(req, params, "js");
    const cohortGate = hasCohort(req) ? `AND ja.job_application_id IS NOT NULL ${cohort}` : "";

    const sql = `
      SELECT
        jt.job_type_id,
        jt.job_type,

        -- posts: ถ้ามี cohort -> นับเฉพาะโพสต์ที่มีใบสมัคร cohort
        COUNT(DISTINCT jp.jobpost_id)::int AS posts,

        -- applications/hired: ถูกกรอง cohort จริง ๆ
        COUNT(ja.job_application_id)::int AS applications,
        COUNT(DISTINCT ja.job_application_id) FILTER (WHERE e.employment_id IS NOT NULL)::int AS hired,

        CASE WHEN COUNT(DISTINCT jp.jobpost_id) = 0 THEN 0
             ELSE ROUND(COUNT(ja.job_application_id)::numeric / COUNT(DISTINCT jp.jobpost_id)::numeric, 2)
        END AS apps_per_post,

        CASE WHEN COUNT(ja.job_application_id) = 0 THEN 0
             ELSE ROUND(
               (COUNT(DISTINCT ja.job_application_id) FILTER (WHERE e.employment_id IS NOT NULL))::numeric
               / COUNT(ja.job_application_id)::numeric
             , 2)
        END AS hire_rate

      FROM jobposts jp
      JOIN job_types jt ON jp.job_type_id = jt.job_type_id
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id

      LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
      LEFT JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
      LEFT JOIN employments e ON e.job_application_id = ja.job_application_id

      ${where}
      ${cohortGate}

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
    const { where, params } = await buildJobpostFilters(req);

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
    const applicantLink = await getApplicantLink();
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: false });

    const cohort = applicantCohortInlineClause(req, params, "js");
    const cohortGate = hasCohort(req)
      ? `AND ja.job_application_id IS NOT NULL ${cohort}`
      : "";

    const sql = `
      SELECT
        g.name AS geography,
        p.name_th AS province,
        COUNT(DISTINCT jp.jobpost_id)::int AS posts,
        COUNT(ja.job_application_id)::int AS applications,
        CASE WHEN COUNT(DISTINCT jp.jobpost_id)=0 THEN 0
             ELSE ROUND(COUNT(ja.job_application_id)::numeric / COUNT(DISTINCT jp.jobpost_id)::numeric, 2)
        END AS apps_per_post,
        ROUND(AVG(jp.wage_amount)::numeric, 2) AS avg_wage

      FROM jobposts jp
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      JOIN geographies g ON p.geography_id = g.id

      LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
      LEFT JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}

      ${where}
      ${cohortGate}

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

async function applicantCohortExistsClause(req, params) {
  const applicantLink = await getApplicantLink();
  const { gender, age_min, age_max } = req.query;

  if (!gender && !age_min && !age_max) return ""; // ไม่มี cohort filter

  // NOTE: ใช้ addParam(params, ...) เพื่อให้ placeholder ไม่ชนกัน
  const genderCond = gender ? `
    AND (
      CASE
        WHEN lower(trim(COALESCE(js2.gender,''))) IN ('male','m','ชาย','man') THEN 'male'
        WHEN lower(trim(COALESCE(js2.gender,''))) IN ('female','f','หญิง','woman') THEN 'female'
        WHEN COALESCE(trim(js2.gender), '') = '' THEN 'unknown'
        ELSE 'other'
      END
    ) = ${addParam(params, gender)}
  ` : "";

  const ageCond = (age_min || age_max) ? `
    AND js2.birth_date IS NOT NULL
    ${age_min ? `AND DATE_PART('year', AGE(CURRENT_DATE, js2.birth_date)) >= ${addParam(params, age_min)}` : ""}
    ${age_max ? `AND DATE_PART('year', AGE(CURRENT_DATE, js2.birth_date)) <= ${addParam(params, age_max)}` : ""}
  ` : "";

  return `
    AND EXISTS (
      SELECT 1
      FROM job_applications ja2
      JOIN job_seekers js2 ON ${applicantJoinCondition(applicantLink, 'ja2', 'js2')}
      WHERE ja2.jobpost_id = jp.jobpost_id
      ${genderCond}
      ${ageCond}
    )
  `;
}

function applicantCohortInlineClause(req, params, jsAlias = "js") {
  const { gender, age_min, age_max } = req.query;
  let sql = "";

  if (gender) {
    sql += `
      AND (
        CASE
          WHEN lower(trim(COALESCE(${jsAlias}.gender,''))) IN ('male','m','ชาย','man') THEN 'male'
          WHEN lower(trim(COALESCE(${jsAlias}.gender,''))) IN ('female','f','หญิง','woman') THEN 'female'
          WHEN COALESCE(trim(${jsAlias}.gender), '') = '' THEN 'unknown'
          ELSE 'other'
        END
      ) = ${addParam(params, gender)}
    `;
  }

  if (age_min || age_max) {
    sql += `
      AND ${jsAlias}.birth_date IS NOT NULL
      ${age_min ? `AND DATE_PART('year', AGE(CURRENT_DATE, ${jsAlias}.birth_date)) >= ${addParam(params, age_min)}` : ""}
      ${age_max ? `AND DATE_PART('year', AGE(CURRENT_DATE, ${jsAlias}.birth_date)) <= ${addParam(params, age_max)}` : ""}
    `;
  }

  return sql;
}

function hasCohort(req) {
  const { gender, age_min, age_max } = req.query;
  return !!(gender || age_min || age_max);
}

/**
 * Filter สำหรับ jobposts-based endpoints
 * opts.includeCohortExists = true  -> โหมด "post มีผู้สมัคร cohort อย่างน้อย 1 คน"
 * opts.includeCohortExists = false -> โหมดกรองเฉพาะ jobpost (ไม่ยุ่ง cohort)
 */
async function buildJobpostFilters(req, opts = { includeCohortExists: false }) {
  const {
    geography, province, district, job_type,
    min_wage, max_wage,
    start_date, end_date,
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

  // ✅ ใส่ cohort EXISTS เฉพาะ endpoint ที่ต้องการ "post-level cohort" จริง ๆ
  if (opts.includeCohortExists) {
    where += await applicantCohortExistsClause(req, params);
  }

  return { where, params };
}

/**
 * Filter สำหรับ endpoints ที่ time-based เป็น applied_at (พฤติกรรมผู้สมัคร)
 */
async function buildApplicationFilters(req, opts = {}) {
  const useGenderFilter = opts.useGenderFilter !== false;
  const applicantLink = await getApplicantLink();

  const {
    geography, province, district, job_type,
    gender,
    age_min, age_max,
    min_wage, max_wage,
    start_date, end_date
  } = req.query;

  const params = [];
  let where = "WHERE 1=1";

  const appDateColumn = await getApplicationDateColumn();
  const appDateExpr = getDateFilterExpr('ja', appDateColumn);
  where = addDateRangeFilter(where, params, appDateExpr, start_date, end_date);

  if (geography) where += ` AND p.geography_id = ${addParam(params, geography)}`;
  if (province)  where += ` AND p.id = ${addParam(params, province)}`;
  if (district)  where += ` AND d.id = ${addParam(params, district)}`;

  if (job_type)  where += ` AND jp.job_type_id = ${addParam(params, job_type)}`;

  if (min_wage)  where += ` AND jp.wage_amount >= ${addParam(params, min_wage)}`;
  if (max_wage)  where += ` AND jp.wage_amount <= ${addParam(params, max_wage)}`;

  if (useGenderFilter && gender) {
    where += ` AND EXISTS (
      SELECT 1
      FROM job_seekers js2
      WHERE ${applicantJoinCondition(applicantLink, 'ja', 'js2')}
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

  if (age_min || age_max) {
    where += ` AND EXISTS (
      SELECT 1
      FROM job_seekers js_age
      WHERE ${applicantJoinCondition(applicantLink, 'ja', 'js_age')}
        AND js_age.birth_date IS NOT NULL
        ${age_min ? `AND DATE_PART('year', AGE(CURRENT_DATE, js_age.birth_date)) >= ${addParam(params, age_min)}` : ""}
        ${age_max ? `AND DATE_PART('year', AGE(CURRENT_DATE, js_age.birth_date)) <= ${addParam(params, age_max)}` : ""}
    )`;
  }

  return { where, params, appDateColumn, applicantLink };
}


async function detectEmployerCreatedAtSource() {
  if (schemaCache.employerCreatedAtSource) return schemaCache.employerCreatedAtSource;

  if (await hasColumn(pool, 'employers', 'created_at')) {
    schemaCache.employerCreatedAtSource = { joinSql: '', expr: 'e.created_at' };
    return schemaCache.employerCreatedAtSource;
  }

  if (await hasTable(pool, 'users') && await hasColumn(pool, 'users', 'user_id') && await hasColumn(pool, 'users', 'created_at')) {
    schemaCache.employerCreatedAtSource = {
      joinSql: 'LEFT JOIN users u_created ON u_created.user_id = e.user_id',
      expr: 'u_created.created_at'
    };
    return schemaCache.employerCreatedAtSource;
  }

  if (await hasTable(pool, 'profiles') && await hasColumn(pool, 'profiles', 'id') && await hasColumn(pool, 'profiles', 'created_at')) {
    schemaCache.employerCreatedAtSource = {
      joinSql: 'LEFT JOIN profiles p_created ON p_created.id = e.user_id',
      expr: 'p_created.created_at'
    };
    return schemaCache.employerCreatedAtSource;
  }

  schemaCache.employerCreatedAtSource = { joinSql: '', expr: null };
  return schemaCache.employerCreatedAtSource;
}

app.get("/dashboard/overview", async (req, res) => {
  try {
    const applicantLink = await getApplicantLink();
    // ✅ jobpost filter ไม่เอา cohort EXISTS
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: false });

    // ✅ cohort filter (gender/age) ใช้กับ alias "js"
    const cohort = applicantCohortInlineClause(req, params, "js");

    const employmentExists = await hasTable(pool, "employments");
    const hasJobApplicationId = employmentExists && await hasColumn(pool, "employments", "job_application_id");

    let hireCte = `SELECT 0::int AS total_employments`;

    if (hasJobApplicationId) {
      hireCte = `
        SELECT
          COUNT(DISTINCT ja.job_application_id)::int AS total_employments
        FROM employments e
        JOIN job_applications ja ON e.job_application_id = ja.job_application_id
        JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
        JOIN base b ON ja.jobpost_id = b.jobpost_id
        WHERE 1=1
        ${cohort}
      `;
    }

    // ✅ start/end ส่งมาจาก UI ได้/ไม่ได้ก็ได้
    const start_date = req.query.start_date || null;
    const end_date   = req.query.end_date   || null;

    // ✅ index ของ start/end ต้องคำนวณหลัง params ถูก push โดย cohort แล้ว
    const idxStart = params.length + 1;
    const idxEnd   = params.length + 2;

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
          COUNT(DISTINCT ${applicantIdExpr(applicantLink, 'ja')})::int AS unique_applicants
        FROM job_applications ja
        JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
        JOIN base b ON ja.jobpost_id = b.jobpost_id
        WHERE 1=1
        ${cohort}
      ),
      hires AS (
        ${hireCte}
      ),
      seekers AS (
        SELECT
          COUNT(*)::int AS total_jobseekers,

          CASE
            WHEN $${idxStart}::timestamptz IS NULL AND $${idxEnd}::timestamptz IS NULL
            THEN COUNT(*)::int
            ELSE
              COUNT(*) FILTER (
                WHERE (
                  $${idxStart}::timestamptz IS NULL
                  OR js.created_at >= $${idxStart}::timestamptz
                )
                AND (
                  $${idxEnd}::timestamptz IS NULL
                  OR js.created_at <  $${idxEnd}::timestamptz
                )
              )::int
          END AS new_jobseekers_in_range

        FROM job_seekers js
        WHERE 1=1
        ${cohort}
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

    const { rows } = await pool.query(sql, [...params, start_date, end_date]);
    res.json(rows[0]);

  } catch (err) {
    console.error("❌ /dashboard/overview error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/geo/area", async (req, res) => {
  try {
    const applicantLink = await getApplicantLink();
    // ✅ jobpost filters ไม่เอา cohort EXISTS (เพราะเราจะกรอง cohort ที่ ja/js)
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: false });
    const { page, pageSize, offset } = getPaging(req);

    // ✅ cohort filter ที่ระดับผู้สมัคร
    const cohort = applicantCohortInlineClause(req, params, "js");
    const cohortGate = hasCohort(req)
      ? `AND ja.job_application_id IS NOT NULL ${cohort}`
      : "";

    const baseCte = `
      WITH agg AS (
        SELECT
          g.name AS geography,
          p.name_th AS province,
          d.name_th AS district,

          -- posts: ถ้ามี cohort -> นับเฉพาะโพสต์ที่มีใบสมัคร cohort
          COUNT(DISTINCT jp.jobpost_id)::int AS posts,

          -- applications: ถูกกรอง cohort จริง (อยู่ใน WHERE cohortGate แล้ว)
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
        LEFT JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}

        ${where}
        ${cohortGate}

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
    const applicantLink = await getApplicantLink();
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: false });

    const cohort = applicantCohortInlineClause(req, params, "js");
    const cohortGate = hasCohort(req)
      ? `AND ja.job_application_id IS NOT NULL ${cohort}`
      : "";

    const provinceSelected = !!req.query.province;
    const districtSelected = !!req.query.district;

    if (districtSelected) {
      return res.json({ mode: "none", rows: [] });
    }

    if (provinceSelected) {
      const sql = `
        SELECT
          d.name_th AS label,
          COUNT(DISTINCT jp.jobpost_id)::int AS value
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id

        LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
        LEFT JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}

        ${where}
        ${cohortGate}

        GROUP BY d.name_th
        ORDER BY value DESC, label
        LIMIT 10
      `;
      const { rows } = await pool.query(sql, params);
      return res.json({ mode: "district", rows });
    } else {
      const sql = `
        SELECT
          p.name_th AS label,
          COUNT(DISTINCT jp.jobpost_id)::int AS value
        FROM jobposts jp
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
        JOIN geographies g ON p.geography_id = g.id

        LEFT JOIN job_applications ja ON ja.jobpost_id = jp.jobpost_id
        LEFT JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}

        ${where}
        ${cohortGate}

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
    const applicantLink = await getApplicantLink();
    // ✅ ใช้ post-level cohort (EXISTS)
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: true });

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
    const applicantLink = await getApplicantLink();
    // ✅ ใช้ post-level cohort (EXISTS)
    const { where, params } = await buildJobpostFilters(req, { includeCohortExists: true });
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
    const { where, params, applicantLink } = await buildApplicationFilters(req);

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
        COUNT(DISTINCT ${applicantIdExpr(applicantLink, 'ja')})::int AS unique_applicants,
        COUNT(*)::int AS applications
      FROM job_applications ja
      JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
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
    const { where, params, applicantLink } = await buildApplicationFilters(req);

    const sql = `
      SELECT
        ${applicantIdExpr(applicantLink, 'ja')} AS applicant_id,
        COUNT(*)::int AS applications
      FROM job_applications ja
      JOIN jobposts jp ON ja.jobpost_id = jp.jobpost_id
      JOIN sub_districts sd ON jp.sub_district_id = sd.id
      JOIN districts d ON sd.district_id = d.id
      JOIN provinces p ON d.province_id = p.id
      ${where}
      GROUP BY ${applicantIdExpr(applicantLink, 'ja')}
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

    const { where, params, applicantLink } = await buildApplicationFilters(req);

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
        JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
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
    const { where, params, applicantLink } = await buildApplicationFilters(req, { useGenderFilter: false });

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
        JOIN job_seekers js ON ${applicantJoinCondition(applicantLink, 'ja', 'js')}
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


app.get("/dashboard/revenue/summary", async (req, res) => {
  try {
    const promotionTableExists = await hasTable(pool, "promotion");
    const hasPromotionId = await hasColumn(pool, "employers", "promotion_id");
    const hasPromotionText = await hasColumn(pool, "employers", "promotion");
    const hasVerified = await hasColumn(pool, "employers", "verified");
    const hasPromotionStartDate = await hasColumn(pool, "employers", "start_date_promotion");
    const hasPromotionEndDate = await hasColumn(pool, "employers", "end_date_promotion");
    const createdAtSource = await detectEmployerCreatedAtSource();

    const { geography, province, district, job_type } = req.query;
    const params = [];
    let employerScopeJoin = "";
    let employerScopeWhere = "WHERE 1=1";

    const needsJobpostScope = !!(geography || province || district || job_type);

    if (needsJobpostScope) {
      employerScopeJoin = `
        JOIN jobposts jp ON jp.employer_id = e.employer_id
        JOIN sub_districts sd ON jp.sub_district_id = sd.id
        JOIN districts d ON sd.district_id = d.id
        JOIN provinces p ON d.province_id = p.id
      `;
      if (geography) employerScopeWhere += ` AND p.geography_id = ${addParam(params, geography)}`;
      if (province)  employerScopeWhere += ` AND p.id = ${addParam(params, province)}`;
      if (district)  employerScopeWhere += ` AND d.id = ${addParam(params, district)}`;
      if (job_type)  employerScopeWhere += ` AND jp.job_type_id = ${addParam(params, job_type)}`;
    }

    const promoJoin = (promotionTableExists && hasPromotionId)
      ? `LEFT JOIN promotion pr ON pr.id = e.promotion_id`
      : "";

    const packageNameExpr = `
      TRIM(COALESCE(
        ${promotionTableExists && hasPromotionId ? "pr.promotion," : ""}
        ${hasPromotionText ? "NULLIF(e.promotion, '')," : ""}
        'Basic'
      ))
    `;

    const packagePriceExpr = `
      COALESCE(
        ${promotionTableExists && hasPromotionId ? "pr.price," : ""}
        0
      )::numeric
    `;

    const verifiedExpr = hasVerified ? "COALESCE(e.verified, false)" : "false";
    const createdAtExpr = createdAtSource.expr;
    const trendDateExpr = hasPromotionStartDate
      ? "e.start_date_promotion::timestamp"
      : (createdAtExpr ? `${createdAtExpr}::timestamp` : null);

    const trendSql = trendDateExpr ? `SELECT
          TO_CHAR(DATE_TRUNC('month', trend_date), 'YYYY-MM') AS month_key,
          TO_CHAR(DATE_TRUNC('month', trend_date), 'Mon YY') AS label,
          COUNT(*)::int AS employers_count,
          COALESCE(SUM(package_price + CASE WHEN verified THEN 19 ELSE 0 END), 0)::numeric AS revenue
        FROM employer_scope
        WHERE trend_date IS NOT NULL
        GROUP BY 1, 2
        ORDER BY month_key` : `SELECT
          TO_CHAR(DATE_TRUNC('month', CURRENT_DATE), 'YYYY-MM') AS month_key,
          TO_CHAR(DATE_TRUNC('month', CURRENT_DATE), 'Mon YY') AS label,
          COUNT(*)::int AS employers_count,
          COALESCE(SUM(package_price + CASE WHEN verified THEN 19 ELSE 0 END), 0)::numeric AS revenue
        FROM employer_scope
        GROUP BY 1, 2
        ORDER BY month_key`;

    const sql = `
      WITH employer_scope AS (
        SELECT DISTINCT
          e.employer_id,
          ${packageNameExpr} AS package_name,
          ${packagePriceExpr} AS package_price,
          ${verifiedExpr} AS verified
          ${createdAtExpr ? `, ${createdAtExpr} AS created_at` : ""}
          ${hasPromotionStartDate ? `, e.start_date_promotion` : ""}
          ${hasPromotionEndDate ? `, e.end_date_promotion` : ""}
          ${trendDateExpr ? `, ${trendDateExpr} AS trend_date` : ""}
        FROM employers e
        ${promoJoin}
        ${createdAtSource.joinSql}
        ${employerScopeJoin}
        ${employerScopeWhere}
      ),
      totals AS (
        SELECT
          COUNT(*)::int AS total_employers,
          COUNT(*) FILTER (WHERE package_price > 0)::int AS paid_employers,
          COALESCE(SUM(package_price), 0)::numeric AS package_revenue,
          COUNT(*) FILTER (WHERE verified)::int AS verified_count
        FROM employer_scope
      ),
      package_mix AS (
        SELECT
          CASE
            WHEN package_name IS NULL OR package_name = '' THEN 'Basic'
            ELSE package_name
          END AS package_name,
          COUNT(*)::int AS employers_count,
          COALESCE(SUM(package_price), 0)::numeric AS revenue
        FROM employer_scope
        GROUP BY 1
      ),
      trend AS (
        ${trendSql}
      )
      SELECT json_build_object(
        'mrr', ROUND((SELECT package_revenue + (verified_count * 19) FROM totals), 2),
        'arr', ROUND((SELECT (package_revenue + (verified_count * 19)) * 12 FROM totals), 2),
        'paidRatio', CASE WHEN (SELECT total_employers FROM totals) = 0 THEN 0
                          ELSE ROUND((SELECT paid_employers::numeric / total_employers::numeric FROM totals), 4)
                     END,
        'verifiedRevenue', ROUND((SELECT verified_count * 19 FROM totals), 2),
        'verifiedCount', (SELECT verified_count FROM totals),
        'totalEmployers', (SELECT total_employers FROM totals),
        'paidEmployers', (SELECT paid_employers FROM totals),
        'packageBreakdown', COALESCE((
          SELECT json_agg(
            json_build_object(
              'package_name', package_name,
              'employers_count', employers_count,
              'revenue', ROUND(revenue, 2)
            )
            ORDER BY revenue DESC, package_name
          )
          FROM package_mix
        ), '[]'::json),
        'trend', COALESCE((
          SELECT json_agg(
            json_build_object(
              'month_key', month_key,
              'label', label,
              'employers_count', employers_count,
              'value', ROUND(revenue, 2)
            )
            ORDER BY month_key
          )
          FROM trend
        ), '[]'::json)
      ) AS data
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows[0]?.data || {
      mrr: 0,
      arr: 0,
      paidRatio: 0,
      verifiedRevenue: 0,
      verifiedCount: 0,
      totalEmployers: 0,
      paidEmployers: 0,
      packageBreakdown: [],
      trend: []
    });
  } catch (err) {
    console.error("❌ /dashboard/revenue/summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health/db', async (req, res) => {
  try {
    const appDateColumn = await getApplicationDateColumn();
    const result = await pool.query(`SELECT current_database() AS db, current_schema() AS schema, NOW() AS server_time`);
    res.json({
      ok: true,
      database: result.rows[0]?.db,
      schema: result.rows[0]?.schema,
      server_time: result.rows[0]?.server_time,
      application_date_column: appDateColumn,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
