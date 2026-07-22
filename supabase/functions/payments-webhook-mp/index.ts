// Archivo: /supabase/functions/payments-webhook-mp/index.ts
// Webhook público de MercadoPago (verify_jwt=false en config.toml). La
// notificación solo trae el id del pago: la verdad (estado, monto, orden) se
// consulta SIEMPRE a la API de MercadoPago con el access token, nunca se
// confía en el cuerpo recibido.
import { errorResponse, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { fulfillPaidOrder } from '../_shared/dropi/fulfillment.ts';

interface MpNotificationBody {
  type?: string;
  data?: { id?: string | number };
}

interface MpPaymentTruth {
  id?: number | string;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Comparación en tiempo constante: evita fugas por temporización al validar la firma.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Verificación de firma oficial de MercadoPago: header x-signature
// («ts=...,v1=...») + x-request-id; v1 = HMAC-SHA256(secret, manifest).
async function verifySignature(req: Request, dataId: string, secret: string): Promise<boolean> {
  const signatureHeader = req.headers.get('x-signature') ?? '';
  const requestId = req.headers.get('x-request-id') ?? '';

  const parts = new Map<string, string>();
  for (const chunk of signatureHeader.split(',')) {
    const [key, ...rest] = chunk.split('=');
    if (key && rest.length > 0) {
      parts.set(key.trim(), rest.join('=').trim());
    }
  }
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  if (!ts || !v1) return false;

  // Manifest documentado por MercadoPago; el id alfanumérico va en minúsculas.
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(manifest));
  return timingSafeEqual(toHex(digest), v1.toLowerCase());
}

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido', 405);
  }

  try {
    // MercadoPago notifica con query params (?type=payment&data.id=...) y/o
    // cuerpo JSON {type, data:{id}}; además existe el formato legado
    // ?topic=payment&id=... — soportamos todas las variantes.
    const url = new URL(req.url);
    let body: MpNotificationBody = {};
    try {
      body = (await req.json()) as MpNotificationBody;
    } catch {
      // Sin cuerpo JSON: los query params pueden bastar.
    }

    const type = url.searchParams.get('type') ?? url.searchParams.get('topic') ?? body.type ?? '';
    const rawDataId = url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? body.data?.id ?? '';
    const dataId = String(rawDataId).trim();

    if (type !== 'payment') {
      return jsonResponse({ ignored: true });
    }
    if (!dataId) {
      return jsonResponse({ ignored: true });
    }

    // FAIL-CLOSED: sin secreto configurado no se procesa nada, salvo que el
    // modo de pruebas MP_WEBHOOK_ALLOW_UNSIGNED=true esté activo explícitamente.
    const webhookSecret = Deno.env.get('MP_WEBHOOK_SECRET');
    const allowUnsigned = Deno.env.get('MP_WEBHOOK_ALLOW_UNSIGNED') === 'true';
    if (!webhookSecret) {
      if (!allowUnsigned) {
        console.error(
          'payments-webhook-mp: MP_WEBHOOK_SECRET no configurado; notificación rechazada (configura el secreto o, solo en pruebas, MP_WEBHOOK_ALLOW_UNSIGNED=true)',
        );
        return errorResponse('Webhook sin verificación configurada', 401);
      }
      console.warn(
        'payments-webhook-mp: MP_WEBHOOK_ALLOW_UNSIGNED=true — solo para pruebas, NUNCA en producción',
      );
    } else {
      const validSignature = await verifySignature(req, dataId, webhookSecret);
      if (!validSignature) {
        console.error(`payments-webhook-mp: firma inválida para data.id=${dataId}`);
        return errorResponse('Firma inválida', 401);
      }
    }

    const accessToken = Deno.env.get('MP_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('Falta MP_ACCESS_TOKEN en los secretos de la función');
    }

    // La fuente de verdad es la API de pagos, no la notificación.
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (mpResponse.status === 404) {
      // Pago inexistente (o de otra cuenta): nada que procesar.
      return jsonResponse({ ignored: true });
    }
    if (!mpResponse.ok) {
      // Error transitorio de MercadoPago: 502 para que reintente más tarde.
      console.error(`payments-webhook-mp: HTTP ${mpResponse.status} consultando el pago ${dataId}`);
      return errorResponse('No se pudo consultar el pago en MercadoPago', 502);
    }
    const mpPayment = (await mpResponse.json()) as MpPaymentTruth;

    const orderId =
      typeof mpPayment.external_reference === 'string' ? mpPayment.external_reference : '';
    if (!orderId) {
      return jsonResponse({ ignored: true });
    }

    const admin = createAdminClient();
    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('id, order_id, amount, status')
      .eq('gateway', 'mercadopago')
      .eq('external_reference', orderId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) {
      // Referencia desconocida: 200 sin dar pistas a terceros.
      return jsonResponse({ ignored: true });
    }

    // Guardamos la notificación y la verdad consultada como evidencia.
    const webhookPayload = { notification: { type, data_id: dataId }, payment: mpPayment };

    // Defensa en profundidad: el monto real cobrado debe coincidir con el
    // registrado por payments-create; si no, rechazado con evidencia.
    const paidAmount = Number(mpPayment.transaction_amount);
    if (
      Number.isFinite(paidAmount) &&
      Math.round(paidAmount) !== Math.round(Number(payment.amount))
    ) {
      console.error(
        `payments-webhook-mp: monto cobrado (${paidAmount}) no coincide con el registrado (${payment.amount}) para la orden ${orderId}`,
      );
      const { error: rejectError } = await admin
        .from('payments')
        .update({ status: 'rechazado', webhook_payload: webhookPayload })
        .eq('id', payment.id)
        .neq('status', 'aprobado');
      if (rejectError) throw rejectError;
      return jsonResponse({ received: true });
    }

    const status = String(mpPayment.status ?? '');
    if (status === 'approved') {
      const { error: approveError } = await admin
        .from('payments')
        .update({ status: 'aprobado', webhook_payload: webhookPayload })
        .eq('id', payment.id);
      if (approveError) throw approveError;

      // mark_order_paid es idempotente: true solo en la transición
      // pendiente -> pagada, así el despacho a Dropi ocurre una sola vez.
      const { data: paid, error: rpcError } = await admin.rpc('mark_order_paid', {
        p_order_id: payment.order_id,
      });
      if (rpcError) {
        console.error(
          `payments-webhook-mp: mark_order_paid falló para la orden ${payment.order_id}`,
          rpcError,
        );
      } else if (paid === true) {
        // Un fallo de Dropi NUNCA debe tumbar la confirmación del pago.
        try {
          await fulfillPaidOrder(admin, payment.order_id);
        } catch (fulfillmentError) {
          console.error(
            `payments-webhook-mp: fulfillment Dropi falló para la orden ${payment.order_id}`,
            fulfillmentError,
          );
        }
      }
    } else if (status === 'rejected' || status === 'cancelled') {
      // Un rechazo tardío no debe pisar un pago ya aprobado.
      const { error: updateError } = await admin
        .from('payments')
        .update({ status: 'rechazado', webhook_payload: webhookPayload })
        .eq('id', payment.id)
        .neq('status', 'aprobado');
      if (updateError) throw updateError;
    } else if (status === 'refunded' || status === 'charged_back') {
      const { error: updateError } = await admin
        .from('payments')
        .update({ status: 'reembolsado', webhook_payload: webhookPayload })
        .eq('id', payment.id);
      if (updateError) throw updateError;
    } else {
      // Estados intermedios (in_process, pending, etc.): solo evidencia.
      const { error: updateError } = await admin
        .from('payments')
        .update({ webhook_payload: webhookPayload })
        .eq('id', payment.id);
      if (updateError) throw updateError;
    }

    return jsonResponse({ received: true });
  } catch (err) {
    // 500: MercadoPago reintenta, útil ante errores transitorios de base.
    console.error('payments-webhook-mp: error procesando la notificación', err);
    return errorResponse('Error interno al procesar la notificación', 500);
  }
});
