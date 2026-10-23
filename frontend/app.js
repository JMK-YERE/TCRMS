(() => {
  const button = document.getElementById("check-api");
  const status = document.getElementById("api-status");
  const message = document.getElementById("status-message");

  if (!button || !status || !message) return;

  button.addEventListener("click", async () => {
    const baseUrl = window.TCRMS_CONFIG?.API_BASE_URL;
    if (!baseUrl) {
      status.textContent = "API URL is not configured.";
      message.textContent = "Set API_BASE_URL in frontend/config.js.";
      return;
    }

    button.disabled = true;
    button.textContent = "Checking…";
    status.textContent = "Contacting the local API…";
    message.textContent = "";

    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/health`, {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.status !== "UP") throw new Error("Unexpected health response");

      status.textContent = "API responded successfully.";
      message.textContent = `${result.application}: ${result.status}. This is only a liveness check, not a security or database-readiness test.`;
    } catch (error) {
      status.textContent = "API could not be reached.";
      message.textContent = "Start the backend, check its API URL, and verify CORS settings. No system data was requested.";
    } finally {
      button.disabled = false;
      button.textContent = "Check API";
    }
  });
})();
