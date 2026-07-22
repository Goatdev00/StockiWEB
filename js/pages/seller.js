// Archivo: /js/pages/seller.js
// Panel del vendedor: tres pestañas (productos propios, importación desde
// Dropi y ventas). El estado de la pestaña vive en el hash de la URL para
// que se pueda enlazar/recargar directamente cada sección.
import { initLayout, requireAuth } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { getMainImage } from '../ui/productCard.js';
import { qs, qsa, escapeHtml, setLoading, renderEmptyState } from '../utils/dom.js';
import { formatPrice, formatDate, formatOrderStatus } from '../utils/format.js';
import { fetchMyProducts, createProduct, updateProduct, deleteProduct } from '../api/products.js';
import { fetchCategories } from '../api/categories.js';
import { uploadProductImage } from '../api/storage.js';
import { fetchDropiCatalog, importDropiProduct, syncMyDropiProducts } from '../api/dropi.js';
import { fetchMySales } from '../api/orders.js';

const TAB_NAMES = ['productos', 'dropi', 'ventas'];
// Estados de orden que cuentan como venta efectiva para el total
const SOLD_STATUSES = ['pagada', 'enviada', 'entregada'];
const DROPI_MARGIN = 1.3;

let categories = [];
let myProducts = [];
const dropiState = {
  search: '',
  page: 1,
  totalPages: 1,
  loaded: false,
  products: new Map(),
};

function roundToHundred(value) {
  return Math.round(value / 100) * 100;
}

function categoryOptionsHtml(selectedId = null) {
  const options = categories.map((category) => {
    const selected = selectedId !== null && String(selectedId) === String(category.id) ? ' selected' : '';
    return `<option value="${escapeHtml(String(category.id))}"${selected}>${escapeHtml(category.name)}</option>`;
  });
  return `<option value="">Selecciona una categoría</option>${options.join('')}`;
}

/* ============================ Pestaña: Mis productos ============================ */

function productRowHtml(product) {
  const originBadge = product.source === 'dropi'
    ? '<span class="badge badge--dropi">Dropi</span>'
    : '<span class="badge badge--neutral">Manual</span>';
  const stateBadge = product.active
    ? '<span class="badge badge--aprobado">Activo</span>'
    : '<span class="badge badge--neutral">Pausado</span>';
  const toggleLabel = product.active ? 'Pausar' : 'Activar';
  const safeId = escapeHtml(String(product.id));
  return `
    <tr>
      <td><img class="data-table__thumb" src="${escapeHtml(getMainImage(product))}"
               alt="${escapeHtml(product.title)}" loading="lazy" /></td>
      <td>${escapeHtml(product.title)}</td>
      <td>${formatPrice(product.price)}</td>
      <td>${escapeHtml(String(product.stock))}</td>
      <td>${originBadge}</td>
      <td>${stateBadge}</td>
      <td>
        <div class="seller-actions">
          <button class="btn btn--ghost btn--small" type="button" data-action="edit" data-id="${safeId}">Editar</button>
          <button class="btn btn--secondary btn--small" type="button" data-action="toggle" data-id="${safeId}">${toggleLabel}</button>
          <button class="btn btn--danger btn--small" type="button" data-action="delete" data-id="${safeId}">Eliminar</button>
        </div>
      </td>
    </tr>`;
}

async function loadProducts() {
  const container = qs('#products-table-container');
  setLoading(container);
  try {
    myProducts = await fetchMyProducts();
    if (myProducts.length === 0) {
      renderEmptyState(container, {
        title: 'Aún no tienes productos publicados',
        text: 'Publica tu primer producto o importa uno desde la pestaña «Importar de Dropi».',
      });
      return;
    }
    container.innerHTML = `
      <div class="table-wrap seller-table-card">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">Imagen</span></th>
              <th scope="col">Producto</th>
              <th scope="col">Precio</th>
              <th scope="col">Stock</th>
              <th scope="col">Origen</th>
              <th scope="col">Estado</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>${myProducts.map(productRowHtml).join('')}</tbody>
        </table>
      </div>`;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar tus productos',
      text: 'Verifica tu conexión e intenta de nuevo.',
    });
    showToast('Error al cargar tus productos', 'error');
  }
}

// updateProduct sobrescribe todas las columnas editables: se envían los
// valores actuales para no borrar datos al cambiar un solo campo.
function productToChanges(product) {
  return {
    title: product.title,
    description: product.description,
    categoryId: product.category_id,
    price: product.price,
    costPrice: product.cost_price,
    stock: product.stock,
    images: product.images,
    freeShipping: product.free_shipping,
    active: product.active,
  };
}

async function handleProductAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const product = myProducts.find((item) => String(item.id) === button.dataset.id);
  if (!product) return;

  if (button.dataset.action === 'edit') {
    openProductModal(product);
    return;
  }

  if (button.dataset.action === 'toggle') {
    button.disabled = true;
    try {
      await updateProduct(product.id, { ...productToChanges(product), active: !product.active });
      showToast(product.active ? 'Producto pausado' : 'Producto activado', 'success');
      await loadProducts();
    } catch (error) {
      console.error(error);
      showToast('No se pudo cambiar el estado del producto', 'error');
      button.disabled = false;
    }
    return;
  }

  if (button.dataset.action === 'delete') {
    const confirmed = await confirmModal({
      title: 'Eliminar producto',
      message: `¿Seguro que quieres eliminar «${escapeHtml(product.title)}»? Esta acción no se puede deshacer.`,
      confirmLabel: 'Eliminar',
    });
    if (!confirmed) return;
    try {
      await deleteProduct(product.id);
      showToast('Producto eliminado', 'success');
      await loadProducts();
    } catch (error) {
      console.error(error);
      showToast('No se pudo eliminar el producto', 'error');
    }
  }
}

/* ---------- Modal de publicación / edición ---------- */

function productFormHtml(product, isDropi) {
  const isEdit = product !== null;
  const dropiHint = isDropi
    ? '<p class="form-field__hint">El stock y el costo de este producto se sincronizan automáticamente desde Dropi y no se pueden editar aquí.</p>'
    : '<p class="form-field__hint">El costo es solo para tu control de margen; no se muestra a los compradores.</p>';
  return `
    <form class="form" id="product-form" novalidate>
      <div class="form-field">
        <label class="form-field__label" for="pf-title">Título</label>
        <input class="form-field__input" id="pf-title" type="text" required minlength="3"
               value="${escapeHtml(product?.title ?? '')}" />
      </div>
      <div class="form-field">
        <label class="form-field__label" for="pf-description">Descripción</label>
        <textarea class="form-field__textarea" id="pf-description">${escapeHtml(product?.description ?? '')}</textarea>
      </div>
      <div class="form-field">
        <label class="form-field__label" for="pf-category">Categoría</label>
        <select class="form-field__select" id="pf-category" required>
          ${categoryOptionsHtml(product?.category_id ?? null)}
        </select>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label class="form-field__label" for="pf-price">Precio (COP)</label>
          <input class="form-field__input" id="pf-price" type="number" min="1" step="1" required
                 value="${escapeHtml(String(product?.price ?? ''))}" />
        </div>
        <div class="form-field">
          <label class="form-field__label" for="pf-stock">Stock</label>
          <input class="form-field__input" id="pf-stock" type="number" min="0" step="1" required
                 value="${escapeHtml(String(product?.stock ?? 0))}" ${isDropi ? 'disabled' : ''} />
        </div>
      </div>
      <div class="form-field">
        <label class="form-field__label" for="pf-cost">Costo (COP, opcional)</label>
        <input class="form-field__input" id="pf-cost" type="number" min="0" step="1"
               value="${escapeHtml(String(product?.cost_price ?? ''))}" ${isDropi ? 'disabled' : ''} />
        ${dropiHint}
      </div>
      <label class="check-field" for="pf-free-shipping">
        <input id="pf-free-shipping" type="checkbox" ${product?.free_shipping ? 'checked' : ''} />
        <span>Envío gratis</span>
      </label>
      <label class="check-field" for="pf-active">
        <input id="pf-active" type="checkbox" ${product === null || product.active ? 'checked' : ''} />
        <span>Producto activo (visible en el catálogo)</span>
      </label>
      <div class="form-field">
        <label class="form-field__label" for="pf-images">Imágenes</label>
        <input class="form-field__input" id="pf-images" type="file" multiple accept="image/*" />
        <p class="form-field__hint">JPG, PNG o WebP, máximo 5 MB por imagen.</p>
        <p class="seller-form__upload-status" id="pf-upload-status" hidden>Subiendo imágenes…</p>
        <ul class="seller-form__images-list" id="pf-previews"></ul>
      </div>
      <div class="seller-form__actions">
        <button class="btn btn--secondary" type="button" data-action="cancel">Cancelar</button>
        <button class="btn btn--primary" type="submit" id="pf-submit">${isEdit ? 'Guardar cambios' : 'Publicar'}</button>
      </div>
    </form>`;
}

function openProductModal(product = null) {
  const isEdit = product !== null;
  const isDropi = product?.source === 'dropi';
  let images = Array.isArray(product?.images) ? [...product.images] : [];

  const modal = openModal({
    title: isEdit ? 'Editar producto' : 'Publicar producto',
    contentHtml: productFormHtml(product, isDropi),
  });
  const root = modal.element;
  const form = qs('#product-form', root);
  const fileInput = qs('#pf-images', root);
  const uploadStatus = qs('#pf-upload-status', root);
  const previewsList = qs('#pf-previews', root);
  const submitButton = qs('#pf-submit', root);

  function renderPreviews() {
    previewsList.innerHTML = images
      .map(
        (url, index) => `
          <li class="seller-form__preview">
            <img class="seller-form__preview-img" src="${escapeHtml(url)}" alt="Imagen ${index + 1} del producto" />
            <button class="seller-form__preview-remove" type="button" data-index="${index}"
                    aria-label="Quitar imagen ${index + 1}">✕</button>
          </li>`
      )
      .join('');
  }
  renderPreviews();

  previewsList.addEventListener('click', (event) => {
    const removeButton = event.target.closest('button[data-index]');
    if (!removeButton) return;
    images.splice(Number(removeButton.dataset.index), 1);
    renderPreviews();
  });

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (files.length === 0) return;
    uploadStatus.hidden = false;
    submitButton.disabled = true;
    for (const file of files) {
      try {
        const url = await uploadProductImage(file);
        images.push(url);
        renderPreviews();
      } catch (error) {
        console.error(error);
        showToast(error.message ?? 'No se pudo subir la imagen', 'error');
      }
    }
    uploadStatus.hidden = true;
    submitButton.disabled = false;
  });

  qs('[data-action="cancel"]', root).addEventListener('click', modal.close);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = qs('#pf-title', root).value.trim();
    const description = qs('#pf-description', root).value.trim();
    const categoryId = qs('#pf-category', root).value || null;
    const price = Number(qs('#pf-price', root).value);
    // En productos Dropi, stock y costo se preservan tal cual: los gobierna la sincronización
    const stock = isDropi ? product.stock : Number.parseInt(qs('#pf-stock', root).value, 10);
    const costRaw = qs('#pf-cost', root).value;
    const costPrice = isDropi ? product.cost_price : (costRaw === '' ? null : Number(costRaw));
    const freeShipping = qs('#pf-free-shipping', root).checked;
    const active = qs('#pf-active', root).checked;

    if (title.length < 3) {
      showToast('El título debe tener al menos 3 caracteres', 'warning');
      return;
    }
    if (!categoryId) {
      showToast('Selecciona una categoría', 'warning');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      showToast('El precio debe ser mayor que 0', 'warning');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      showToast('El stock debe ser 0 o mayor', 'warning');
      return;
    }

    submitButton.disabled = true;
    try {
      const payload = { title, description, categoryId, price, costPrice, stock, images, freeShipping, active };
      if (isEdit) {
        await updateProduct(product.id, payload);
        showToast('Producto actualizado', 'success');
      } else {
        await createProduct(payload);
        showToast('Producto publicado', 'success');
      }
      modal.close();
      await loadProducts();
    } catch (error) {
      console.error(error);
      showToast(error.message ?? 'No se pudo guardar el producto', 'error');
      submitButton.disabled = false;
    }
  });
}

/* ============================ Pestaña: Importar de Dropi ============================ */

function dropiCardHtml(dropiProduct) {
  const safeId = escapeHtml(String(dropiProduct.id));
  const cost = Number(dropiProduct.cost_price) || 0;
  const suggestedPrice = roundToHundred(cost * DROPI_MARGIN);
  return `
    <article class="dropi-card">
      <img class="dropi-card__image" src="${escapeHtml(getMainImage(dropiProduct))}"
           alt="${escapeHtml(dropiProduct.name)}" loading="lazy" />
      <div class="dropi-card__body">
        <h3 class="dropi-card__name">${escapeHtml(dropiProduct.name)}</h3>
        <p class="dropi-card__meta">Costo proveedor: <strong>${formatPrice(cost)}</strong></p>
        <p class="dropi-card__meta">Stock proveedor: ${escapeHtml(String(dropiProduct.stock ?? 0))}</p>
        <div class="form-field">
          <label class="form-field__label" for="dropi-price-${safeId}">Tu precio de venta (COP)</label>
          <input class="form-field__input" id="dropi-price-${safeId}" type="number" min="0" step="50"
                 value="${suggestedPrice}" data-field="price" />
        </div>
        <div class="form-field">
          <label class="form-field__label" for="dropi-category-${safeId}">Categoría en Stocki</label>
          <select class="form-field__select" id="dropi-category-${safeId}" data-field="category">
            ${categoryOptionsHtml()}
          </select>
        </div>
        <label class="check-field" for="dropi-shipping-${safeId}">
          <input id="dropi-shipping-${safeId}" type="checkbox" data-field="free-shipping" />
          <span>Envío gratis</span>
        </label>
        <button class="btn btn--primary btn--block dropi-card__import" type="button"
                data-action="import" data-id="${safeId}">Importar</button>
      </div>
    </article>`;
}

function renderDropiPagination() {
  const nav = qs('#dropi-pagination');
  if (dropiState.totalPages <= 1) {
    nav.innerHTML = '';
    return;
  }
  nav.innerHTML = `
    <button class="btn btn--secondary btn--small" type="button" data-move="-1"
            ${dropiState.page <= 1 ? 'disabled' : ''}>Anterior</button>
    <span class="dropi-pagination__info">Página ${dropiState.page} de ${dropiState.totalPages}</span>
    <button class="btn btn--secondary btn--small" type="button" data-move="1"
            ${dropiState.page >= dropiState.totalPages ? 'disabled' : ''}>Siguiente</button>`;
}

async function loadDropiCatalog() {
  const container = qs('#dropi-results');
  qs('#dropi-pagination').innerHTML = '';
  setLoading(container);
  try {
    const result = await fetchDropiCatalog({ search: dropiState.search, page: dropiState.page });
    const products = result?.products ?? [];
    dropiState.page = result?.page ?? dropiState.page;
    dropiState.totalPages = result?.total_pages ?? 1;
    dropiState.products = new Map(products.map((item) => [String(item.id), item]));
    if (products.length === 0) {
      renderEmptyState(container, {
        title: 'Sin resultados en Dropi',
        text: 'Prueba con otro término de búsqueda.',
      });
      return;
    }
    container.innerHTML = `<div class="dropi-grid">${products.map(dropiCardHtml).join('')}</div>`;
    renderDropiPagination();
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos consultar el catálogo de Dropi',
      text: 'Intenta de nuevo en unos segundos.',
    });
    showToast('Error al consultar el catálogo de Dropi', 'error');
  }
}

async function handleDropiImport(event) {
  const button = event.target.closest('button[data-action="import"]');
  if (!button) return;
  const dropiProduct = dropiState.products.get(button.dataset.id);
  if (!dropiProduct) return;

  const card = button.closest('.dropi-card');
  const price = Number(qs('[data-field="price"]', card).value);
  const categoryId = qs('[data-field="category"]', card).value || null;
  const freeShipping = qs('[data-field="free-shipping"]', card).checked;
  const cost = Number(dropiProduct.cost_price) || 0;

  if (!Number.isFinite(price) || price <= cost) {
    showToast('El precio de venta debe ser mayor que el costo del proveedor', 'warning');
    return;
  }
  if (!categoryId) {
    showToast('Selecciona una categoría de Stocki', 'warning');
    return;
  }

  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Importando…';
  try {
    await importDropiProduct({ dropiProductId: dropiProduct.id, price, categoryId, freeShipping });
    showToast(`«${dropiProduct.name}» importado a tu catálogo`, 'success');
    button.textContent = 'Importado';
  } catch (error) {
    console.error(error);
    showToast(error.message ?? 'No se pudo importar el producto', 'error');
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleDropiSync() {
  const button = qs('#dropi-sync-button');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Sincronizando…';
  try {
    const summary = (await syncMyDropiProducts()) ?? {};
    const { updated = 0, errors = 0, total = 0 } = summary;
    showToast(
      `Sincronización: ${updated} de ${total} productos actualizados, ${errors} con error`,
      errors > 0 ? 'warning' : 'success'
    );
  } catch (error) {
    console.error(error);
    showToast('No se pudo sincronizar con Dropi', 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

/* ============================ Pestaña: Mis ventas ============================ */

function saleRowHtml(sale) {
  const order = sale.order ?? {};
  const status = order.status ?? '';
  const city = order.shipping_address?.city;
  return `
    <tr>
      <td>${escapeHtml(formatDate(order.created_at))}</td>
      <td>${escapeHtml(sale.title)}</td>
      <td>${escapeHtml(String(sale.quantity))}</td>
      <td>${formatPrice(sale.subtotal)}</td>
      <td><span class="badge badge--${escapeHtml(status || 'neutral')}">${escapeHtml(status ? formatOrderStatus(status) : 'Sin estado')}</span></td>
      <td>${city ? escapeHtml(city) : '—'}</td>
    </tr>`;
}

async function loadSales() {
  const summary = qs('#sales-summary');
  const container = qs('#sales-table-container');
  summary.innerHTML = '';
  setLoading(container);
  try {
    const sales = await fetchMySales();
    if (sales.length === 0) {
      renderEmptyState(container, {
        title: 'Aún no tienes ventas',
        text: 'Cuando un comprador pague uno de tus productos, aparecerá aquí.',
      });
      return;
    }
    const totalSold = sales
      .filter((sale) => SOLD_STATUSES.includes(sale.order?.status))
      .reduce((sum, sale) => sum + (Number(sale.subtotal) || 0), 0);
    summary.innerHTML = `
      <div class="card seller-total">
        <p class="seller-total__label">Total vendido (órdenes pagadas, enviadas o entregadas)</p>
        <p class="seller-total__amount">${formatPrice(totalSold)}</p>
      </div>`;
    container.innerHTML = `
      <div class="table-wrap seller-table-card">
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Estado</th>
              <th scope="col">Ciudad de envío</th>
            </tr>
          </thead>
          <tbody>${sales.map(saleRowHtml).join('')}</tbody>
        </table>
      </div>`;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar tus ventas',
      text: 'Verifica tu conexión e intenta de nuevo.',
    });
    showToast('Error al cargar tus ventas', 'error');
  }
}

/* ============================ Pestañas y arranque ============================ */

function currentTab() {
  const hash = window.location.hash.replace('#', '');
  return TAB_NAMES.includes(hash) ? hash : 'productos';
}

function activateTab(name) {
  qsa('.tabs__tab').forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle('tabs__tab--active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  TAB_NAMES.forEach((tabName) => {
    const panel = qs(`#panel-${tabName}`);
    if (panel) panel.hidden = tabName !== name;
  });

  if (name === 'productos') loadProducts();
  else if (name === 'ventas') loadSales();
  else if (name === 'dropi' && !dropiState.loaded) {
    // El catálogo Dropi solo se carga la primera vez para no perder los
    // precios/categorías que el vendedor ya haya escrito en las tarjetas
    dropiState.loaded = true;
    loadDropiCatalog();
  }
}

async function init() {
  initLayout();

  let profile = null;
  try {
    profile = await requireAuth({ roles: ['seller', 'admin'] });
  } catch (error) {
    console.error(error);
    showToast('No se pudo verificar tu sesión', 'error');
    return;
  }
  if (!profile) return;

  try {
    categories = await fetchCategories();
  } catch (error) {
    console.error(error);
    showToast('No se pudieron cargar las categorías', 'warning');
  }

  qsa('.tabs__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      window.location.hash = tab.dataset.tab;
    });
  });
  window.addEventListener('hashchange', () => activateTab(currentTab()));

  qs('#new-product-button').addEventListener('click', () => openProductModal(null));
  qs('#products-table-container').addEventListener('click', handleProductAction);

  qs('#dropi-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    dropiState.search = qs('#dropi-search-input').value.trim();
    dropiState.page = 1;
    dropiState.loaded = true;
    loadDropiCatalog();
  });
  qs('#dropi-sync-button').addEventListener('click', handleDropiSync);
  qs('#dropi-results').addEventListener('click', handleDropiImport);
  qs('#dropi-pagination').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-move]');
    if (!button) return;
    const nextPage = dropiState.page + Number(button.dataset.move);
    if (nextPage < 1 || nextPage > dropiState.totalPages) return;
    dropiState.page = nextPage;
    loadDropiCatalog();
  });

  activateTab(currentTab());
}

init();
