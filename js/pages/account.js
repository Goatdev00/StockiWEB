// Archivo: /js/pages/account.js
// Página de cuenta protegida: perfil, historial de compras y activación
// del perfil de vendedor. Las secciones se navegan por hash (#perfil,
// #compras, #vender) para poder enlazarlas desde el header.
import { initLayout, requireAuth } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { qs, escapeHtml, setLoading, renderEmptyState } from '../utils/dom.js';
import { formatPrice, formatDate, formatOrderStatus } from '../utils/format.js';
import { updateMyProfile, becomeSeller } from '../api/profiles.js';
import { fetchMyOrders } from '../api/orders.js';
import { getUser } from '../api/auth.js';

const VALID_TABS = ['perfil', 'compras', 'vender'];
const ROLE_LABELS = { buyer: 'Comprador', seller: 'Vendedor', admin: 'Administrador' };
const GATEWAY_LABELS = { bold: 'Bold', mercadopago: 'MercadoPago' };

let profile = null;
let ordersLoaded = false;

/* ---------- Navegación por pestañas (hash) ---------- */

function currentTab() {
  const hash = window.location.hash.replace('#', '');
  return VALID_TABS.includes(hash) ? hash : 'perfil';
}

function activateTab() {
  const active = currentTab();
  VALID_TABS.forEach((name) => {
    const tab = qs(`#tab-${name}`);
    const panel = qs(`#panel-${name}`);
    const isActive = name === active;
    tab.classList.toggle('tabs__tab--active', isActive);
    if (isActive) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
    panel.hidden = !isActive;
  });
  // Las compras se cargan bajo demanda, la primera vez que se abre la pestaña
  if (active === 'compras' && !ordersLoaded) loadOrders();
}

/* ---------- Sección #perfil ---------- */

function renderRoleBadge() {
  const role = profile?.role ?? 'buyer';
  qs('#profile-role').innerHTML = `
    <span class="badge badge--role-${escapeHtml(role)}">${escapeHtml(ROLE_LABELS[role] ?? role)}</span>`;
}

async function renderProfileSection() {
  qs('#profile-name').value = profile.full_name ?? '';
  qs('#profile-phone').value = profile.phone ?? '';
  renderRoleBadge();
  try {
    const user = await getUser();
    qs('#profile-email').value = user?.email ?? '';
  } catch (error) {
    console.error(error);
    showToast('No pudimos cargar tu correo', 'error');
  }
}

function setFieldError(errorId, message = '') {
  const element = qs(`#${errorId}`);
  if (!element) return;
  element.textContent = message;
  element.hidden = !message;
}

function bindProfileForm() {
  const form = qs('#profile-form');
  const submit = qs('#profile-submit');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fullName = qs('#profile-name').value.trim();
    const phone = qs('#profile-phone').value.trim();

    let valid = true;
    if (fullName.length < 3) {
      setFieldError('profile-name-error', 'Ingresa tu nombre completo');
      valid = false;
    } else {
      setFieldError('profile-name-error');
    }
    if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) {
      setFieldError('profile-phone-error', 'Ingresa un teléfono válido');
      valid = false;
    } else {
      setFieldError('profile-phone-error');
    }
    if (!valid) return;

    submit.disabled = true;
    submit.textContent = 'Guardando…';
    try {
      profile = await updateMyProfile({ fullName, phone: phone || null });
      showToast('Perfil actualizado', 'success');
    } catch (error) {
      console.error(error);
      showToast(error.message ?? 'No se pudo actualizar el perfil', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Guardar cambios';
    }
  });
}

/* ---------- Sección #compras ---------- */

function orderCardHtml(order) {
  const status = order.status ?? 'pendiente';
  const gateway = GATEWAY_LABELS[order.payment_gateway] ?? 'Pasarela sin registrar';
  const itemsHtml = (order.order_items ?? [])
    .map(
      (item) => `
        <li class="order-card__item">
          <span class="order-card__item-title">${escapeHtml(item.title)} × ${Number(item.quantity) || 0}</span>
          <span class="order-card__item-subtotal">${escapeHtml(formatPrice(item.subtotal))}</span>
        </li>`
    )
    .join('');
  const pendingLink =
    status === 'pendiente'
      ? `<a class="order-card__link" href="./order-confirmation.html?order=${encodeURIComponent(order.id)}">Ver estado del pago</a>`
      : '';
  return `
    <article class="order-card">
      <header class="order-card__header">
        <div>
          <p class="order-card__date">${escapeHtml(formatDate(order.created_at))}</p>
          <p class="order-card__gateway">${escapeHtml(gateway)}</p>
        </div>
        <span class="badge badge--${escapeHtml(status)}">${escapeHtml(formatOrderStatus(status))}</span>
      </header>
      <ul class="order-card__items">${itemsHtml}</ul>
      <footer class="order-card__footer">
        <span class="order-card__total-label">Total</span>
        <span class="order-card__total">${escapeHtml(formatPrice(order.total))}</span>
      </footer>
      ${pendingLink}
    </article>`;
}

async function loadOrders() {
  ordersLoaded = true;
  const container = qs('#orders-container');
  setLoading(container);
  try {
    const orders = await fetchMyOrders();
    if (orders.length === 0) {
      renderEmptyState(container, {
        title: 'Aún no tienes compras',
        text: 'Cuando compres en Stocki, tus órdenes y su estado aparecerán aquí.',
        actionHtml: '<a class="btn btn--primary" href="./search.html">Explorar productos</a>',
      });
      return;
    }
    container.innerHTML = orders.map(orderCardHtml).join('');
  } catch (error) {
    console.error(error);
    // Se permite reintentar al volver a abrir la pestaña
    ordersLoaded = false;
    renderEmptyState(container, {
      title: 'No pudimos cargar tus compras',
      text: 'Verifica tu conexión y vuelve a intentarlo en unos segundos.',
    });
    showToast('Error al cargar tus compras', 'error');
  }
}

/* ---------- Sección #vender ---------- */

function renderSellSection() {
  const container = qs('#sell-container');
  if (['seller', 'admin'].includes(profile?.role)) {
    container.innerHTML = `
      <div class="card sell-card">
        <h2 class="card__title">Ya puedes vender en Stocki</h2>
        <p class="sell-card__text">Tu perfil de vendedor está activo. Administra tus productos, tu stock y tus ventas desde tu panel.</p>
        <a class="btn btn--primary" href="./seller.html">Ir a mi panel de vendedor</a>
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="card sell-card">
      <h2 class="card__title">Vende en Stocki</h2>
      <p class="sell-card__text">Publica tus productos, recibe pagos seguros con Bold o MercadoPago y llega a compradores en toda Colombia. Activarlo es gratis y toma un segundo.</p>
      <ul class="sell-card__benefits">
        <li class="sell-card__benefit">Publica tus productos con fotos y stock</li>
        <li class="sell-card__benefit">Gestiona tus ventas desde un solo panel</li>
        <li class="sell-card__benefit">Cobra con pasarelas de pago seguras</li>
      </ul>
      <button class="btn btn--primary" type="button" id="become-seller-button">Activar mi perfil de vendedor</button>
    </div>`;
  qs('#become-seller-button').addEventListener('click', onBecomeSeller);
}

async function onBecomeSeller() {
  const button = qs('#become-seller-button');
  button.disabled = true;
  button.textContent = 'Activando…';
  try {
    profile = await becomeSeller();
    showToast('¡Tu perfil de vendedor está activo!', 'success');
    renderRoleBadge();
    renderSellSection();
  } catch (error) {
    console.error(error);
    showToast(error.message ?? 'No se pudo activar el perfil de vendedor', 'error');
    button.disabled = false;
    button.textContent = 'Activar mi perfil de vendedor';
  }
}

/* ---------- Arranque ---------- */

async function init() {
  initLayout();
  try {
    profile = await requireAuth();
  } catch (error) {
    console.error(error);
    showToast('No pudimos verificar tu sesión', 'error');
    return;
  }
  if (!profile) return;

  await renderProfileSection();
  bindProfileForm();
  renderSellSection();

  window.addEventListener('hashchange', activateTab);
  activateTab();
}

init();
