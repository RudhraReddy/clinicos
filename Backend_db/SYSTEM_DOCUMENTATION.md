# System Documentation

## 1. System Overview

The **Clinic Management System** is a backend service designed to manage core clinic operations including patient records, visit logging, inventory tracking, and billing. It is built using **Python (Flask)** and **PostgreSQL**, exposing a RESTful API for frontend applications.

### Key Features
- **Patient Management**: Secure storage of patient demographics with unique Hex-based IDs.
- **Visit Logging**: Tracking patient visits with detailed notes, status updates, and prescriptions.
- **Inventory Control**: Real-time stock tracking with history logging for usage and restocking.
- **Billing**: Integrated billing system that links visits and inventory usage to invoices.

### Architecture

```mermaid
graph TD
    Client[Frontend Application] -->|HTTP/REST| API[Flask API Layer]
    API -->|ORM| Models[SQLAlchemy Models]
    Models -->|SQL| DB[(PostgreSQL Database)]
```

## 2. Database Schema

The database consists of 5 main tables. The schema is designed with custom string-based IDs for business entities (Patients, Visits, Bills) to allow for human-readable or secure identifiers.

### ER Diagram

```mermaid
erDiagram
    PATIENTS ||--o{ VISITS : "has"
    PATIENTS ||--o{ BILLS : "billed to"
    VISITS |o--|| BILLS : "generates"
    INVENTORY ||--o{ INVENTORY_HISTORY : "tracks"
    BILLS ||--o{ INVENTORY_HISTORY : "consumes"

    PATIENTS {
        string patient_id PK "Hex (e.g. A1B2C3D4)"
        string phone_number "Indexed"
        string name
        date dob
        datetime created_at
    }

    VISITS {
        string visit_id PK "Format: PID-DDMMYY-XXX"
        string patient_id FK
        string invoice_id
        text reason
        text notes
        date visit_date
        time visit_time
        string status "in_progress, Done, cancelled"
        datetime created_at
    }

    BILLS {
        string invoice_id PK "Format: DDMMYY-XXX"
        string patient_id FK
        string visit_id FK
        numeric total_amount
        string payment_type "CASH, CARD, INSURANCE"
        datetime created_at
    }

    INVENTORY {
        int id PK
        string item_name
        int quantity
        int min_stock_level
        numeric price
        string supplier
        string category
        string unit
        date expiry_date
    }

    INVENTORY_HISTORY {
        int id PK
        int item_id FK
        string bill_id FK "Nullable"
        int change_amount
        string type "RESTOCK, USAGE"
        string notes
        datetime timestamp
    }
```

## 3. Data Flow

### 3.1 Patient Registration
When a new patient is registered, the system generates a random 8-character unique Hex ID.

```mermaid
sequenceDiagram
    participant User
    participant API
    participant DB

    User->>API: POST /patients {name, phone, dob}
    API->>API: Generate patient_id (e.g. 7B8F91)
    API->>DB: INSERT INTO patients
    DB-->>API: Success
    API-->>User: 201 Created {patient_id}
```

### 3.2 Visit Creation
Visits are linked to patients. The `visit_id` is a composite string containing the patient ID and current date.

```mermaid
sequenceDiagram
    participant User
    participant API
    participant DB

    User->>API: POST /visits {patient_id, reason...}
    API->>DB: Lookup Patient
    API->>API: Generate visit_id (PID-DATE-SUFFIX)
    API->>DB: INSERT INTO visits
    DB-->>API: Success
    API-->>User: 201 Created {visit_id}
```

### 3.3 Billing & Inventory Usage
Billing is the most complex flow as it involves creating a bill record AND updating inventory stock levels.

```mermaid
sequenceDiagram
    participant User
    participant API
    participant Inventory
    participant History
    participant Bill

    User->>API: POST /billing {items_used, patient, visit}
    API->>API: Calculate Total
    API->>Bill: Create Bill Record
    loop For each item
        API->>Inventory: Decrease Quantity
        API->>History: Log USAGE (linked to Bill ID)
    end
    API-->>User: 201 Created {invoice_id, total}
```

## 4. API Reference

### Base URL: `/api`

### Patients
| Method | Endpoint | Description |
|Args|---|---|
| POST | `/patients` | Create a new patient. |
| GET | `/patients` | Search patients by `phone_number` or list all (limit 50). |
| GET | `/patients/<id>` | Get details of a specific patient. |

### Visits
| Method | Endpoint | Description |
|---|---|---|
| POST | `/visits` | Log a new patient visit. |
| GET | `/visits` | Get list of recent visits (global). |
| GET | `/visits/patient/<id>` | Get all visits for a specific patient. |
| GET | `/visits/<id>` | Get details of a specific visit. |
| PATCH | `/visits/<id>` | Update visit status, reason, or notes. |

### Inventory
| Method | Endpoint | Description |
|---|---|---|
| GET | `/inventory` | List all inventory items with status (OK/LOW STOCK). |
| POST | `/inventory` | Add a new item to inventory. |
| POST | `/inventory/restock` | Restock an existing item (updates quantity + history). |

### Billing
| Method | Endpoint | Description |
|---|---|---|
| POST | `/billing` | Create a bill and deduct used inventory. |
| GET | `/billing/patient/<id>` | Get all invoices for a specific patient. |

## 5. Setup & Initialization

The database tables are initialized using `init_tables.py`. The application configuration is handled in `app.py`, which loads database credentials from environment variables (`.env`).
