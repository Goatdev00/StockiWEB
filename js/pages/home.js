// Archivo: /js/pages/home.js
// Controlador de la portada: orquesta layout + catálogo. Patrón de referencia
// para el resto de páginas: initLayout() -> cargar datos -> renderizar.
import { initLayout } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { renderProductGrid } from '../ui/productCard.js';
import { fetchCatalog } from '../api/products.js';
import { qs, setLoading, renderEmptyState } from '../utils/dom.js';

async function loadProducts() {
  const container = qs('#products-container');
  setLoading(container);
  try {
    const { products } = await fetchCatalog({ limit: 24 });
    if (products.length === 0) {
      renderEmptyState(container, {
        title: 'Aún no hay productos publicados',
        text: 'Si eres el administrador, ejecuta supabase/schema.sql en el editor SQL de Supabase para crear las tablas y los datos de ejemplo.',
      });
      return;
    }
    renderProductGrid(container, products);
  } catch (error) {
    console.error(error);
    renderEmptyState(container, {
      title: 'No pudimos cargar el catálogo',
      text: 'Verifica tu conexión o que la base de datos tenga el esquema aplicado (supabase/schema.sql).',
    });
    showToast('Error al cargar los productos', 'error');
  }
}

initLayout();
loadProducts();
