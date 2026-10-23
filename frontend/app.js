(() => {
  const form = document.getElementById("login-form");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const toggle = document.getElementById("toggle-password");
  const message = document.getElementById("login-message");
  if (!form || !username || !password || !toggle || !message) return;

  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.textContent = show ? "Hide" : "Show";
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(show));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    message.textContent = "";
    if (!username.value.trim() || !password.value) {
      message.textContent = "Enter your username and password.";
      (!username.value.trim() ? username : password).focus();
      return;
    }
    message.textContent = "Sign-in is not connected yet. Authentication must be implemented and tested before accounts can be used.";
  });
})();