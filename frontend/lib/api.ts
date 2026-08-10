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
    reference_patient_id?: string | null;
    reference_patient_name?: string | null;
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
    refund_amount?: number;
    refund_mode?: string;
    payment_status?: string;
    payment_mode?: string;
    billed_amount?: number | null;
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
    min_stock_override: boolean;
    total_value: number;
    manufacturer?: string;
    vendors?: string[];
    expiry_date?: string;
    status: string[]; /* 'OK' | 'LOW STOCK' | 'EXPIRED' | 'EXPIRES SOON' */
    pack_size?: string;
    hsn_code?: string;
    gst_rate?: number;
    formula?: string;
    rack_location?: string;
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
    payment_mode?: string;
}

export interface InventorySearchResult {
    id: string;
    item_name: string;
    manufacturer?: string;
    dosage: string;
    gst_rate: number;
    vendors?: string[];
    formula?: string | null;
    rack_location?: string | null;
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

export interface Location {
    id: number;
    name: string;
    is_active: boolean;
}

export interface BillingHistoryEntry {
    invoice_id: string;
    date: string;
    patient_name: string;
    patient_id: string | null;
    is_walk_in?: boolean;
    total_amount: number;
    payment_type: string;
    visit_id?: string;
}

export interface BillingHistoryFilters {
    date_from?: string;
    date_to?: string;
    payment_type?: string;
    is_walk_in?: 'true' | 'false';
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
}

export interface DailySummaryRow {
    type: 'visit' | 'walkin';
    visit_id?: string;
    invoice_id?: string;
    patient_id: string | null;
    patient_name: string;
    phone_number: string | null;
    reason: string | null;
    time: string;
    visit_fee: number | null;
    visit_fee_mode: 'cash' | 'upi' | 'other' | null;
    billing_fee: number | null;
    billing_fee_mode: 'cash' | 'upi' | 'other' | null;
}

export interface DailySummaryBucket {
    cash: number;
    upi: number;
    total: number;
}

export interface DailySummaryResponse {
    date: string;
    rows: DailySummaryRow[];
    summary: {
        visit_fee: DailySummaryBucket;
        billing_fee: DailySummaryBucket;
        total: DailySummaryBucket;
    };
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

    async getPatientsByPhone(phone: string): Promise<Patient[]> {
        return fetchApi<Patient[]>(`/api/patients?phone_number=${encodeURIComponent(phone)}`)
    },

    async searchPatients(query: string): Promise<Patient[]> {
        return fetchApi<Patient[]>(`/api/patients?q=${encodeURIComponent(query)}`)
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
    async getInventory(expiryMonths?: number, locationId?: number): Promise<InventoryItem[]> {
        const params = new URLSearchParams()
        if (expiryMonths) params.set('expiry_months', expiryMonths.toString())
        if (locationId) params.set('location_id', locationId.toString())
        const qs = params.toString() ? `?${params}` : ''
        return fetchApi(`/api/inventory${qs}`)
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

    async applyDefaultMinStock(value: number): Promise<{ updated: number }> {
        return fetchApi('/api/inventory/products/apply_default_min_stock', {
            method: 'PATCH',
            body: JSON.stringify({ default_min_stock: value }),
        });
    },

    async wipeInventory(totpCode: string): Promise<{ message: string }> {
        return fetchApi('/api/admin/inventory/wipe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ totp_code: totpCode }),
        });
    },

    async updateInventoryBatch(id: number, data: { expiry_date?: string, quantity?: number, mrp?: number, purchase_rate?: number }): Promise<void> {
        return fetchApi(`/api/inventory/batch/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    async getInventoryAnalytics(locationId?: number | 'all'): Promise<{
        today: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        month: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        year: { income: number; outcome: number; net: number; pharmRev: number; consultRev: number; visits: number; pBills: number; paid: number; marginPct: number };
        sitting_inventory_value: number;
        [key: string]: any;
    }> {
        const qs = (locationId && locationId !== 'all') ? `?location_id=${locationId}` : '';
        return fetchApi(`/api/inventory_analytics${qs}`);
    },

    exportInventory() {
        window.location.href = `${API_BASE_URL}/api/inventory/export`
    },
    exportInventoryEdit(scope: string) {
        window.location.href = `${API_BASE_URL}/api/inventory/export/edit?scope=${encodeURIComponent(scope)}`
    },

    async parseImportHeaders(file: File): Promise<{
        headers: string[];
        known_fields: string[];
        known_clinics: { header: string; location_name: string }[];
        unknown: string[];
        needs_mapping: boolean;
    }> {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${API_BASE_URL}/api/inventory/import/parse-headers`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        })
        if (!res.ok) {
            const err = await res.json().catch(() => ({}))
            throw new Error((err as any).error || 'Failed to parse headers')
        }
        return res.json()
    },

    async importInventory(
        file: File,
        mode: 'update' | 'overwrite',
        fieldMapping?: Record<string, string>,
        clinicMapping?: Record<string, number>,
        defaultMinStock?: number,
    ) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', mode)
        if (fieldMapping && Object.keys(fieldMapping).length > 0) {
            formData.append('field_mapping', JSON.stringify(fieldMapping))
        }
        if (clinicMapping && Object.keys(clinicMapping).length > 0) {
            formData.append('clinic_mapping', JSON.stringify(clinicMapping))
        }
        const qs = defaultMinStock ? `?default_min_stock=${defaultMinStock}` : ''
        const res = await fetch(`${API_BASE_URL}/api/inventory/import${qs}`, {
            method: 'POST',
            body: formData,
            credentials: 'include',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as any).error || 'Failed to import')
        return data
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

    async saveInvoice(data: any): Promise<{ message: string; invoice_number: string; warnings?: string[] }> {
        return fetchApi('/api/inventory/save_invoice', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    async getInvoices(locationId?: number): Promise<any[]> {
        const qs = locationId ? `?location_id=${locationId}` : ''
        return fetchApi(`/api/inventory/invoices${qs}`);
    },

    async getInvoiceDetail(id: string): Promise<{ invoice: any; items: any[] }> {
        return fetchApi(`/api/inventory/invoices/${id}`);
    },

    async updateInvoice(id: string, data: { paid_date?: string | null; payment_mode?: string | null; image_path?: string | null }): Promise<{ message: string }> {
        return fetchApi(`/api/inventory/invoices/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    },

    async getInventoryHistory(productId: string, page = 1, limit = 50): Promise<{ history: InventoryHistoryEntry[]; page: number; limit: number }> {
        return fetchApi(`/api/inventory/${encodeURIComponent(productId)}/history?page=${page}&limit=${limit}`);
    },

    // Visit APIs
    async getVisits(patientId?: string, filters?: { date_from?: string; date_to?: string }): Promise<Visit[]> {
        if (patientId) {
            return fetchApi(`/api/visits/patient/${patientId}`);
        }
        const params = new URLSearchParams()
        if (filters?.date_from) params.set('date_from', filters.date_from)
        if (filters?.date_to) params.set('date_to', filters.date_to)
        const qs = params.toString()
        return fetchApi(`/api/visits${qs ? `?${qs}` : ''}`);
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

    async refundVisit(id: string, amount: number, mode: 'cash' | 'upi'): Promise<{ refund_amount: number; payment_status: string; refund_mode: string }> {
        return fetchApi(`/api/visits/${id}/refund`, {
            method: 'POST',
            body: JSON.stringify({ amount, mode }),
        });
    },

    // Billing APIs
    async getBillingHistory(filters?: BillingHistoryFilters): Promise<BillingHistoryResponse> {
        const params = new URLSearchParams()
        if (filters?.date_from) params.set('date_from', filters.date_from)
        if (filters?.date_to) params.set('date_to', filters.date_to)
        if (filters?.payment_type) params.set('payment_type', filters.payment_type)
        if (filters?.is_walk_in) params.set('is_walk_in', filters.is_walk_in)
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

    async getLocations(): Promise<Location[]> {
        return fetchApi('/api/admin/locations');
    },
    async createLocation(name: string): Promise<Location> {
        return fetchApi('/api/admin/locations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
    },
    async updateLocation(id: number, data: { name?: string; is_active?: boolean }): Promise<Location> {
        return fetchApi(`/api/admin/locations/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },
    async deleteLocation(id: number): Promise<{ ok?: boolean; error?: string }> {
        return fetchApi(`/api/admin/locations/${id}`, { method: 'DELETE' });
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
    async getLedger(locationId?: number | 'all', page = 1, limit = 20): Promise<any[]> {
        const params = new URLSearchParams()
        if (locationId && locationId !== 'all') params.set('location_id', locationId.toString())
        params.set('page', page.toString())
        params.set('limit', limit.toString())
        const res = await fetch(`${API_BASE_URL}/api/ledger?${params}`, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to fetch ledger')
        return res.json()
    },

    async getDailySummary(date: string, locationId?: number | 'all'): Promise<DailySummaryResponse> {
        const params = new URLSearchParams({ date })
        if (locationId && locationId !== 'all') params.set('location_id', locationId.toString())
        return fetchApi(`/api/daily_summary?${params.toString()}`)
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
  return res.json() as Promise<{ user_id: string; username: string; role: string; location_label?: string; location_id?: number | null }>
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
  location_id?: number | null
  location_name?: string | null
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
