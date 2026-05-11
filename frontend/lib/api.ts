// For Twingate/Remote access to work, we must use relative paths
// so the request goes to Next.js (port 3000) which proxies to Flask (port 5000).
// If we set this to localhost:5000, remote devices will try to hit *their own* localhost.
export const API_BASE_URL = '';

export interface Patient {
    patient_id: string;
    name: string;
    phone_number: string;
    age?: number;
    sex?: string;
    dob?: string | null; // Deprecated but kept for type compat
    address?: string;
    reference?: string;
    created_at?: string;
}

export interface Visit {
    visit_id: string;
    patient_id: string;
    patient_name: string;
    visit_date: string;
    visit_time: string;
    status: string;
    reason?: string;
    created_at?: string;
    updated_at?: string;
    phone_number?: string;
    dob?: string;
    visiting_fee?: number;
    amount_paid?: number;
    payment_status?: string;
}

export interface InventoryBatch {
    id: number
    quantity: number
    initial_quantity?: number
    free_quantity?: number
    expiry_date: string | null
    mrp: number
    purchase_rate: number
    vendor: string | null
    invoice_number: string | null
    batch_number?: string | null
    gst_rate?: number
}

export interface InventoryItem {
    id: string;
    item_name: string;
    // dosage removed
    category: string;
    quantity: number;
    price: number;
    min_price?: number;
    max_price?: number;
    min_stock_level: number;
    total_value: number;
    manufacturer?: string;
    vendors?: string[];
    expiry_date?: string;
    status: string[]; /* 'OK' | 'LOW STOCK' | 'EXPIRED' | 'EXPIRES SOON' */
    pack_size?: string;
    hsn_code?: string;
    gst_rate?: number;
    formula?: string;
}

export interface CreateVisitData {
    patient_id: string;
    visit_date: string;
    visit_time?: string;
    status?: string;
    reason?: string;
    visiting_fee?: number;
    amount_paid?: number;
    payment_status?: string;
}

export interface InventorySearchResult {
    id: string;
    item_name: string;
    manufacturer?: string;
    dosage: string;
    gst_rate: number;
    total_qty: number;
    price: number;
    pack_size?: string;
    substitutes: any[];
}

export interface InventoryHistoryEntry {
    id: number;
    type: string;
    change_amount: number;
    batch_id: number | null;
    bill_id: string | null;
    timestamp: string;
}

export interface BillingHistoryEntry {
    invoice_id: string;
    date: string;
    patient_name: string;
    patient_id: string;
    total_amount: number;
    payment_type: string;
    visit_id?: string;
}

export interface BillingHistoryFilters {
    date_from?: string;
    date_to?: string;
    payment_type?: string;
    page?: number;
    limit?: number;
}

export interface BillingHistoryResponse {
    bills: BillingHistoryEntry[];
    total: number;
    page: number;
    limit: number;
    pages: number;
}

export interface UploadInventoryResponse {
    message: string;
    path: string;
    ocr_data: string | Record<string, unknown> | { error: string };
}

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
        this.name = 'ApiError';
    }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options?.headers,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new ApiError(response.status, errorText || response.statusText);
        }

        return await response.json();
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new Error(`Network error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// API Functions

export const api = {
    // Test connection
    async testConnection(): Promise<{ status: string; message: string }> {
        return fetchApi('/api/health');
    },

    // Patient APIs
    async getPatients(page = 1, limit = 50): Promise<Patient[]> {
        return fetchApi(`/api/patients?page=${page}&limit=${limit}`);
    },

    async getPatient(id: string): Promise<Patient> {
        return fetchApi(`/api/patients/${id}`);
    },

    async createPatient(data: Omit<Patient, 'patient_id' | 'created_at'>): Promise<Patient> {
        return fetchApi('/api/patients', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updatePatient(id: string, data: Partial<Patient>): Promise<void> {
        return fetchApi(`/api/patients/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async exportPatients() {
        window.location.href = `${API_BASE_URL}/api/patients/export`
    },

    async importPatients(file: File) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${API_BASE_URL}/api/patients/import`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error(err.error || 'File verification failed on server')
        }
        return res.json()
    },

    // Inventory APIs
    async getInventory(): Promise<InventoryItem[]> {
        return fetchApi('/api/inventory');
    },

    async getInventoryBatches(id: string): Promise<InventoryBatch[]> {
        const res = await fetch(`${API_BASE_URL}/api/inventory/${id}/batches`)
        if (!res.ok) throw new Error('Failed to fetch batches')
        return res.json()
    },

    async updateInventoryItem(id: string, data: Partial<InventoryItem>): Promise<void> {
        return fetchApi(`/api/inventory/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteInventoryItem(id: string): Promise<void> {
        return fetchApi(`/api/inventory/${id}`, {
            method: 'DELETE',
        });
    },

    async updateInventoryBatch(id: number, data: { expiry_date?: string, quantity?: number, mrp?: number, purchase_rate?: number }): Promise<void> {
        return fetchApi(`/api/inventory/batch/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async getInventoryAnalytics(location?: string): Promise<{
        all: any;
        year: any;
        month: any;
        today: any;
        ledger_expense_pie: { label: string, value: number }[];
        sitting_inventory_value: number;
        busy_day_matrix: { d: string, c: number }[];
        today_by_payment: { type: string; value: number }[];
        
        // Compatibility keys to prevent breaking the old status page
        total_purchase_cost: number;
        medicine_revenue: number;
        total_visits: number;
        visit_fees_collected: number;
        total_invoices_count: number;
        total_sales_count: number;
        total_current_value: number;
        visit_fees_pending: number;
        month_medicine: number;
        month_visit_fees: number;
        today_medicine: number;
        today_visit_fees: number;
        today_visit_fees_pending: number;
        weekly_income: { week: string; medicine: number; visit_fees: number }[];
        category_stock: { category: string; value: number }[];
        category_sales: { category: string; value: number }[];
        top_items: { name: string; revenue: number; qty_sold: number }[];
        low_stock: { name: string; qty: number }[];
        out_of_stock: { name: string; qty: number }[];
        expired: { name: string; expiry: string; qty: number }[];
        expiring_soon: { name: string; expiry: string; qty: number }[];
        low_stock_count: number;
        expiring_count: number;
    }> {
        const qs = location && location !== 'all' ? `?location=${encodeURIComponent(location)}` : '';
        return fetchApi(`/api/inventory_analytics${qs}`);
    },

    async exportInventory() {
        // Trigger download directly
        window.location.href = `${API_BASE_URL}/api/inventory/export`
    },

    async importInventory(file: File, mode: 'update' | 'overwrite') {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', mode)

        const res = await fetch(`${API_BASE_URL}/api/inventory/import`, {
            method: 'POST',
            body: formData,
        })
        if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error || 'Failed to import')
        }
        return res.json()
    },

    async uploadInventoryReport(file: File): Promise<UploadInventoryResponse> {
        const formData = new FormData();
        formData.append('file', file);

        // We use raw fetch here because fetchApi uses application/json content-type by default
        // which breaks multipart/form-data upload
        const res = await fetch(`${API_BASE_URL}/api/inventory/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || res.statusText);
        }

        return await res.json();
    },

    async saveInvoice(data: any): Promise<{ message: string; invoice_number: string }> {
        return fetchApi('/api/inventory/save_invoice', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getInvoices(): Promise<any[]> {
        return fetchApi('/api/inventory/invoices');
    },

    async getInvoiceDetail(id: string): Promise<{ invoice: any; items: any[] }> {
        return fetchApi(`/api/inventory/invoices/${id}`);
    },

    async getInventoryHistory(productId: string, page = 1, limit = 50): Promise<{ history: InventoryHistoryEntry[]; page: number; limit: number }> {
        return fetchApi(`/api/inventory/${encodeURIComponent(productId)}/history?page=${page}&limit=${limit}`);
    },

    // Visit APIs
    async getVisits(patientId?: string): Promise<Visit[]> {
        const endpoint = patientId ? `/api/visits/patient/${patientId}` : '/api/visits';
        return fetchApi(endpoint);
    },

    async getVisit(id: string): Promise<Visit> {
        return fetchApi(`/api/visits/${id}`);
    },

    async createVisit(data: CreateVisitData): Promise<Visit> {
        return fetchApi('/api/visits', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async updateVisit(id: string, data: Partial<CreateVisitData>): Promise<Visit> {
        return fetchApi(`/api/visits/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async deleteVisit(id: string): Promise<void> {
        return fetchApi(`/api/visits/${id}`, {
            method: 'DELETE',
        });
    },

    // Billing APIs
    async getBillingHistory(filters?: BillingHistoryFilters): Promise<BillingHistoryResponse> {
        const params = new URLSearchParams()
        if (filters?.date_from) params.set('date_from', filters.date_from)
        if (filters?.date_to) params.set('date_to', filters.date_to)
        if (filters?.payment_type) params.set('payment_type', filters.payment_type)
        if (filters?.page != null) params.set('page', String(filters.page))
        if (filters?.limit != null) params.set('limit', String(filters.limit))
        const qs = params.toString()
        return fetchApi(`/api/billing/history${qs ? `?${qs}` : ''}`)
    },

    async getPatientBillingHistory(patientId: string): Promise<any[]> {
        return fetchApi(`/api/billing/patient/${patientId}`);
    },

    async createBill(data: any): Promise<{ invoice_id: string; total: number }> {
        return fetchApi('/api/billing', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getBillDetails(invoiceId: string): Promise<any> {
        return fetchApi(`/api/billing/${invoiceId}`);
    },

    async deleteBill(invoiceId: string): Promise<void> {
        return fetchApi(`/api/billing/${invoiceId}`, {
            method: 'DELETE',
        });
    },

    async getInventoryAllChanges(dateFrom?: string, dateTo?: string): Promise<any> {
        const params = new URLSearchParams()
        if (dateFrom) params.set('date_from', dateFrom)
        if (dateTo) params.set('date_to', dateTo)
        const qs = params.toString()
        return fetchApi(`/api/inventory/all-changes${qs ? `?${qs}` : ''}`)
    },

    // Billing Search
    async searchInventory(query: string): Promise<InventorySearchResult[]> {
        if (!query) return []
        return fetchApi(`/api/inventory/search?q=${encodeURIComponent(query)}`)
    },

    // Patient Images
    async uploadPatientImage(patientId: string, file: File, visitId?: string, notes?: string) {
        const formData = new FormData()
        formData.append('file', file)
        if (visitId) formData.append('visit_id', visitId)
        if (notes) formData.append('notes', notes)

        const res = await fetch(`${API_BASE_URL}/api/patients/${patientId}/images`, {
            method: 'POST',
            body: formData,
        })
        if (!res.ok) {
            const err = await res.text()
            throw new Error(err || 'Failed to upload image')
        }
        return res.json()
    },

    async updatePatientImage(imageId: number, data: { notes?: string, tag?: string }) {
        return fetchApi(`/api/patients/images/${imageId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        })
    },

    async getPatientImages(patientId: string): Promise<any[]> {
        return fetchApi(`/api/patients/${patientId}/images`)
    },

    async getAllPatientImages(): Promise<any[]> {
        return fetchApi('/api/patients/images')
    },

    // QR Code Upload
    async createUploadSession(contextType: 'patient' | 'inventory', contextId: string): Promise<{ session_id: string; url_path: string }> {
        return fetchApi('/api/upload/session', {
            method: 'POST',
            body: JSON.stringify({ context_type: contextType, context_id: contextId }),
        })
    },

    async getUploadSession(sessionId: string): Promise<{ status: string; files: any[]; context_type: string; context_id: string }> {
        return fetchApi(`/api/upload/session/${sessionId}`)
    },

    async uploadMobileFiles(sessionId: string, files: FileList | File[], tags: string[], notes: string) {
        const formData = new FormData()
        // Handle FileList or Array
        const fileArray = files instanceof FileList ? Array.from(files) : files
        fileArray.forEach(f => formData.append('file', f))

        tags.forEach(t => formData.append('tags', t))
        formData.append('notes', notes)

        const res = await fetch(`${API_BASE_URL}/api/upload/mobile/${sessionId}`, {
            method: 'POST',
            body: formData
        })
        if (!res.ok) throw new Error('Failed to upload')
        return res.json()
    },

    async finalizeUploadSession(sessionId: string): Promise<any> {
        return fetchApi(`/api/upload/session/${sessionId}/finalize`, {
            method: 'POST'
        })
    },

    // Patient Image Trash
    async deletePatientImage(imageId: number): Promise<void> {
        return fetchApi(`/api/patients/images/${imageId}`, {
            method: 'DELETE',
        })
    },

    async getTrashImages(patientId?: string): Promise<any[]> {
        const qs = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : ''
        return fetchApi(`/api/patients/images/trash${qs}`)
    },

    async restorePatientImage(imageId: number): Promise<void> {
        return fetchApi(`/api/patients/images/${imageId}/restore`, {
            method: 'POST',
        })
    },

    async permanentDeleteImage(imageId: number): Promise<void> {
        const url = `${API_BASE_URL}/api/patients/images/${imageId}/permanent`
        const response = await fetch(url, { method: 'DELETE' })
        if (!response.ok && response.status !== 204) {
            const errorText = await response.text()
            throw new ApiError(response.status, errorText || response.statusText)
        }
    },

    // Ledger APIs
    async getLedger(location?: string, page = 1, limit = 20): Promise<any[]> {
        const params = new URLSearchParams();
        if (location && location !== 'all') params.set('location', location);
        params.set('page', String(page));
        params.set('limit', String(limit));
        return fetchApi(`/api/ledger?${params.toString()}`);
    },

    async createLedgerItem(data: { title: string, amount: number, category: string, frequency: string, location: string, notes?: string }): Promise<{ id: number }> {
        return fetchApi('/api/ledger', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async deleteLedgerItem(id: number): Promise<void> {
        return fetchApi(`/api/ledger/${id}`, {
            method: 'DELETE'
        });
    }
};

// Auth API helpers
export async function login(username: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Login failed')
  }
  return res.json() as Promise<{ user_id: string; username: string; role: string }>
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
}

export async function getMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) return null
  return res.json() as Promise<{ user_id: string; username: string; role: string; location_label?: string }>
}

export async function verifyTotp(totp_code: string) {
  const res = await fetch('/api/auth/verify-totp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ totp_code }),
  })
  return { ok: res.ok }
}

export async function register(data: {
  totp_code: string
  username: string
  password: string
  role: 'staff' | 'doctor' | 'admin'
  location_label?: string
}) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Registration failed')
  }
}

export async function getAssignedStaff() {
  const res = await fetch('/api/auth/users/me/assigned-staff', { credentials: 'include' })
  if (!res.ok) return []
  return res.json() as Promise<Array<{ user_id: string; username: string; role: string; location_label?: string }>>
}

// --- Admin APIs ---

export interface AdminUser {
  user_id: string
  username: string
  email: string
  role: 'staff' | 'doctor' | 'admin'
  is_active: boolean
  location_label?: string | null
  created_at: string
  assigned_staff_ids?: string[]
}

export interface ActivityEntry {
  id: number
  user_id: string | null
  username: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  resource_label: string | null
  details: string | null
  timestamp: string
  ip_address: string | null
}

export interface ActivityLogFilters {
  user_id?: string
  action?: string
  resource_type?: string
  date_from?: string
  date_to?: string
  page?: number
  limit?: number
}

export async function getAdminStats() {
  const res = await fetch('/api/admin/stats', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load stats')
  return res.json() as Promise<{
    users_by_role: Record<string, number>
    active_users: number
    inactive_users: number
    logins_today: number
    activities_today: number
    visits_today: number
    bills_today: number
    total_audit_entries: number
    total_patients: number
    recent_activity: ActivityEntry[]
  }>
}

export interface SystemDiagnostics {
  ocr_configured: boolean
  db_size_bytes: number
  media_size_bytes: number
  system_disk: {
    total: number
    used: number
    free: number
  }
  timestamp: string
}

export async function getSystemDiagnostics() {
  const res = await fetch('/api/admin/diagnostics', { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to run diagnostics')
  return res.json() as Promise<SystemDiagnostics>
}

export async function getAdminUsers(role?: string) {
  const qs = role ? `?role=${role}` : ''
  const res = await fetch(`/api/admin/users${qs}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load users')
  return res.json() as Promise<AdminUser[]>
}

export async function updateAdminUser(userId: string, data: { role?: string; is_active?: boolean; location_label?: string | null }) {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || 'Update failed')
  }
}

export async function getActivityLog(filters: ActivityLogFilters = {}) {
  const params = new URLSearchParams()
  if (filters.user_id) params.set('user_id', filters.user_id)
  if (filters.action) params.set('action', filters.action)
  if (filters.resource_type) params.set('resource_type', filters.resource_type)
  if (filters.date_from) params.set('date_from', filters.date_from)
  if (filters.date_to) params.set('date_to', filters.date_to)
  if (filters.page) params.set('page', String(filters.page))
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()
  const res = await fetch(`/api/admin/activity-log${qs ? `?${qs}` : ''}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to load activity log')
  return res.json() as Promise<{
    total: number
    page: number
    limit: number
    pages: number
    entries: ActivityEntry[]
  }>
}

export { ApiError };
