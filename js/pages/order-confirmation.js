// Archivo: /js/pages/order-confirmation.js
// Página de retorno tras el pago. La ÚNICA fuente de verdad del estado es
// orders.status, que escribe el webhook de la pasarela: los parámetros extra
// que Bold/MercadoPago agregan a la URL (status, bold-tx-status…) se ignoran
// a propósito porque cualquiera puede manipularlos.
import { initLayout, requireAuth } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { fetchOrderById } from '../api/orders.js';
import { startPayment, fetchPaymentsByOrder, GATEWAYS } from '../api/payments.js';
import { formatPrice, formatDate, formatOrderStatus } from '../utils/format.js';
import { qs, escapeHtml, getQueryParam, setLoading, renderEmptyState } from '../utils/dom.js';

const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 8;

let orderId = null;
let pollAttempts = 0;
let pollTimer = null;

function getContainer() {
  return qs('#confirmation-container');
}

function shortId(id) {
  return `#${String(id).slice(0, 8)}`;
}

function renderNotFound() {
  renderEmptyState(getContainer(), {
    title: 'No encontramos esta orden',
    text: 'El enlace puede ser incorrecto o la orden pertenece a otra cuenta.',
    actionHtml: '<a class="btn btn--primary" href="./account.html#compras">Ir a mis compras</a>',
  });
}

function itemsHtml(order) {
  const items = order.order_items ?? [];
  return `
    <section class="confirmation__section" aria-label="Resumen de la orden">
      <h3 class="confirmation__section-title">Resumen</h3>
      <ul class="confirmation__items">
        ${items
          .map(
            (item) => `
              <li class="confirmation__item">
                <span class="confirmation__item-title">${escapeHtml(item.title)}
                  <span class="confirmation__item-qty">× ${item.quantity}</span>
                </span>
                <span class="confirmation__item-subtotal">${formatPrice(item.subtotal)}</span>
              </li>`
          )
          .join('')}
      </ul>
      <p class="confirmation__total"><span>Total</span><span>${formatPrice(order.total)}</span></p>
    </section>`;
}

function addressHtml(order) {
  const address = order.shipping_address ?? {};
  const lines = [
    address.full_name,
    address.phone,
    address.address,
    [address.city, address.department].filter(Boolean).join(', '),
    address.notes ? `Notas: ${address.notes}` : '',
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `
    <section class="confirmation__section" aria-label="Datos de envío">
      <h3 class="confirmation__section-title">Datos de envío</h3>
      ${lines.map((line) => `<p class="confirmation__address-line">${escapeHtml(line)}</p>`).join('')}
    </section>`;
}

// pagada / enviada / entregada: el pago ya fue confirmado por el webhook
function renderSuccess(order) {
  getContainer().innerHTML = `
    <section class="card confirmation confirmation--success">
      <div class="confirmation__icon confirmation__icon--success" aria-hidden="true">✓</div>
      <h2 class="confirmation__title">¡Pago confirmado!</h2>
      <p class="confirmation__meta">
        Orden ${escapeHtml(shortId(order.id))} · ${escapeHtml(formatDate(order.created_at))} ·
        <span class="badge badge--${escapeHtml(order.status)}">${escapeHtml(formatOrderStatus(order.status))}</span>
      </p>
      ${itemsHtml(order)}
      ${addressHtml(order)}
      <div class="confirmation__actions">
        <a class="btn btn--primary" href="./account.html#compras">Ver mis compras</a>
        <a class="btn btn--secondary" href="./search.html">Seguir comprando</a>
      </div>
    </section>`;
}

function renderCancelled(order) {
  getContainer().innerHTML = `
    <section class="card confirmation confirmation--error">
      <div class="confirmation__icon confirmation__icon--error" aria-hidden="true">✕</div>
      <h2 class="confirmation__title">El pago no se completó</h2>
      <p class="confirmation__text">
        La orden ${escapeHtml(shortId(order.id))} quedó cancelada. Puedes revisar el detalle
        o intentar la compra de nuevo desde «Mis compras».
      </p>
      <div class="confirmation__actions">
        <a class="btn btn--primary" href="./account.html#compras">Ir a mis compras</a>
        <a class="btn btn--secondary" href="./cart.html">Volver al carrito</a>
      </div>
    </section>`;
}

async function handleManualRefresh(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Consultando…';
  await loadOrder();
}

// Controles para reintentar el pago de una orden aún 'pendiente'. La Edge
// Function payments-create es idempotente, por lo que reintentar es seguro.
function retryHtml(order) {
  // Si la orden no tiene pasarela guardada se ofrece elegirla aquí mismo
  const gatewayPickerHtml = order.payment_gateway
    ? ''
    : `
      <div class="confirmation__gateway">
        <label class="form-field__label" for="retry-gateway">Pasarela de pago</label>
        <select class="form-field__select confirmation__gateway-select" id="retry-gateway">
          <option value="${escapeHtml(GATEWAYS.BOLD)}">Bold</option>
          <option value="${escapeHtml(GATEWAYS.MERCADOPAGO)}">MercadoPago</option>
        </select>
      </div>`;
  return `
    <div class="confirmation__retry" id="retry-controls">
      <p class="confirmation__retry-hint">Si no completaste el pago, puedes intentarlo de nuevo.</p>
      ${gatewayPickerHtml}
      <button class="btn btn--primary" type="button" id="retry-payment-button">Reintentar pago</button>
    </div>
    <section class="confirmation__bold" id="bold-embed" hidden aria-label="Pago con Bold">
      <h3 class="confirmation__section-title">Finaliza tu pago con Bold</h3>
      <p class="confirmation__text">
        Usa el botón seguro de Bold para completar tu pago. Al terminar volverás
        a esta página para ver la confirmación.
      </p>
      <div class="confirmation__bold-button" id="bold-button-container"></div>
    </section>`;
}

function renderBoldButton({ orderReference, amount, currency, apiKey, integritySignature, redirectionUrl }) {
  const section = qs('#bold-embed');
  const slot = qs('#bold-button-container');
  // Se ocultan los controles de reintento: el pago continúa en el botón de Bold
  qs('#retry-controls').hidden = true;
  section.hidden = false;

  // El botón embebido de Bold se inyecta como <script> con data-attributes.
  // TODO: verificar atributos exactos con la documentación oficial de Bold.
  const script = document.createElement('script');
  script.src = 'https://checkout.bold.co/library/boldPaymentButton.js';
  script.setAttribute('data-bold-button', 'dark-L');
  script.setAttribute('data-order-id', String(orderReference));
  script.setAttribute('data-currency', String(currency));
  script.setAttribute('data-amount', String(amount));
  script.setAttribute('data-api-key', String(apiKey));
  script.setAttribute('data-integrity-signature', String(integritySignature));
  script.setAttribute('data-redirection-url', String(redirectionUrl));
  slot.innerHTML = '';
  slot.appendChild(script);
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function initRetryPayment(order) {
  const button = qs('#retry-payment-button');
  if (!button) return;
  button.addEventListener('click', async () => {
    // Se detiene el polling: un re-render pisaría el botón embebido de Bold
    clearTimeout(pollTimer);
    button.disabled = true;
    button.textContent = 'Procesando…';
    try {
      const gateway = order.payment_gateway ?? qs('#retry-gateway').value;
      const payment = await startPayment(order.id, gateway);
      if (gateway === GATEWAYS.MERCADOPAGO && payment?.mercadopago?.initPoint) {
        window.location.href = payment.mercadopago.initPoint;
        return;
      }
      if (gateway === GATEWAYS.BOLD && payment?.bold) {
        renderBoldButton(payment.bold);
        return;
      }
      throw new Error('Respuesta de la pasarela no reconocida');
    } catch (error) {
      console.error(error);
      showToast(error.message ?? 'No pudimos iniciar el pago', 'error');
      button.disabled = false;
      button.textContent = 'Reintentar pago';
    }
  });
}

// La orden sigue 'pendiente' pero el intento de pago más reciente fue
// rechazado: sin este estado el comprador vería el spinner para siempre.
function renderRejected(order) {
  getContainer().innerHTML = `
    <section class="card confirmation confirmation--error">
      <div class="confirmation__icon confirmation__icon--error" aria-hidden="true">✕</div>
      <h2 class="confirmation__title">El pago fue rechazado</h2>
      <p class="confirmation__text">
        La pasarela rechazó el pago de la orden ${escapeHtml(shortId(order.id))}.
        Puedes reintentar el pago o probar con otro medio.
      </p>
      ${retryHtml(order)}
      <div class="confirmation__actions">
        <a class="btn btn--ghost" href="./account.html#compras">Ver mis compras</a>
      </div>
    </section>`;
  initRetryPayment(order);
}

function renderPending(order) {
  const exhausted = pollAttempts >= MAX_POLL_ATTEMPTS;
  getContainer().innerHTML = `
    <section class="card confirmation confirmation--pending">
      ${exhausted
        ? ''
        : `<div class="loader" role="status" aria-live="polite">
             <div class="loader__spinner"></div>
             <span class="visually-hidden">Verificando el pago…</span>
           </div>`}
      <h2 class="confirmation__title">Estamos confirmando tu pago…</h2>
      <p class="confirmation__text">${
        exhausted
          ? 'La confirmación está tardando más de lo normal. Actualiza el estado o revísalo más tarde en «Mis compras».'
          : 'Esto puede tardar unos segundos. No cierres esta página.'
      }</p>
      ${exhausted ? '<button class="btn btn--primary" type="button" id="refresh-button">Actualizar estado</button>' : ''}
      ${order ? retryHtml(order) : ''}
      <div class="confirmation__actions">
        <a class="btn btn--ghost" href="./account.html#compras">Ver mis compras</a>
      </div>
    </section>`;

  if (order) initRetryPayment(order);
  if (exhausted) {
    qs('#refresh-button').addEventListener('click', handleManualRefresh);
  } else {
    // Re-consulta automática: el webhook suele confirmar en pocos segundos
    pollTimer = setTimeout(() => {
      pollAttempts += 1;
      loadOrder();
    }, POLL_INTERVAL_MS);
  }
}

async function loadOrder() {
  clearTimeout(pollTimer);
  try {
    const order = await fetchOrderById(orderId);
    if (!order) {
      // RLS devuelve null tanto para órdenes inexistentes como ajenas
      renderNotFound();
      return;
    }
    if (order.status === 'pendiente') {
      // El webhook no cambia la orden cuando la pasarela rechaza el pago: el
      // rechazo solo queda registrado en el intento más reciente de payments
      const payments = await fetchPaymentsByOrder(order.id);
      if (payments?.[0]?.status === 'rechazado') {
        renderRejected(order);
      } else {
        renderPending(order);
      }
    } else if (order.status === 'cancelada') {
      renderCancelled(order);
    } else {
      renderSuccess(order);
    }
  } catch (error) {
    console.error(error);
    // 22P02: el ?order= de la URL no tiene formato uuid; equivale a "no existe"
    if (error?.code === '22P02') {
      renderNotFound();
      return;
    }
    showToast('No pudimos consultar el estado de la orden', 'error');
    // Ante un error de red se pasa directo al modo de reintento manual
    pollAttempts = MAX_POLL_ATTEMPTS;
    renderPending();
  }
}

async function init() {
  setLoading(getContainer());
  try {
    const profile = await requireAuth();
    if (!profile) return;
    orderId = getQueryParam('order');
    if (!orderId) {
      renderNotFound();
      return;
    }
    await loadOrder();
  } catch (error) {
    console.error(error);
    showToast('No pudimos cargar la página', 'error');
    renderNotFound();
  }
}

initLayout();
init();
