// Archivo: /supabase/functions/_shared/dropi/adapter.ts
// Contrato del adaptador de Dropi. Todo el código de Stocki depende de esta
// interfaz y NUNCA de una implementación concreta: así el día que llegue la
// API real solo se reemplaza la implementación en index.ts sin tocar nada más.

export interface DropiProduct {
  id: string;
  name: string;
  description: string;
  // Costo del proveedor en COP; el precio de venta lo fija cada vendedor.
  cost_price: number;
  stock: number;
  images: string[];
  category: string;
}

export interface DropiOrderItem {
  dropi_product_id: string;
  quantity: number;
}

export interface DropiShipping {
  name: string;
  phone: string;
  address: string;
  city: string;
  department: string;
  notes?: string;
}

export interface DropiOrderRequest {
  // Id de la orden en Stocki: permite conciliar ambos sistemas.
  external_id: string;
  items: DropiOrderItem[];
  shipping: DropiShipping;
}

export interface DropiOrderResult {
  dropi_order_id: string;
  status: string;
}

export interface DropiSearchParams {
  search?: string;
  page?: number;
}

export interface DropiSearchResult {
  products: DropiProduct[];
  page: number;
  total_pages: number;
}

export interface DropiAdapter {
  searchProducts(params: DropiSearchParams): Promise<DropiSearchResult>;
  getProduct(id: string): Promise<DropiProduct | null>;
  createOrder(req: DropiOrderRequest): Promise<DropiOrderResult>;
}
