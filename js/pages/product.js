// Archivo: /js/pages/product.js
// Detalle de producto: galería con miniaturas, selector de cantidad y
// acciones de compra; al final carga productos relacionados por categoría.
import { initLayout } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { renderProductGrid, getMainImage } from '../ui/productCard.js';
import { fetchProductById, fetchCatalog } from '../api/products.js';
import { addToCart } from '../api/cart.js';
import { qs, qsa, escapeHtml, getQueryParam, setLoading, renderEmptyState } from '../utils/dom.js';
import { formatPrice } from '../utils/format.js';

const RELATED_LIMIT = 6;

// Estado del módulo: el producto cargado y la cantidad elegida por el usuario
let product = null;
let quantity = 1;

function getImages(item) {
  // getMainImage garantiza siempre una imagen (placeholder si no hay ninguna)
  return Array.isArray(item.images) && item.images.length > 0
    ? item.images
    : [getMainImage(item)];
}

function renderNotFound(container) {
  renderEmptyState(container, {
    title: 'Producto no encontrado',
    text: 'El producto que buscas no existe o ya no está disponible.',
    actionHtml: '<a class="btn btn--primary" href="./index.html">Volver al inicio</a>',
  });
}

function galleryHtml(item) {
  const images = getImages(item);
  const thumbsHtml = images.length > 1
    ? `
      <div class="product-gallery__thumbs">
        ${images
          .map(
            (src, index) => `
              <button class="product-gallery__thumb${index === 0 ? ' product-gallery__thumb--active' : ''}"
                      type="button" data-index="${index}"
                      aria-label="Ver imagen ${index + 1} de ${images.length}">
                <img class="product-gallery__thumb-image" src="${escapeHtml(src)}" alt="" loading="lazy" />
              </button>`
          )
          .join('')}
      </div>`
    : '';
  return `
    <div class="product-gallery">
      <div class="product-gallery__main-wrap">
        <img class="product-gallery__main" id="gallery-main-image"
             src="${escapeHtml(images[0])}" alt="${escapeHtml(item.title)}" />
      </div>
      ${thumbsHtml}
    </div>`;
}

function detailHtml(item) {
  const inStock = Number(item.stock) > 0;
  const categoryHtml = item.category_slug
    ? `<a class="product-info__category" href="./search.html?category=${encodeURIComponent(item.category_slug)}">
         ${escapeHtml(item.category_name ?? 'Ver categoría')}
       </a>`
    : '';
  const shippingHtml = item.free_shipping
    ? '<p class="product-info__shipping">Envío gratis</p>'
    : '';
  const stockHtml = inStock
    ? `<p class="product-info__stock">${Number(item.stock)} disponibles</p>`
    : '<p class="product-info__stock product-info__stock--out">Sin stock</p>';
  // Sin stock se oculta el selector: la cantidad no aplica y los CTA van deshabilitados
  const qtyHtml = inStock
    ? `
      <div class="product-info__qty">
        <span class="product-info__qty-label" id="qty-label">Cantidad:</span>
        <div class="qty-stepper" role="group" aria-labelledby="qty-label">
          <button class="qty-stepper__button" type="button" id="qty-minus" aria-label="Disminuir cantidad">−</button>
          <span class="qty-stepper__value" id="qty-value" aria-live="polite">1</span>
          <button class="qty-stepper__button" type="button" id="qty-plus" aria-label="Aumentar cantidad">+</button>
        </div>
      </div>`
    : '';
  const descriptionHtml = item.description
    ? `
      <section class="product-description card" aria-label="Descripción del producto">
        <h2 class="card__title">Descripción</h2>
        <p class="product-description__text">${escapeHtml(item.description)}</p>
      </section>`
    : '';
  return `
    <article class="product-detail card">
      ${galleryHtml(item)}
      <div class="product-info">
        ${categoryHtml}
        <h1 class="product-info__title">${escapeHtml(item.title)}</h1>
        <p class="product-info__price">${formatPrice(item.price)}</p>
        ${shippingHtml}
        ${stockHtml}
        <p class="product-info__seller">Vendido por <strong>${escapeHtml(item.seller_name ?? 'Stocki')}</strong></p>
        ${qtyHtml}
        <div class="product-info__actions">
          <button class="btn btn--primary btn--block" type="button" id="buy-now" ${inStock ? '' : 'disabled'}>Comprar ahora</button>
          <button class="btn btn--secondary btn--block" type="button" id="add-to-cart" ${inStock ? '' : 'disabled'}>Agregar al carrito</button>
        </div>
      </div>
    </article>
    ${descriptionHtml}`;
}

function initGallery() {
  const mainImage = qs('#gallery-main-image');
  const thumbs = qsa('.product-gallery__thumb');
  if (!mainImage || thumbs.length === 0) return;
  const images = getImages(product);
  thumbs.forEach((thumb) => {
    thumb.addEventListener('click', () => {
      const index = Number(thumb.dataset.index);
      if (!images[index]) return;
      mainImage.src = images[index];
      thumbs.forEach((other) => other.classList.remove('product-gallery__thumb--active'));
      thumb.classList.add('product-gallery__thumb--active');
    });
  });
}

function refreshQtyUi() {
  const value = qs('#qty-value');
  const minusButton = qs('#qty-minus');
  const plusButton = qs('#qty-plus');
  if (!value || !minusButton || !plusButton) return;
  value.textContent = String(quantity);
  minusButton.disabled = quantity <= 1;
  // El máximo es el stock disponible: no se puede pedir más de lo que hay
  plusButton.disabled = quantity >= Number(product.stock);
}

function initQtyStepper() {
  const minusButton = qs('#qty-minus');
  const plusButton = qs('#qty-plus');
  if (!minusButton || !plusButton) return;
  minusButton.addEventListener('click', () => {
    if (quantity > 1) {
      quantity -= 1;
      refreshQtyUi();
    }
  });
  plusButton.addEventListener('click', () => {
    if (quantity < Number(product.stock)) {
      quantity += 1;
      refreshQtyUi();
    }
  });
  refreshQtyUi();
}

function initPurchaseActions() {
  const buyButton = qs('#buy-now');
  const addButton = qs('#add-to-cart');
  if (!buyButton || !addButton) return;

  async function handlePurchase(redirectToCart) {
    // Se deshabilitan ambos para evitar dobles clics mientras se sincroniza
    buyButton.disabled = true;
    addButton.disabled = true;
    try {
      await addToCart(product.id, quantity);
      if (redirectToCart) {
        window.location.href = './cart.html';
        return;
      }
      showToast('Producto agregado al carrito', 'success');
    } catch (error) {
      console.error(error);
      showToast('No se pudo agregar el producto al carrito', 'error');
    } finally {
      buyButton.disabled = false;
      addButton.disabled = false;
    }
  }

  addButton.addEventListener('click', () => handlePurchase(false));
  buyButton.addEventListener('click', () => handlePurchase(true));
}

async function loadRelated() {
  const section = qs('#related-section');
  const container = qs('#related-container');
  if (!section || !container) return;
  try {
    // Se pide uno de más porque el producto actual puede venir en la respuesta
    const { products } = await fetchCatalog({
      categorySlug: product.category_slug ?? '',
      limit: RELATED_LIMIT + 1,
    });
    const related = products.filter((item) => item.id !== product.id).slice(0, RELATED_LIMIT);
    if (related.length === 0) return;
    section.hidden = false;
    renderProductGrid(container, related);
  } catch (error) {
    // No es crítico: si falla, la sección simplemente no se muestra
    console.error(error);
  }
}

async function loadProduct() {
  const container = qs('#product-container');
  const id = getQueryParam('id');
  if (!id) {
    renderNotFound(container);
    return;
  }
  setLoading(container);
  try {
    product = await fetchProductById(id);
    if (!product) {
      renderNotFound(container);
      return;
    }
    document.title = `${product.title} — Stocki`;
    container.innerHTML = detailHtml(product);
    initGallery();
    initQtyStepper();
    initPurchaseActions();
    loadRelated();
  } catch (error) {
    console.error(error);
    // 22P02: el id de la URL no tiene formato uuid; equivale a "no existe"
    if (error?.code === '22P02') {
      renderNotFound(container);
      return;
    }
    renderEmptyState(container, {
      title: 'No pudimos cargar el producto',
      text: 'Verifica tu conexión e inténtalo de nuevo.',
      actionHtml: '<a class="btn btn--primary" href="./index.html">Volver al inicio</a>',
    });
    showToast('Error al cargar el producto', 'error');
  }
}

initLayout();
loadProduct();
