# Clinic App Backend Documentation

## Overview
This is the backend service for the Clinic Application, built using **Flask** (Python) and **PostgreSQL**.
It manages patient records, visits, inventory, and billing.

## Setup
### Prerequisites
- Python 3.11+
- PostgreSQL
- `pip`

### Installation
1. Install system dependencies:
   ```bash
   sudo apt-get install -y postgresql postgresql-contrib libpq-dev python3-venv
   ```
2. Create and activate virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Set up Database:
   - Ensure PostgreSQL is running.
   - Create a database (e.g., `clinic_db`).
   - Run the app (first run will create tables if configured, or use migration script).

### Running the Server
```bash
python app.py
```
Server runs on `http://localhost:5000`.

---

## Database Schema

### 1. Patients (`patients`)
- **`patient_id`**: String (PK) - Unique Hex ID (e.g., `A1B2C3D4`).
- **`phone_number`**: String - Primary identifier. Indexed.
- **`name`**: String - Full name.
- **`dob`**: Date - Date of Birth.
- **`created_at`**: DateTime.

### 2. Inventory (`inventory`)
- **`id`**: Integer (PK).
- **`item_name`**: String.
- **`quantity`**: Integer - Current stock.
- **`min_stock_level`**: Integer - Threshold for low stock warning.
- **`price`**: Numeric - Unit price.
- **`supplier`**: String.
- **`category`**: String.
- **`unit`**: String - e.g., 'pcs', 'box'.
- **`expiry_date`**: Date.

### 3. InventoryHistory (`inventory_history`)
- **`id`**: Integer (PK).
- **`item_id`**: Integer (FK -> `inventory.id`).
- **`bill_id`**: String (FK -> `bills.invoice_id`, Nullable) - Links usage to a specific bill.
- **`change_amount`**: Integer - Positive for restock, negative for usage.
- **`type`**: Enum (String) - `RESTOCK`, `USAGE`, `ADJUSTMENT`.
- **`timestamp`**: DateTime.
- **`notes`**: Text.

### 4. Visits (`visits`)
- **`visit_id`**: String (PK) - Format: `patient_id-DDMMYY-XXX-XXX`.
- **`patient_id`**: String (FK -> `patients.patient_id`).
- **`invoice_id`**: String - Linked invoice ID.
- **`reason`**: Text.
- **`notes`**: Text - Extra notes.
- **`visit_date`**: Date.
- **`visit_time`**: Time.
- **`status`**: String - `in_progress`, `Done`, `cancelled`.
- **`created_at`**: DateTime.

### 5. Bills (`bills`)
- **`invoice_id`**: String (PK) - Format: `DDMMYY-XXX-XXX`.
- **`patient_id`**: String (FK -> `patients.patient_id`).
- **`visit_id`**: String (FK -> `visits.visit_id`, Nullable).
- **`total_amount`**: Numeric.
- **`payment_type`**: String - `CASH`, `CARD`, `INSURANCE`.
- **`created_at`**: DateTime.

---

## API Endpoints (`/api`)

### Patients

#### Create Patient
- **URL**: `/api/patients`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "name": "Jane Doe",
    "phone_number": "555-0199",
    "dob": "1980-05-15"
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "message": "Patient created",
    "public_id": "7B8F9123"
  }
  ```

#### Search Patients
- **URL**: `/api/patients?phone_number=<number>`
- **Method**: `GET`
- **Params**: `phone_number` (optional, filters results)
- **Response**: `200 OK` (List of patients)

#### Get Patient Details
- **URL**: `/api/patients/<public_id>`
- **Method**: `GET`
- **Response**: `200 OK`
  ```json
  {
    "public_id": "7B8F9123",
    "name": "Jane Doe",
    "phone_number": "555-0199",
    "dob": "1980-05-15",
    "created_at": "..."
  }
  ```

### Visits

#### Log Visit
- **URL**: `/api/visits`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "patient_public_id": "7B8F9123",
    "reason": "Flu Complains",
    "prescription": "Paracetamol",
    "doctor_notes": "Advised rest."
  }
  ```
- **Response**: `201 Created`

#### Get Patient Visits
- **URL**: `/api/visits/patient/<public_id>`
- **Method**: `GET`
- **Response**: `200 OK` (List of visits)

#### Get Recent Visits (Global)
- **URL**: `/api/visits`
- **Method**: `GET`
- **Response**: `200 OK` (List of 50 most recent visits with patient names)

### Inventory

#### Get Inventory
- **URL**: `/api/inventory`
- **Method**: `GET`
- **Response**: `200 OK`
  ```json
  [
    {
      "id": 1,
      "item_name": "Bandage",
      "quantity": 50,
      "price": 5.0,
      "category": "Wound Care",
      "unit": "box",
      "expiry_date": "2025-12-01",
      "status": "OK"
    }
  ]
  ```
  *Note: `status` will be "LOW STOCK" if `quantity < min_stock_level`.*

#### Add Item
- **URL**: `/api/inventory`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "item_name": "Syringe",
    "price": 10.5,
    "quantity": 100,
    "min_stock_level": 20,
    "supplier": "MedCorp",
    "category": "Injection",
    "unit": "pcs",
    "expiry_date": "2025-05-20"
  }
  ```

#### Restock Item
- **URL**: `/api/inventory/restock`
- **Method**: `POST`
- **Body**:
  ```json
  {
    "item_id": 1,
    "amount": 50,
    "notes": "Weekly supply"
  }
  ```

### Billing

#### Create Bill
- **URL**: `/api/billing`
- **Method**: `POST`
- **Description**: Creates a bill and automatically deducts used inventory items.
- **Body**:
  ```json
  {
    "patient_public_id": "7B8F9123",
    "visit_id": 123,
    "payment_type": "CASH",
    "items_used": [
        { "item_id": 1, "quantity": 2 }
    ],
    "total_amount": 100.00 
  }
  ```
  *(Note: `total_amount` is optional; if omitted, backend calculates based on item prices)*

- **Response**: `201 Created`
  ```json
  {
    "message": "Bill created",
    "invoice_id": "INV-2024...",
    "total": 100.00
  }
  ```

#### Get Patient Invoices
- **URL**: `/api/billing/patient/<public_id>`
- **Method**: `GET`
- **Response**: `200 OK`
  ```json
  [
    {
      "invoice_id": "INV-2024...",
      "total_amount": 100.0,
      "payment_type": "CASH",
      "created_at": "...",
      "visit_id": 123
    }
  ]
  ```
