// Archivo: /supabase/functions/dropi-products/index.ts
// Catálogo de Dropi disponible para importar. Se sirve desde el servidor para
// que el token del proveedor nunca llegue al navegador.
// Entrada: { search?: string, page?: number >= 1 }
// Salida:  { products, page, total_pages }

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

    // El catálogo del proveedor (con costos) es solo para vendedores y admin.
    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !['seller', 'admin'].includes(profile.role)) {
      return errorResponse('Solo vendedores o administradores pueden ver el catálogo de Dropi', 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch (_err) {
      // Cuerpo vacío o no-JSON: se aceptan los valores por defecto.
      body = {};
    }

    if (body.search !== undefined && typeof body.search !== 'string') {
      return errorResponse('El parámetro "search" debe ser texto', 400);
    }
    const page = body.page === undefined ? 1 : body.page;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
      return errorResponse('El parámetro "page" debe ser un entero mayor o igual a 1', 400);
    }

    const adapter = getDropiAdapter();
    const result = await adapter.searchProducts({
      search: (body.search as string | undefined) ?? '',
      page,
    });

    return jsonResponse({
      products: result.products,
      page: result.page,
      total_pages: result.total_pages,
    });
  } catch (err) {
    console.error('[dropi-products]', err);
    return errorResponse('Error interno del servidor', 500);
  }
});
