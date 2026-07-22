// Archivo: /js/api/categories.js
// Lectura pública de categorías (RLS permite SELECT a cualquiera).
import { supabase } from '../supabaseClient.js';

export async function fetchCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug')
    .order('name');
  if (error) throw error;
  return data;
}
