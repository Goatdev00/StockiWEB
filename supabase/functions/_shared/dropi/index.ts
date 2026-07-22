// Archivo: /supabase/functions/_shared/dropi/index.ts
// Punto ÚNICO de acceso al adaptador de Dropi. Cuando exista la integración
// real, este archivo es el único lugar donde se cambia el adaptador devuelto:
// el resto del código (Edge Functions y fulfillment) no se toca.

import type { DropiAdapter } from './adapter.ts';
import { mockDropiAdapter } from './mock.ts';

export type {
  DropiAdapter,
  DropiOrderItem,
  DropiOrderRequest,
  DropiOrderResult,
  DropiProduct,
  DropiSearchParams,
  DropiSearchResult,
  DropiShipping,
} from './adapter.ts';

export function getDropiAdapter(): DropiAdapter {
  // Aunque el token ya esté configurado, todavía no hay implementación real:
  // avisamos en los logs para que nadie crea que está operando contra Dropi.
  if (Deno.env.get('DROPI_API_TOKEN')) {
    console.warn(
      '[dropi] DROPI_API_TOKEN detectado, pero la integración real aún no está conectada; se usa el adaptador mock.'
    );
  }
  return mockDropiAdapter;
}
