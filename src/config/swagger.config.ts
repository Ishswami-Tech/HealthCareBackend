import { DocumentBuilder, SwaggerCustomOptions } from '@nestjs/swagger';
import developmentConfig from './environment/development.config';
import productionConfig from './environment/production.config';

const getEnvironmentConfig = () => {
  return process.env.NODE_ENV === 'production' ? productionConfig() : developmentConfig();
};

// Helper function to get API servers based on environment
const getApiServers = () => {
  const config = getEnvironmentConfig();
  const servers = [];
  
  if (config.app.environment === 'production') {
    servers.push(
      { url: config.app.baseUrl, description: 'Production API Server' },
      { url: `${config.app.baseUrl}${config.urls.bullBoard}`, description: 'Queue Dashboard' }
    );
  } else {
    const devConfig = config as typeof developmentConfig extends () => infer R ? R : never;
    // Docker-first development configuration
    servers.push(
      // Primary Docker network URLs
      { url: `http://localhost:8088`, description: 'Development API Server' },
      { url: `http://localhost:8088${config.urls.bullBoard}`, description: 'Queue Dashboard' },
      // Development services with Docker network URLs
      { url: 'http://localhost:8082', description: 'Redis Commander' },
      { url: 'http://localhost:5555', description: 'Prisma Studio' },
      { url: 'http://localhost:5050', description: 'PgAdmin' }
    );
  }
  
  return servers;
};

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Healthcare API')
  .setDescription(`
## Modern Healthcare Management System

A comprehensive API system providing seamless integration for healthcare services.

### Environment: ${getEnvironmentConfig().app.environment}
${getEnvironmentConfig().app.environment === 'production' ? `
### Production URLs
- Frontend: ${getEnvironmentConfig().urls.frontend}
- API: ${getEnvironmentConfig().app.apiUrl}
` : `
### Development URLs (Docker)
- API: http://localhost:8088
- Frontend: ${getEnvironmentConfig().urls.frontend}
- Redis Commander: http://localhost:8082
- Prisma Studio: http://localhost:5555
- PgAdmin: http://localhost:5050
`}

### Core Features
✨ Authentication & Authorization
🔐 Secure Session Management
📱 Multi-factor Authentication
🔄 Real-time Queue Management
💉 Clinic Management

### Authentication Steps
1. First, use the \`/auth/login\` endpoint to get your access token
2. Copy the \`access_token\` value from the response
3. Click the "Authorize" button at the top
4. Enter the token in the format: Bearer <your_token>
5. Click "Authorize"

### Available Endpoints
- API Documentation: ${getEnvironmentConfig().urls.swagger}
- Health Check: /health
- Queue Dashboard: ${getEnvironmentConfig().urls.bullBoard}
${getEnvironmentConfig().app.environment !== 'production' ? `
### Development Tools (Docker)
- Redis Commander: http://localhost:8082
- Prisma Studio: http://localhost:5555
- PgAdmin: http://localhost:5050` : ''}
  `)
  .setVersion('1.0')
  .addTag('root', 'Root endpoints and health checks')
  .addTag('health', 'System health checks and monitoring')
  .addTag('auth', 'Authentication & User Management')
  .addTag('user', 'User profile and preferences management')
  .addTag('appointments', 'Appointment Scheduling And Management')
  .addTag('clinic', 'Healthcare facility and service management')
  .addTag('Clinic Locations', 'Geographical management of clinic locations')
  .addTag('cache', 'Redis-based caching system')
  .addTag('Logging', 'System Logging And Monitoring')
  .addSecurityRequirements('JWT-auth')
  .addBearerAuth()
  .build();

// Add servers after building the config
getApiServers().forEach(server => {
  swaggerConfig.servers.push(server);
});

export const swaggerCustomOptions: SwaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true,
    showRequestDuration: true,
    tryItOutEnabled: 'true',
    syntaxHighlight: {
      theme: 'monokai',
    },
    defaultModelsExpandDepth: 3,
    defaultModelExpandDepth: 3,
    displayOperationId: false,
    maxDisplayedTags: 15,
    showExtensions: true,
    showCommonExtensions: true,
    layout: 'BaseLayout',
    deepLinking: true,
    tagsSorter: 'alpha',
    // Add support for both localhost and Docker URLs
    urls: getApiServers()
  },
  customCss: `
    .swagger-ui {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    }
    
    .swagger-ui .topbar { display: none }
    
    .swagger-ui .info {
      margin: 15px 0;
      background: ${getEnvironmentConfig().app.environment === 'production' ? '#f8f9fa' : '#e3f2fd'};
      padding: 15px;
      border-radius: 6px;
    }
    
    .swagger-ui .info .title {
      font-size: 2em;
      color: #2c3e50;
      font-weight: 600;
    }
    
    .swagger-ui .info .description {
      font-size: 1em;
      color: #34495e;
      line-height: 1.5;
    }
    
    /* Environment Indicator */
    .swagger-ui .info::before {
      content: '${getEnvironmentConfig().app.environment.toUpperCase()} ENVIRONMENT';
      display: inline-block;
      padding: 4px 8px;
      background: ${getEnvironmentConfig().app.environment === 'production' ? '#dc3545' : '#28a745'};
      color: white;
      border-radius: 4px;
      margin-bottom: 10px;
      font-weight: bold;
    }
    
    /* Production-specific styles */
    ${getEnvironmentConfig().app.environment === 'production' ? `
    .swagger-ui .try-out { display: none }
    .swagger-ui .auth-wrapper { background: #dc3545; padding: 8px; border-radius: 4px; }
    .swagger-ui .auth-wrapper .authorize { color: white; }
    ` : ''}
    
    .swagger-ui .opblock-tag {
      font-size: 1.2em;
      border: none;
      margin: 10px 0 5px;
      padding: 10px 0;
      border-bottom: 1px solid #eee;
      transition: all 0.2s;
      text-transform: capitalize;
    }
    
    .swagger-ui .opblock-tag:hover {
      background: #f8f9fa;
      transform: translateX(3px);
    }
    
    .swagger-ui .opblock {
      margin: 0 0 10px;
      border-radius: 6px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      border: 1px solid #e9ecef;
    }
    
    .swagger-ui .opblock .opblock-summary {
      padding: 10px;
    }
    
    .swagger-ui .opblock .opblock-summary-description {
      font-size: 0.9em;
      color: #6c757d;
      font-weight: 400;
      text-transform: capitalize;
    }
    
    /* Method Colors */
    .swagger-ui .opblock.opblock-get {
      background: rgba(97,175,254,.1);
      border-color: #61affe;
    }
    
    .swagger-ui .opblock.opblock-post {
      background: rgba(73,204,144,.1);
      border-color: #49cc90;
    }
    
    .swagger-ui .opblock.opblock-put {
      background: rgba(252,161,48,.1);
      border-color: #fca130;
    }
    
    .swagger-ui .opblock.opblock-delete {
      background: rgba(249,62,62,.1);
      border-color: #f93e3e;
    }
    
    /* Parameters and Response Styling */
    .swagger-ui .parameters-container {
      background: #fff;
      border-radius: 4px;
      margin: 8px 0;
    }
    
    .swagger-ui .parameter__name {
      font-weight: 500;
      color: #2c3e50;
    }
    
    .swagger-ui .parameter__type {
      color: #6c757d;
      font-size: 0.85em;
    }
    
    /* Authorization Button */
    .swagger-ui .btn.authorize {
      background-color: #2c3e50;
      border-color: #2c3e50;
      color: white;
      border-radius: 4px;
    }
    
    .swagger-ui .btn.authorize svg {
      fill: white;
    }
    
    /* Models Section */
    .swagger-ui section.models {
      margin-top: 30px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 6px;
    }
    
    .swagger-ui section.models .model-container {
      padding: 10px;
      background: white;
      border-radius: 4px;
      margin: 8px 0;
    }
    
    /* Try it out button */
    .swagger-ui .try-out__btn {
      background-color: #2c3e50;
      border-color: #2c3e50;
      color: white;
      border-radius: 4px;
    }
    
    /* Response section */
    .swagger-ui .responses-inner {
      background: #fff;
      padding: 10px;
      border-radius: 4px;
    }
    
    .swagger-ui .response-col_status {
      font-weight: 500;
      color: #2c3e50;
    }
    
    /* Schema styles */
    .swagger-ui .model {
      font-size: 0.9em;
    }
    
    .swagger-ui .model-title {
      font-size: 1em;
      color: #2c3e50;
    }
  `,
  customSiteTitle: `Healthcare API Documentation (${getEnvironmentConfig().app.environment})`,
}; 