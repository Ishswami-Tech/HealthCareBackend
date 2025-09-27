# 🤖 AI Implementation Prompt for Healthcare Notification System

> **Use this prompt with Claude, ChatGPT, or any AI coding assistant to implement the complete notification system**

## 🎯 **Main Implementation Prompt**

```
You are an expert backend developer implementing a notification system for a Healthcare Backend application. The app is built with NestJS, TypeScript, and supports 10 million users.

## Current Project Structure:
- NestJS backend with TypeScript
- PostgreSQL database
- Redis for caching
- BullMQ for job queues
- Existing services: auth, appointments, users, clinic
- Existing communication: email, WhatsApp services
- Firebase Admin SDK already installed
- AWS SDK packages available

## Requirements:
Implement a complete notification system with the following components:

### 1. Firebase Push Notifications (Primary)
- Firebase Cloud Messaging for cross-platform push notifications
- Support for iOS, Android, and Web
- Device token management
- Topic-based messaging
- Batch notifications

### 2. AWS SES Email Service (Primary)
- High-deliverability email service
- HTML email templates
- Appointment reminders
- Prescription notifications
- Billing notifications

### 3. AWS SNS Push Backup (Secondary)
- Backup push notification service
- Automatic failover from Firebase
- HIPAA compliant
- High reliability

### 4. Firebase Realtime Database (Chat Backup)
- Backup chat messages (20M capacity)
- Real-time synchronization
- Offline support
- Message history

### 5. Notification Management
- User preferences
- Delivery tracking
- Retry mechanisms
- Analytics

## Implementation Tasks:

### Task 1: Create Firebase Services
Create the following services in `src/libs/communication/messaging/push/`:
- `push.service.ts` - Firebase Cloud Messaging service
- `sns-backup.service.ts` - AWS SNS backup service
- `device-token.service.ts` - Device token management

### Task 2: Create Email Services
Create the following services in `src/libs/communication/messaging/email/`:
- `ses-email.service.ts` - AWS SES email service
- `email-templates.service.ts` - HTML email templates
- `email-queue.service.ts` - Email queue management

### Task 3: Create Chat Backup Service
Create in `src/libs/communication/messaging/chat/`:
- `chat-backup.service.ts` - Firebase Realtime Database backup

### Task 4: Create Notification Controller
Create `src/controllers/notification.controller.ts` with endpoints:
- POST /notifications/push - Send push notification
- POST /notifications/email - Send email
- POST /notifications/appointment-reminder - Appointment reminder
- POST /notifications/prescription-ready - Prescription notification
- POST /notifications/chat-backup - Backup chat message
- GET /notifications/history/:userId - Get notification history

### Task 5: Create Notification Service
Create `src/services/notification.service.ts` with:
- Unified notification sending
- Fallback mechanisms
- Delivery tracking
- User preferences

### Task 6: Create DTOs
Create `src/libs/dtos/notification/` with:
- `send-notification.dto.ts`
- `appointment-reminder.dto.ts`
- `prescription-notification.dto.ts`
- `chat-backup.dto.ts`

### Task 7: Create Database Entities
Create `src/libs/infrastructure/database/entities/` with:
- `notification.entity.ts`
- `device-token.entity.ts`
- `notification-preference.entity.ts`

### Task 8: Create Queue Jobs
Create `src/libs/infrastructure/queue/jobs/` with:
- `send-notification.job.ts`
- `send-email.job.ts`
- `backup-chat.job.ts`

### Task 9: Update App Module
Update `src/app.module.ts` to include all new services and controllers

### Task 10: Create Environment Configuration
Add to `.env`:
- Firebase configuration
- AWS SES configuration
- AWS SNS configuration

## Code Requirements:

### Firebase Service Requirements:
- Initialize Firebase Admin SDK
- Send to single device
- Send to multiple devices
- Send to topics
- Handle errors gracefully
- Log all operations

### AWS SES Requirements:
- Initialize AWS SES client
- Send HTML emails
- Send text emails
- Handle bounces and complaints
- Retry failed sends
- Log all operations

### AWS SNS Requirements:
- Initialize AWS SNS client
- Send push notifications
- Handle platform endpoints
- Retry failed sends
- Log all operations

### Chat Backup Requirements:
- Initialize Firebase Realtime Database
- Backup individual messages
- Sync message history
- Handle offline scenarios
- Log all operations

### Notification Service Requirements:
- Unified interface for all notification types
- Automatic fallback mechanisms
- Delivery tracking
- User preference handling
- Retry logic
- Analytics collection

## Error Handling:
- All services must have comprehensive error handling
- Log all errors with context
- Implement retry mechanisms
- Graceful degradation
- Fallback to alternative services

## Security:
- Validate all inputs
- Sanitize user data
- Encrypt sensitive information
- Implement rate limiting
- Audit logging

## Performance:
- Use connection pooling
- Implement caching
- Batch operations where possible
- Async/await patterns
- Queue heavy operations

## Testing:
- Unit tests for all services
- Integration tests for API endpoints
- Mock external services
- Test error scenarios
- Test fallback mechanisms

## Documentation:
- JSDoc comments for all methods
- API documentation
- Setup instructions
- Troubleshooting guide

## Environment Variables Needed:
```
# Firebase Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Email Configuration
AWS_SES_FROM_EMAIL=noreply@yourdomain.com
AWS_SES_FROM_NAME=Healthcare App

# Push Notification Configuration
FIREBASE_SERVER_KEY=your-server-key
```

## Expected Output:
1. Complete implementation of all services
2. Working API endpoints
3. Proper error handling
4. Database entities and migrations
5. Queue jobs for background processing
6. Environment configuration
7. Basic tests
8. Documentation

## Success Criteria:
- All notification types working
- Fallback mechanisms functional
- Error handling comprehensive
- Performance optimized
- Security implemented
- Tests passing
- Documentation complete

Please implement this step by step, starting with the Firebase services, then AWS services, then the unified notification service, and finally the API endpoints. Make sure to follow NestJS best practices and include proper error handling, logging, and documentation.
```

## 🔧 **Specific Service Implementation Prompts**

### **Firebase Push Service Prompt:**
```
Create a Firebase Cloud Messaging service for a NestJS healthcare app. Requirements:

1. Initialize Firebase Admin SDK with environment variables
2. Send push notifications to single device
3. Send push notifications to multiple devices
4. Send push notifications to topics
5. Handle device token validation
6. Implement error handling and retry logic
7. Log all operations
8. Support for custom data payload
9. Support for notification channels (Android)
10. Handle invalid tokens gracefully

Use the existing project structure and follow NestJS patterns. Include proper TypeScript types and JSDoc documentation.
```

### **AWS SES Email Service Prompt:**
```
Create an AWS SES email service for a NestJS healthcare app. Requirements:

1. Initialize AWS SES client with credentials
2. Send HTML emails with templates
3. Send text emails
4. Handle email bounces and complaints
5. Implement retry logic for failed sends
6. Support for email templates (appointment reminders, prescriptions)
7. Handle rate limiting
8. Log all operations
9. Support for attachments
10. Handle email validation

Create email templates for:
- Appointment reminders
- Prescription ready notifications
- Payment confirmations
- Password reset emails
- Account verification emails

Use the existing project structure and follow NestJS patterns. Include proper error handling and logging.
```

### **Notification Controller Prompt:**
```
Create a notification controller for a NestJS healthcare app. Requirements:

1. POST /notifications/push - Send push notification
2. POST /notifications/email - Send email
3. POST /notifications/appointment-reminder - Send appointment reminder
4. POST /notifications/prescription-ready - Send prescription notification
5. POST /notifications/chat-backup - Backup chat message
6. GET /notifications/history/:userId - Get notification history
7. GET /notifications/preferences/:userId - Get user preferences
8. PUT /notifications/preferences/:userId - Update user preferences
9. POST /notifications/test - Test notification system
10. GET /notifications/stats - Get notification statistics

Include:
- Request validation with DTOs
- Response formatting
- Error handling
- Rate limiting
- Authentication/authorization
- Logging
- API documentation

Use the existing project structure and follow NestJS patterns.
```

### **Database Entities Prompt:**
```
Create database entities for a notification system in a NestJS healthcare app. Requirements:

1. Notification entity - Store notification records
2. DeviceToken entity - Store user device tokens
3. NotificationPreference entity - Store user preferences
4. NotificationHistory entity - Store notification history
5. ChatMessage entity - Store chat messages for backup

Each entity should include:
- Proper TypeScript types
- Database relationships
- Validation decorators
- Indexes for performance
- Audit fields (createdAt, updatedAt)
- Soft delete support

Use TypeORM decorators and follow the existing project patterns.
```

## 🧪 **Testing Prompts**

### **Unit Test Prompt:**
```
Create comprehensive unit tests for the notification services in a NestJS healthcare app. Requirements:

1. Test Firebase push notification service
2. Test AWS SES email service
3. Test AWS SNS backup service
4. Test chat backup service
5. Test notification controller
6. Test error scenarios
7. Test fallback mechanisms
8. Test retry logic
9. Mock external services
10. Test edge cases

Include:
- Jest test framework
- Proper mocking
- Test coverage
- Error scenario testing
- Performance testing
- Integration testing

Use the existing project structure and testing patterns.
```

### **Integration Test Prompt:**
```
Create integration tests for the notification system in a NestJS healthcare app. Requirements:

1. Test complete notification flow
2. Test API endpoints
3. Test database operations
4. Test queue jobs
5. Test external service integration
6. Test error handling
7. Test performance
8. Test security
9. Test fallback mechanisms
10. Test user preferences

Include:
- Test database setup
- Mock external services
- Test data cleanup
- Performance benchmarks
- Security testing
- End-to-end testing

Use the existing project structure and testing patterns.
```

## 📚 **Documentation Prompts**

### **API Documentation Prompt:**
```
Create comprehensive API documentation for the notification system in a NestJS healthcare app. Requirements:

1. OpenAPI/Swagger documentation
2. Request/response examples
3. Error codes and messages
4. Authentication requirements
5. Rate limiting information
6. Usage examples
7. Integration guides
8. Troubleshooting section
9. Performance considerations
10. Security guidelines

Include:
- Swagger decorators
- Example requests
- Example responses
- Error documentation
- Authentication flow
- Rate limiting details

Use the existing project structure and documentation patterns.
```

### **Setup Guide Prompt:**
```
Create a comprehensive setup guide for the notification system in a NestJS healthcare app. Requirements:

1. Prerequisites and dependencies
2. Environment configuration
3. Firebase setup instructions
4. AWS setup instructions
5. Database setup
6. Testing instructions
7. Deployment guide
8. Troubleshooting common issues
9. Performance optimization
10. Security considerations

Include:
- Step-by-step instructions
- Code examples
- Configuration files
- Screenshots
- Common errors and solutions
- Best practices

Make it beginner-friendly and comprehensive.
```

## 🚀 **Usage Instructions**

### **For Claude:**
1. Copy the main implementation prompt
2. Paste it into Claude
3. Ask for step-by-step implementation
4. Use specific service prompts for detailed implementation

### **For ChatGPT:**
1. Use the main prompt as context
2. Ask for specific services one by one
3. Request code reviews and improvements
4. Ask for testing and documentation

### **For Other AI Assistants:**
1. Adapt the prompt to the specific AI
2. Break down into smaller tasks
3. Request incremental implementation
4. Ask for code reviews

## 🎯 **Expected Timeline**

### **With AI Assistant:**
- **Day 1-2**: Firebase services implementation
- **Day 3-4**: AWS services implementation
- **Day 5-6**: Notification service and controller
- **Day 7**: Testing and documentation
- **Total**: 1 week with AI assistance

### **Without AI Assistant:**
- **Week 1**: Firebase services
- **Week 2**: AWS services
- **Week 3**: Integration and testing
- **Total**: 3 weeks manual implementation

## 💡 **Tips for AI Implementation**

1. **Start with one service at a time**
2. **Ask for code reviews after each service**
3. **Request testing for each component**
4. **Ask for error handling improvements**
5. **Request performance optimizations**
6. **Ask for security enhancements**
7. **Request documentation updates**
8. **Ask for deployment instructions**

## 🔧 **Troubleshooting with AI**

### **Common Issues to Ask About:**
1. "How do I handle Firebase authentication errors?"
2. "How do I implement retry logic for failed notifications?"
3. "How do I handle invalid device tokens?"
4. "How do I implement rate limiting for notifications?"
5. "How do I test notification services without sending real notifications?"
6. "How do I handle email bounces and complaints?"
7. "How do I implement notification preferences?"
8. "How do I optimize notification performance?"

---

## 🎉 **Success Metrics**

After implementation, you should have:
- ✅ Working push notifications (Firebase + AWS SNS backup)
- ✅ Working email notifications (AWS SES)
- ✅ Chat message backup (Firebase Realtime Database)
- ✅ Unified notification service
- ✅ API endpoints for all notification types
- ✅ Error handling and fallback mechanisms
- ✅ User preferences and delivery tracking
- ✅ Comprehensive testing
- ✅ Complete documentation
- ✅ Production-ready code

**Total Cost: $105/month for 10M users!**

Use these prompts to get AI assistance in implementing your complete notification system! 🚀


