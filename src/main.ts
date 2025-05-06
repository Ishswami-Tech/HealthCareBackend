import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe, Logger, LogLevel } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import { initDatabase } from "./shared/database/scripts/init-db";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    await initDatabase();

    // SSL configuration
    let httpsOptions = undefined;
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Get SSL paths from environment variables or use defaults
    const sslKeyPath = process.env.SSL_KEY_PATH || '/app/ssl/api.ishswami.in.key';
    const sslCertPath = process.env.SSL_CERT_PATH || '/app/ssl/api.ishswami.in.crt';

    logger.log('SSL Configuration:');
    logger.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
    logger.log(`SSL Key Path: ${sslKeyPath}`);
    logger.log(`SSL Cert Path: ${sslCertPath}`);

    // Check if files exist
    const keyExists = fs.existsSync(sslKeyPath);
    const certExists = fs.existsSync(sslCertPath);
    
    logger.log(`SSL Key exists: ${keyExists}`);
    logger.log(`SSL Cert exists: ${certExists}`);

    if (keyExists && certExists) {
      try {
        const key = fs.readFileSync(sslKeyPath);
        const cert = fs.readFileSync(sslCertPath);
        
        httpsOptions = { key, cert };
        logger.log('SSL certificates loaded successfully, enabling HTTPS');
        
        // Log certificate details
        logger.log(`Key file size: ${key.length} bytes`);
        logger.log(`Cert file size: ${cert.length} bytes`);
      } catch (error) {
        logger.error(`Error reading SSL certificates: ${error.message}`);
        logger.error(error.stack);
        logger.warn('Falling back to HTTP mode due to SSL read error');
        
        // Additional error details
        if (error.code === 'EACCES') {
          logger.error('Permission denied. Check file permissions and ownership.');
        } else if (error.code === 'ENOENT') {
          logger.error('File not found. Check if SSL files are properly mounted.');
        }
      }
    } else {
      logger.warn('SSL certificates not found, running in HTTP mode');
      if (!keyExists) logger.warn(`Key file not found: ${sslKeyPath}`);
      if (!certExists) logger.warn(`Cert file not found: ${sslCertPath}`);
      
      // Log mounted volumes for debugging
      try {
        const sslDir = path.dirname(sslKeyPath);
        if (fs.existsSync(sslDir)) {
          const files = fs.readdirSync(sslDir);
          logger.log(`Contents of ${sslDir}:`, files);
        } else {
          logger.warn(`SSL directory ${sslDir} does not exist`);
        }
      } catch (error) {
        logger.error(`Error checking SSL directory: ${error.message}`);
      }
    }

    const app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        logger: {
          level: 'debug',
          serializers: {
            req: (req) => ({
              method: req.method,
              url: req.url,
              path: req.routerPath,
              parameters: req.params,
              headers: req.headers
            }),
            res: (res) => ({
              statusCode: res.statusCode,
              time: res.responseTime
            })
          }
        },
        trustProxy: true,
        bodyLimit: 10 * 1024 * 1024, // 10MB
        ignoreTrailingSlash: true,
        disableRequestLogging: false,
        https: httpsOptions
      }),
      {
        logger: ['log', 'error', 'warn', 'debug', 'verbose'] as LogLevel[],
        bufferLogs: true,
        cors: {
          origin: ['http://localhost:8088', 'http://82.208.20.16:8088', 'http://ishswami.in', 'http://api.ishswami.in'],
          methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
          credentials: true,
          preflightContinue: false,
          optionsSuccessStatus: 204
        }
      }
    );

    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    
    const configService = app.get(ConfigService);
    const eventEmitter = new EventEmitter2();

    // Set up WebSocket adapter with Redis
    try {
      const { IoAdapter } = await import('@nestjs/platform-socket.io');
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      
      // Redis client configuration
      const redisConfig = {
        url: `redis://${configService.get('REDIS_HOST', 'localhost')}:${configService.get('REDIS_PORT', '6379')}`,
        password: configService.get('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const maxDelay = 3000;
          const delay = Math.min(times * 100, maxDelay);
          logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        },
        reconnectOnError: (err: Error) => {
          logger.error('Redis reconnection error:', err);
          return true;
        },
        maxRetriesPerRequest: 5,
        enableReadyCheck: true,
        commandTimeout: 10000,
        connectTimeout: 20000,
        lazyConnect: true,
        retryMaxDelay: 3000,
        maxLoadingRetryTime: 30000,
        enableOfflineQueue: true
      };

      // Create Redis pub/sub clients
      const pubClient = createClient(redisConfig);
      const subClient = pubClient.duplicate();

      // Enhanced Redis connection event handling
      const handleRedisError = (client: string, err: Error) => {
        logger.error(`Redis ${client} Client Error:`, err);
        eventEmitter.emit('redisError', { client, error: err.message });
      };

      const handleRedisConnect = (client: string) => {
        logger.log(`Redis ${client} Client Connected`);
        eventEmitter.emit('redisConnect', { client });
      };

      pubClient.on('error', (err) => handleRedisError('Pub', err));
      subClient.on('error', (err) => handleRedisError('Sub', err));
      pubClient.on('connect', () => handleRedisConnect('Pub'));
      subClient.on('connect', () => handleRedisConnect('Sub'));
      
      await Promise.all([pubClient.connect(), subClient.connect()]);

      class CustomIoAdapter extends IoAdapter {
        constructor(private app: any) {
          super(app);
        }
        
        createIOServer(port: number, options?: any) {
          // Allow all origins temporarily for testing
          const corsOrigins = '*';

          logger.log('WebSocket CORS configuration: Allow all origins (temporary)');

          const server = super.createIOServer(port, {
            cors: {
              origin: corsOrigins,
              credentials: true,
              methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            },
            adapter: createAdapter(pubClient, subClient, {
              key: 'healthcare-socket',
              publishOnSpecificResponseChannel: true,
              requestsTimeout: 5000,
              parser: {
                encode: JSON.stringify,
                decode: JSON.parse
              }
            }),
            connectionStateRecovery: {
              maxDisconnectionDuration: 2 * 60 * 1000,
              skipMiddlewares: true,
            },
            transports: ['websocket', 'polling'],
            pingTimeout: 20000,
            pingInterval: 25000,
            upgradeTimeout: 10000,
            maxHttpBufferSize: 1e6,
            connectTimeout: 45000,
            allowEIO3: true,
            path: '/socket.io/'
          });

          // Add global error handler
          server.on('error', (error: Error) => {
            logger.error('Socket.IO server error:', error?.message || 'Unknown error');
          });

          // Add connection error handler
          server.on('connection_error', (error: Error) => {
            logger.error('Socket.IO connection error:', error?.message || 'Unknown error');
          });

          // Log namespace creation
          server.of('/appointments').on('connection', (socket) => {
            logger.log(`Client connected to appointments namespace: ${socket.id}`);
            
            socket.on('error', (error: Error) => {
              logger.error(`Socket error in appointments namespace for client ${socket.id}:`, error?.message || 'Unknown error');
            });
          });

          logger.log('WebSocket server initialized with namespaces:', 
            Object.keys(server._nsps).join(', '));
          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);
      logger.log('WebSocket adapter configured successfully');

    } catch (error) {
      logger.warn(`WebSocket adapter could not be initialized: ${error instanceof Error ? error.message : 'Unknown error'}`);
      logger.error(error instanceof Error ? error.stack : 'No stack trace available');
    }

    // Security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: false  // Disable CSP for development/HTTP
    });

    // Configure route handling to prevent Bull Board from intercepting other routes
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      if (!request.url.startsWith('/queue-dashboard')) {
        done();
      } else {
        done();
      }
    });

    // Initialize Swagger documentation
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      ...swaggerCustomOptions,
      explorer: true,
      customSiteTitle: 'Healthcare API Documentation',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        displayRequestDuration: true,
        tryItOutEnabled: true
      }
    });

    // Start the server
    const port = configService.get<number>('PORT', 8088);
    const host = '0.0.0.0';
    
    try {
      await app.listen(port, host, () => {
        logger.log(`Server is running on: http://${host}:${port}`);
        logger.log(`Swagger documentation is available at: http://${host}:${port}/docs`);
        logger.log(`Bull Board is available at: http://${host}:${port}/queue-dashboard`);
        logger.log(`WebSocket server is available at: ws://${host}:${port}/socket.io`);
        logger.log(`Environment: ${process.env.NODE_ENV}`);
      });
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

bootstrap();