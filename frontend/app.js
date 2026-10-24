(() => {
  const $ = (id) => document.getElementById(id);
  const api = (path, options = {}) => fetch((window.TCRMS_CONFIG?.API_BASE_URL || "") + path, {
    ...options, headers: { "content-type": "application/json", ...(window.TCRMS_CONFIG?.token ? { authorization: "Bearer " + window.TCRMS_CONFIG.token } : {}), ...(options.headers || {}) }
  });
  const state = { user: null, offset: 0, limit: 25 };
  const setMessage = (id, text, bad = false) => { const node = $(id); if (node) { node.textContent = text || ""; node.classList.toggle("error-text", bad); } };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const date = (value) => value ? new Date(value).toLocaleDateString() : "—";
  const signedIn = () => { $("login-view").hidden = true; $("app-view").hidden = false; $("user-name").textContent = state.user.fullName || state.user.username; $("user-role").textContent = state.user.role.replaceAll("_", " "); $("metric-role").textContent = state.user.role.replaceAll("_", " "); $("nav-new-record").hidden = !["ADMIN", "RECORDS_OFFICER"].includes(state.user.role); $("nav-audit").hidden = !["ADMIN", "AUDITOR"].includes(state.user.role); $("connection-state").textContent = "Signed in"; $("connection-state").classList.add("connected"); loadRecords(); };
  async function checkHealth() {
    try { const r = await api("/api/v1/health"); const data = await r.json(); if (r.ok && data.database === "connected") { $("connection-state").textContent = "Database connected"; $("connection-state").classList.add("connected"); } else { $("connection-state").textContent = "Service not ready"; $("connection-state").classList.remove("connected"); } }
    catch { $("connection-state").textContent = "API unavailable"; }
  }
  async function loadRecords() {
    const params = new URLSearchParams({ q: $("record-search").value.trim(), status: $("record-status").value, limit: String(state.limit), offset: String(state.offset) });
    setMessage("records-message", "Loading records…");
    try {
      const r = await api("/api/v1/records?" + params);
      const data = await r.json();
      if (r.status === 401) return logout("Your session expired. Sign in again.");
      if (!r.ok) throw new Error(data.message || "Could not load records.");
      const rows = data.records || [];
      $("record-count").textContent = rows.length;
      $("records-body").innerHTML = rows.length ? rows.map((row) => '<tr><td>'+escapeHtml(row.case_reference)+'</td><td>'+escapeHtml(row.full_name)+'</td><td>'+escapeHtml(date(row.date_of_birth))+'</td><td><span class="record-status status-'+escapeHtml(row.record_status.toLowerCase())+'">'+escapeHtml(row.record_status.replaceAll("_"," "))+'</span></td><td>'+escapeHtml(date(row.created_at))+'</td><td><button class="text-button" data-record-id="'+escapeHtml(row.id)+'">View</button></td></tr>').join("") : '<tr><td colspan="6" class="empty-state">No matching records were returned by the database.</td></tr>';
      $("records-summary").textContent = rows.length + " records · page offset " + state.offset;
      $("next-page").disabled = rows.length < state.limit;
      setMessage("records-message", "");
    } catch (error) { $("records-body").innerHTML = '<tr><td colspan="6" class="empty-state">Records could not be loaded.</td></tr>'; setMessage("records-message", error.message, true); }
  }
  async function viewRecord(id) {
    try {
      const r = await api("/api/v1/records/" + encodeURIComponent(id)); const data = await r.json();
      if (r.status === 401) return logout("Your session expired. Sign in again.");
      if (!r.ok) throw new Error(data.message || "Unable to open record.");
      const rec = data.record;
      const detail = ["Case: "+rec.case_reference, "Name: "+rec.full_name, "Date of birth: "+(rec.date_of_birth || "Not provided"), "Status: "+rec.record_status, "Summary: "+rec.summary].join("\n");
      window.alert(detail);
    } catch (e) { setMessage("records-message", e.message, true); }
  }
  async function loadAudit() {
    setMessage("audit-message", "Loading audit trail…");
    try {
      const r = await api("/api/v1/audit?limit=50"); const data = await r.json();
      if (r.status === 401) return logout("Your session expired. Sign in again.");
      if (!r.ok) throw new Error(data.message || "Audit access denied.");
      $("audit-body").innerHTML = data.events.length ? data.events.map((event) => '<tr><td>'+escapeHtml(new Date(event.created_at).toLocaleString())+'</td><td>'+escapeHtml(event.actor_username)+'</td><td>'+escapeHtml(event.action)+'</td><td>'+escapeHtml(event.resource_type)+'</td><td>'+escapeHtml(event.resource_id || "—")+'</td></tr>').join("") : '<tr><td colspan="5" class="empty-state">No audit events found.</td></tr>';
      setMessage("audit-message", "");
    } catch (e) { setMessage("audit-message", e.message, true); }
  }
  function showPanel(id) {
    document.querySelectorAll(".workspace-panel").forEach((p) => p.classList.toggle("active", p.id === id));
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.panel === id));
    $("workspace-title").textContent = ({ "records-panel":"Records", "new-record-panel":"Register record", "audit-panel":"Audit trail" })[id] || "TCRMS";
    if (id === "records-panel") loadRecords();
    if (id === "audit-panel") loadAudit();
  }
  function logout(message = "") {
    window.TCRMS_CONFIG.token = "";
    state.user = null;
    $("app-view").hidden = true; $("login-view").hidden = false;
    $("password").value = ""; setMessage("login-message", message, Boolean(message));
  }
  const form = $("login-form");
  $("toggle-password").addEventListener("click", () => { const show = $("password").type === "password"; $("password").type = show ? "text" : "password"; $("toggle-password").textContent = show ? "Hide" : "Show"; $("toggle-password").setAttribute("aria-pressed", String(show)); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); setMessage("login-message", "");
    const username = $("username").value.trim(), password = $("password").value;
    if (!username || !password) return setMessage("login-message", "Enter your username and password.", true);
    $("sign-in").disabled = true; $("sign-in").textContent = "Signing in…";
    try {
      const r = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Sign-in failed.");
      window.TCRMS_CONFIG.token = data.token; state.user = data.user; signedIn();
    } catch (e) { setMessage("login-message", e.message, true); }
    finally { $("sign-in").disabled = false; $("sign-in").innerHTML = 'Sign in <span aria-hidden="true">→</span>'; }
  });
  document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panel)));
  $("logout").addEventListener("click", () => logout());
  $("refresh-records").addEventListener("click", loadRecords);
  $("search-form").addEventListener("submit", (event) => { event.preventDefault(); state.offset = 0; loadRecords(); });
  $("next-page").addEventListener("click", () => { state.offset += state.limit; loadRecords(); });
  $("records-body").addEventListener("click", (event) => { const button = event.target.closest("[data-record-id]"); if (button) viewRecord(button.dataset.recordId); });
  $("refresh-audit").addEventListener("click", loadAudit);
  $("new-record-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const button = $("create-record-button"); button.disabled = true; setMessage("create-message", "Saving record…");
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const key of ["dateOfBirth", "nationalIdLast4"]) if (!body[key]) body[key] = null;
    try {
      const r = await api("/api/v1/records", { method: "POST", body: JSON.stringify(body) }); const data = await r.json();
      if (r.status === 401) return logout("Your session expired. Sign in again.");
      if (!r.ok) throw new Error(data.message || "Record could not be saved.");
      event.currentTarget.reset(); setMessage("create-message", "Record saved to the database. Reference: " + data.record.case_reference); showPanel("records-panel");
    } catch (e) { setMessage("create-message", e.message, true); }
    finally { button.disabled = false; }
  });
  checkHealth();
})();