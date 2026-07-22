// Archivo: /supabase/functions/_shared/payments/types.ts
// Tipos del patrón adaptador de pasarelas. payments-create trabaja solo contra
// la interfaz PaymentAdapter: agregar una pasarela nueva no toca la función.

export type GatewayId = 'bold' | 'mercadopago';

// Fila de public.orders con las columnas que usa el flujo de pago.
export interface OrderRecord {
  id: string;
  buyer_id: string;
  status: string;
  total: number;
  payment_gateway: string | null;
}

// Fila de public.order_items (snapshot de título/precio en el momento de compra).
export interface OrderItemRecord {
  id: string;
  order_id: string;
  product_id: string | null;
  seller_id: string | null;
  title: string;
  unit_price: number;
  quantity: number;
  subtotal: number;
}

// Contexto de entorno que el adaptador necesita para construir URLs:
// siteUrl para redirecciones al sitio y supabaseUrl para webhooks propios.
export interface CheckoutContext {
  siteUrl: string;
  supabaseUrl: string;
}

// Payload que consume el botón embebido de Bold en el frontend. La firma de
// integridad se calcula aquí (servidor) para que el monto no sea manipulable.
export interface BoldCheckoutData {
  orderReference: string;
  amount: number;
  currency: string;
  apiKey: string;
  integritySignature: string;
  redirectionUrl: string;
}

// Payload de Checkout Pro de MercadoPago: el frontend redirige a initPoint.
export interface MercadoPagoCheckoutData {
  preferenceId: string;
  initPoint: string;
}

// Unión discriminada por pasarela: es EXACTAMENTE lo que espera js/api/payments.js.
export type CheckoutPayload =
  | { gateway: 'bold'; bold: BoldCheckoutData }
  | { gateway: 'mercadopago'; mercadopago: MercadoPagoCheckoutData };

export interface PaymentAdapter {
  gateway: GatewayId;
  createCheckout(
    order: OrderRecord,
    items: OrderItemRecord[],
    ctx: CheckoutContext,
  ): Promise<CheckoutPayload>;
}
