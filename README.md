# Fleet Manager

A full-stack **Fleet & Driver Management System** for managing drivers, documents, commissions, and fleet overview. Built with React (Vite) and Node.js (Express) with PostgreSQL.

---

## Table of Contents

- [Project Description](#project-description)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Setup](#environment-setup)
- [Development](#development)
- [Build](#build)
- [API Documentation](#api-documentation)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Project Description

Fleet Manager helps organizations:

- **Authenticate** users (login/register) with JWT and role-based access (admin, accountant, driver).
- **Manage drivers**: list, add, edit, soft-delete, view profile and activity.
- **Handle documents**: upload ID, license, contract files; verify, download, delete.
- **Configure commission**: percentage, fixed amount, or hybrid per driver.
- **View dashboard**: fleet stats, driver status, earnings, document stats, recent activity.
- **Log out** with confirmation.

---

## Tech Stack

| Layer      | Technologies |
| ---------- | ------------ |
| **Frontend** | React 19, TypeScript, Vite 7, Tailwind CSS, React Router, Zustand, React Query, Axios, Recharts |
| **Backend**  | Node.js, Express, TypeScript, PostgreSQL, JWT, bcrypt, Multer |
| **Database** | PostgreSQL |

---

## Project Structure

```
Fleet Manager/
├── frontend/                 # React (Vite) SPA
│   ├── public/
│   ├── src/
│   │   ├── api/              # API clients (drivers, auth, dashboard, documents)
│   │   ├── components/       # UI, dashboard, drivers, documents
│   │   ├── lib/              # api.ts (axios instance)
│   │   ├── pages/            # auth, dashboard, drivers, register
│   │   ├── store/            # authStore (Zustand)
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── backend/                  # Express API
│   ├── src/
│   │   ├── config/           # env, multer
│   │   ├── db/                # pool (PostgreSQL)
│   │   ├── middleware/       # auth (JWT, roles)
│   │   ├── modules/
│   │   │   ├── auth/         # login, register
│   │   │   ├── dashboard/    # stats, activity, documents
│   │   │   ├── documents/    # upload, list, verify, download
│   │   │   └── drivers/      # CRUD, activity, notes, soft delete
│   │   ├── app.ts
│   │   └── index.ts
│   ├── sql/
│   │   ├── schema.sql        # Full schema
│   │   ├── views.sql
│   │   └── migrations/       # 001, 002, 003...
│   ├── uploads/              # Uploaded files (create if missing)
│   ├── .env                  # Not committed; see Environment Setup
│   ├── package.json
│   └── tsconfig.json
│
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** or **yarn** or **pnpm**
- **PostgreSQL** 14+ (local or remote instance)

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-org/fleet-manager.git
cd fleet-manager
```

### 2. Backend setup

```bash
cd backend
npm install
```

Create a PostgreSQL database and run the schema:

```bash
# Using psql (adjust user/db name)
psql -U postgres -d your_database -f sql/schema.sql

# Run migrations if the DB already existed before new schema changes
psql -U postgres -d your_database -f sql/migrations/001_add_organization_id_to_driver_documents.sql
psql -U postgres -d your_database -f sql/migrations/002_soft_delete_drivers.sql
psql -U postgres -d your_database -f sql/migrations/003_commission_system.sql

# Commission legs sign fix (positive magnitudes + generated total_commission); then verify (expect empty result sets):
psql -U postgres -d your_database -f sql/migrations/038_commission_legs_positive.sql
psql -U postgres -d your_database -f sql/migrations/038_commission_legs_positive.verify.sql

# Single company commission on net income (drops dual-leg columns); then verify:
psql -U postgres -d your_database -f sql/migrations/039_single_company_commission.sql
psql -U postgres -d your_database -f sql/migrations/039_single_company_commission.verify.sql
```

### 3. Frontend setup

```bash
cd ../frontend
npm install
```

---

## Environment Setup

### Backend (`.env` in `backend/`)

Create `backend/.env` with:

```env
# Server
PORT=4100

# Database (required for production)
DATABASE_URL=postgresql://user:password@localhost:5432/fleet_manager

# JWT (use a long random string in production)
JWT_SECRET=your_jwt_secret_change_in_production
```

| Variable       | Description                    | Default (if omitted)     |
| -------------- | ------------------------------ | ------------------------ |
| `PORT`         | API server port                | `4100`                   |
| `DATABASE_URL` | PostgreSQL connection string   | *(required for DB access)* |
| `JWT_SECRET`   | Secret for signing JWT tokens  | `dev_jwt_secret_change_me` |

### Frontend (optional)

Create `frontend/.env` if you need to point the app at a different API:

```env
# API base URL (used by Vite as import.meta.env.VITE_API_URL)
VITE_API_URL=http://localhost:4100/api
```

If not set, the frontend defaults to `http://localhost:4100/api`.

---

## Development

### Run backend (API)

From the project root:

```bash
cd backend
npm run dev
```

- API: **http://localhost:4100**
- Health: **http://localhost:4100/health**
- API base path: **http://localhost:4100/api**

### Run frontend (React)

From the project root:

```bash
cd frontend
npm run dev
```

- App: **http://localhost:5173** (or the port Vite prints)

Use both terminals so the frontend can call the backend API.

---

## Build

### Backend

```bash
cd backend
npm run build
```

Output: `backend/dist/`. Run in production with:

```bash
npm start
```

### Frontend

```bash
cd frontend
npm run build
```

Output: `frontend/dist/`. Serve with any static file server or use:

```bash
npm run preview
```

---

## API Documentation

*(Placeholder for full API docs. You can replace this with OpenAPI/Swagger or a link to your docs.)*

**Base URL:** `http://localhost:4100/api` (or your deployed API URL)

| Area        | Prefix              | Description                    |
| ----------- | ------------------- | ------------------------------ |
| Auth        | `/api/auth`         | Login, register                |
| Drivers     | `/api/drivers`      | CRUD, activity, notes, delete  |
| Documents   | `/api/drivers`      | Upload, list, verify, download |
| Dashboard   | `/api/dashboard`    | Stats, status, earnings, activity |

- **Authentication:** Send `Authorization: Bearer <token>` for protected routes.
- **Roles:** Many routes require `admin` or `accountant` (enforced by backend).

A full API reference (endpoints, request/response shapes, errors) can be added here or in a separate `docs/` folder.

---

## Deployment

- **Backend:** Run `npm run build` then `npm start`; set `PORT`, `DATABASE_URL`, and `JWT_SECRET` in the production environment. Ensure PostgreSQL is reachable and migrations are applied.
- **Frontend:** Run `npm run build` and serve the `frontend/dist` folder with Nginx, a CDN, or a static host. Set `VITE_API_URL` at build time to your production API URL.
- **Database:** Use a managed PostgreSQL service; run `schema.sql` and migrations on the production DB.
- **Uploads:** Ensure `backend/uploads` exists and is writable; for multi-instance setups, use a shared store (e.g. S3) and adjust the app accordingly.

---

## Contributing

1. **Fork** the repository and create a branch from `main` (e.g. `feature/your-feature` or `fix/your-fix`).
2. **Follow** existing code style (TypeScript, existing patterns in frontend/backend).
3. **Test** your changes (run frontend and backend, test in the UI and/or with API calls).
4. **Commit** with clear messages; reference any issue numbers.
5. **Push** your branch and open a **Pull Request** against `main`.
6. Address review feedback; maintainers will merge when ready.

---

## License

[Add your license here, e.g. MIT, Apache 2.0, or "Proprietary - All rights reserved."]
