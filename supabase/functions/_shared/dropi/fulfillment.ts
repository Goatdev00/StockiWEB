// Archivo: /supabase/functions/_shared/dropi/fulfillment.ts
// Despacho automático a Dropi de una orden ya pagada. Lo invoca el webhook de
// pagos con el cliente admin: aquí no hay usuario final, por eso no se valida
// sesión. Los errores se relanzan para que el llamador decida si los traga
// (un fallo de despacho no debe tumbar la confirmación del pago).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { DropiOrderItem, DropiOrderRequest } from './adapter.ts';
import { getDropiAdapter } from './index.ts';

export async function fulfillPaidOrder(admin: SupabaseClient, orderId: string): Promise<void> {
  try {
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, fulfillment, shipping_address')
      .eq('id', orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error(`Orden ${orderId} no encontrada`);

    // Idempotencia: si ya se despachó (los webhooks pueden repetirse), no se
    // reenvía la orden al proveedor.
    if (order.fulfillment) return;

    const { data: items, error: itemsError } = await admin
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', orderId);
    if (itemsError) throw itemsError;

    const productIds = (items ?? [])
      .map((item: { product_id: string | null }) => item.product_id)
      .filter((id: string | null): id is string => Boolean(id));
    if (productIds.length === 0) return;

    // Solo interesan los productos de origen Dropi con id del proveedor;
    // los manuales los despacha el vendedor por su cuenta.
    const { data: products, error: productsError } = await admin
      .from('products')
      .select('id, source, dropi_product_id')
      .in('id', productIds);
    if (productsError) throw productsError;

    const dropiIdByProductId = new Map<string, string>();
    for (const product of products ?? []) {
      if (product.source === 'dropi' && product.dropi_product_id) {
        dropiIdByProductId.set(product.id, product.dropi_product_id);
      }
    }

    const dropiItems: DropiOrderItem[] = [];
    for (const item of items ?? []) {
      const dropiProductId = item.product_id ? dropiIdByProductId.get(item.product_id) : undefined;
      if (dropiProductId) {
        dropiItems.push({ dropi_product_id: dropiProductId, quantity: item.quantity });
      }
    }
    if (dropiItems.length === 0) return;

    // shipping_address es jsonb libre: se rellena con cadenas vacías para no
    // enviar undefined al proveedor si algún campo faltara.
    const shipping = (order.shipping_address ?? {}) as Record<string, unknown>;
    const request: DropiOrderRequest = {
      external_id: orderId,
      items: dropiItems,
      shipping: {
        // El checkout guarda el nombre del destinatario como full_name;
        // se acepta también name por compatibilidad futura.
        name: typeof shipping.full_name === 'string'
          ? shipping.full_name
          : typeof shipping.name === 'string' ? shipping.name : '',
        phone: typeof shipping.phone === 'string' ? shipping.phone : '',
        address: typeof shipping.address === 'string' ? shipping.address : '',
        city: typeof shipping.city === 'string' ? shipping.city : '',
        department: typeof shipping.department === 'string' ? shipping.department : '',
        notes: typeof shipping.notes === 'string' ? shipping.notes : undefined,
      },
    };

    const adapter = getDropiAdapter();
    const result = await adapter.createOrder(request);

    const { error: updateError } = await admin
      .from('orders')
      .update({
        fulfillment: {
          provider: 'dropi',
          dropi_order_id: result.dropi_order_id,
          status: result.status,
          sent_at: new Date().toISOString(),
        },
      })
      .eq('id', orderId);
    if (updateError) throw updateError;
  } catch (err) {
    console.error(`[dropi] Error despachando la orden ${orderId}:`, err);
    throw err;
  }
}
