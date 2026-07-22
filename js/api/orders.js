// Archivo: /js/api/orders.js
// Creación y consulta de órdenes. La orden nace 'pendiente'; solo el webhook
// de pago (Edge Function con secret key) puede marcarla 'pagada'.
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
