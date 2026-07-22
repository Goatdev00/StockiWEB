// Archivo: /js/ui/toast.js
// Notificaciones no bloqueantes. Reemplazan a alert() en todo el proyecto.
import { escapeHtml } from '../utils/dom.js';

const TOAST_DURATION_MS = 3500;

function getContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    // aria-live para que los lectores de pantalla anuncien los mensajes
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info') {
  const container = getContainer();
  const toast = document.createElement('div');
  const modifier = ['success', 'error', 'warning'].includes(type) ? ` toast--${type}` : '';
  toast.className = `toast${modifier}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), TOAST_DURATION_MS);
}
