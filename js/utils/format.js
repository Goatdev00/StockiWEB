// Archivo: /js/utils/format.js
// Formateadores centralizados: un solo lugar define cómo se muestran
// precios y fechas en toda la aplicación.

const copFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatPrice(value) {
  return copFormatter.format(Number(value) || 0);
}

export function formatDate(isoString) {
  if (!isoString) return '';
  return dateFormatter.format(new Date(isoString));
}

export const ORDER_STATUS_LABELS = {
  pendiente: 'Pendiente de pago',
  pagada: 'Pagada',
  enviada: 'Enviada',
  entregada: 'Entregada',
  cancelada: 'Cancelada',
};

export function formatOrderStatus(status) {
  return ORDER_STATUS_LABELS[status] ?? status;
}
