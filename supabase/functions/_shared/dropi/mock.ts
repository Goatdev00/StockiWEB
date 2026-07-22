// Archivo: /supabase/functions/_shared/dropi/mock.ts
//
// ============================================================================
// TODO: conectar API real de Dropi cuando se entregue el token y la
// documentación oficial (DROPI_API_TOKEN / DROPI_API_URL en secrets).
//
// Esta es una IMPLEMENTACIÓN SIMULADA (mock) del adaptador de Dropi.
// Es determinista a propósito: mismo input → mismo output, para poder
// desarrollar y probar todo el flujo de importación, sincronización y
// despacho sin depender del proveedor. NO hace ninguna llamada HTTP.
// ============================================================================

import type {
  DropiAdapter,
  DropiOrderRequest,
  DropiOrderResult,
  DropiProduct,
  DropiSearchParams,
  DropiSearchResult,
} from './adapter.ts';

// Tamaño de página fijo del catálogo simulado.
const PAGE_SIZE = 8;

// Catálogo ficticio pero coherente con dropshipping en Colombia:
// costos mayoristas realistas en COP y stocks variados.
const MOCK_CATALOG: DropiProduct[] = [
  {
    id: 'dropi-001',
    name: 'Freidora de aire 3.5 litros digital',
    description:
      'Freidora de aire con panel táctil, 8 programas preestablecidos, canasta antiadherente extraíble y apagado automático. Cocina con hasta 85 % menos aceite.',
    cost_price: 145000,
    stock: 32,
    images: ['https://picsum.photos/seed/dropi-1/600/600'],
    category: 'Hogar',
  },
  {
    id: 'dropi-002',
    name: 'Audífonos gamer con micrófono y luz LED',
    description:
      'Diadema gamer over-ear con sonido envolvente, micrófono ajustable con cancelación de ruido, almohadillas acolchadas y conector 3.5 mm + USB para la iluminación.',
    cost_price: 62000,
    stock: 58,
    images: ['https://picsum.photos/seed/dropi-2/600/600'],
    category: 'Tecnología',
  },
  {
    id: 'dropi-003',
    name: 'Proyector portátil HD con WiFi',
    description:
      'Mini proyector LED 1080p soportado, conexión WiFi para duplicar pantalla del celular, entrada HDMI/USB y parlante integrado. Ideal para cine en casa.',
    cost_price: 210000,
    stock: 14,
    images: ['https://picsum.photos/seed/dropi-3/600/600'],
    category: 'Tecnología',
  },
  {
    id: 'dropi-004',
    name: 'Masajeador cervical eléctrico recargable',
    description:
      'Masajeador de cuello y hombros con 3 intensidades, calor infrarrojo y electrodos de pulso. Batería recargable por USB con autonomía de una semana.',
    cost_price: 78000,
    stock: 45,
    images: ['https://picsum.photos/seed/dropi-4/600/600'],
    category: 'Belleza y salud',
  },
  {
    id: 'dropi-005',
    name: 'Set de brochas de maquillaje x12 con estuche',
    description:
      'Kit profesional de 12 brochas de fibra sintética suave para rostro y ojos, mango de madera y estuche enrollable de viaje.',
    cost_price: 28000,
    stock: 120,
    images: ['https://picsum.photos/seed/dropi-5/600/600'],
    category: 'Belleza y salud',
  },
  {
    id: 'dropi-006',
    name: 'Cama antiestrés para mascota talla M',
    description:
      'Cama tipo donut de felpa ultra suave que reduce la ansiedad de perros y gatos. Base antideslizante y funda lavable a máquina. Diámetro 60 cm.',
    cost_price: 54000,
    stock: 60,
    images: ['https://picsum.photos/seed/dropi-6/600/600'],
    category: 'Mascotas',
  },
  {
    id: 'dropi-007',
    name: 'Fuente de agua para gatos 2 litros',
    description:
      'Bebedero automático con filtro de carbón activado, bomba silenciosa y luz LED indicadora de nivel. Estimula a la mascota a hidratarse mejor.',
    cost_price: 68000,
    stock: 37,
    images: ['https://picsum.photos/seed/dropi-7/600/600'],
    category: 'Mascotas',
  },
  {
    id: 'dropi-008',
    name: 'Reloj inteligente cuadrado resistente al agua',
    description:
      'Smartwatch con pantalla táctil de 1.7", notificaciones, monitoreo de sueño y ritmo cardíaco, y correas intercambiables. Compatible con Android y iOS.',
    cost_price: 89000,
    stock: 75,
    images: ['https://picsum.photos/seed/dropi-8/600/600'],
    category: 'Tecnología',
  },
  {
    id: 'dropi-009',
    name: 'Aspiradora robot compacta con control remoto',
    description:
      'Robot aspirador de perfil bajo con 3 modos de limpieza, sensores anticaída, filtro HEPA y base de carga. Ideal para pisos duros y alfombras delgadas.',
    cost_price: 320000,
    stock: 9,
    images: ['https://picsum.photos/seed/dropi-9/600/600'],
    category: 'Hogar',
  },
  {
    id: 'dropi-010',
    name: 'Corrector de postura ajustable unisex',
    description:
      'Faja correctora de espalda con tirantes acolchados y velcro de ajuste, transpirable y discreta bajo la ropa. Tallas S a XL en una sola pieza ajustable.',
    cost_price: 32000,
    stock: 90,
    images: ['https://picsum.photos/seed/dropi-10/600/600'],
    category: 'Belleza y salud',
  },
  {
    id: 'dropi-011',
    name: 'Bandas elásticas de resistencia x5 con accesorios',
    description:
      'Set de 5 bandas de látex con distintos niveles de resistencia, agarraderas, tobilleras y anclaje de puerta. Incluye bolso de transporte y guía de ejercicios.',
    cost_price: 24000,
    stock: 150,
    images: ['https://picsum.photos/seed/dropi-11/600/600'],
    category: 'Deportes',
  },
  {
    id: 'dropi-012',
    name: 'Botella térmica de acero inoxidable 1 litro',
    description:
      'Termo de doble pared al vacío que mantiene bebidas frías 24 h o calientes 12 h. Tapa antigoteo con asa y acabado mate antideslizante.',
    cost_price: 35000,
    stock: 110,
    images: ['https://picsum.photos/seed/dropi-12/600/600'],
    category: 'Deportes',
  },
];

// Normaliza texto para buscar sin distinguir mayúsculas ni tildes, como haría
// un buscador real en español. Tras NFD, los diacríticos quedan como marcas
// combinantes (U+0300–U+036F) que descartamos comparando el code point; se
// evita un rango regex con caracteres invisibles, frágil ante editores.
function normalize(text: string): string {
  let result = '';
  for (const char of text.toLowerCase().normalize('NFD')) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x0300 || code > 0x036f) result += char;
  }
  return result;
}

export const mockDropiAdapter: DropiAdapter = {
  searchProducts(params: DropiSearchParams): Promise<DropiSearchResult> {
    const search = normalize(params.search ?? '').trim();
    const page = Math.max(1, Math.floor(params.page ?? 1));

    const filtered = search
      ? MOCK_CATALOG.filter((product) =>
          normalize(`${product.name} ${product.description} ${product.category}`).includes(search)
        )
      : MOCK_CATALOG;

    // Siempre reportamos al menos 1 página para que la UI no divida por cero.
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const products = filtered
      .slice(start, start + PAGE_SIZE)
      // Copias defensivas: nadie debe mutar el catálogo base del mock.
      .map((product) => ({ ...product, images: [...product.images] }));

    return Promise.resolve({ products, page, total_pages: totalPages });
  },

  getProduct(id: string): Promise<DropiProduct | null> {
    const product = MOCK_CATALOG.find((item) => item.id === id);
    if (!product) return Promise.resolve(null);
    return Promise.resolve({ ...product, images: [...product.images] });
  },

  createOrder(req: DropiOrderRequest): Promise<DropiOrderResult> {
    if (!req.external_id || req.items.length === 0) {
      return Promise.reject(new Error('Orden de Dropi inválida: faltan external_id o ítems'));
    }
    // Determinista: el id simulado deriva del id de la orden en Stocki,
    // así se puede rastrear a simple vista y repetir en pruebas.
    return Promise.resolve({
      dropi_order_id: `DROPI-MOCK-${req.external_id}`,
      status: 'created',
    });
  },
};
