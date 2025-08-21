# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenPanel is an open-source alternative to Mixpanel - a web and product analytics platform combining the power of Mixpanel with the ease of Plausible.

## Development Commands

### Initial Setup
```bash
# Add to hosts file: 127.0.0.1 op.local api.op.local
pnpm dock:up          # Start Docker containers (PostgreSQL, Redis, ClickHouse)
pnpm codegen          # Generate Prisma client and geo data
pnpm migrate:deploy   # Setup database schema
pnpm dev              # Start all services
```

### Common Commands
```bash
# Development
pnpm dev              # Start all services in parallel
pnpm dev:public       # Start only public site

# Docker & Database
pnpm dock:up          # Start Docker containers
pnpm dock:down        # Stop Docker containers
pnpm dock:ch          # Access ClickHouse terminal
pnpm dock:redis       # Access Redis terminal
pnpm migrate          # Run database migrations (dev)
pnpm migrate:deploy   # Run database migrations (production)

# Code Quality
pnpm lint             # Run Biome linter
pnpm lint:fix         # Fix linting issues
pnpm typecheck        # Run TypeScript checks across workspace
pnpm test             # Run tests with Vitest

# Code Generation
pnpm codegen          # Generate Prisma client and geo data
pnpm gen:bots         # Generate bot detection rules (API)
pnpm gen:referrers    # Generate referrer data (Worker)
```

## Architecture

### Monorepo Structure
- **apps/** - Main applications
  - `dashboard` - Next.js 14 admin dashboard (port 3000)
  - `api` - Fastify event tracking API (port 3333)
  - `worker` - BullMQ background job processor (port 9999)
  - `public` - Marketing website
  - `docs` - Documentation site

- **packages/** - Shared libraries
  - `db` - Database layer (Prisma, ClickHouse client)
  - `trpc` - Type-safe API layer with 18 routers
  - `queue` - BullMQ job queue management
  - `constants` - Shared constants (timeWindows, intervals, etc.)
  - `validation` - Zod schemas for data validation
  - `integrations` - Third-party service integrations

### Service Architecture

1. **Dashboard** → tRPC → **API** - Frontend communicates with backend via type-safe tRPC
2. **API** → Queue → **Worker** - Events are queued for background processing
3. **PostgreSQL** - User management, projects, organizations, configuration
4. **ClickHouse** - High-performance analytics event storage
5. **Redis** - Caching, pub/sub, and queue management

### Database Setup

- **PostgreSQL**: Main application data (users, projects, organizations)
- **ClickHouse**: Analytics events with custom query builder
- **Redis**: Cache layer, pub/sub, and BullMQ queues

### ClickHouse Query Builder

When writing ClickHouse queries, always use the custom query builder:
- `packages/db/src/clickhouse/query-builder.ts`
- `packages/db/src/clickhouse/query-functions.ts`

### Key Technical Decisions

- **Authentication**: Arctic for OAuth, Oslo for session management
- **API**: tRPC for type-safe client-server communication
- **Queue**: BullMQ for reliable background job processing
- **Styling**: Tailwind CSS with Shadcn UI components
- **State Management**: Redux Toolkit in dashboard
- **Email**: Resend for transactional emails

### Time Windows & Defaults

The application uses predefined time windows for analytics:
- Default time window: `60d` (60 days)
- Available options: 30min, lastHour, today, yesterday, 7d, 30d, 60d, 6m, 12m, monthToDate, lastMonth, yearToDate, lastYear, custom
- Constants defined in `packages/constants/index.ts`

### Development URLs

Local development uses custom hosts:
- Dashboard: https://op.local
- API: https://api.op.local
- Queue UI: http://localhost:9999

### Testing Approach

- Unit tests with Vitest
- Pre-push hooks run `pnpm typecheck && pnpm test`
- Test files use `.test.ts` extension

### Important Files

- `packages/constants/index.ts` - Time windows, intervals, chart types
- `packages/validation/src/index.ts` - Zod schemas for data validation
- `packages/db/prisma/schema.prisma` - Database schema
- `apps/dashboard/src/components/overview/useOverviewOptions.ts` - Dashboard state management