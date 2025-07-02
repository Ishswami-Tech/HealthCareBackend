import { SetMetadata } from '@nestjs/common';
import { Permission, ResourceType } from '../../libs/types/permission.types';

export interface PermissionMetadata {
  action: Permission;
  resourceType?: ResourceType;
  resourceIdParam?: string; // e.g., 'clinicId' for dynamic resource checks
}

export const PERMISSION_KEY = 'permission';

export const PermissionDecorator = (
  action: Permission,
  resourceType?: ResourceType,
  resourceIdParam?: string
) => SetMetadata(PERMISSION_KEY, { action, resourceType, resourceIdParam });

export { PermissionDecorator as Permission }; 