// Archivo: /js/pages/checkout.js
// Controlador del checkout: valida los datos de envío, crea la orden, limpia
// el carrito e inicia el pago. Si la pasarela falla, la orden ya existe y el
// comprador puede reintentar desde «Mis compras»; por eso el formulario se
// bloquea tras crearla para no generar órdenes duplicadas.
import { initLayout, requireAuth } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { getCartItems, clearCart } from '../api/cart.js';
import { fetchProductsByIds } from '../api/products.js';
import { createOrder } from '../api/orders.js';
import { startPayment, GATEWAYS } from '../api/payments.js';
import { formatPrice } from '../utils/format.js';
import { qs, qsa, escapeHtml, setLoading, renderEmptyState } from '../utils/dom.js';

const REQUIRED_FIELDS = [
  { id: 'full-name', key: 'full_name' },
  { id: 'phone', key: 'phone' },
  { id: 'address', key: 'address' },
  { id: 'city', key: 'city' },
  { id: 'department', key: 'department' },
];

let cartItems = [];
let submitting = false;

function renderGatewayOptions() {
  const options = [
    { value: GATEWAYS.BOLD, name: 'Bold', hint: 'Tarjetas, PSE, Nequi y más' },
    { value: GATEWAYS.MERCADOPAGO, name: 'MercadoPago', hint: 'Paga con tu cuenta o con tarjetas' },
  ];
  qs('#gateway-options').innerHTML = options
    .map(
      (option, index) => `
        <label class="gateway-option" for="gateway-${escapeHtml(option.value)}">
          <input class="gateway-option__radio" type="radio" name="gateway"
                 id="gateway-${escapeHtml(option.value)}" value="${escapeHtml(option.value)}"
                 ${index === 0 ? 'checked' : ''} />
          <span class="gateway-option__body">
            <span class="gateway-option__name">${escapeHtml(option.name)}</span>
            <span class="gateway-option__hint">${escapeHtml(option.hint)}</span>
          </span>
        </label>`
    )
    .join('');
}

function renderSummary(rows) {
  const total = rows.reduce((sum, row) => sum + row.product.price * row.item.quantity, 0);
  qs('#summary-container').innerHTML = `
    <ul class="checkout-summary__list">
      ${rows
        .map(
          (row) => `
            <li class="checkout-summary__item">
              <span class="checkout-summary__item-title">${escapeHtml(row.product.title)}
                <span class="checkout-summary__item-qty">× ${row.item.quantity}</span>
              </span>
              <span class="checkout-summary__item-subtotal">${formatPrice(row.product.price * row.item.quantity)}</span>
            </li>`
        )
        .join('')}
    </ul>
    <p class="checkout-summary__total"><span>Total</span><span>${formatPrice(total)}</span></p>`;
}

// Devuelve el objeto shipping_address o null si hay campos obligatorios vacíos
function readShippingForm() {
  let firstInvalid = null;
  const shippingAddress = {};
  for (const field of REQUIRED_FIELDS) {
    const input = qs(`#${field.id}`);
    const error = qs(`[data-error-for="${field.id}"]`);
    const value = input.value.trim();
    const valid = value.length > 0;
    if (error) {
      error.hidden = valid;
      error.textContent = valid ? '' : 'Este campo es obligatorio';
    }
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid && !firstInvalid) firstInvalid = input;
    shippingAddress[field.key] = value;
  }
  if (firstInvalid) {
    firstInvalid.focus();
    showToast('Completa los campos obligatorios de envío', 'warning');
    return null;
  }
  shippingAddress.notes = qs('#notes').value.trim();
  return shippingAddress;
}

function setSubmitting(active) {
  submitting = active;
  const button = qs('#confirm-button');
  button.disabled = active;
  button.textContent = active ? 'Procesando…' : 'Confirmar y pagar';
}

// Tras crear la orden el formulario deja de ser editable: la dirección ya
// quedó guardada en la orden y reenviar crearía una orden duplicada.
function lockForm() {
  qs('#confirm-button').hidden = true;
  qsa('#checkout-form input, #checkout-form textarea').forEach((element) => {
    element.disabled = true;
  });
}

function showPaymentRetry() {
  lockForm();
  const section = qs('#payment-retry');
  section.hidden = false;
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderBoldButton({ orderReference, amount, currency, apiKey, integritySignature, redirectionUrl }) {
  lockForm();
  const section = qs('#bold-embed');
  const slot = qs('#bold-button-container');
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

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting) return;

  const shippingAddress = readShippingForm();
  if (!shippingAddress) return;
  const gateway = qs('input[name="gateway"]:checked')?.value;
  if (!gateway) {
    showToast('Selecciona un método de pago', 'warning');
    return;
  }

  setSubmitting(true);

  let order = null;
  try {
    order = await createOrder({ items: cartItems, shippingAddress, gateway });
  } catch (error) {
    console.error(error);
    showToast(error.message ?? 'No se pudo crear la orden', 'error');
    setSubmitting(false);
    return;
  }

  try {
    // La orden ya existe: vaciar el carrito no debe bloquear el pago
    await clearCart();
  } catch (error) {
    console.error(error);
  }

  try {
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
    showPaymentRetry();
  }
}

async function init() {
  const loadingArea = qs('#checkout-loading');
  setLoading(loadingArea);
  try {
    const profile = await requireAuth();
    if (!profile) return;

    cartItems = getCartItems();
    if (cartItems.length === 0) {
      window.location.replace('./cart.html');
      return;
    }

    const products = await fetchProductsByIds(cartItems.map((item) => item.product_id));
    const productsById = new Map(products.map((product) => [product.id, product]));
    const rows = cartItems.map((item) => ({ item, product: productsById.get(item.product_id) }));
    const hasInvalidItems = rows.some((row) => !row.product || row.product.stock < row.item.quantity);
    if (hasInvalidItems) {
      // El carrito es la pantalla donde se resuelven faltantes y stock
      showToast('Algunos productos del carrito cambiaron; revísalo antes de continuar', 'warning');
      window.location.replace('./cart.html');
      return;
    }

    renderSummary(rows);
    renderGatewayOptions();

    // Prellenar el nombre desde el perfil ahorra un paso al comprador
    const nameInput = qs('#full-name');
    if (nameInput && !nameInput.value && profile.full_name) nameInput.value = profile.full_name;

    loadingArea.innerHTML = '';
    qs('#checkout-layout').hidden = false;
    qs('#checkout-form').addEventListener('submit', handleSubmit);
  } catch (error) {
    console.error(error);
    renderEmptyState(loadingArea, {
      title: 'No pudimos preparar el checkout',
      text: 'Revisa tu conexión e inténtalo de nuevo desde el carrito.',
      actionHtml: '<a class="btn btn--primary" href="./cart.html">Volver al carrito</a>',
    });
    showToast('Error al cargar el checkout', 'error');
  }
}

initLayout();
init();
