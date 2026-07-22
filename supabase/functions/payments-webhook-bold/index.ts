// Archivo: /supabase/functions/payments-webhook-bold/index.ts
// Webhook público de Bold (verify_jwt=false en config.toml): las pasarelas no
// envían JWT de Supabase. Es la ÚNICA autoridad que aprueba pagos Bold.
// Responde 200 rápido siempre que el mensaje sea procesable, para que Bold no
// reintente en bucle; los detalles quedan en los logs y en webhook_payload.
import { errorResponse, handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createAdminClient } from '../_shared/supabase.ts';
import { fulfillPaidOrder } from '../_shared/dropi/fulfillment.ts';

// Estructura esperada de la notificación de Bold.
// TODO: confirmar campos y eventos exactos (SALE_APPROVED, SALE_REJECTED,
// VOID_APPROVED) con la documentación oficial de webhooks de Bold
// (https://developers.bold.co), y activar la verificación de firma del header
// que Bold provea antes de confiar en producción.
interface BoldWebhookPayload {
  type?: string;
  data?: {
    payment_id?: string;
    metadata?: { reference?: string };
    amount?: { total?: number };
  };
}

// Verificación de autenticidad del webhook (FAIL-CLOSED): se calcula el
// HMAC-SHA256 del cuerpo crudo con BOLD_SECRET_KEY y se compara con el header
// de firma. Sin firma válida NO se procesa nada, salvo que el modo de pruebas
// BOLD_WEBHOOK_ALLOW_UNSIGNED=true esté activo explícitamente.
// TODO: confirmar con la documentación oficial de Bold el nombre exacto del
// header y el formato de la firma (hex/base64) antes de salir a producción.
async function isAuthenticWebhook(req: Request, rawBody: string): Promise<boolean> {
  const secret = Deno.env.get('BOLD_SECRET_KEY');
  if (!secret) return false;

  const signatureHeader =
    req.headers.get('x-bold-signature') ?? req.headers.get('x-signature') ?? '';
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const bytes = new Uint8Array(mac);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const base64 = btoa(String.fromCharCode(...bytes));

  const normalized = signatureHeader.trim().toLowerCase();
  return normalized === hex.toLowerCase() || signatureHeader.trim() === base64;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const optionsResponse = handleOptions(req);
  if (optionsResponse) return optionsResponse;
  if (req.method !== 'POST') {
    return errorResponse('Método no permitido', 405);
  }

  // Se lee el cuerpo crudo (necesario para la firma) y luego se parsea.
  const rawBody = await req.text();
  let payload: BoldWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as BoldWebhookPayload;
  } catch {
    return errorResponse('Cuerpo JSON inválido', 400);
  }

  // Endpoint público: sin autenticidad verificada no se aplica ningún efecto.
  const allowUnsigned = Deno.env.get('BOLD_WEBHOOK_ALLOW_UNSIGNED') === 'true';
  if (!allowUnsigned && !(await isAuthenticWebhook(req, rawBody))) {
    console.error('payments-webhook-bold: firma ausente o inválida; notificación descartada');
    return errorResponse('Firma inválida', 401);
  }
  if (allowUnsigned) {
    console.warn(
      'payments-webhook-bold: BOLD_WEBHOOK_ALLOW_UNSIGNED=true — solo para pruebas, NUNCA en producción',
    );
  }

  try {
    const reference =
      typeof payload?.data?.metadata?.reference === 'string'
        ? payload.data.metadata.reference
        : '';
    // Referencias ajenas o malformadas: 200 sin pistas para terceros que prueben el endpoint.
    if (!reference.startsWith('STK-')) {
      return jsonResponse({ ignored: true });
    }

    const admin = createAdminClient();
    const { data: payment, error: paymentError } = await admin
      .from('payments')
      .select('id, order_id, amount, status')
      .eq('gateway', 'bold')
      .eq('external_reference', reference)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) {
      return jsonResponse({ ignored: true });
    }

    // Defensa en profundidad: el monto notificado debe existir y coincidir con
    // el registrado por payments-create; si no coincide se marca rechazado
    // (sin pisar un pago ya aprobado) y queda la evidencia.
    const notifiedTotal = payload?.data?.amount?.total;
    const hasValidAmount =
      typeof notifiedTotal === 'number' && Number.isFinite(notifiedTotal);
    if (
      hasValidAmount &&
      Math.round(notifiedTotal) !== Math.round(Number(payment.amount))
    ) {
      console.error(
        `payments-webhook-bold: monto notificado (${notifiedTotal}) no coincide con el registrado (${payment.amount}) para ${reference}`,
      );
      const { error: rejectError } = await admin
        .from('payments')
        .update({ status: 'rechazado', webhook_payload: payload })
        .eq('id', payment.id)
        .neq('status', 'aprobado');
      if (rejectError) throw rejectError;
      return jsonResponse({ received: true });
    }

    switch (payload.type) {
      case 'SALE_APPROVED': {
        // Una aprobación sin monto verificable no es confiable: se guarda la
        // evidencia y no se aplica ningún efecto.
        if (!hasValidAmount) {
          console.error(
            `payments-webhook-bold: SALE_APPROVED sin monto verificable para ${reference}; no se aprueba`,
          );
          const { error: evidenceError } = await admin
            .from('payments')
            .update({ webhook_payload: payload })
            .eq('id', payment.id);
          if (evidenceError) throw evidenceError;
          break;
        }
        const { error: approveError } = await admin
          .from('payments')
          .update({ status: 'aprobado', webhook_payload: payload })
          .eq('id', payment.id);
        if (approveError) throw approveError;

        // mark_order_paid es idempotente: solo devuelve true la primera vez
        // (pendiente -> pagada), lo que evita despachar a Dropi dos veces.
        const { data: paid, error: rpcError } = await admin.rpc('mark_order_paid', {
          p_order_id: payment.order_id,
        });
        if (rpcError) {
          console.error(
            `payments-webhook-bold: mark_order_paid falló para la orden ${payment.order_id}`,
            rpcError,
          );
          break;
        }
        if (paid === true) {
          // Un fallo de Dropi NUNCA debe tumbar la confirmación del pago.
          try {
            await fulfillPaidOrder(admin, payment.order_id);
          } catch (fulfillmentError) {
            console.error(
              `payments-webhook-bold: fulfillment Dropi falló para la orden ${payment.order_id}`,
              fulfillmentError,
            );
          }
        }
        break;
      }
      case 'SALE_REJECTED': {
        // Un rechazo tardío no debe pisar un pago ya aprobado.
        const { error: updateError } = await admin
          .from('payments')
          .update({ status: 'rechazado', webhook_payload: payload })
          .eq('id', payment.id)
          .neq('status', 'aprobado');
        if (updateError) throw updateError;
        break;
      }
      case 'VOID_APPROVED': {
        const { error: updateError } = await admin
          .from('payments')
          .update({ status: 'reembolsado', webhook_payload: payload })
          .eq('id', payment.id);
        if (updateError) throw updateError;
        break;
      }
      default: {
        // Evento desconocido: guardamos el payload como evidencia de auditoría.
        const { error: updateError } = await admin
          .from('payments')
          .update({ webhook_payload: payload })
          .eq('id', payment.id);
        if (updateError) throw updateError;
        break;
      }
    }

    return jsonResponse({ received: true });
  } catch (err) {
    // Respondemos 200 igualmente: el estado queda en logs y una reconciliación
    // manual es preferible a que Bold reintente contra un error persistente.
    console.error('payments-webhook-bold: error procesando la notificación', err);
    return jsonResponse({ received: true });
  }
});
