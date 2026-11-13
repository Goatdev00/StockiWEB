// Archivo: /js/utils/images.js
// Imágenes de producto: qué URL mostrar, cuál usar de respaldo y una red de
// seguridad global para que una foto caída nunca se vea como un ícono roto.

// Respaldo alojado en el propio sitio: no depende de ningún servicio externo
export const PLACEHOLDER_IMAGE = './assets/placeholder.svg';

// Los productos de demostración se sembraron enlazados a picsum.photos, un
// servicio externo que dejó de responder. Sus fotos ahora viven en
// /assets/products con el nombre de la "seed" original; aquí se traducen las
// URL antiguas que sigan guardadas en la base o que devuelva el mock de Dropi.
// Si alguna no tiene foto local, installImageFallback() muestra el respaldo.
const LEGACY_DEMO_URL = /^https:\/\/picsum\.photos\/seed\/((?:stocki|dropi)-[a-z0-9-]+)\//;

export function resolveImageUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return PLACEHOLDER_IMAGE;
  const legacyDemo = url.match(LEGACY_DEMO_URL);
  return legacyDemo ? `./assets/products/${legacyDemo[1]}.webp` : url;
}

// Siempre devuelve al menos una imagen (el respaldo si el producto no tiene)
export function getProductImages(product) {
  const images = Array.isArray(product?.images) ? product.images.filter(Boolean) : [];
  return images.length > 0 ? images.map(resolveImageUrl) : [PLACEHOLDER_IMAGE];
}

export function getMainImage(product) {
  return getProductImages(product)[0];
}

let fallbackInstalled = false;

// Si cualquier <img> de la página falla al cargar, se reemplaza por el
// respaldo. Cubre fotos de vendedores o proveedores alojadas fuera del sitio.
export function installImageFallback() {
  if (fallbackInstalled) return;
  fallbackInstalled = true;
  const placeholderUrl = new URL(PLACEHOLDER_IMAGE, document.baseURI).href;
  // El evento "error" de una imagen no burbujea: se escucha en fase de captura
  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      // Si lo que falló es el propio respaldo no se reintenta (evita bucles)
      if (image.src === placeholderUrl) return;
      image.src = placeholderUrl;
    },
    true
  );
}
