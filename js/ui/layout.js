// Archivo: /js/ui/layout.js
// Header y footer compartidos. Cada página llama initLayout() al arrancar:
// pinta el shell, carga categorías, refleja la sesión y mantiene el contador
// del carrito sincronizado.
import { escapeHtml, qs } from '../utils/dom.js';
import { showToast } from './toast.js';
import { fetchCategories } from '../api/categories.js';
import { getUser, onAuthChange, signOut } from '../api/auth.js';
import { getMyProfile } from '../api/profiles.js';
import { getCartCount, onCartChange, mergeCartOnLogin, clearLocalCart } from '../api/cart.js';

const CART_ICON = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 4h2l2.4 12.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.76L20.5 8H6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="9.5" cy="20" r="1.4" fill="currentColor"/>
    <circle cx="16.5" cy="20" r="1.4" fill="currentColor"/>
  </svg>`;

const SEARCH_ICON = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
    <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;

function navLinksHtml(profile) {
  if (!profile) {
    return `
      <a class="header__nav-link" href="./auth.html?mode=register">Crea tu cuenta</a>
      <a class="header__nav-link" href="./auth.html">Ingresa</a>`;
  }
  const firstName = (profile.full_name ?? 'Mi cuenta').split(' ')[0];
  const sellerLink = ['seller', 'admin'].includes(profile.role)
    ? '<a class="header__nav-link" href="./seller.html">Mi panel</a>'
    : '<a class="header__nav-link" href="./account.html#vender">Vender</a>';
  const adminLink = profile.role === 'admin'
    ? '<a class="header__nav-link" href="./admin.html">Admin</a>'
    : '';
  return `
    <a class="header__nav-link" href="./account.html">${escapeHtml(firstName)}</a>
    <a class="header__nav-link" href="./account.html#compras">Mis compras</a>
    ${sellerLink}
    ${adminLink}
    <button class="header__nav-button" type="button" id="logout-button">Salir</button>`;
}

function renderHeaderShell(searchQuery) {
  const header = qs('#app-header');
  if (!header) return;
  header.innerHTML = `
    <div class="header__top container">
      <a class="header__logo" href="./index.html" aria-label="Stocki, ir al inicio">
        <span class="logo">st<span class="logo__o" aria-hidden="true"></span>cki</span>
        <span class="logo__tagline">store</span>
      </a>
      <form class="search-form" id="search-form" role="search" action="./search.html" method="get">
        <label class="visually-hidden" for="search-input">Buscar productos</label>
        <input class="search-form__input" id="search-input" type="search" name="q"
               placeholder="Buscar productos, marcas y más…" value="${escapeHtml(searchQuery)}" />
        <button class="search-form__button" type="submit" aria-label="Buscar">${SEARCH_ICON}</button>
      </form>
      <nav class="header__nav" aria-label="Cuenta y carrito">
        <span id="header-session-links"></span>
        <a class="header__cart" href="./cart.html" aria-label="Ver carrito">
          ${CART_ICON}
          <span class="header__cart-badge header__cart-badge--empty" id="cart-badge"></span>
        </a>
      </nav>
    </div>
    <div class="header__bottom container">
      <nav class="categories-nav" id="categories-nav" aria-label="Categorías"></nav>
    </div>`;
}

function renderFooter() {
  const footer = qs('#app-footer');
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer__content container">
      <p class="footer__text">Stocki · Marketplace hecho en Colombia</p>
      <p class="footer__text">Compra protegida · Pagos procesados por Bold y MercadoPago</p>
    </div>`;
}

function updateCartBadge() {
  const badge = qs('#cart-badge');
  if (!badge) return;
  const count = getCartCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('header__cart-badge--empty', count === 0);
}

async function renderSessionLinks() {
  const slot = qs('#header-session-links');
  if (!slot) return;
  let profile = null;
  try {
    const user = await getUser();
    if (user) profile = await getMyProfile();
  } catch {
    // Sin perfil (ej. esquema aún no ejecutado): se muestra el estado invitado
  }
  slot.innerHTML = navLinksHtml(profile);

  const logoutButton = qs('#logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      try {
        await signOut();
        // El carrito local se vacía para que otra cuenta en este navegador
        // no herede (ni fusione) los ítems del usuario saliente
        clearLocalCart();
        showToast('Sesión cerrada', 'success');
        window.location.href = './index.html';
      } catch (error) {
        showToast(error.message ?? 'No se pudo cerrar sesión', 'error');
      }
    });
  }
}

async function renderCategoriesNav() {
  const nav = qs('#categories-nav');
  if (!nav) return;
  try {
    const categories = await fetchCategories();
    nav.innerHTML = categories
      .map(
        (category) => `
          <a class="categories-nav__link" href="./search.html?category=${encodeURIComponent(category.slug)}">
            ${escapeHtml(category.name)}
          </a>`
      )
      .join('');
  } catch {
    // Silencioso: si la base aún no tiene el esquema, el header sigue usable
    nav.innerHTML = '';
  }
}

export async function initLayout({ searchQuery = '' } = {}) {
  renderHeaderShell(searchQuery);
  renderFooter();
  updateCartBadge();
  onCartChange(updateCartBadge);

  // En paralelo: ninguna bloquea el renderizado de la página
  renderCategoriesNav();
  renderSessionLinks();

  onAuthChange(async (session) => {
    if (session) {
      try {
        await mergeCartOnLogin();
      } catch {
        // La fusión del carrito no debe romper el login
      }
      updateCartBadge();
    }
    renderSessionLinks();
  });
}

// Guardia para páginas que exigen sesión (y opcionalmente un rol mínimo).
// Devuelve el perfil o redirige y devuelve null.
export async function requireAuth({ roles = null, redirectTo = './auth.html' } = {}) {
  const user = await getUser();
  if (!user) {
    // Se conserva también el hash para volver a la pestaña exacta (#compras, #ventas…)
    const next = window.location.pathname.split('/').pop() + window.location.search + window.location.hash;
    window.location.href = `${redirectTo}?next=${encodeURIComponent(next)}`;
    return null;
  }
  const profile = await getMyProfile();
  if (roles && !roles.includes(profile?.role)) {
    showToast('No tienes permisos para acceder a esta sección', 'warning');
    window.location.href = './index.html';
    return null;
  }
  return profile;
}
