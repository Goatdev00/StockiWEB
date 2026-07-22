// Archivo: /js/api/payments.js
// Inicia el pago llamando a la Edge Function payments-create, que verifica la
// orden con la secret key y devuelve los datos seguros de cada pasarela.
// El frontend NUNCA decide si un pago fue aprobado: eso lo hace el webhook.
import { supabase } from '../supabaseClient.js';
import { functionsErrorMessage } from '../utils/edgeError.js';

export const GATEWAYS = {
  BOLD: 'bold',
  MERCADOPAGO: 'mercadopago',
};

// Respuesta esperada:
//  - bold:        { gateway: 'bold', bold: { orderReference, amount, currency,
//                   apiKey, integritySignature, redirectionUrl } }
//  - mercadopago: { gateway: 'mercadopago', mercadopago: { preferenceId, initPoint } }
export async function startPayment(orderId, gateway) {
  const { data, error } = await supabase.functions.invoke('payments-create', {
    body: { order_id: orderId, gateway },
  });
  if (error) {
    throw new Error(await functionsErrorMessage(error, 'No se pudo iniciar el pago'));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function fetchPaymentsByOrder(orderId) {
  const { data, error } = await supabase
    .from('payments')
    .select('id, gateway, external_reference, amount, status, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
