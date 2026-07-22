// Archivo: /js/api/admin.js
// Operaciones exclusivas del admin. RLS es quien realmente autoriza cada una:
// si un no-admin llama estas funciones, la base de datos devuelve error/0 filas.
import { supabase } from '../supabaseClient.js';

// --- Usuarios ---------------------------------------------------------------

export async function fetchAllProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setUserRole(userId, role) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// --- Categorías -------------------------------------------------------------

export async function createCategory({ name, slug }) {
  const { data, error } = await supabase
    .from('categories')
    .insert({ name, slug })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id, { name, slug }) {
  const { data, error } = await supabase
    .from('categories')
    .update({ name, slug })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// --- Productos (todos, incluidos inactivos) ---------------------------------

export async function fetchAllProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, title, price, stock, active, source, created_at, seller:profiles(full_name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function setProductActive(id, active) {
  const { error } = await supabase.from('products').update({ active }).eq('id', id);
  if (error) throw error;
}

// --- Órdenes (todas) --------------------------------------------------------

export async function fetchAllOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, total, payment_gateway, created_at, shipping_address, buyer:profiles(full_name), order_items(id, title, quantity, subtotal)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// El estado 'pagada' lo escribe únicamente el webhook con secret key; el admin
// gestiona la logística posterior y las cancelaciones.
export async function updateOrderStatus(orderId, status) {
  const allowed = ['enviada', 'entregada', 'cancelada'];
  if (!allowed.includes(status)) {
    throw new Error(`Estado no permitido desde el panel: ${status}`);
  }
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
