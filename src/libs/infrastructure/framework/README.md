# Framework Service

**Purpose:** Fastify framework abstraction and lifecycle management
**Location:** `src/libs/infrastructure/framework`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
// Framework is automatically configured in AppModule
// No direct usage needed - works behind the scenes
```

---

## Key Features

- ✅ **Fastify Integration** - 2-3x faster than Express
- ✅ **Middleware Management** - Global and route-specific middleware
- ✅ **Route Registration** - Automatic route registration
- ✅ **Lifecycle Hooks** - onRequest, preHandler, onResponse, etc.
- ✅ **Error Handling** - Centralized error handling
- ✅ **CORS Configuration** - Configurable CORS settings

---

## Architecture

```
FrameworkModule
├── fastify.adapter.ts         # Main Fastify adapter
├── middleware/
│   ├── helmet.middleware.ts
│   ├── rate-limit.middleware.ts
│   └── compression.middleware.ts
└── hooks/
    └── lifecycle.hooks.ts
```

---

## Fastify vs Express

**Why Fastify?**
- 2-3x faster request handling
- Built-in schema validation
- Better async/await support
- Lower memory footprint
- Production-optimized

---

## Configuration

```env
# Framework Configuration
PORT=8088
NODE_ENV=production
FASTIFY_LOGGER=true
FASTIFY_BODY_LIMIT=10MB
```

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#framework)
- [NestJS-Specific Guide](../../../.ai-rules/nestjs-specific.md)

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
