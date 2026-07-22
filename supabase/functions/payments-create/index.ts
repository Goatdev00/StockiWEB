// Archivo: /supabase/functions/payments-create/index.ts
// Inicia el pago de una orden pendiente. Corre con la secret key porque debe
// revalidar precios contra la base ANTES de firmar/crear cualquier checkout:
// el total que ve la pasarela sale de aquí, nunca del navegador.
import { errorResponse, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts';
import { getAdapter } from '../_shared/payments/index.ts';
import type { CheckoutContext, OrderItemRecord, OrderRecord } from '../_shared/payments/types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_GATEWAYS = ['bold', 'mercadopago'];
// Tolerancia de comparación para numeric(14,2) convertido a float.
const CENTS_TOLERANCE = 0.01;

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido', 405);
  }

  try {
    let body: { order_id?: unknown; gateway?: unknown };
    try {
      body = await req.json();
    } catch {
      return errorResponse('Cuerpo JSON inválido', 400);
    }

    const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
    const gateway = typeof body.gateway === 'string' ? body.gateway : '';
    if (!UUID_RE.test(orderId)) {
      return errorResponse('order_id inválido', 400);
    }
    if (!ALLOWED_GATEWAYS.includes(gateway)) {
      return errorResponse('Pasarela de pago no soportada', 400);
    }

    const user = await getAuthenticatedUser(req);
    if (!user) {
      return errorResponse('Debes iniciar sesión para pagar', 401);
    }

    const siteUrl = (Deno.env.get('PUBLIC_SITE_URL') ?? '').replace(/\/+$/, '');
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
    if (!siteUrl || !supabaseUrl) {
      throw new Error('Faltan PUBLIC_SITE_URL o SUPABASE_URL en los secretos de la función');
    }

    const admin = createAdminClient();

    const { data: orderData, error: orderError } = await admin
      .from('orders')
      .select('id, buyer_id, status, total, payment_gateway')
      .eq('id', orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    const order = (orderData ?? null) as OrderRecord | null;

    if (!order) {
      return errorResponse('La orden no existe', 404);
    }
    if (order.buyer_id !== user.id) {
      return errorResponse('No puedes pagar una orden de otra persona', 403);
    }
    if (order.status !== 'pendiente') {
      return errorResponse('La orden ya no está pendiente de pago', 409);
    }

    const { data: itemsData, error: itemsError } = await admin
      .from('order_items')
      .select('id, order_id, product_id, seller_id, title, unit_price, quantity, subtotal')
      .eq('order_id', order.id);
    if (itemsError) throw itemsError;
    const items = (itemsData ?? []) as OrderItemRecord[];

    if (items.length === 0) {
      return errorResponse('La orden no tiene productos', 409);
    }

    // Anti-manipulación: los ítems y el total los escribió el cliente al crear
    // la orden (RLS lo permite), así que aquí se revalida TODO contra la base.
    const productIds = items
      .map((item) => item.product_id)
      .filter((id): id is string => Boolean(id));
    const currentPrices = new Map<string, number>();
    if (productIds.length > 0) {
      const { data: products, error: productsError } = await admin
        .from('products')
        .select('id, price')
        .in('id', productIds);
      if (productsError) throw productsError;
      for (const product of (products ?? []) as Array<{ id: string; price: number }>) {
        currentPrices.set(product.id, Number(product.price));
      }
    }

    let computedTotal = 0;
    for (const item of items) {
      const unitPrice = Number(item.unit_price);
      const quantity = Number(item.quantity);
      const subtotal = Number(item.subtotal);
      // El subtotal debe ser coherente con precio x cantidad del propio ítem.
      if (Math.abs(subtotal - unitPrice * quantity) > CENTS_TOLERANCE) {
        return errorResponse('Los precios cambiaron, vuelve a crear tu orden', 409);
      }
      // Y el precio unitario debe seguir siendo el vigente del producto
      // (si el producto fue eliminado, el snapshot del ítem es la referencia).
      const currentPrice = item.product_id ? currentPrices.get(item.product_id) : undefined;
      if (currentPrice !== undefined && Math.abs(currentPrice - unitPrice) > CENTS_TOLERANCE) {
        return errorResponse('Los precios cambiaron, vuelve a crear tu orden', 409);
      }
      computedTotal += subtotal;
    }
    if (Math.abs(computedTotal - Number(order.total)) > CENTS_TOLERANCE) {
      return errorResponse('Los precios cambiaron, vuelve a crear tu orden', 409);
    }

    // Registro previo del intento de pago, idempotente por (gateway, referencia).
    // El índice único es parcial (where external_reference is not null) y
    // PostgREST no puede inferirlo con on_conflict, así que emulamos el upsert:
    // insert y, si ya existe (23505), update del intento anterior.
    const externalReference = gateway === 'bold' ? `STK-${order.id}` : order.id;
    const paymentRow = {
      order_id: order.id,
      gateway,
      external_reference: externalReference,
      amount: Number(order.total),
      status: 'pendiente',
    };
    const { error: insertError } = await admin.from('payments').insert(paymentRow);
    if (insertError) {
      if (insertError.code === '23505') {
        // Reintento del comprador: refrescamos monto y estado, pero jamás
        // pisamos un pago ya aprobado (el webhook es la única autoridad).
        const { error: updateError } = await admin
          .from('payments')
          .update({ amount: paymentRow.amount, status: 'pendiente' })
          .eq('gateway', gateway)
          .eq('external_reference', externalReference)
          .neq('status', 'aprobado');
        if (updateError) throw updateError;
      } else {
        throw insertError;
      }
    }

    // Dejamos constancia de la pasarela elegida; no bloquea el checkout si falla.
    const { error: gatewayError } = await admin
      .from('orders')
      .update({ payment_gateway: gateway })
      .eq('id', order.id);
    if (gatewayError) {
      console.error(`payments-create: no se pudo guardar payment_gateway de la orden ${order.id}`, gatewayError);
    }

    const ctx: CheckoutContext = { siteUrl, supabaseUrl };
    const adapter = getAdapter(gateway);
    const payload = await adapter.createCheckout(order, items, ctx);

    return jsonResponse(payload);
  } catch (err) {
    // Nunca filtramos detalles internos (SQL, secretos, stack) al cliente.
    console.error('payments-create: error inesperado', err);
    return errorResponse('No se pudo iniciar el pago, inténtalo de nuevo', 500);
  }
});
