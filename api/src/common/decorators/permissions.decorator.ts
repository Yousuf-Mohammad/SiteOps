import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/** Declare the permissions a route requires, enforced by PermissionsGuard. */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
