import { loginApp } from "../services/xtreamApi.js";
import { showToast } from "../ui/notifier.js";

export async function renderLoginView({ container, status, onLoginSuccess }) {
  container.innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <h2>Entrar na aplicacao</h2>
        <p>Use seu usuario e senha para continuar.</p>
        <form id="login-form" class="login-form">
          <label>
            <span>Usuario</span>
            <div class="login-input-wrap">
              <i class="bi bi-person"></i>
              <input id="login-username" type="text" autocomplete="username" required />
            </div>
          </label>
          <label>
            <span>Senha</span>
            <div class="login-input-wrap">
              <i class="bi bi-shield-lock"></i>
              <input id="login-password" type="password" autocomplete="current-password" required />
            </div>
          </label>
          <button id="login-submit" type="submit">Entrar</button>
        </form>
      </div>
    </section>
  `;

  const form = container.querySelector("#login-form");
  const usernameEl = container.querySelector("#login-username");
  const passwordEl = container.querySelector("#login-password");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      status.show("Autenticando...");
      await loginApp({
        username: usernameEl.value.trim(),
        password: passwordEl.value
      });
      status.hide();
      showToast("Login realizado com sucesso.", "success");
      onLoginSuccess();
    } catch (error) {
      status.show(error.message || "Falha no login.");
    }
  });
}
