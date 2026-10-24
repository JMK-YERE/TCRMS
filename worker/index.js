import postgres from "postgres";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (status, code, message) => json({ error: code, message }, status);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const fromB64url = (value) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
const randomSalt = () => crypto.getRandomValues(new Uint8Array(16));

async function passwordHash(password, salt = randomSalt()) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" }, key, 256);
  return "pbkdf2-sha256$310000$" + b64url(salt) + "$" + b64url(bits);
}
function constantTimeEqual(a, b) {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
async function verifyPassword(password, stored) {
  const [scheme, rounds, saltText, expected] = String(stored).split("$");
  if (scheme !== "pbkdf2-sha256" || Number(rounds) !== 310000 || !saltText || !expected) return false;
  const actual = (await passwordHash(password, fromB64url(saltText))).split("$")[3];
  return constantTimeEqual(actual, expected);
}
async function signToken(payload, secret) {
  const header = b64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const data = header + "." + body;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return data + "." + b64url(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
}
async function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", key, fromB64url(parts[2]), encoder.encode(parts[0] + "." + parts[1]))) return null;
  const header = JSON.parse(decoder.decode(fromB64url(parts[0])));
  const payload = JSON.parse(decoder.decode(fromB64url(parts[1])));
  if (header.alg !== "HS256" || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000) || payload.iss !== "tcrms") return null;
  return payload;
}
function sqlClient(env) {
  if (!env.HYPERDRIVE?.connectionString) throw new Error("HYPERDRIVE binding is not configured");
  return postgres(env.HYPERDRIVE.connectionString, { max: 3, idle_timeout: 5, connect_timeout: 8, prepare: false, ssl: "require" });
}
async function audit(sql, actor, action, resourceType, resourceId, request, details = {}) {
  const ip = request.headers.get("cf-connecting-ip") || "";
  const digest = ip ? await crypto.subtle.digest("SHA-256", encoder.encode(ip)) : null;
  await sql`INSERT INTO tcrms_audit_logs (actor_user_id, actor_username, action, resource_type, resource_id, request_id, ip_hash, details)
    VALUES (${actor?.id || null}, ${actor?.username || "anonymous"}, ${action}, ${resourceType}, ${resourceId || null},
    ${request.headers.get("cf-ray") || null}, ${digest ? b64url(digest) : null}, ${sql.json(details)})`;
}
async function authenticate(request, env, sql) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return { error: fail(503, "auth_not_configured", "JWT_SECRET must be configured as a secret of at least 32 characters.") };
  const payload = await verifyToken(token, env.JWT_SECRET).catch(() => null);
  if (!payload?.sub) return { error: fail(401, "unauthorized", "Sign in is required.") };
  const rows = await sql`SELECT id, username, full_name, role, active FROM tcrms_users WHERE id = ${payload.sub} LIMIT 1`;
  if (!rows[0]?.active) return { error: fail(401, "session_invalid", "This account is unavailable. Sign in again or contact an administrator.") };
  return { user: rows[0] };
}
const canReadRecords = (role) => ["ADMIN", "RECORDS_OFFICER", "ANALYST", "AUDITOR"].includes(role);
const canWriteRecords = (role) => ["ADMIN", "RECORDS_OFFICER"].includes(role);
const validText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

async function routeApi(request, env, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "Content-Type, Authorization, X-Bootstrap-Secret",
    "access-control-max-age": "600", "vary": "Origin",
  }});
  if (request.method === "GET" && url.pathname === "/api/v1/health") {
    let sql;
    try {
      sql = sqlClient(env); await sql`SELECT 1`;
      return json({ service: "TCRMS API", status: "ok", database: "connected", authentication: env.JWT_SECRET?.length >= 32 ? "configured" : "not_configured" });
    } catch {
      return json({ service: "TCRMS API", status: "degraded", database: env.HYPERDRIVE ? "connection_failed" : "not_configured", authentication: env.JWT_SECRET?.length >= 32 ? "configured" : "not_configured" }, 503);
    } finally { if (sql) await sql.end({ timeout: 1 }).catch(() => {}); }
  }

  if (url.pathname === "/api/v1/auth/bootstrap-admin" && request.method === "POST") {
    if (!env.BOOTSTRAP_SECRET || env.BOOTSTRAP_SECRET.length < 32) return fail(503, "bootstrap_disabled", "Set a strong BOOTSTRAP_SECRET before creating the first administrator.");
    if (request.headers.get("x-bootstrap-secret") !== env.BOOTSTRAP_SECRET) return fail(403, "forbidden", "Bootstrap secret is invalid.");
    let body; try { body = await request.json(); } catch { return fail(400, "invalid_json", "Request body must be valid JSON."); }
    if (!validText(body.username, 150) || !validText(body.fullName, 200) || typeof body.password !== "string" || body.password.length < 14 || body.password.length > 256)
      return fail(400, "validation_error", "Provide username, fullName, and a password of 14–256 characters.");
    let sql;
    try {
      sql = sqlClient(env);
      const existing = await sql`SELECT id FROM tcrms_users LIMIT 1`;
      if (existing.length) return fail(409, "bootstrap_closed", "An account already exists. Ask an existing administrator to provision accounts.");
      const hashed = await passwordHash(body.password);
      const rows = await sql`INSERT INTO tcrms_users (username, password_hash, full_name, role) VALUES (${body.username.trim()}, ${hashed}, ${body.fullName.trim()}, 'ADMIN') RETURNING id, username, full_name, role, created_at`;
      await audit(sql, rows[0], "ADMIN_BOOTSTRAP", "user", rows[0].id, request);
      return json({ user: rows[0], message: "Initial administrator created. Rotate or remove BOOTSTRAP_SECRET now." }, 201);
    } catch (error) {
      if (error.code === "42P01") return fail(503, "migration_required", "TCRMS database migration 001 has not been applied.");
      if (error.code === "23505") return fail(409, "username_exists", "That username is already in use.");
      return fail(500, "internal_error", "Could not create administrator.");
    } finally { if (sql) await sql.end({ timeout: 1 }).catch(() => {}); }
  }

  if (url.pathname === "/api/v1/auth/login" && request.method === "POST") {
    let body; try { body = await request.json(); } catch { return fail(400, "invalid_json", "Request body must be valid JSON."); }
    if (!validText(body.username, 150) || typeof body.password !== "string" || body.password.length > 256) return fail(400, "validation_error", "Enter your username and password.");
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return fail(503, "auth_not_configured", "Authentication is not configured yet.");
    let sql;
    try {
      sql = sqlClient(env);
      const rows = await sql`SELECT id, username, password_hash, full_name, role, active, failed_login_count, locked_until FROM tcrms_users WHERE username = ${body.username.trim()} LIMIT 1`;
      const user = rows[0];
      if (!user || !user.active || (user.locked_until && new Date(user.locked_until) > new Date())) {
        await audit(sql, null, "LOGIN_FAILED", "user", null, request, { usernameProvided: true });
        return fail(401, "invalid_credentials", "Username or password is incorrect, or the account is temporarily unavailable.");
      }
      if (!await verifyPassword(body.password, user.password_hash)) {
        const count = Number(user.failed_login_count || 0) + 1;
        await sql`UPDATE tcrms_users SET failed_login_count = ${count}, locked_until = CASE WHEN ${count} >= 8 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END, updated_at = NOW() WHERE id = ${user.id}`;
        await audit(sql, user, "LOGIN_FAILED", "user", user.id, request);
        return fail(401, "invalid_credentials", "Username or password is incorrect, or the account is temporarily unavailable.");
      }
      await sql`UPDATE tcrms_users SET failed_login_count = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW() WHERE id = ${user.id}`;
      await audit(sql, user, "LOGIN_SUCCEEDED", "user", user.id, request);
      const now = Math.floor(Date.now() / 1000);
      const token = await signToken({ sub: user.id, iat: now, exp: now + 3600, iss: "tcrms" }, env.JWT_SECRET);
      return json({ token, tokenType: "Bearer", expiresIn: 3600, user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role } });
    } catch (error) {
      if (error.code === "42P01") return fail(503, "migration_required", "TCRMS database migration 001 has not been applied.");
      return fail(500, "internal_error", "Sign-in failed due to a server error.");
    } finally { if (sql) await sql.end({ timeout: 1 }).catch(() => {}); }
  }

  if (!url.pathname.startsWith("/api/v1/")) return fail(404, "not_found", "Not found.");
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return fail(503, "auth_not_configured", "Authentication is not configured yet.");
  let sql;
  try {
    sql = sqlClient(env);
    const auth = await authenticate(request, env, sql);
    if (auth.error) return auth.error;
    const user = auth.user;

    if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
      await audit(sql, user, "VIEW_PROFILE", "user", user.id, request);
      return json({ user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role } });
    }
    if (url.pathname === "/api/v1/records" && request.method === "GET") {
      if (!canReadRecords(user.role)) return fail(403, "forbidden", "Your role cannot read records.");
      const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
      const status = (url.searchParams.get("status") || "").trim();
      if (status && !["PENDING", "UNDER_REVIEW", "VERIFIED", "CLOSED"].includes(status)) return fail(400, "validation_error", "Invalid record status.");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 25), 1), 100);
      const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
      const rows = await sql`SELECT id, case_reference, full_name, date_of_birth, record_status, created_at, updated_at FROM tcrms_records
        WHERE (${q} = '' OR case_reference ILIKE ${'%' + q + '%'} OR full_name ILIKE ${'%' + q + '%'})
        AND (${status} = '' OR record_status = ${status}) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
      await audit(sql, user, "LIST_RECORDS", "record", null, request, { count: rows.length, searched: Boolean(q) });
      return json({ records: rows, pagination: { limit, offset, returned: rows.length } });
    }
    if (url.pathname === "/api/v1/records" && request.method === "POST") {
      if (!canWriteRecords(user.role)) return fail(403, "forbidden", "Your role cannot create records.");
      let body; try { body = await request.json(); } catch { return fail(400, "invalid_json", "Request body must be valid JSON."); }
      if (!validText(body.caseReference, 80) || !validText(body.fullName, 200) || !validText(body.summary, 5000)) return fail(400, "validation_error", "caseReference, fullName, and summary are required.");
      const status = body.status || "PENDING";
      if (!["PENDING", "UNDER_REVIEW", "VERIFIED", "CLOSED"].includes(status)) return fail(400, "validation_error", "Invalid record status.");
      const dob = body.dateOfBirth || null;
      if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail(400, "validation_error", "dateOfBirth must use YYYY-MM-DD.");
      const last4 = body.nationalIdLast4 || null;
      if (last4 && !/^\d{4}$/.test(last4)) return fail(400, "validation_error", "Only the last four digits are accepted for nationalIdLast4.");
      try {
        const rows = await sql`INSERT INTO tcrms_records (case_reference, full_name, date_of_birth, national_id_last4, record_status, summary, created_by, updated_by)
          VALUES (${body.caseReference.trim()}, ${body.fullName.trim()}, ${dob}, ${last4}, ${status}, ${body.summary.trim()}, ${user.id}, ${user.id})
          RETURNING id, case_reference, full_name, date_of_birth, record_status, created_at, updated_at`;
        await audit(sql, user, "CREATE_RECORD", "record", rows[0].id, request, { status });
        return json({ record: rows[0] }, 201);
      } catch (error) {
        if (error.code === "23505") return fail(409, "case_reference_exists", "That case reference already exists.");
        throw error;
      }
    }
    const match = url.pathname.match(/^\/api\/v1\/records\/([0-9a-f-]{36})$/i);
    if (match && request.method === "GET") {
      if (!canReadRecords(user.role)) return fail(403, "forbidden", "Your role cannot read records.");
      const rows = await sql`SELECT id, case_reference, full_name, date_of_birth, national_id_last4, record_status, summary, created_at, updated_at FROM tcrms_records WHERE id = ${match[1]} LIMIT 1`;
      if (!rows[0]) return fail(404, "not_found", "Record not found.");
      await audit(sql, user, "VIEW_RECORD", "record", rows[0].id, request, { caseReference: rows[0].case_reference });
      return json({ record: rows[0] });
    }
    if (url.pathname === "/api/v1/audit" && request.method === "GET") {
      if (!["ADMIN", "AUDITOR"].includes(user.role)) return fail(403, "forbidden", "Only administrators and auditors can review the audit log.");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 100);
      return json({ events: await sql`SELECT id, actor_username, action, resource_type, resource_id, request_id, details, created_at FROM tcrms_audit_logs ORDER BY created_at DESC LIMIT ${limit}` });
    }
    return fail(404, "not_found", "No API route matches this request.");
  } catch (error) {
    if (error.code === "42P01") return fail(503, "migration_required", "TCRMS database migration 001 has not been applied.");
    return fail(500, "internal_error", "The request could not be completed.");
  } finally { if (sql) await sql.end({ timeout: 1 }).catch(() => {}); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const origin = request.headers.get("origin");
      const allowed = (env.ALLOWED_ORIGIN || url.origin).split(",").map((s) => s.trim()).filter(Boolean);
      if (origin && !allowed.includes(origin)) return fail(403, "origin_not_allowed", "This origin is not allowed.");
      const response = await routeApi(request, env, url);
      if (origin && allowed.includes(origin)) {
        const headers = new Headers(response.headers);
        headers.set("access-control-allow-origin", origin); headers.set("vary", "Origin");
        return new Response(response.body, { status: response.status, headers });
      }
      return response;
    }
    if (!env.ASSETS) return new Response("Static assets binding is missing.", { status: 500 });
    return env.ASSETS.fetch(request);
  },
};
