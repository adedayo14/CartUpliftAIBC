# Cart Uplift - AI Coding Agent Instructions

## Project Overview
Cart Uplift is a Shopify app built with Remix that provides an enhanced cart drawer experience with ML-powered product recommendations, free shipping progress bars, and comprehensive analytics. The app uses a hybrid architecture combining a Remix admin interface with Shopify theme app extensions.

## Architecture & Key Components

### Core Stack
- **Backend**: Remix (Node.js) with Prisma ORM + PostgreSQL (Production)
- **Frontend**: React + Shopify Polaris + App Bridge
- **Shopify Integration**: `@shopify/shopify-app-remix` with session storage
- **Extension**: Shopify Theme App Extension (JavaScript/Liquid)
- **Deployment**: Vercel with serverless functions

### Database Schema (Prisma)
- **Session**: Shopify app sessions and merchant authentication
- **Settings**: Comprehensive cart configuration (70+ fields including ML settings, styling, behavior)
- **Production**: Uses `schema.production.prisma` when `DATABASE_DATABASE_URL` is set

### Key Service Boundaries
1. **Admin App** (`/app/routes/`): Merchant-facing settings and analytics dashboard
2. **Theme Extension** (`/extensions/cart-uplift/`): Customer-facing cart drawer implementation
3. **ML Service** (`/app/services/ml.server.ts`): Product recommendation engine
4. **API Layer**: RESTful endpoints for real-time cart interactions

## Development Workflows

### Essential Commands
```bash
# Development with Shopify CLI (includes tunnel, webhook forwarding)
npm run dev

# Build for production (handles schema switching)
npm run build

# Database operations
npm run setup           # Generate Prisma client + migrate
npm run db:reset       # Reset local database
prisma db push         # Push schema changes (production)

# ML/Testing utilities
npm run ml:seed        # Generate test orders for ML training
npm run inv:increase   # Bulk inventory management
```

### Dual Schema Pattern
- Single PostgreSQL schema for production deployment
- Uses Neon PostgreSQL database via Vercel environment variables

### Theme Extension Development
- Extension lives in `/extensions/cart-uplift/`
- Use `shopify app dev` for live theme extension updates
- App embed block pattern: merchant enables via theme editor, no code injection required

## Critical Conventions

### ML Recommendation System
- **Fallback Chain**: Manual bundles → Co-purchase analysis → Shopify recommendations → Content-based filtering
- **Bundle Sources**: `"ml"` | `"rules"` | `"manual"` - always track source for analytics
- **Dynamic Pricing**: Stepped discounts based on bundle value (10-25%)

### Settings Management Pattern
```typescript
// Always use this pattern for settings updates
const settings = await prisma.settings.upsert({
  where: { shop },
  update: updateData,
  create: { shop, ...updateData }
});
```

### API Route Conventions
- **Admin routes**: `/admin.*` - require merchant authentication
- **App routes**: `/app.*` - embedded app interface  
- **API routes**: `/api.*` - public/proxy endpoints for theme extension
- **Webhook routes**: `/webhooks.*` - Shopify webhook handlers

### Authentication Patterns
```typescript
// Admin routes
const { admin, session } = await authenticate.admin(request);

// Public/proxy routes  
const { session } = await authenticate.public.appProxy(request);
// OR for unauthenticated API access
const { admin } = await unauthenticated.admin(shop);
```

## Integration Points

### Shopify App Proxy
- Configured in `shopify.app.toml`: `/apps/proxy` → `/apps/cart-uplift`
- Enables theme extension to call app APIs without CORS issues
- Route pattern: `/apps.proxy.$.tsx` handles all proxy requests

### Theme-App Communication
- Theme extension loads settings via proxy API calls
- Real-time cart updates use Shopify AJAX Cart API
- Settings from `Settings` model passed through theme editor variables

### ML Training Data

- Co-purchase analysis requires minimum order volume
- Content-based fallback uses Shopify product recommendations API

## Environment-Specific Behaviors

### Development
- Uses Shopify CLI tunnel for webhook/OAuth testing  
- PostgreSQL database via Vercel/Neon integration
- HMR on port 64999 for embedded app development

### Production  
- Automatic Prisma schema switching in build
- Vercel serverless deployment via `/api/index.js`
- Database migrations via `prisma db push` (no migration files in production)



## Common Patterns to Follow

1. **Settings Updates**: Always use upsert pattern with shop as key
2. **Error Handling**: Embedded apps need `boundary` exports for Shopify error handling  
3. **GraphQL**: Use admin.graphql() with proper error checking, prefer over REST when possible
4. **Bundle Generation**: Always check manual settings first, then fall through ML chain
5. **Theme Extension**: Keep JavaScript vanilla (no build step) for maximum theme compatibility

## Development Server Best Practices

- **Never use `sleep` commands** when starting `npm run dev` - the Shopify CLI handles initialization timing automatically
- Run `npm run dev` with `isBackground: true` parameter to avoid blocking other operations
- Check server status with `get_terminal_output` if needed, but don't artificially delay with sleep
- The development server will show initialization progress and ready status when available
- Trust the Shopify CLI to manage tunnel setup, webhook forwarding, and app preview timing

## Code Quality Standards

- No shortcuts or mock data - always ensure real data integration and production readiness
- Don't hardcode Shopify store URLs or API keys - use environment variables or session data
- Follow TypeScript strict mode and handle all potential undefined/null cases
- Use proper error boundaries for embedded app components

## Git Commit Standards

- **Keep commit messages concise** - Use single line format: `type: brief description`
- **Use conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `style:`
- **Maximum 50 characters** for commit subject line
- **Examples**: 
  - `feat: add product selection to bundles`
  - `fix: resolve A/B testing save issue` 
  - `refactor: improve bundle API performance`
- **Avoid lengthy descriptions** - keep details in code comments, not commits
- **One logical change per commit** - don't bundle unrelated fixes