// Archivo: /js/api/products.js
// Catálogo público (vista catalog_products, sin datos sensibles como cost_price)
// y CRUD de productos del vendedor (tabla products, protegida por RLS).
import { supabase } from '../supabaseClient.js';
import { getUser } from './auth.js';

const CATALOG_COLUMNS =
  'id, title, description, price, stock, images, free_shipping, source, ' +
  'category_id, category_name, category_slug, seller_id, seller_name, created_at';

// --- Catálogo público -------------------------------------------------------

export async function fetchCatalog({
  search = '',
  categorySlug = '',
  sortBy = 'recent',
  limit = 24,
  offset = 0,
} = {}) {
  let query = supabase.from('catalog_products').select(CATALOG_COLUMNS, { count: 'exact' });

  if (search) {
    // El patrón va entre comillas dobles para que PostgREST trate comas y
    // paréntesis como texto, y se escapan los comodines de ilike
    const sanitized = search
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_')
      .replaceAll('"', '');
    const term = `%${sanitized}%`;
    query = query.or(`title.ilike."${term}",description.ilike."${term}"`);
  }
  if (categorySlug) {
    query = query.eq('category_slug', categorySlug);
  }

  if (sortBy === 'price_asc') query = query.order('price', { ascending: true });
  else if (sortBy === 'price_desc') query = query.order('price', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { products: data, total: count ?? data.length };
}

export async function fetchProductById(id) {
  const { data, error } = await supabase
    .from('catalog_products')
    .select(CATALOG_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Trae varios productos del catálogo a la vez (carrito, checkout)
export async function fetchProductsByIds(ids) {
  if (!ids?.length) return [];
  const { data, error } = await supabase
    .from('catalog_products')
    .select(CATALOG_COLUMNS)
    .in('id', ids);
  if (error) throw error;
  return data;
}

// --- Gestión del vendedor ---------------------------------------------------

const SELLER_COLUMNS =
  'id, title, description, price, cost_price, stock, images, free_shipping, ' +
  'source, dropi_product_id, active, category_id, created_at, updated_at';

export async function fetchMyProducts() {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('products')
    .select(SELLER_COLUMNS)
    .eq('seller_id', user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProduct(product) {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('products')
    .insert({
      seller_id: user.id,
      title: product.title,
      description: product.description,
      category_id: product.categoryId,
      price: product.price,
      cost_price: product.costPrice ?? null,
      stock: product.stock,
      images: product.images ?? [],
      free_shipping: product.freeShipping ?? false,
      source: product.source ?? 'manual',
      dropi_product_id: product.dropiProductId ?? null,
      active: product.active ?? true,
    })
    .select(SELLER_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id, changes) {
  const { data, error } = await supabase
    .from('products')
    .update({
      title: changes.title,
      description: changes.description,
      category_id: changes.categoryId,
      price: changes.price,
      cost_price: changes.costPrice,
      stock: changes.stock,
      images: changes.images,
      free_shipping: changes.freeShipping,
      active: changes.active,
    })
    .eq('id', id)
    .select(SELLER_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}
