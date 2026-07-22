// Archivo: /js/api/cart.js
// Carrito híbrido: localStorage es la fuente de verdad para la UI (respuesta
// instantánea y soporte de invitados); con sesión activa se refleja en la
// tabla cart_items para persistir entre dispositivos.
import { supabase } from '../supabaseClient.js';
import { getUser } from './auth.js';

const STORAGE_KEY = 'stocki_cart';
export const CART_EVENT = 'stocki:cart-updated';

function readLocalCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeLocalCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent(CART_EVENT));
}

async function syncItemToSupabase(userId, productId, quantity) {
  if (quantity > 0) {
    await supabase
      .from('cart_items')
      .upsert({ user_id: userId, product_id: productId, quantity });
  } else {
    await supabase
      .from('cart_items')
      .delete()
      .match({ user_id: userId, product_id: productId });
  }
}

// --- API pública ------------------------------------------------------------

export function getCartItems() {
  return readLocalCart();
}

export function getCartCount() {
  return readLocalCart().reduce((sum, item) => sum + item.quantity, 0);
}

export async function addToCart(productId, quantity = 1) {
  const items = readLocalCart();
  const existing = items.find((item) => item.product_id === productId);
  if (existing) existing.quantity += quantity;
  else items.push({ product_id: productId, quantity });
  writeLocalCart(items);

  const user = await getUser();
  if (user) {
    const updated = items.find((item) => item.product_id === productId);
    await syncItemToSupabase(user.id, productId, updated.quantity);
  }
}

export async function updateQuantity(productId, quantity) {
  let items = readLocalCart();
  if (quantity > 0) {
    const existing = items.find((item) => item.product_id === productId);
    if (existing) existing.quantity = quantity;
    else items.push({ product_id: productId, quantity });
  } else {
    items = items.filter((item) => item.product_id !== productId);
  }
  writeLocalCart(items);

  const user = await getUser();
  if (user) await syncItemToSupabase(user.id, productId, quantity);
}

export async function removeFromCart(productId) {
  await updateQuantity(productId, 0);
}

export async function clearCart() {
  writeLocalCart([]);
  const user = await getUser();
  if (user) await supabase.from('cart_items').delete().eq('user_id', user.id);
}

// Al cerrar sesión solo se vacía el carrito local: el carrito del servidor
// se conserva para cuando ese usuario vuelva a entrar, y el siguiente
// usuario del navegador no hereda ítems ajenos.
export function clearLocalCart() {
  writeLocalCart([]);
}

// Fusiona el carrito de invitado con el guardado en el servidor al iniciar
// sesión: se conserva la cantidad mayor de cada producto.
export async function mergeCartOnLogin() {
  const user = await getUser();
  if (!user) return;

  const { data: remote, error } = await supabase
    .from('cart_items')
    .select('product_id, quantity')
    .eq('user_id', user.id);
  if (error) throw error;

  const merged = new Map();
  for (const item of remote ?? []) merged.set(item.product_id, item.quantity);
  for (const item of readLocalCart()) {
    const current = merged.get(item.product_id) ?? 0;
    merged.set(item.product_id, Math.max(current, item.quantity));
  }

  const items = [...merged.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
  writeLocalCart(items);

  if (items.length > 0) {
    await supabase
      .from('cart_items')
      .upsert(items.map((item) => ({ user_id: user.id, ...item })));
  }
}

export function onCartChange(callback) {
  window.addEventListener(CART_EVENT, callback);
  // El evento 'storage' sincroniza el contador entre pestañas abiertas
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) callback();
  });
}
