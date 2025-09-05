# 🏥 HealthCare App - AI Rules Index

> **Comprehensive development guidelines for the HealthCare Backend application**

## 📋 Quick Reference

- [🏗️ Architecture Guidelines](./architecture.md) - SOLID principles, design patterns, project structure
- [📝 Coding Standards](./coding-standards.md) - TypeScript standards, naming conventions, code quality
- [🗄️ Database Guidelines](./database.md) - Multi-database architecture, Prisma patterns, query optimization
- [🚀 NestJS Specific](./nestjs-specific.md) - NestJS/Fastify patterns, dependency injection, guards
- [🔒 Security Guidelines](./security.md) - Authentication, authorization, data protection, audit logging

---

## 🎯 Essential Rules Summary

### **Core Architecture Principles**
- **SOLID Principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY Principle**: Don't Repeat Yourself - extract common functionality into reusable components
- **Multi-Database Architecture**: Separate databases for healthcare and fashion clients using PrismaService
- **Event-Driven Architecture**: Use domain events for loose coupling between modules
- **Repository Pattern**: Abstract data access layer with consistent interfaces

### **Project Structure**
- ✅ **NestJS with Fastify** (NOT Express)
- ✅ **TypeScript Strict Mode** - No `any` types
- ✅ **Multi-Database Architecture** - Healthcare + Fashion domains
- ✅ **Path Aliases** - Use `@services`, `@dtos`, etc. (never relative imports)

### **Code Quality Standards**
```typescript
// Naming Conventions
user.service.ts           // Files: kebab-case
export class UserService  // Classes: PascalCase
const firstName = 'John'  // Variables: camelCase
const JWT_SECRET = 'key'  // Constants: UPPER_SNAKE_CASE
interface IUser {}        // Interfaces: PascalCase with 'I' prefix
```

### **Import Organization**
```typescript
// 1. External imports (Node.js, npm packages)
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 2. Internal imports (using path aliases)
import { PrismaService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { UserDto } from '@dtos';

// 3. Local imports (same directory)
```