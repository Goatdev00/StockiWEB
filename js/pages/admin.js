// Archivo: /js/pages/admin.js
// Controlador del panel de administración: cuatro pestañas (usuarios,
// categorías, productos y órdenes) sincronizadas con el hash de la URL.
// Toda la data pasa por js/api/admin.js; RLS es quien autoriza de verdad.
import { initLayout, requireAuth } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { openModal, confirmModal } from '../ui/modal.js';
import { qs, qsa, escapeHtml, setLoading, renderEmptyState } from '../utils/dom.js';
import { formatPrice, formatDate, formatOrderStatus } from '../utils/format.js';
import { fetchCategories } from '../api/categories.js';
import {
  fetchAllProfiles,
  setUserRole,
  createCategory,
  updateCategory,
  deleteCategory,
  fetchAllProducts,
  setProductActive,
  fetchAllOrders,
  updateOrderStatus,
} from '../api/admin.js';

const TAB_NAMES = ['usuarios', 'categorias', 'productos', 'ordenes'];

const ROLE_LABELS = {
  buyer: 'Comprador',
  seller: 'Vendedor',
  admin: 'Administrador',
};

const ROLE_IMPACT = {
  buyer: 'Solo podrá comprar y perderá el acceso a los paneles de venta.',
  seller: 'Podrá publicar productos y gestionar sus propias ventas.',
  admin: 'Tendrá control total del marketplace: usuarios, productos y órdenes.',
};

const GATEWAY_LABELS = {
  bold: 'Bold',
  mercadopago: 'MercadoPago',
};

// Estados que cuentan como venta confirmada para el resumen
const CONFIRMED_ORDER_STATUSES = ['pagada', 'enviada', 'entregada'];

// Etiquetas amigables para las claves más comunes de shipping_address (jsonb)
const ADDRESS_LABELS = {
  full_name: 'Nombre',
  name: 'Nombre',
  phone: 'Teléfono',
  address: 'Dirección',
  address_line: 'Dirección',
  address_detail: 'Detalle',
  detail: 'Detalle',
  city: 'Ciudad',
  department: 'Departamento',
  state: 'Departamento',
  postal_code: 'Código postal',
  zip: 'Código postal',
  country: 'País',
  notes: 'Notas',
};

const state = {
  profile: null,
  profiles: [],
  categories: [],
  products: [],
  orders: [],
  productFilter: '',
  orderFilter: '',
};

// ---------------------------------------------------------------------------
// Pestañas sincronizadas con el hash
// ---------------------------------------------------------------------------

function currentTabFromHash() {
  const name = window.location.hash.replace('#', '');
  return TAB_NAMES.includes(name) ? name : 'usuarios';
}

function activateTab(name) {
  qsa('.tabs__tab').forEach((tab) => {
    const isActive = tab.dataset.tab === name;
    tab.classList.toggle('tabs__tab--active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  TAB_NAMES.forEach((panelName) => {
    const panel = qs(`#panel-${panelName}`);
    if (panel) panel.hidden = panelName !== name;
  });
}

function setupTabs() {
  qsa('.tabs__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      window.location.hash = tab.dataset.tab;
    });
  });
  window.addEventListener('hashchange', () => activateTab(currentTabFromHash()));
  activateTab(currentTabFromHash());
}

// ---------------------------------------------------------------------------
// Resumen superior
// ---------------------------------------------------------------------------

function renderSummary() {
  qs('#summary-users').textContent = String(state.profiles.length);
  qs('#summary-products').textContent = String(state.products.length);
  qs('#summary-orders').textContent = String(state.orders.length);
  const confirmedTotal = state.orders
    .filter((order) => CONFIRMED_ORDER_STATUSES.includes(order.status))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  qs('#summary-sales').textContent = formatPrice(confirmedTotal);
}

// ---------------------------------------------------------------------------
// Pestaña USUARIOS
// ---------------------------------------------------------------------------

function renderUsersTable() {
  const container = qs('#users-table');
  if (state.profiles.length === 0) {
    renderEmptyState(container, {
      title: 'Aún no hay usuarios registrados',
      text: 'Cuando alguien cree su cuenta en Stocki aparecerá en esta lista.',
    });
    return;
  }
  const rows = state.profiles
    .map((user) => {
      const isSelf = user.id === state.profile.id;
      const name = user.full_name?.trim() || 'Sin nombre';
      const options = Object.keys(ROLE_LABELS)
        .map((role) => `<option value="${role}"${role === user.role ? ' selected' : ''}>${ROLE_LABELS[role]}</option>`)
        .join('');
      return `
        <tr>
          <td>${escapeHtml(name)}${isSelf ? ' <span class="badge badge--neutral">Tú</span>' : ''}</td>
          <td>${escapeHtml(user.phone?.trim() || '—')}</td>
          <td>
            <label class="visually-hidden" for="role-${escapeHtml(user.id)}">Rol de ${escapeHtml(name)}</label>
            <select class="form-field__select admin-inline-select" id="role-${escapeHtml(user.id)}"
                    data-role-user="${escapeHtml(user.id)}" data-current-role="${escapeHtml(user.role)}">
              ${options}
            </select>
          </td>
          <td>${escapeHtml(formatDate(user.created_at))}</td>
        </tr>`;
    })
    .join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th scope="col">Nombre</th><th scope="col">Teléfono</th><th scope="col">Rol</th><th scope="col">Registro</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function onUserRoleChange(select) {
  const userId = select.dataset.roleUser;
  const newRole = select.value;
  const currentRole = select.dataset.currentRole;
  if (newRole === currentRole) return;

  // Un admin no puede quitarse su propio rol: se quedaría fuera del panel
  if (userId === state.profile.id && newRole !== 'admin') {
    select.value = currentRole;
    showToast('No puedes quitarte tu propio rol de administrador', 'warning');
    return;
  }

  const user = state.profiles.find((profileRow) => profileRow.id === userId);
  const name = user?.full_name?.trim() || 'este usuario';
  const confirmed = await confirmModal({
    title: 'Cambiar rol de usuario',
    message: `¿Cambiar el rol de <strong>${escapeHtml(name)}</strong> a <strong>${ROLE_LABELS[newRole]}</strong>? ${ROLE_IMPACT[newRole]}`,
    confirmLabel: 'Cambiar rol',
  });
  if (!confirmed) {
    select.value = currentRole;
    return;
  }

  select.disabled = true;
  try {
    await setUserRole(userId, newRole);
    select.dataset.currentRole = newRole;
    if (user) user.role = newRole;
    showToast(`Rol actualizado a ${ROLE_LABELS[newRole]}`, 'success');
  } catch (error) {
    console.error(error);
    select.value = currentRole;
    showToast('No se pudo actualizar el rol', 'error');
  } finally {
    select.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Pestaña CATEGORÍAS
// ---------------------------------------------------------------------------

function renderCategoriesTable() {
  const container = qs('#categories-table');
  if (state.categories.length === 0) {
    renderEmptyState(container, {
      title: 'No hay categorías creadas',
      text: 'Crea la primera con el botón «Nueva categoría».',
    });
    return;
  }
  const rows = state.categories
    .map(
      (category) => `
        <tr>
          <td>${escapeHtml(category.name)}</td>
          <td><code class="admin-slug">${escapeHtml(category.slug)}</code></td>
          <td>
            <div class="admin-actions">
              <button class="btn btn--secondary btn--small" type="button"
                      data-action="edit-category" data-id="${escapeHtml(category.id)}">Editar</button>
              <button class="btn btn--danger btn--small" type="button"
                      data-action="delete-category" data-id="${escapeHtml(category.id)}">Eliminar</button>
            </div>
          </td>
        </tr>`
    )
    .join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th scope="col">Nombre</th><th scope="col">Slug</th><th scope="col">Acciones</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Minúsculas, sin tildes, espacios a guiones: mismo criterio que las semillas
function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function openCategoryModal(category = null) {
  const isEdit = Boolean(category);
  const { element, close } = openModal({
    title: isEdit ? 'Editar categoría' : 'Nueva categoría',
    contentHtml: `
      <form class="form" id="category-form">
        <div class="form-field">
          <label class="form-field__label" for="category-name">Nombre</label>
          <input class="form-field__input" id="category-name" name="name" type="text"
                 required maxlength="60" value="${escapeHtml(category?.name ?? '')}" />
        </div>
        <div class="form-field">
          <label class="form-field__label" for="category-slug">Slug</label>
          <input class="form-field__input" id="category-slug" name="slug" type="text"
                 required maxlength="60" pattern="[a-z0-9]+(-[a-z0-9]+)*"
                 value="${escapeHtml(category?.slug ?? '')}" />
          <p class="form-field__hint">Se usa en la URL. Se genera solo desde el nombre, pero puedes editarlo.</p>
        </div>
        <div class="admin-modal-actions">
          <button class="btn btn--secondary" type="button" data-action="cancel">Cancelar</button>
          <button class="btn btn--primary" type="submit">${isEdit ? 'Guardar cambios' : 'Crear categoría'}</button>
        </div>
      </form>`,
  });

  const form = qs('#category-form', element);
  const nameInput = qs('#category-name', element);
  const slugInput = qs('#category-slug', element);

  // El slug se autogenera hasta que el usuario lo edite a mano
  let slugTouched = isEdit;
  nameInput.addEventListener('input', () => {
    if (!slugTouched) slugInput.value = slugify(nameInput.value);
  });
  slugInput.addEventListener('input', () => {
    slugTouched = slugInput.value.trim() !== '';
  });

  qs('[data-action="cancel"]', element).addEventListener('click', close);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const slug = slugify(slugInput.value.trim() || name);
    if (!name || !slug) {
      showToast('El nombre y el slug son obligatorios', 'warning');
      return;
    }
    const submitButton = qs('[type="submit"]', form);
    submitButton.disabled = true;
    try {
      if (isEdit) {
        await updateCategory(category.id, { name, slug });
      } else {
        await createCategory({ name, slug });
      }
      showToast(isEdit ? 'Categoría actualizada' : 'Categoría creada', 'success');
      close();
      await loadCategoriesData();
    } catch (error) {
      console.error(error);
      // 23505: violación de unicidad del slug en Postgres
      const message = error?.code === '23505'
        ? 'Ya existe una categoría con ese slug'
        : 'No se pudo guardar la categoría';
      showToast(message, 'error');
      submitButton.disabled = false;
    }
  });

  nameInput.focus();
}

async function onDeleteCategory(category) {
  const confirmed = await confirmModal({
    title: 'Eliminar categoría',
    message: `¿Eliminar la categoría <strong>${escapeHtml(category.name)}</strong>? Los productos asociados quedarán sin categoría (no se eliminan).`,
    confirmLabel: 'Eliminar',
  });
  if (!confirmed) return;
  try {
    await deleteCategory(category.id);
    showToast('Categoría eliminada', 'success');
    await loadCategoriesData();
  } catch (error) {
    console.error(error);
    showToast('No se pudo eliminar la categoría', 'error');
  }
}

// ---------------------------------------------------------------------------
// Pestaña PRODUCTOS
// ---------------------------------------------------------------------------

function renderProductsTable() {
  const container = qs('#products-table');
  const filter = state.productFilter.trim().toLowerCase();
  const products = state.products.filter((product) => {
    if (!filter) return true;
    const sellerName = product.seller?.full_name ?? 'Stocki';
    return `${product.title} ${sellerName}`.toLowerCase().includes(filter);
  });

  if (products.length === 0) {
    renderEmptyState(container, {
      title: filter ? 'Sin resultados' : 'No hay productos publicados',
      text: filter
        ? 'Ningún producto coincide con el filtro escrito.'
        : 'Cuando un vendedor publique productos aparecerán aquí.',
    });
    return;
  }

  const rows = products
    .map((product) => {
      const sellerName = product.seller?.full_name ?? 'Stocki';
      const sourceBadge = product.source === 'dropi'
        ? '<span class="badge badge--enviada">Dropi</span>'
        : '<span class="badge badge--neutral">Manual</span>';
      const stateBadge = product.active
        ? '<span class="badge badge--pagada">Activo</span>'
        : '<span class="badge badge--pendiente">Pausado</span>';
      const toggleButton = product.active
        ? `<button class="btn btn--secondary btn--small" type="button" data-action="toggle-active" data-id="${escapeHtml(product.id)}">Pausar</button>`
        : `<button class="btn btn--primary btn--small" type="button" data-action="toggle-active" data-id="${escapeHtml(product.id)}">Activar</button>`;
      return `
        <tr>
          <td class="admin-product-title">${escapeHtml(product.title)}</td>
          <td>${escapeHtml(sellerName)}</td>
          <td class="admin-nowrap">${escapeHtml(formatPrice(product.price))}</td>
          <td>${Number(product.stock) || 0}</td>
          <td>${sourceBadge}</td>
          <td>${stateBadge}</td>
          <td>${toggleButton}</td>
        </tr>`;
    })
    .join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Título</th><th scope="col">Vendedor</th><th scope="col">Precio</th>
            <th scope="col">Stock</th><th scope="col">Origen</th><th scope="col">Estado</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function onToggleProductActive(button) {
  const product = state.products.find((item) => item.id === button.dataset.id);
  if (!product) return;
  button.disabled = true;
  try {
    await setProductActive(product.id, !product.active);
    product.active = !product.active;
    showToast(product.active ? 'Producto activado' : 'Producto pausado', 'success');
    renderProductsTable();
  } catch (error) {
    console.error(error);
    showToast('No se pudo cambiar el estado del producto', 'error');
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Pestaña ÓRDENES
// ---------------------------------------------------------------------------

function renderOrdersTable() {
  const container = qs('#orders-table');
  const filter = state.orderFilter;
  const orders = filter
    ? state.orders.filter((order) => order.status === filter)
    : state.orders;

  if (orders.length === 0) {
    renderEmptyState(container, {
      title: filter ? 'Sin órdenes en este estado' : 'Aún no hay órdenes',
      text: filter
        ? 'Cambia el filtro para ver órdenes en otros estados.'
        : 'Cuando un comprador cree una orden aparecerá aquí.',
    });
    return;
  }

  const rows = orders
    .map((order) => {
      const buyerName = order.buyer?.full_name?.trim() || '—';
      return `
        <tr>
          <td class="admin-nowrap">${escapeHtml(formatDate(order.created_at))}</td>
          <td>${escapeHtml(buyerName)}</td>
          <td class="admin-nowrap">${escapeHtml(formatPrice(order.total))}</td>
          <td>${escapeHtml(GATEWAY_LABELS[order.payment_gateway] ?? '—')}</td>
          <td><span class="badge badge--${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span></td>
          <td>
            <label class="visually-hidden" for="status-${escapeHtml(order.id)}">Cambiar estado de la orden de ${escapeHtml(buyerName)}</label>
            <select class="form-field__select admin-inline-select" id="status-${escapeHtml(order.id)}"
                    data-order-status="${escapeHtml(order.id)}">
              <option value="" selected>Cambiar a…</option>
              <option value="enviada">Enviada</option>
              <option value="entregada">Entregada</option>
              <option value="cancelada">Cancelada</option>
            </select>
          </td>
          <td>
            <button class="btn btn--ghost btn--small" type="button"
                    data-action="view-order" data-id="${escapeHtml(order.id)}">Ver detalle</button>
          </td>
        </tr>`;
    })
    .join('');
  container.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th scope="col">Fecha</th><th scope="col">Comprador</th><th scope="col">Total</th>
            <th scope="col">Pasarela</th><th scope="col">Estado</th><th scope="col">Cambiar estado</th>
            <th scope="col">Detalle</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function shippingAddressHtml(address) {
  if (!address || typeof address !== 'object' || Object.keys(address).length === 0) {
    return '<p class="admin-order-detail__empty">Sin dirección registrada.</p>';
  }
  const rows = Object.entries(address)
    .filter(([, value]) => value !== null && value !== '' && typeof value !== 'object')
    .map(
      ([key, value]) => `
        <li class="admin-rows__row">
          <span class="admin-rows__label">${escapeHtml(ADDRESS_LABELS[key] ?? key)}</span>
          <span class="admin-rows__value">${escapeHtml(String(value))}</span>
        </li>`
    )
    .join('');
  if (!rows) return '<p class="admin-order-detail__empty">Sin dirección registrada.</p>';
  return `<ul class="admin-rows">${rows}</ul>`;
}

function openOrderDetailModal(order) {
  const buyerName = order.buyer?.full_name?.trim() || '—';
  const items = order.order_items ?? [];
  const itemsHtml = items.length
    ? items
        .map(
          (item) => `
            <li class="admin-rows__row">
              <span>${escapeHtml(item.title)} × ${Number(item.quantity) || 0}</span>
              <span class="admin-rows__strong">${escapeHtml(formatPrice(item.subtotal))}</span>
            </li>`
        )
        .join('')
    : '<li class="admin-rows__row"><span>Sin ítems registrados.</span></li>';

  openModal({
    title: 'Detalle de la orden',
    contentHtml: `
      <div class="admin-order-detail">
        <ul class="admin-rows">
          <li class="admin-rows__row">
            <span class="admin-rows__label">Fecha</span>
            <span class="admin-rows__value">${escapeHtml(formatDate(order.created_at))}</span>
          </li>
          <li class="admin-rows__row">
            <span class="admin-rows__label">Comprador</span>
            <span class="admin-rows__value">${escapeHtml(buyerName)}</span>
          </li>
          <li class="admin-rows__row">
            <span class="admin-rows__label">Pasarela</span>
            <span class="admin-rows__value">${escapeHtml(GATEWAY_LABELS[order.payment_gateway] ?? '—')}</span>
          </li>
          <li class="admin-rows__row">
            <span class="admin-rows__label">Estado</span>
            <span class="admin-rows__value">
              <span class="badge badge--${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
            </span>
          </li>
        </ul>
        <h3 class="admin-order-detail__subtitle">Productos</h3>
        <ul class="admin-rows">${itemsHtml}</ul>
        <p class="admin-order-detail__total">Total: <strong>${escapeHtml(formatPrice(order.total))}</strong></p>
        <h3 class="admin-order-detail__subtitle">Dirección de envío</h3>
        ${shippingAddressHtml(order.shipping_address)}
      </div>`,
  });
}

async function onOrderStatusChange(select) {
  const orderId = select.dataset.orderStatus;
  const newStatus = select.value;
  if (!newStatus) return;

  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  if (order.status === newStatus) {
    select.value = '';
    showToast('La orden ya está en ese estado', 'warning');
    return;
  }

  // Una orden pendiente no tiene pago confirmado: la base de datos rechazaría
  // el cambio, pero el panel debe avisarlo claro antes de intentarlo
  if (order.status === 'pendiente' && ['enviada', 'entregada'].includes(newStatus)) {
    select.value = '';
    showToast('La orden sigue pendiente de pago: no puede marcarse como enviada ni entregada', 'warning');
    return;
  }

  const buyerName = order.buyer?.full_name?.trim() || 'el comprador';
  const confirmed = await confirmModal({
    title: 'Cambiar estado de la orden',
    message: `¿Marcar la orden de <strong>${escapeHtml(buyerName)}</strong> (${escapeHtml(formatDate(order.created_at))}) como <strong>${escapeHtml(formatOrderStatus(newStatus))}</strong>?`,
    confirmLabel: 'Cambiar estado',
  });
  if (!confirmed) {
    select.value = '';
    return;
  }

  select.disabled = true;
  try {
    await updateOrderStatus(orderId, newStatus);
    order.status = newStatus;
    showToast(`Orden marcada como ${formatOrderStatus(newStatus).toLowerCase()}`, 'success');
    renderOrdersTable();
    // Una cancelación puede sacar la orden de las ventas confirmadas
    renderSummary();
  } catch (error) {
    console.error(error);
    select.disabled = false;
    select.value = '';
    showToast('No se pudo actualizar el estado de la orden', 'error');
  }
}

// ---------------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------------

async function loadUsersData() {
  const container = qs('#users-table');
  setLoading(container);
  try {
    state.profiles = await fetchAllProfiles();
    renderUsersTable();
    return true;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar los usuarios',
      text: 'Recarga la página o revisa tu conexión.',
    });
    return false;
  }
}

async function loadCategoriesData() {
  const container = qs('#categories-table');
  setLoading(container);
  try {
    state.categories = await fetchCategories();
    renderCategoriesTable();
    return true;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar las categorías',
      text: 'Recarga la página o revisa tu conexión.',
    });
    return false;
  }
}

async function loadProductsData() {
  const container = qs('#products-table');
  setLoading(container);
  try {
    state.products = await fetchAllProducts();
    renderProductsTable();
    return true;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar los productos',
      text: 'Recarga la página o revisa tu conexión.',
    });
    return false;
  }
}

async function loadOrdersData() {
  const container = qs('#orders-table');
  setLoading(container);
  try {
    state.orders = await fetchAllOrders();
    renderOrdersTable();
    return true;
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar las órdenes',
      text: 'Recarga la página o revisa tu conexión.',
    });
    return false;
  }
}

async function loadAllData() {
  const results = await Promise.all([
    loadUsersData(),
    loadCategoriesData(),
    loadProductsData(),
    loadOrdersData(),
  ]);
  renderSummary();
  if (results.some((ok) => !ok)) {
    showToast('Algunos datos no se pudieron cargar', 'error');
  }
}

// ---------------------------------------------------------------------------
// Eventos delegados (las tablas se re-renderizan con frecuencia)
// ---------------------------------------------------------------------------

function bindEvents() {
  qs('#users-table').addEventListener('change', (event) => {
    const select = event.target.closest('[data-role-user]');
    if (select) onUserRoleChange(select);
  });

  qs('#new-category-button').addEventListener('click', () => openCategoryModal());

  qs('#categories-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const category = state.categories.find((item) => item.id === button.dataset.id);
    if (!category) return;
    if (button.dataset.action === 'edit-category') openCategoryModal(category);
    if (button.dataset.action === 'delete-category') onDeleteCategory(category);
  });

  qs('#products-filter').addEventListener('input', (event) => {
    state.productFilter = event.target.value;
    renderProductsTable();
  });

  qs('#products-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="toggle-active"]');
    if (button) onToggleProductActive(button);
  });

  qs('#orders-filter').addEventListener('change', (event) => {
    state.orderFilter = event.target.value;
    renderOrdersTable();
  });

  qs('#orders-table').addEventListener('change', (event) => {
    const select = event.target.closest('[data-order-status]');
    if (select) onOrderStatusChange(select);
  });

  qs('#orders-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="view-order"]');
    if (!button) return;
    const order = state.orders.find((item) => item.id === button.dataset.id);
    if (order) openOrderDetailModal(order);
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function init() {
  initLayout();
  let profile = null;
  try {
    profile = await requireAuth({ roles: ['admin'] });
  } catch (error) {
    console.error(error);
    showToast('No se pudo verificar tu sesión', 'error');
    return;
  }
  if (!profile) return;
  state.profile = profile;

  setupTabs();
  bindEvents();
  await loadAllData();
}

init();
