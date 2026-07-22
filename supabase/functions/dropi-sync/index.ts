// Archivo: /supabase/functions/dropi-sync/index.ts
// Sincroniza stock y costo de los productos Dropi del vendedor autenticado.
// El precio de venta NO se toca: ese margen es decisión del vendedor.
// Entrada: {}   Salida: { updated, errors, total }

import { errorResponse, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts';
import { getDropiAdapter } from '../_shared/dropi/index.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return errorResponse('Método no permitido', 405);
  }

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return errorResponse('Debes iniciar sesión', 401);

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !['seller', 'admin'].includes(profile.role)) {
      return errorResponse('Solo vendedores o administradores pueden sincronizar', 403);
    }

    const { data: myProducts, error: productsError } = await admin
      .from('products')
      .select('id, dropi_product_id')
      .eq('seller_id', user.id)
      .eq('source', 'dropi');
    if (productsError) throw productsError;

    const products = myProducts ?? [];
    const adapter = getDropiAdapter();
    let updated = 0;
    let errors = 0;

    // Secuencial a propósito: el catálogo por vendedor es pequeño y así se
    // evita saturar al proveedor con ráfagas de peticiones en paralelo.
    for (const product of products) {
      try {
        const remote = product.dropi_product_id
          ? await adapter.getProduct(product.dropi_product_id)
          : null;

        if (remote) {
          const { error: updateError } = await admin
            .from('products')
            .update({ stock: remote.stock, cost_price: remote.cost_price })
            .eq('id', product.id);
          if (updateError) throw updateError;
          updated++;
        } else {
          // El proveedor ya no ofrece el producto: se oculta del catálogo
          // para no vender algo que no se puede despachar.
          const { error: deactivateError } = await admin
            .from('products')
            .update({ active: false })
            .eq('id', product.id);
          if (deactivateError) throw deactivateError;
          errors++;
        }
      } catch (itemErr) {
        // Un producto fallido no debe frenar la sincronización del resto.
        console.error(`[dropi-sync] Error con el producto ${product.id}:`, itemErr);
        errors++;
      }
    }

    return jsonResponse({ updated, errors, total: products.length });
  } catch (err) {
    console.error('[dropi-sync]', err);
    return errorResponse('Error interno del servidor', 500);
  }
});
