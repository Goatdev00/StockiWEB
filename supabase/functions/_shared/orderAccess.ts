// Archivo: /supabase/functions/_shared/orderAccess.ts
// Decide quién puede pagar una orden. Hay dos tipos:
//  - orden con cuenta (buyer_id): solo su dueño, identificado por su sesión;
//  - orden de invitado (buyer_id NULL): quien presente el token secreto que
//    create_guest_order() entregó al crearla. En la base solo está su hash.

export interface OrderAccessFields {
  buyer_id: string | null;
  guest_token_hash: string | null;
}

export type OrderAccess =
  | { ok: true }
  | { ok: false; status: 401 | 403; message: string };

// Mismo cálculo que public.hash_guest_token() en schema.sql: SHA-256 en hex.
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function isGuestOrder(order: OrderAccessFields): boolean {
  return order.buyer_id === null;
}

export async function authorizeOrderAccess(
  order: OrderAccessFields,
  userId: string | null,
  orderToken: string,
): Promise<OrderAccess> {
  if (!isGuestOrder(order)) {
    // El token de invitado jamás abre una orden que pertenece a una cuenta
    if (!userId) {
      return { ok: false, status: 401, message: 'Debes iniciar sesión para pagar' };
    }
    if (order.buyer_id !== userId) {
      return { ok: false, status: 403, message: 'No puedes pagar una orden de otra persona' };
    }
    return { ok: true };
  }

  const invalid: OrderAccess = {
    ok: false,
    status: 403,
    message: 'El enlace de esta orden no es válido',
  };
  if (!order.guest_token_hash || !orderToken) return invalid;
  return (await sha256Hex(orderToken)) === order.guest_token_hash ? { ok: true } : invalid;
}
