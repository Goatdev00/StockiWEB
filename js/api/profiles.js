// Archivo: /js/api/profiles.js
// Perfil del usuario autenticado y activación del rol de vendedor.
import { supabase } from '../supabaseClient.js';
import { getUser } from './auth.js';

export async function getMyProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, created_at')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyProfile({ fullName, phone }) {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('profiles')
    .update({ full_name: fullName, phone })
    .eq('id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// La transición buyer -> seller la valida un trigger en la base de datos:
// un usuario solo puede subirse a vendedor, nunca a admin.
export async function becomeSeller() {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: 'seller' })
    .eq('id', user.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
