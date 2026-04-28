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
    prescription?: string;
    created_at?: string;
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
}

export interface CreateVisitData {
    patient_id: string;
    visit_date: string;
    visit_time?: string;
    status?: string;
    reason?: string;
    prescription?: string;
    visiting_fee?: number;
    amount_paid?: number;
    payment_status?: string;
}

export interface PrescriptionItem {
    id?: number;
    product_id?: string;
    item_name: string;
    quantity: number;
    dosage_instructions?: string;
    duration?: string;
    notes?: string;
    dosage?: string; // from inventory
}

export interface InventorySearchResult {
    id: string;
    item_name: string;
    manufacturer?: string;
    dosage: string;
    gst_rate: number;
    total_qty: number;
    price: number;
    substitutes: any[];
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
    async getPatients(): Promise<Patient[]> {
        return fetchApi('/api/patients');
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

    async updateInventoryBatch(id: number, data: { expiry_date?: string, quantity?: number, mrp?: number, purchase_rate?: number }): Promise<void> {
        return fetchApi(`/api/inventory/batch/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
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

    // Visit APIs
    async getVisits(patientId?: string): Promise<Visit[]> {
        const endpoint = patientId ? `/api/visits/patient/${patientId}` : '/api/visits';
        return fetchApi(endpoint);
    },

    async getVisit(id: string): Promise<Visit> {
        return fetchApi(`/api/visits/${id}`);
    },

    async getPatientPrescriptionHistory(patientId: string): Promise<any[]> {
        return fetchApi(`/api/patients/${patientId}/prescriptions`);
    },

    async getAllPrescriptions(): Promise<any[]> {
        return fetchApi('/api/prescriptions');
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
    async getBillingHistory(): Promise<any[]> {
        return fetchApi('/api/billing/history');
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

    // Prescription APIs
    async getPrescription(visitId: string): Promise<PrescriptionItem[]> {
        return fetchApi(`/api/visits/${visitId}/prescription`);
    },

    async savePrescription(visitId: string, items: Partial<PrescriptionItem>[]): Promise<{ message: string; count: number }> {
        return fetchApi(`/api/visits/${visitId}/prescription`, {
            method: 'POST',
            body: JSON.stringify({ items }),
        });
    },

    async deletePrescriptionItem(visitId: string, itemId: number): Promise<void> {
        return fetchApi(`/api/visits/${visitId}/prescription/${itemId}`, {
            method: 'DELETE',
        });
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

    async finalizeUploadSession(sessionId: string): Promise<{ message: string; count: number }> {
        return fetchApi(`/api/upload/session/${sessionId}/finalize`, {
            method: 'POST'
        })
    }
};

export { ApiError };
