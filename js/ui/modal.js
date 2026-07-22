// Archivo: /js/ui/modal.js
// Modal genérico reutilizable (paneles de vendedor/admin, confirmaciones).
// Devuelve un controlador con close() para que el llamador decida el ciclo de vida.

export function openModal({ title, contentHtml, onClose }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', title);
  modal.innerHTML = `
    <button class="modal__overlay" type="button" aria-label="Cerrar"></button>
    <div class="modal__dialog">
      <button class="modal__close" type="button" aria-label="Cerrar">✕</button>
      <h2 class="modal__title"></h2>
      <div class="modal__content"></div>
    </div>`;

  modal.querySelector('.modal__title').textContent = title;
  modal.querySelector('.modal__content').innerHTML = contentHtml;

  function close() {
    modal.remove();
    document.removeEventListener('keydown', onKeydown);
    if (typeof onClose === 'function') onClose();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
  }

  modal.querySelector('.modal__overlay').addEventListener('click', close);
  modal.querySelector('.modal__close').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(modal);
  modal.querySelector('.modal__close').focus();

  return { element: modal, close };
}

// Confirmación accesible que sustituye a window.confirm()
export function confirmModal({ title, message, confirmLabel = 'Confirmar' }) {
  return new Promise((resolve) => {
    const { element, close } = openModal({
      title,
      contentHtml: `
        <p style="margin-bottom:20px;">${message}</p>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn btn--secondary" type="button" data-action="cancel">Cancelar</button>
          <button class="btn btn--danger" type="button" data-action="confirm">${confirmLabel}</button>
        </div>`,
      onClose: () => resolve(false),
    });
    element.querySelector('[data-action="cancel"]').addEventListener('click', close);
    element.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      element.querySelector('.modal__overlay').removeEventListener('click', close);
      resolve(true);
      element.remove();
    });
  });
}
