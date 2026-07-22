// Archivo: /js/pages/search.js
// Búsqueda del catálogo: lee q/category/sort de la URL, permite refiltrar
// sin recargar (history.replaceState) y pinta los resultados en la grilla.
import { initLayout } from '../ui/layout.js';
import { showToast } from '../ui/toast.js';
import { renderProductGrid } from '../ui/productCard.js';
import { fetchCatalog } from '../api/products.js';
import { fetchCategories } from '../api/categories.js';
import { qs, getQueryParam, setLoading, renderEmptyState } from '../utils/dom.js';

const PAGE_SIZE = 24;
const VALID_SORTS = ['recent', 'price_asc', 'price_desc'];

const state = {
  search: getQueryParam('q') ?? '',
  categorySlug: getQueryParam('category') ?? '',
  // Un valor desconocido en la URL cae al orden por defecto
  sortBy: VALID_SORTS.includes(getQueryParam('sort')) ? getQueryParam('sort') : 'recent',
  // Acumulado de páginas ya cargadas: su longitud hace de offset para «Ver más»
  products: [],
  total: 0,
};

function updateUrl() {
  // replaceState mantiene la URL compartible sin recargar la página
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.categorySlug) params.set('category', state.categorySlug);
  if (state.sortBy !== 'recent') params.set('sort', state.sortBy);
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function updateHeading(total) {
  const heading = qs('#results-heading');
  if (!heading) return;
  const noun = total === 1 ? 'resultado' : 'resultados';
  // textContent evita cualquier inyección desde el término de búsqueda
  heading.textContent = state.search
    ? `${total} ${noun} para “${state.search}”`
    : `${total} ${noun}`;
}

function updateLoadMoreButton() {
  const wrapper = qs('#load-more');
  const button = qs('#load-more-button');
  if (!wrapper || !button) return;
  // El botón solo se ofrece cuando el servidor anuncia más resultados que los cargados
  wrapper.hidden = state.products.length >= state.total;
  button.disabled = false;
  button.textContent = 'Ver más resultados';
}

async function loadResults({ append = false } = {}) {
  const container = qs('#results-container');
  const button = qs('#load-more-button');
  if (append) {
    // El estado de carga vive en el propio botón para no vaciar la grilla visible
    if (button) {
      button.disabled = true;
      button.textContent = 'Cargando…';
    }
  } else {
    // Cambio de búsqueda/filtros/orden: la paginación arranca de cero
    state.products = [];
    state.total = 0;
    setLoading(container);
  }
  try {
    const { products, total } = await fetchCatalog({
      search: state.search,
      categorySlug: state.categorySlug,
      sortBy: state.sortBy,
      limit: PAGE_SIZE,
      offset: state.products.length,
    });
    state.products = state.products.concat(products);
    state.total = total;
    updateHeading(total);
    if (state.products.length === 0) {
      renderEmptyState(container, {
        title: 'No encontramos resultados',
        text: 'Prueba con otras palabras o revisa los filtros seleccionados.',
        actionHtml: '<a class="btn btn--secondary" href="./search.html">Ver todo el catálogo</a>',
      });
      updateLoadMoreButton();
      return;
    }
    // Se re-renderiza el acumulado completo para mantener una sola grilla
    renderProductGrid(container, state.products);
    updateLoadMoreButton();
  } catch (error) {
    console.error(error);
    if (!append) {
      renderEmptyState(container, {
        title: 'No pudimos cargar los resultados',
        text: 'Verifica tu conexión e inténtalo de nuevo.',
      });
    }
    // Si falla al paginar se conserva lo cargado y el botón queda listo para reintentar
    updateLoadMoreButton();
    showToast('Error al cargar los resultados', 'error');
  }
}

async function loadCategoryFilter() {
  const select = qs('#category-filter');
  if (!select) return;
  try {
    const categories = await fetchCategories();
    for (const category of categories) {
      // createElement + textContent: sin interpolación HTML, sin escapes manuales
      const option = document.createElement('option');
      option.value = category.slug;
      option.textContent = category.name;
      select.appendChild(option);
    }
    // Refleja la categoría de la URL; si el slug no existe queda «Todas»
    select.value = state.categorySlug;
  } catch (error) {
    console.error(error);
    showToast('No se pudieron cargar las categorías', 'error');
  }
}

function initFilters() {
  const categorySelect = qs('#category-filter');
  const sortSelect = qs('#sort-filter');
  if (!categorySelect || !sortSelect) return;
  sortSelect.value = state.sortBy;

  categorySelect.addEventListener('change', () => {
    state.categorySlug = categorySelect.value;
    updateUrl();
    loadResults();
  });
  sortSelect.addEventListener('change', () => {
    state.sortBy = sortSelect.value;
    updateUrl();
    loadResults();
  });
}

function initLoadMore() {
  const button = qs('#load-more-button');
  if (!button) return;
  button.addEventListener('click', () => loadResults({ append: true }));
}

// searchQuery conserva el término escrito en el buscador del header
initLayout({ searchQuery: state.search });
if (state.search) {
  document.title = `${state.search} — Stocki`;
}
initFilters();
initLoadMore();
loadCategoryFilter();
loadResults();
