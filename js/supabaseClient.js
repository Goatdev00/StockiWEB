// Archivo: /js/supabaseClient.js
// Único punto de configuración del cliente de Supabase.
// La publishable key es pública por diseño: RLS protege todos los datos.
// Los secretos (Bold, MercadoPago, Dropi, secret key) viven SOLO en Edge Functions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://rbslnuosovolowenvcus.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BmcV18qpwujgS7DHhRYGuQ_7zSoxFHG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
