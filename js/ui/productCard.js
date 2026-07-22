// Archivo: /js/ui/productCard.js
// Tarjeta de producto reutilizada en home, búsqueda y listados relacionados.
import { escapeHtml } from '../utils/dom.js';
import { formatPrice } from '../utils/format.js';

const PLACEHOLDER_IMAGE = 'https://placehold.co/400x400/EDEDED/999999?text=Sin+imagen';

export function getMainImage(product) {
  return Array.isArray(product.images) && product.images.length > 0
    ? product.images[0]
    : PLACEHOLDER_IMAGE;
}

export function productCardHtml(product) {
  const shippingTag = product.free_shipping
    ? '<span class="product-card__shipping">Envío gratis</span>'
    : '';
  return `
    <article class="product-card">
      <a class="product-card__link" href="./product.html?id=${encodeURIComponent(product.id)}">
        <div class="product-card__image-wrap">
          <img class="product-card__image" src="${escapeHtml(getMainImage(product))}"
               alt="${escapeHtml(product.title)}" loading="lazy" />
        </div>
        <div class="product-card__body">
          <h3 class="product-card__title">${escapeHtml(product.title)}</h3>
          <p class="product-card__price">${formatPrice(product.price)}</p>
          ${shippingTag}
          <p class="product-card__seller">Vendido por ${escapeHtml(product.seller_name ?? 'Stocki')}</p>
        </div>
      </a>
    </article>`;
}

export function renderProductGrid(container, products) {
  container.innerHTML = `
    <div class="product-grid">
      ${products.map(productCardHtml).join('')}
    </div>`;
}
