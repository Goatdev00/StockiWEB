// Archivo: /js/api/storage.js
// Carga de imágenes de producto a Supabase Storage. Cada vendedor solo puede
// escribir dentro de su propia carpeta (política sobre storage.objects).
import { supabase } from '../supabaseClient.js';
import { getUser } from './auth.js';

const BUCKET = 'product-images';
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function uploadProductImage(file) {
  const user = await getUser();
  if (!user) throw new Error('Debes iniciar sesión');
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no soportado: usa JPG, PNG o WebP');
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error('La imagen supera el máximo de 5 MB');
  }

  const extension = file.name.split('.').pop().toLowerCase();
  // La ruta empieza con el uid: es lo que valida la política de Storage
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
