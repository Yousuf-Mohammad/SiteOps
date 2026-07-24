# SiteOps — Operations Platform (starter)

Multi-tenant operations platform for road-works contractors. Projects, equipment, plant dockets, site notes, and the burn dashboard are live. The **expense claims** workflow (lodgment, approvals, LegacyPlant import) is in progress — see the assessment brief for what to build. Priya got the create/read path running before rotating off the project; it's your module now.

## Layout

- `api/` — NestJS 11 + Prisma 6 + PostgreSQL
  - `src/common/` — platform kernel: response envelope, pagination, permissions guard/decorator, exception filter, number sequences
  - `src/audit/` — audit-trail service
  - `src/outbox/` — transactional outbox (dev relay logs deliveries)
  - `src/projects/`, `src/equipment/`, `src/dockets/`, `src/notes/`, `src/reports/` — platform modules
  - `src/claims/` — expense claims module (in progress)
  - `src/users/` — org members (used by the dev user-switcher)
- `web/` — Next.js App Router + TypeScript + TanStack React Query
  - `app/dashboard`, `app/projects`, `app/equipment`, `app/dockets`, `app/claims` — feature screens
  - `lib/api/` — API client · `lib/query/` — cache keys · `lib/use-acting-user.ts` — acting user + permissions
  - `components/` — shell, nav, user switcher, notes panel

## Getting started

```bash
# database
cd api
docker compose up -d
cp .env.example .env

# api
npm install
npx prisma migrate dev
npx prisma db seed          # prints seeded user/org ids
npm run start:dev           # http://localhost:3100

# web
cd ../web
npm install
cp .env.example .env.local  # fill in an org id + default user id from the seed output
npm run dev                 # http://localhost:3000
```

## Fake auth

There is no real auth. Requests identify themselves with two headers:

- `x-user-id` — a seeded user id (the web app's top-right switcher sets this)
- `x-org-id` — the acting organization

Seeded org `roadco`: Alice, Bob (supervisors), Carol (site lead — approves claims, confirms dockets, manages projects/equipment), Dan (approver). Org `pavecorp`: Eve (site lead).
