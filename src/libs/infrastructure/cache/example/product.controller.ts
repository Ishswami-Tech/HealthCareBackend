// import { 
//     Controller, 
//     Get, 
//     Post, 
//     Put, 
//     Body, 
//     Param, 
//     Query, 
//     Delete 
//   } from "@nestjs/common";
//   import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
//   import { ProductsService } from "../services/products.service";
//   import { RedisService } from "../../../shared/cache/redis/redis.service";
  
//   @ApiTags("products")
//   @Controller("products")
//   export class ProductsController {
//     constructor(
//       private readonly productsService: ProductsService,
//       private readonly redis: RedisService
//     ) {}
  
//     @Get()
//     @ApiOperation({ summary: "Get all products" })
//     async findAll() {
//       return this.productsService.findAll();
//     }
  
//     @Get(":id")
//     @ApiOperation({ summary: "Get product by id" })
//     async findOne(@Param("id") id: string) {
//       return this.productsService.findOne(id);
//     }
  
//     @Get("category/:category")
//     @ApiOperation({ summary: "Get products by category and price range" })
//     async findByPriceRange(
//       @Param("category") category: string,
//       @Query("minPrice") minPrice: number = 0,
//       @Query("maxPrice") maxPrice: number = Number.MAX_SAFE_INTEGER
//     ) {
//       return this.productsService.findByPriceRange(
//         category,
//         minPrice,
//         maxPrice
//       );
//     }
  
//     @Get(":id/inventory")
//     @ApiOperation({ summary: "Get real-time inventory" })
//     async getInventory(@Param("id") id: string) {
//       return this.productsService.getProductInventory(id);
//     }
  
//     @Get("stats/overview")
//     @ApiOperation({ summary: "Get product statistics" })
//     async getStats() {
//       return this.productsService.getProductStats();
//     }
  
//     @Post()
//     @ApiOperation({ summary: "Create new product" })
//     async create(@Body() data: any) {
//       return this.productsService.createProduct(data);
//     }
  
//     @Put("bulk/prices")
//     @ApiOperation({ summary: "Update multiple product prices" })
//     async updatePrices(
//       @Body() updates: { id: string; price: number }[]
//     ) {
//       return this.productsService.updatePrices(updates);
//     }
  
//     // Cache monitoring endpoints
//     @Get("monitoring/cache-status")
//     @ApiOperation({ summary: "Get product cache status" })
//     async getCacheStatus() {
//       const keys = await this.redis.keys("products:*");
//       const stats = await Promise.all(
//         keys.map(async (key) => ({
//           key,
//           ttl: await this.redis.ttl(key),
//           type: await this.redis.type(key)
//         }))
//       );
  
//       return {
//         totalCachedItems: keys.length,
//         cacheItems: stats,
//         timestamp: new Date().toISOString()
//       };
//     }
//   }