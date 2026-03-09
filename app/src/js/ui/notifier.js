// -----------------------------------------------------------------------------
// Notificador visual (toast)
// -----------------------------------------------------------------------------
export function showToast(message, type = "info") {
  const bg =
    type === "success"
      ? "linear-gradient(135deg, #134e2a, #166534)"
      : type === "error"
        ? "linear-gradient(135deg, #7f1d1d, #991b1b)"
        : "linear-gradient(135deg, #0f172a, #1e293b)";

  if (window.Toastify) {
    window.Toastify({
      text: message,
      duration: 2200,
      close: false,
      gravity: "bottom",
      position: "center",
      stopOnFocus: true,
      offset: {
        y: 18
      },
      style: {
        background: bg,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "10px",
        boxShadow: "0 10px 24px rgba(0,0,0,0.35)"
      }
    }).showToast();
    return;
  }

  // Fallback mínimo, caso CDN não carregue.
  console.log(`[toast:${type}] ${message}`);
}
