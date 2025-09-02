import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from '../../infrastructure/permissions/permission.service';
import { PERMISSION_KEY, PermissionMetadata } from '../../infrastructure/permissions/permission.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission: PermissionMetadata = this.reflector.get<PermissionMetadata>(PERMISSION_KEY, context.getHandler());
    if (!permission) {
      // No permission required for this route
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    // Super admin bypass
    if (user.role === 'SUPER_ADMIN') {
      return true;
    }
    let resourceId: string | undefined = undefined;
    if (permission.resourceIdParam && request.params) {
      resourceId = request.params[permission.resourceIdParam];
    }
    
    // Use user.sub (JWT subject) as userId, fallback to user.id
    const userId = user.sub || user.id;
    if (!userId) {
      throw new ForbiddenException('User ID not found in token');
    }
    
    const has = await this.permissionService.hasPermission({
      userId: userId,
      action: permission.action,
      resourceType: permission.resourceType,
      resourceId,
    });
    if (!has) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
} 