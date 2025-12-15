# Search Service

**Purpose:** Full-text search with Elasticsearch
**Location:** `src/libs/infrastructure/search`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { SearchService } from '@infrastructure/search';

@Injectable()
export class MyService {
  constructor(private readonly searchService: SearchService) {}

  async searchPatients(query: string, clinicId: string) {
    const results = await this.searchService.search({
      index: 'patients',
      query,
      filters: { clinicId },
      limit: 20,
    });

    return results.hits;
  }
}
```

---

## Key Features

- ✅ **Full-Text Search** - Elasticsearch-powered search
- ✅ **Fuzzy Matching** - Typo-tolerant search
- ✅ **Database Fallback** - Automatic fallback to DB if Elasticsearch unavailable
- ✅ **Multi-Tenant** - Clinic-scoped search
- ✅ **Query Building** - Flexible query construction
- ✅ **Faceted Search** - Filter by multiple attributes

---

## Configuration

```env
# Elasticsearch Configuration
ELASTICSEARCH_NODE=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=your-password
```

---

## Usage Examples

### Search with Filters

```typescript
const results = await this.searchService.search({
  index: 'patients',
  query: 'John Doe',
  filters: {
    clinicId: 'clinic123',
    status: 'active',
  },
  sort: { createdAt: 'desc' },
  limit: 50,
});
```

---

## Related Documentation

- [Complete Infrastructure Documentation](../../../INFRASTRUCTURE_DOCUMENTATION.md#search)

---

## Troubleshooting

**Issue 1: Search not working**
- Check Elasticsearch is running
- Verify indices are created
- Check connection settings

---

## Contributing

See main [README.md](../../../../README.md) for contribution guidelines.
