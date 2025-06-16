import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ValidationPipe, Logger, LogLevel, INestApplication } from '@nestjs/common';
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./libs/filters/http-exception.filter";
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { swaggerConfig, swaggerCustomOptions } from './config/swagger.config';
import { LoggingService } from './shared/logging/logging.service';
import { LogType } from './shared/logging/types/logging.types';
import { LogLevel as AppLogLevel } from './shared/logging/types/logging.types';
import developmentConfig from './config/environment/development.config';
import productionConfig from './config/environment/production.config';
import { RedisService } from './shared/cache/redis/redis.service';
import { QueueService } from './shared/queue/queue.service';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { EmailModule } from './shared/messaging/email/email.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { LoggingInterceptor } from './shared/logging/logging.interceptor';
import { FastifyRequest, FastifyReply } from 'fastify';

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  debug: console.debug,
  info: console.info
};

// Declare Redis client variables at module level
let pubClient: any = null;
let subClient: any = null;

// Function to redirect only HTTP logs to the logging service
// but keep important service logs visible in the console
function setupConsoleRedirect(loggingService: LoggingService) {
  if (!loggingService) return;

  // We'll keep all console logs as they are,
  // but only filter FastifyAdapter logs for HTTP requests
}

// Add environment type
const validEnvironments = ['development', 'production'] as const;
type Environment = typeof validEnvironments[number];

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  let app: NestFastifyApplication & INestApplication;
  let loggingService: LoggingService;
  
  try {
    logger.log('Starting application bootstrap...');
    
    const environment = process.env.NODE_ENV as Environment;
    if (!validEnvironments.includes(environment)) {
      throw new Error(`Invalid NODE_ENV: ${environment}. Must be one of: ${validEnvironments.join(', ')}`);
    }

    const envConfig = environment === 'production' ? productionConfig() : developmentConfig();

    // Configure Fastify logger based on environment
    const loggerConfig = {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      serializers: {
        req: (req) => {
          // Skip detailed logging for health check endpoints
          if (req.url === '/health' || req.url === '/api-health') {
            return { method: req.method, url: req.url };
          }
          return {
            method: req.method,
            url: req.url,
            headers: req.headers
          };
        },
        res: (res) => ({ statusCode: res.statusCode }),
        err: (err) => ({
          type: 'ERROR',
          message: err.message,
          stack: err.stack || 'No stack trace'
        })
      }
    };

    // Add pretty printing only in development
    if (process.env.NODE_ENV !== 'production') {
      loggerConfig['transport'] = {
        target: 'pino-pretty',
        options: {
          translateTime: false,
          ignore: 'pid,hostname',
          messageFormat: '{msg}',
          colorize: true
        }
      };
    }

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({
        logger: loggerConfig,
        disableRequestLogging: true,
        requestIdLogLabel: 'requestId',
        requestIdHeader: 'x-request-id',
        trustProxy: envConfig.security.trustProxy === 1
      }),
      {
        logger: ['error', 'warn', 'log', 'debug', 'verbose'] as LogLevel[],
        bufferLogs: true
      }
    );

    // Initialize core services
    const configService = app.get(ConfigService);
    loggingService = app.get(LoggingService);
    logger.log('Core services initialized');
    const eventEmitter = new EventEmitter2();
    
    // Set up console redirection to the logging service
    setupConsoleRedirect(loggingService);

    // Apply global interceptor for logging
    app.useGlobalInterceptors(new LoggingInterceptor(loggingService));

    // Apply global pipes and filters with error logging
    app.useGlobalPipes(new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) => {
        const formattedErrors = errors.map(error => ({
          field: error.property,
          constraints: error.constraints
        }));
        
        loggingService.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          'Validation failed',
          'ValidationPipe',
          { errors: formattedErrors }
        );
        
        return {
          type: 'VALIDATION_ERROR',
          message: 'Validation failed',
          stack: new Error().stack,
          errors: formattedErrors
        };
      }
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    logger.log('Global pipes and filters configured');

    // Log application startup
    await loggingService.log(
      LogType.SYSTEM,
      AppLogLevel.INFO,
      'Application bootstrap started',
      'Bootstrap',
      { timestamp: new Date() }
    );

    // Set up WebSocket adapter with Redis
    try {
      const { createAdapter } = await import('@socket.io/redis-adapter');
      const { createClient } = await import('redis');
      
      // Redis client configuration with improved error handling
      const redisConfig = {
        url: `redis://${configService.get('REDIS_HOST', '127.0.0.1').trim()}:${configService.get('REDIS_PORT', '6379').trim()}`,
        password: configService.get('REDIS_PASSWORD'),
        retryStrategy: (times: number) => {
          const maxRetries = 5;
          if (times > maxRetries) {
            logger.error(`Redis connection failed after ${maxRetries} retries`);
            return null; // Stop retrying
          }
          const maxDelay = 3000;
          const delay = Math.min(times * 100, maxDelay);
          logger.log(`Redis reconnection attempt ${times}, delay: ${delay}ms`);
          return delay;
        }
      };

      try {
        pubClient = createClient(redisConfig);
        subClient = pubClient.duplicate();

      // Enhanced Redis connection event handling
      const handleRedisError = async (client: string, err: Error) => {
        try {
          await loggingService?.log(
            LogType.ERROR,
            AppLogLevel.ERROR,
            `Redis ${client} Client Error: ${err.message}`,
            'Redis',
            { client, error: err.message, stack: err.stack }
          );
        } catch (logError) {
          // If logging service fails, use original console
          originalConsole.error(`Redis ${client} Client Error:`, err);
        }
      };

      const handleRedisConnect = async (client: string) => {
        try {
          await loggingService?.log(
            LogType.SYSTEM,
            AppLogLevel.INFO,
            `Redis ${client} Client Connected`,
            'Redis',
            { client }
          );
        } catch (logError) {
          originalConsole.log(`Redis ${client} Client Connected`);
        }
      };

        // Set up event handlers
      pubClient.on('error', (err) => handleRedisError('Pub', err));
      subClient.on('error', (err) => handleRedisError('Sub', err));
      pubClient.on('connect', () => handleRedisConnect('Pub'));
      subClient.on('connect', () => handleRedisConnect('Sub'));
      
        // Connect with timeout
        const connectWithTimeout = async (client: any, name: string) => {
          return Promise.race([
            client.connect(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`${name} client connection timeout`)), 10000)
            )
          ]);
        };

        await Promise.all([
          connectWithTimeout(pubClient, 'Pub'),
          connectWithTimeout(subClient, 'Sub')
        ]);

      class CustomIoAdapter extends IoAdapter {
        private adapterConstructor: ReturnType<typeof createAdapter>;

        constructor(app: any) {
          super(app);
          this.adapterConstructor = createAdapter(pubClient, subClient);
        }
        
        createIOServer(port: number, options?: any) {
          const server = super.createIOServer(port, {
            ...options,
            cors: {
                origin: process.env.NODE_ENV === 'production'
                  ? process.env.CORS_ORIGIN?.split(',') || ['https://ishswami.in']
                  : '*',
              methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
              credentials: true,
              allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
            },
            path: '/socket.io',
              serveClient: true,
            transports: ['websocket', 'polling'],
            allowEIO3: true,
            pingTimeout: 60000,
            pingInterval: 25000,
            connectTimeout: 45000,
            maxHttpBufferSize: 1e6,
            allowUpgrades: true,
              cookie: false
          });

          server.adapter(this.adapterConstructor);

            // Health check endpoint
          server.of('/health').on('connection', (socket) => {
              socket.emit('health', { 
                status: 'healthy', 
                timestamp: new Date(),
                environment: process.env.NODE_ENV
              });
            });
            
            // Test namespace with improved error handling
          server.of('/test').on('connection', (socket) => {
            logger.log('Client connected to test namespace');
            
              let heartbeat: NodeJS.Timeout;
              
              // Send a welcome message and start heartbeat
              const startHeartbeat = () => {
                socket.emit('welcome', { 
                  message: 'Connected to WebSocket server',
                  timestamp: new Date().toISOString(),
                  environment: process.env.NODE_ENV
                });
                
                heartbeat = setInterval(() => {
                  socket.emit('heartbeat', { 
                timestamp: new Date().toISOString() 
              });
                }, 30000); // 30 second heartbeat
              };
              
              startHeartbeat();
            
              // Handle disconnection
            socket.on('disconnect', () => {
                clearInterval(heartbeat);
              logger.log('Client disconnected from test namespace');
            });
            
              // Echo messages with error handling
            socket.on('message', (data) => {
                try {
              socket.emit('echo', { 
                original: data,
                    timestamp: new Date().toISOString(),
                    processed: true
                  });
                } catch (error) {
                  logger.error('Error processing socket message:', error);
                  socket.emit('error', { 
                    message: 'Failed to process message',
                timestamp: new Date().toISOString()
                  });
                }
              });
              
              // Handle errors
              socket.on('error', (error) => {
                logger.error('Socket error:', error);
                clearInterval(heartbeat);
            });
          });

          return server;
        }
      }

      const customAdapter = new CustomIoAdapter(app);
      app.useWebSocketAdapter(customAdapter);
      
      logger.log('WebSocket adapter configured successfully');
      
      await loggingService?.log(
        LogType.SYSTEM,
        AppLogLevel.INFO,
        'WebSocket adapter configured successfully',
        'WebSocket'
      );

      } catch (redisError) {
        logger.warn('Failed to initialize Redis adapter:', redisError);
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.WARN,
          'Continuing without Redis adapter',
          'WebSocket'
        );
      }

    } catch (error) {
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `WebSocket adapter initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WebSocket',
        { error: error instanceof Error ? error.stack : 'No stack trace available' }
      );
      // Don't throw, continue without WebSocket
      logger.warn('Continuing without WebSocket support');
    }

    // Enable CORS with specific configuration
    app.enableCors({
      origin: process.env.NODE_ENV === 'production' 
        ? [
            'https://ishswami.in',
            'https://www.ishswami.in',
            /\.ishswami\.in$/,
            'http://localhost:3000',  // Allow local development frontend
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://www.googleapis.com'
          ]
        : [
            'http://localhost:3000',
            'http://localhost:8088',
            'http://localhost:5050',
            'http://localhost:8082',
            'https://accounts.google.com',
            'https://oauth2.googleapis.com',
            'https://www.googleapis.com'
          ],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Session-ID',
        'Origin',
        'Accept',
        'X-Requested-With',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers',
        'X-Client-Data',
        'Sec-Fetch-Site',
        'Sec-Fetch-Mode',
        'Sec-Fetch-Dest'
      ],
      exposedHeaders: ['Set-Cookie', 'Authorization'],
      maxAge: 86400 // 24 hours
    });

    // Add preflight handler for all routes
    const fastifyInstance = app.getHttpAdapter().getInstance();
    fastifyInstance.addHook('onRequest', (request, reply, done) => {
      // Handle preflight requests
      if (request.method === 'OPTIONS') {
        const origin = request.headers.origin;
        if (origin) {
          const allowedOrigins = process.env.NODE_ENV === 'production'
            ? ['https://ishswami.in', 'https://www.ishswami.in', 'http://localhost:3000']  // Allow local development frontend
            : ['http://localhost:3000', 'http://localhost:8088', 'http://localhost:5050', 'http://localhost:8082'];
          
          if (allowedOrigins.includes(origin) || /\.ishswami\.in$/.test(origin)) {
            reply.header('Access-Control-Allow-Origin', origin);
            reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
            reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-ID');
            reply.header('Access-Control-Allow-Credentials', 'true');
            reply.header('Access-Control-Max-Age', '86400');
            reply.send();
            return;
          }
        }
      }
      done();
    });

    // Configure Fastify security headers
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'",
            "https://accounts.google.com",
            "https://apis.google.com",
            "https://www.googleapis.com"
          ],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          connectSrc: [
            "'self'",
            "http://localhost:3000",
            "https://ishswami.in",
            "https://www.ishswami.in",
            "https://api.ishswami.in",
            "wss://api.ishswami.in",
            "https://accounts.google.com",
            "https://oauth2.googleapis.com",
            "https://www.googleapis.com"
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          frameSrc: ["'self'", "https://accounts.google.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", "https://accounts.google.com", "http://localhost:3000"],
          frameAncestors: ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      crossOriginResourcePolicy: { policy: "cross-origin" }
    });

    // Configure Swagger with environment variables
    const port = configService.get('PORT') || configService.get('VIRTUAL_PORT') || 8088;
    const virtualHost = configService.get('VIRTUAL_HOST') || 'localhost';
    const apiUrl = configService.get('API_URL');
    const swaggerUrl = configService.get('SWAGGER_URL') || '/docs';
    const bullBoardUrl = configService.get('BULL_BOARD_URL') || '/queue-dashboard';
    const socketUrl = configService.get('SOCKET_URL') || '/socket.io';
    const redisCommanderUrl = configService.get('REDIS_COMMANDER_URL');
    const prismaStudioUrl = configService.get('PRISMA_STUDIO_URL');
    const loggerUrl = configService.get('LOGGER_URL') || '/logger';
    
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    
    // Add environment-specific Swagger setup
    if (process.env.NODE_ENV === 'production') {
      // In production, add CORS and security headers for Swagger UI
      await fastifyInstance.register(fastifyHelmet, {
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'https:', 'data:']
          }
        }
      });
    }
    
    SwaggerModule.setup(swaggerUrl.replace('/', ''), app, document, {
      ...swaggerCustomOptions,
      swaggerOptions: {
        ...swaggerCustomOptions.swaggerOptions,
        // Set the default server based on environment
        urls: [
          {
            url: `${apiUrl}${swaggerUrl}/swagger.json`,
            name: process.env.NODE_ENV === 'production' ? 'Production' : 'Development'
          }
        ]
      }
    });
    
    logger.log(`Swagger API documentation configured for ${process.env.NODE_ENV} environment`);

    // Start the server with improved error handling
    try {
      const port = envConfig.app.port;
      const host = envConfig.app.host;
      const bindAddress = envConfig.app.bindAddress;
      
      await app.listen(port, bindAddress);
      
      logger.log(`Application is running in ${envConfig.app.environment} mode:`);
      logger.log(`- Local: http://${host}:${port}`);
      logger.log(`- Base URL: ${envConfig.app.baseUrl}`);
      logger.log(`- Swagger Docs: ${envConfig.app.environment === 'production' ? envConfig.app.apiUrl : envConfig.app.baseUrl}${envConfig.urls.swagger}`);
      logger.log(`- Health Check: ${envConfig.app.baseUrl}/health`);
      
      if (envConfig.app.environment === 'development') {
        const devConfig = envConfig as typeof developmentConfig extends () => infer R ? R : never;
        logger.log('Development services:');
        logger.log(`- Redis Commander: ${devConfig.urls.redisCommander}`);
        logger.log(`- Prisma Studio: ${devConfig.urls.prismaStudio}`);
        logger.log(`- PgAdmin: ${devConfig.urls.pgAdmin}`);
      }
      
      // Graceful shutdown handlers
      const signals = ['SIGTERM', 'SIGINT'];
      
      signals.forEach(signal => {
        process.on(signal, async () => {
          logger.log(`Received ${signal}, starting graceful shutdown...`);
          
          const shutdownTimeout = setTimeout(() => {
            logger.error('Shutdown timed out, forcing exit');
            process.exit(1);
          }, 10000);
          
          try {
            // Close WebSocket connections
            const wsAdapter = app.get(IoAdapter, { strict: false });
            if (wsAdapter && wsAdapter instanceof IoAdapter) {
              logger.log('Closing WebSocket connections...');
              const httpServer = app.getHttpServer();
              if (httpServer) {
                await new Promise<void>((resolve) => {
                  httpServer.close(() => {
                    logger.log('WebSocket server closed');
                    resolve();
                  });
                });
              }
            }
            
            // Close database connections
            const prismaService = app.get(PrismaService);
            if (prismaService) {
              logger.log('Closing database connections...');
              await prismaService.$disconnect();
            }
            
            // Close Redis connections
            if (pubClient) {
              logger.log('Closing Redis pub connection...');
              await pubClient.quit();
            }
            if (subClient) {
              logger.log('Closing Redis sub connection...');
              await subClient.quit();
            }
            
            // Close the app
            await app.close();
            
            clearTimeout(shutdownTimeout);
            logger.log('Application shut down successfully');
            process.exit(0);
      } catch (error) {
            clearTimeout(shutdownTimeout);
            logger.error('Error during shutdown:', error);
            process.exit(1);
          }
        });
      });
      
    } catch (listenError) {
      await loggingService?.log(
        LogType.ERROR,
        AppLogLevel.ERROR,
        `Failed to start server: ${listenError.message}`,
        'Bootstrap',
        { error: listenError.stack }
      );
      throw new Error(`Server startup failed: ${listenError.message}`);
    }

    // Enhanced error handling for uncaught exceptions
    process.on('uncaughtException', async (error) => {
      try {
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Uncaught Exception: ${error.message}`,
          'Process',
          { error: error.stack }
        );
      } catch (logError) {
        console.error('Failed to log uncaught exception:', logError);
        console.error('Original error:', error);
      }
      process.exit(1);
    });

    // Enhanced error handling for unhandled rejections
    process.on('unhandledRejection', async (reason, promise) => {
      try {
        await loggingService?.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          'Unhandled Rejection',
          'Process',
          { 
            reason: reason instanceof Error ? reason.stack : reason,
            promise: promise
          }
        );
      } catch (logError) {
        console.error('Failed to log unhandled rejection:', logError);
        console.error('Original rejection:', reason);
      }
    });

  } catch (error) {
    if (loggingService) {
      try {
        await loggingService.log(
          LogType.ERROR,
          AppLogLevel.ERROR,
          `Failed to start application: ${error.message}`,
          'Bootstrap',
          { 
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : 'No stack trace available',
            details: error
          }
        );
      } catch (logError) {
        console.error('CRITICAL: Failed to log through LoggingService:', logError);
      }
    } else {
      console.error('CRITICAL: Failed to start application:', error);
    }

    try {
      if (app) {
        await app.close();
      }
    } catch (closeError) {
      console.error('CRITICAL: Failed to close application:', closeError);
    }

    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error('CRITICAL: Fatal error during bootstrap:', error);
  process.exit(1);
});