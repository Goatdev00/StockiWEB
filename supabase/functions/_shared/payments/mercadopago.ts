// Archivo: /supabase/functions/_shared/payments/mercadopago.ts
// Adaptador de MercadoPago (Checkout Pro): crea una preferencia por API y el
// frontend redirige al init_point. external_reference = order.id nos permite
// reconciliar el pago cuando llega el webhook.
import type {
  CheckoutContext,
  CheckoutPayload,
  OrderItemRecord,
  OrderRecord,
  PaymentAdapter,
} from './types.ts';

interface MpPreferenceResponse {
  id?: string;
  init_point?: string;
}

export const mercadoPagoAdapter: PaymentAdapter = {
  gateway: 'mercadopago',

  async createCheckout(
    order: OrderRecord,
    items: OrderItemRecord[],
    ctx: CheckoutContext,
  ): Promise<CheckoutPayload> {
    const accessToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('Falta MP_ACCESS_TOKEN en los secretos de la función');
    }

    // Las tres rutas de retorno apuntan a la confirmación: esa página consulta
    // el estado real de la orden, nunca confía en la URL de regreso.
    const confirmationUrl = `${ctx.siteUrl}/order-confirmation.html?order=${order.id}`;

    const preferenceBody = {
      items: items.map((item) => ({
        id: item.product_id ?? item.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
        currency_id: 'COP',
      })),
      external_reference: order.id,
      notification_url: `${ctx.supabaseUrl}/functions/v1/payments-webhook-mp`,
      back_urls: {
        success: confirmationUrl,
        pending: confirmationUrl,
        failure: confirmationUrl,
      },
      auto_return: 'approved',
    };

    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferenceBody),
    });

    if (!response.ok) {
      // Registramos el detalle en el log del servidor; al cliente solo le
      // llega un mensaje genérico desde payments-create.
      const errorBody = await response.text().catch(() => '');
      console.error(
        `mercadopago.createCheckout: HTTP ${response.status} al crear la preferencia de la orden ${order.id}`,
        errorBody,
      );
      throw new Error(`MercadoPago rechazó la creación de la preferencia (HTTP ${response.status})`);
    }

    const data = (await response.json()) as MpPreferenceResponse;
    if (!data.id || !data.init_point) {
      throw new Error('Respuesta de MercadoPago sin id o init_point de la preferencia');
    }

    return {
      gateway: 'mercadopago',
      mercadopago: { preferenceId: data.id, initPoint: data.init_point },
    };
  },
};
