// Archivo: /js/api/orders.js
// Creación y consulta de órdenes. La orden nace 'pendiente'; solo el webhook
// de pago (Edge Function con secret key) puede marcarla 'pagada'.
// Hay dos caminos: con cuenta (tablas protegidas por RLS) y de invitado (sin
// cuenta: funciones create_guest_order / get_guest_order y un token secreto).
import { supabase } from '../supabaseClient.js';
import { getUser } from './auth.js';

// Crea la orden con snapshot de título/precio por ítem. El precio se
// re-verifica en el servidor (Edge Function payments-create) antes de cobrar.
export async function createOrder({ items, shippingAddress, gateway }) {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión para comprar');
  if (!items?.length) throw new Error('El carrito está vacío');

  // Datos frescos del catálogo para validar stock y tomar el precio actual
  const ids = items.map((item) => item.product_id);
  const { data: products, error: productsError } = await supabase
    .from('catalog_products')
    .select('id, title, price, stock, seller_id, source')
    .in('id', ids);
  if (productsError) throw productsError;

  const byId = new Map(products.map((product) => [product.id, product]));
  const orderItems = items.map((item) => {
    const product = byId.get(item.product_id);
    if (!product) throw new Error('Un producto del carrito ya no está disponible');
    if (product.stock < item.quantity) {
      throw new Error(`Stock insuficiente para "${product.title}"`);
    }
    return {
      product_id: product.id,
      seller_id: product.seller_id,
      title: product.title,
      unit_price: product.price,
      quantity: item.quantity,
      subtotal: product.price * item.quantity,
    };
  });

  const total = orderItems.reduce((sum, item) => sum + item.subtotal, 0);

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      buyer_id: user.id,
      status: 'pendiente',
      total,
      shipping_address: shippingAddress,
      payment_gateway: gateway,
    })
    .select()
    .single();
  if (orderError) throw orderError;

  const { error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
  if (itemsError) {
    // Sin transacciones desde el cliente: si fallan los ítems, se cancela la
    // orden huérfana para no dejar basura.
    await supabase.from('orders').update({ status: 'cancelada' }).eq('id', order.id);
    throw itemsError;
  }

  return order;
}

// --- Compra de invitado (sin cuenta) ------------------------------------------
// El invitado no tiene sesión: lo único que le da acceso a su orden es el token
// que devuelve create_guest_order. Viaja en el enlace de la orden y además se
// recuerda en este navegador por si el enlace llega sin él.

const GUEST_ORDERS_KEY = 'stocki_guest_orders';
const MAX_REMEMBERED_GUEST_ORDERS = 20;
// PostgREST responde PGRST202 cuando la función no existe en la base
const MISSING_FUNCTION_CODE = 'PGRST202';
const PROBE_ORDER_ID = '00000000-0000-4000-8000-000000000000';

function readGuestOrders() {
  try {
    const entries = JSON.parse(localStorage.getItem(GUEST_ORDERS_KEY) ?? '[]');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function rememberGuestOrder(orderId, token) {
  if (!orderId || !token) return;
  const entries = readGuestOrders().filter((entry) => entry.id !== orderId);
  entries.push({ id: orderId, token });
  try {
    localStorage.setItem(
      GUEST_ORDERS_KEY,
      JSON.stringify(entries.slice(-MAX_REMEMBERED_GUEST_ORDERS))
    );
  } catch {
    // Sin almacenamiento (modo privado estricto): el enlace sigue llevando el token
  }
}

export function getGuestOrderToken(orderId) {
  return readGuestOrders().find((entry) => entry.id === orderId)?.token ?? null;
}

// La compra de invitado necesita la versión de supabase/schema.sql que define
// sus funciones. Si la base aún no la tiene, el checkout pide iniciar sesión.
export async function isGuestCheckoutAvailable() {
  const { error } = await supabase.rpc('get_guest_order', {
    p_order_id: PROBE_ORDER_ID,
    p_token: '',
  });
  if (!error) return true;
  if (error.code === MISSING_FUNCTION_CODE) return false;
  throw error;
}

// El servidor recalcula precios, total y stock: del carrito solo se envía qué
// producto y cuántas unidades. Devuelve { id, accessToken }.
export async function createGuestOrder({ items, shippingAddress, gateway }) {
  if (!items?.length) throw new Error('El carrito está vacío');
  const { data, error } = await supabase.rpc('create_guest_order', {
    p_items: items.map((item) => ({ product_id: item.product_id, quantity: item.quantity })),
    p_shipping: shippingAddress,
    p_gateway: gateway,
  });
  if (error) {
    if (error.code === MISSING_FUNCTION_CODE) {
      throw new Error('La compra sin cuenta no está disponible en este momento. Ingresa o crea una cuenta para continuar.');
    }
    throw error;
  }
  rememberGuestOrder(data.id, data.access_token);
  return { id: data.id, accessToken: data.access_token };
}

// Devuelve la orden (con order_items y last_payment_status) o null si el
// token no corresponde a esa orden.
export async function fetchGuestOrder(orderId, token) {
  const { data, error } = await supabase.rpc('get_guest_order', {
    p_order_id: orderId,
    p_token: token,
  });
  if (error) throw error;
  return data;
}

// --- Consultas con cuenta --------------------------------------------------------

export async function fetchMyOrders() {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, total, payment_gateway, shipping_address, created_at, order_items(id, title, unit_price, quantity, subtotal, product_id)')
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function fetchOrderById(orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, buyer_id, status, total, payment_gateway, shipping_address, created_at, order_items(id, title, unit_price, quantity, subtotal, product_id)')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Ventas del vendedor: ítems de órdenes donde él es el dueño del producto.
// RLS le permite ver esos order_items y sus órdenes asociadas.
export async function fetchMySales() {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('order_items')
    .select('id, title, unit_price, quantity, subtotal, created_at, order:orders(id, status, created_at, shipping_address)')
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
