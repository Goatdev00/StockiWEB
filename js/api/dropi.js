// Archivo: /js/api/dropi.js
// Puente hacia las Edge Functions de Dropi. El token de Dropi nunca toca el
// navegador: todas las llamadas pasan por el servidor.
import { supabase } from '../supabaseClient.js';
import { functionsErrorMessage } from '../utils/edgeError.js';

async function invokeDropi(functionName, body) {
  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) {
    throw new Error(await functionsErrorMessage(error, 'Error al comunicarse con Dropi'));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Catálogo de Dropi disponible para importar (paginado y con búsqueda)
export function fetchDropiCatalog({ search = '', page = 1 } = {}) {
  return invokeDropi('dropi-products', { search, page });
}

// Importa un producto de Dropi al catálogo del vendedor con su margen
export function importDropiProduct({ dropiProductId, price, categoryId, freeShipping = false }) {
  return invokeDropi('dropi-import', {
    dropi_product_id: dropiProductId,
    price,
    category_id: categoryId,
    free_shipping: freeShipping,
  });
}

// Sincroniza stock y costo de los productos Dropi del vendedor autenticado
export function syncMyDropiProducts() {
  return invokeDropi('dropi-sync', {});
}
