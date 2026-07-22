// Archivo: /supabase/functions/_shared/payments/bold.ts
// Adaptador de Bold (botón de pago embebido). Bold no requiere crear la
// transacción por API: el frontend monta el botón con estos datos y la firma
// de integridad garantiza que monto/moneda/referencia no fueron alterados.
import type {
  CheckoutContext,
  CheckoutPayload,
  OrderItemRecord,
  OrderRecord,
  PaymentAdapter,
} from './types.ts';

// Hex minúscula de un buffer: formato que Bold espera para la firma.
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export const boldAdapter: PaymentAdapter = {
  gateway: 'bold',

  async createCheckout(
    order: OrderRecord,
    _items: OrderItemRecord[],
    ctx: CheckoutContext,
  ): Promise<CheckoutPayload> {
    const apiKey = Deno.env.get('BOLD_API_KEY');
    const secretKey = Deno.env.get('BOLD_SECRET_KEY');
    if (!apiKey || !secretKey) {
      throw new Error('Faltan BOLD_API_KEY o BOLD_SECRET_KEY en los secretos de la función');
    }

    const orderReference = `STK-${order.id}`;
    // Bold cobra en COP sin decimales: el total viaja como entero.
    const amount = Math.round(Number(order.total));
    const currency = 'COP';
    const redirectionUrl = `${ctx.siteUrl}/order-confirmation.html?order=${order.id}`;

    // Firma de integridad: SHA-256 hex de referencia + monto + moneda + secreto.
    // TODO: verificar el formato exacto de la cadena a firmar con la
    // documentación oficial de Bold (https://developers.bold.co).
    const signaturePayload = `${orderReference}${amount}${currency}${secretKey}`;
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(signaturePayload),
    );
    const integritySignature = toHex(digest);

    return {
      gateway: 'bold',
      bold: { orderReference, amount, currency, apiKey, integritySignature, redirectionUrl },
    };
  },
};
