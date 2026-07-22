// Archivo: /js/utils/edgeError.js
// supabase.functions.invoke devuelve data = null cuando la Edge Function
// responde 4xx/5xx; el mensaje útil ({ error }) queda dentro de
// error.context (la Response). Este helper lo rescata para que el usuario
// vea mensajes accionables y no el genérico "non-2xx status code".

export async function functionsErrorMessage(error, fallback) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const body = await error.context.json();
      if (body?.error) return body.error;
    }
  } catch {
    // Cuerpo no JSON: se usa el fallback
  }
  return error?.message ?? fallback;
}
