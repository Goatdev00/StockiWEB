// Archivo: /supabase/functions/dropi-import/index.ts
// Importa un producto del catálogo de Dropi al inventario del vendedor.
// Entrada: { dropi_product_id: string, price: number > 0,
//            category_id: string | null, free_shipping?: boolean }
// Salida:  el producto creado en public.products (201).

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
      return errorResponse('Solo vendedores o administradores pueden importar productos', 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch (_err) {
      return errorResponse('Cuerpo de la petición inválido', 400);
    }

    const dropiProductId = body.dropi_product_id;
    if (typeof dropiProductId !== 'string' || dropiProductId.trim() === '') {
      return errorResponse('El parámetro "dropi_product_id" es obligatorio', 400);
    }
    const price = body.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return errorResponse('El parámetro "price" debe ser un número mayor que 0', 400);
    }
    const categoryId = body.category_id ?? null;
    if (categoryId !== null && typeof categoryId !== 'string') {
      return errorResponse('El parámetro "category_id" debe ser texto o null', 400);
    }
    const freeShipping = Boolean(body.free_shipping);

    const adapter = getDropiAdapter();
    const dropiProduct = await adapter.getProduct(dropiProductId);
    if (!dropiProduct) {
      return errorResponse('El producto no existe en el catálogo de Dropi', 404);
    }

    // El margen debe ser positivo: vender a costo (o por debajo) es pérdida.
    if (price <= dropiProduct.cost_price) {
      return errorResponse('El precio debe ser mayor al costo del proveedor', 422);
    }

    // Evita duplicados: un vendedor solo puede importar cada producto una vez.
    const { data: existing, error: existingError } = await admin
      .from('products')
      .select('id')
      .eq('seller_id', user.id)
      .eq('source', 'dropi')
      .eq('dropi_product_id', dropiProduct.id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return errorResponse('Ya importaste este producto de Dropi', 409);
    }

    const { data: created, error: insertError } = await admin
      .from('products')
      .insert({
        seller_id: user.id,
        category_id: categoryId,
        title: dropiProduct.name,
        description: dropiProduct.description,
        price,
        cost_price: dropiProduct.cost_price,
        stock: dropiProduct.stock,
        images: dropiProduct.images,
        free_shipping: freeShipping,
        source: 'dropi',
        dropi_product_id: dropiProduct.id,
        active: true,
      })
      .select()
      .single();
    if (insertError) throw insertError;

    return jsonResponse(created, 201);
  } catch (err) {
    console.error('[dropi-import]', err);
    return errorResponse('Error interno del servidor', 500);
  }
});
