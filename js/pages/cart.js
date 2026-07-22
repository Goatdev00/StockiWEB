// Archivo: /js/pages/cart.js
// Controlador del carrito: cruza los ítems guardados con el catálogo vivo para
// mostrar el precio actual, marcar productos retirados o sin stock suficiente
// y habilitar el paso al checkout solo cuando todo es comprable.
import { initLayout } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { confirmModal } from '../ui/modal.js';
import { getMainImage } from '../ui/productCard.js';
import { getCartItems, updateQuantity, removeFromCart } from '../api/cart.js';
import { fetchProductsByIds } from '../api/products.js';
import { getUser } from '../api/auth.js';
import { formatPrice } from '../utils/format.js';
import { qs, qsa, escapeHtml, setLoading, renderEmptyState } from '../utils/dom.js';

// Caché del catálogo: se consulta una sola vez por carga de página; los
// cambios de cantidad re-renderizan sin repetir la petición.
let productsById = new Map();

function getContainer() {
  return qs('#cart-container');
}

function renderEmptyCart() {
  renderEmptyState(getContainer(), {
    title: 'Tu carrito está vacío',
    text: 'Explora el catálogo y agrega productos para verlos aquí.',
    actionHtml: '<a class="btn btn--primary" href="./search.html">Descubrir productos</a>',
  });
}

// issue: 'missing' (retirado del catálogo), 'no-stock', 'low-stock' o null
function buildRows(items) {
  return items.map((item) => {
    const product = productsById.get(item.product_id) ?? null;
    let issue = null;
    if (!product) issue = 'missing';
    else if (product.stock <= 0) issue = 'no-stock';
    else if (product.stock < item.quantity) issue = 'low-stock';
    return { item, product, issue };
  });
}

function rowHtml(row) {
  const { item, product, issue } = row;
  const title = product?.title ?? 'Producto ya no disponible';
  const image = getMainImage(product ?? { images: [] });
  const blocked = issue === 'missing' || issue === 'no-stock';

  const titleHtml = product
    ? `<a class="cart-item__title" href="./product.html?id=${encodeURIComponent(product.id)}">${escapeHtml(title)}</a>`
    : `<span class="cart-item__title">${escapeHtml(title)}</span>`;

  const unitPriceHtml = product
    ? `<p class="cart-item__unit-price">Precio unitario: ${formatPrice(product.price)}</p>`
    : '';

  let statusHtml = '';
  if (issue === 'missing') {
    statusHtml = '<span class="badge badge--cancelada">No disponible</span>';
  } else if (issue === 'no-stock') {
    statusHtml = '<span class="badge badge--cancelada">Sin stock</span>';
  } else if (issue === 'low-stock') {
    statusHtml = `<p class="cart-item__warning">Solo quedan ${product.stock} unidades: ajusta la cantidad</p>`;
  }

  const controlsHtml = blocked
    ? '<button class="btn btn--danger btn--small" type="button" data-action="remove">Quitar del carrito</button>'
    : `
      <div class="qty-stepper" role="group" aria-label="Cantidad de ${escapeHtml(title)}">
        <button class="qty-stepper__button" type="button" data-action="decrease"
                aria-label="Disminuir cantidad" ${item.quantity <= 1 ? 'disabled' : ''}>−</button>
        <span class="qty-stepper__value" aria-live="polite">${item.quantity}</span>
        <button class="qty-stepper__button" type="button" data-action="increase"
                aria-label="Aumentar cantidad" ${item.quantity >= product.stock ? 'disabled' : ''}>+</button>
      </div>
      <button class="cart-item__remove" type="button" data-action="remove">Eliminar</button>
      <p class="cart-item__subtotal">${formatPrice(product.price * item.quantity)}</p>`;

  return `
    <li class="cart-item${blocked ? ' cart-item--blocked' : ''}" data-product-id="${escapeHtml(item.product_id)}">
      <img class="cart-item__image" src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy" />
      <div class="cart-item__info">
        ${titleHtml}
        ${unitPriceHtml}
        ${statusHtml}
      </div>
      <div class="cart-item__controls">${controlsHtml}</div>
    </li>`;
}

function summaryHtml(rows) {
  const validRows = rows.filter((row) => row.issue === null);
  const hasIssues = validRows.length !== rows.length;
  const units = validRows.reduce((sum, row) => sum + row.item.quantity, 0);
  const total = validRows.reduce((sum, row) => sum + row.product.price * row.item.quantity, 0);
  const disabled = hasIssues || validRows.length === 0;
  return `
    <aside class="cart-summary card" aria-label="Resumen de compra">
      <h2 class="card__title">Resumen de compra</h2>
      <p class="cart-summary__row"><span>Productos (${units})</span><span>${formatPrice(total)}</span></p>
      <p class="cart-summary__total"><span>Total</span><span>${formatPrice(total)}</span></p>
      ${hasIssues ? '<p class="cart-summary__hint">Quita o ajusta los productos marcados para continuar.</p>' : ''}
      <button class="btn btn--primary btn--block" type="button" id="checkout-button" ${disabled ? 'disabled' : ''}>
        Continuar compra
      </button>
    </aside>`;
}

function render() {
  const items = getCartItems();
  if (items.length === 0) {
    renderEmptyCart();
    return;
  }
  const rows = buildRows(items);
  getContainer().innerHTML = `
    <div class="cart-layout">
      <section class="card" aria-label="Productos en el carrito">
        <ul class="cart-list">
          ${rows.map(rowHtml).join('')}
        </ul>
      </section>
      ${summaryHtml(rows)}
    </div>`;
  bindEvents();
}

async function handleAction(button) {
  const productId = button.closest('.cart-item')?.dataset.productId;
  const action = button.dataset.action;
  if (!productId || !action) return;
  const item = getCartItems().find((entry) => entry.product_id === productId);
  if (!item) return;

  try {
    if (action === 'increase') {
      const product = productsById.get(productId);
      if (product && item.quantity + 1 > product.stock) {
        showToast('No hay más unidades disponibles de este producto', 'warning');
        return;
      }
      await updateQuantity(productId, item.quantity + 1);
    } else if (action === 'decrease') {
      await updateQuantity(productId, Math.max(1, item.quantity - 1));
    } else if (action === 'remove') {
      const product = productsById.get(productId);
      const confirmed = await confirmModal({
        title: 'Eliminar del carrito',
        message: `¿Quieres quitar «${escapeHtml(product?.title ?? 'este producto')}» del carrito?`,
        confirmLabel: 'Eliminar',
      });
      if (!confirmed) return;
      await removeFromCart(productId);
      showToast('Producto eliminado del carrito', 'success');
    }
    render();
  } catch (error) {
    console.error(error);
    showToast('No pudimos actualizar el carrito', 'error');
    render();
  }
}

async function goToCheckout(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    // Con sesión va directo al checkout; sin sesión pasa por login y vuelve
    const user = await getUser();
    window.location.href = user ? './checkout.html' : './auth.html?next=checkout.html';
  } catch (error) {
    console.error(error);
    button.disabled = false;
    showToast('No pudimos verificar tu sesión', 'error');
  }
}

function bindEvents() {
  qsa('.cart-item [data-action]').forEach((button) => {
    button.addEventListener('click', () => handleAction(button));
  });
  const checkoutButton = qs('#checkout-button');
  if (checkoutButton) checkoutButton.addEventListener('click', goToCheckout);
}

async function loadCart() {
  const items = getCartItems();
  if (items.length === 0) {
    renderEmptyCart();
    return;
  }
  setLoading(getContainer());
  try {
    const products = await fetchProductsByIds(items.map((item) => item.product_id));
    productsById = new Map(products.map((product) => [product.id, product]));
    render();
  } catch (error) {
    console.error(error);
    renderEmptyState(getContainer(), {
      title: 'No pudimos cargar tu carrito',
      text: 'Revisa tu conexión e inténtalo de nuevo.',
      actionHtml: '<button class="btn btn--primary" type="button" id="retry-button">Reintentar</button>',
    });
    qs('#retry-button')?.addEventListener('click', loadCart);
    showToast('Error al cargar el carrito', 'error');
  }
}

initLayout();
loadCart();
