// Archivo: /supabase/functions/_shared/supabase.ts
// Cliente admin (secret key) y resolución del usuario autenticado.
// SUPABASE_URL la inyecta la plataforma; SB_SECRET_KEY se configura con
// `supabase secrets set` (fallback al legacy SUPABASE_SERVICE_ROLE_KEY).
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const secretKey =
    Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !secretKey) {
    throw new Error('Faltan SUPABASE_URL o SB_SECRET_KEY en los secretos de la función');
  }
  return createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Valida el JWT del header Authorization y devuelve el usuario, o null.
export async function getAuthenticatedUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user;
}
