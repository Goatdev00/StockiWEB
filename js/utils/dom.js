// Archivo: /js/utils/dom.js
// Helpers de DOM. escapeHtml es obligatorio al interpolar datos de usuario
// en plantillas: previene XSS almacenado desde títulos/descripciones.

export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

export function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function setLoading(container, visible = true) {
  if (!container) return;
  if (visible) {
    container.innerHTML = `
      <div class="loader" role="status" aria-live="polite">
        <div class="loader__spinner"></div>
        <span class="visually-hidden">Cargando…</span>
      </div>`;
  }
}

export function renderEmptyState(container, { title, text, actionHtml = '' }) {
  container.innerHTML = `
    <div class="empty-state">
      <p class="empty-state__title">${escapeHtml(title)}</p>
      <p class="empty-state__text">${escapeHtml(text)}</p>
      ${actionHtml}
    </div>`;
}
