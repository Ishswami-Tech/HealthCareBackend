import { Injectable, Logger } from "@nestjs/common";
import { RedisCache } from "../../../shared/cache/decorators/redis-cache.decorator";
import { PrismaService } from "../../../shared/database/prisma/prisma.service";
import { RedisService } from "../../../shared/cache/redis/redis.service";
import { KafkaService } from "../../../shared/messaging/kafka/kafka.service";
import { Product, Prisma } from "@prisma/client";

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private kafka: KafkaService
  ) {}

  // Example 1: Basic caching with auto-generated key
  @RedisCache()
  async findAll(): Promise<Product[]> {
    this.logger.debug('Fetching all products from database');
    return this.prisma.product.findMany();
  }

  // Example 2: Caching with prefix and TTL
  @RedisCache({ prefix: 'products:one', ttl: 1800 })
  async findOne(id: string): Promise<Product | null> {
    this.logger.debug(`Fetching product ${id} from database`);
    return this.prisma.product.findUnique({
      where: { id }
    });
  }

  // Example 3: Caching with custom key generator
  @RedisCache({
    ttl: 3600,
    keyGenerator: (category: string, minPrice: number, maxPrice: number) => 
      `products:filtered:${category}:${minPrice}-${maxPrice}`
  })
  async findByPriceRange(
    category: string,
    minPrice: number,
    maxPrice: number
  ): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: {
        category,
        price: {
          gte: minPrice,
          lte: maxPrice
        }
      }
    });
  }

  // Example 4: No caching for real-time data
  @RedisCache({ ttl: 0 })
  async getProductInventory(id: string): Promise<number> {
    return (await this.prisma.product.findUnique({
      where: { id },
      select: { inventory: true }
    }))?.inventory ?? 0;
  }

  // Example 5: Caching with complex data and invalidation
  @RedisCache({ prefix: 'products:stats', ttl: 1200 })
  async getProductStats(): Promise<any> {
    const [total, outOfStock, categories] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({
        where: { inventory: 0 }
      }),
      this.prisma.product.groupBy({
        by: ['category'],
        _count: true
      })
    ]);

    return {
      totalProducts: total,
      outOfStock,
      categoryCounts: categories,
      lastUpdated: new Date()
    };
  }

  // Example 6: Write operation with cache invalidation
  async createProduct(
    data: Omit<Prisma.ProductCreateInput, "id" | "createdAt" | "updatedAt">
  ): Promise<Product> {
    const product = await this.prisma.product.create({ data });

    // Invalidate related caches
    await Promise.all([
      this.redis.del("ProductsService:findAll:"),
      this.redis.del(`products:one:${product.id}`),
      this.redis.del("products:stats"),
      this.redis.del(`products:filtered:${product.category}:*`)
    ]);

    // Notify other services
    await this.kafka.sendMessage("product-events", {
      type: "PRODUCT_CREATED",
      data: product,
      timestamp: new Date().toISOString()
    });

    return product;
  }

  // Example 7: Batch operation with cache invalidation
  async updatePrices(updates: { id: string; price: number }[]): Promise<void> {
    await this.prisma.$transaction(
      updates.map(({ id, price }) =>
        this.prisma.product.update({
          where: { id },
          data: { price }
        })
      )
    );

    // Bulk cache invalidation
    const keysToDelete = await this.redis.keys("products:*");
    if (keysToDelete.length) {
      await this.redis.del(...keysToDelete);
    }

    // Notify about bulk update
    await this.kafka.sendMessage("product-events", {
      type: "BULK_PRICE_UPDATE",
      count: updates.length,
      timestamp: new Date().toISOString()
    });
  }
}