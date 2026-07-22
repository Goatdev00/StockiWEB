// Archivo: /supabase/functions/_shared/payments/index.ts
// Punto único de resolución de adaptadores de pago.
// NOTA para la etapa futura de cobros por vendedor: este es el lugar donde se
// resolverán credenciales por vendedor desde seller_payment_accounts (en vez
// de las variables de entorno globales), sin cambiar a los consumidores.
import type { GatewayId, PaymentAdapter } from './types.ts';
import { boldAdapter } from './bold.ts';
import { mercadoPagoAdapter } from './mercadopago.ts';

const ADAPTERS: Record<GatewayId, PaymentAdapter> = {
  bold: boldAdapter,
  mercadopago: mercadoPagoAdapter,
};

export function getAdapter(gateway: string): PaymentAdapter {
  const adapter = ADAPTERS[gateway as GatewayId];
  if (!adapter) {
    throw new Error(`Pasarela de pago no soportada: ${gateway}`);
  }
  return adapter;
}

export type { CheckoutContext, CheckoutPayload, GatewayId, OrderItemRecord, OrderRecord, PaymentAdapter } from './types.ts';
