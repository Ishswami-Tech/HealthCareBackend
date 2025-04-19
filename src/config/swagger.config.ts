import { DocumentBuilder, SwaggerCustomOptions } from '@nestjs/swagger';

export const swaggerConfig = new DocumentBuilder()
  .setTitle('Healthcare API')
  .setDescription(`
## Modern Healthcare Management System

A comprehensive API system providing seamless integration for healthcare services.

### Core Features
✨ Authentication & Authorization
🔐 Secure Session Management
📱 Multi-factor Authentication
🔄 Real-time Queue Management
💉 Clinic Management

### Authentication Steps
1. First, use the \`/auth/login\` endpoint to get your access token
2. Copy the \`access_token\` value from the response (it starts with "eyJhbGciOiJIUzI1NiIsInR5cCI...")
3. Click the "Authorize" button at the top
4 . Click "Authorize"
5. You can now access protected endpoints

  `)
  .setVersion('1.0')
  // Core System Tags
  .addTag('root', 'Root endpoints and health checks')
  .addTag('health', 'System health checks and monitoring')
  .addTag('auth', 'Authentication & User Management - Complete user authentication flow including social logins and OTP verification')
  .addTag('user', 'User profile and preferences management')
  // Business Logic Tags
  .addTag('Appointment', 'Appointment Scheduling And Management')
  .addTag('AppointmentConfirmation', 'Appointment Confirmation And Validation')
  .addTag('AppointmentLocation', 'Location-Based Appointment Management')
  .addTag('clinic', 'Healthcare facility and service management')
  .addTag('Clinic Locations', 'Geographical management of clinic locations')
  // Infrastructure Tags
  .addTag('cache', 'Redis-based caching system for optimized performance')
  .addTag('Logging', 'System Logging And Monitoring')
  .addServer('http://localhost:8088', 'Local API Server')
  .addServer('/queue-dashboard', 'Bull Queue Dashboard')
  .addSecurityRequirements('JWT-auth')
  .addBearerAuth()
  .build();

export const swaggerCustomOptions: SwaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    filter: true,
    showRequestDuration: true,
    tryItOutEnabled: true,
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
  },
  customCss: `
    .swagger-ui {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    }
    
    .swagger-ui .topbar { display: none }
    
    .swagger-ui .info {
      margin: 15px 0;
      background: #f8f9fa;
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
  customSiteTitle: 'Healthcare API Documentation',
}; 