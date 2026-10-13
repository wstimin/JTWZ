import type { IncomingMessage } from 'node:http'

export const adminRoles = ['owner', 'admin', 'editor', 'analyst'] as const
export type AdminRole = typeof adminRoles[number]
export type Permission = 'system.manage' | 'admins.manage' | 'content.manage' | 'content.read' | 'analytics.read' | 'audit.read' | 'tasks.manage'

const rolePermissions: Record<AdminRole, Permission[]> = {
  owner: ['system.manage', 'admins.manage', 'content.manage', 'content.read', 'analytics.read', 'audit.read', 'tasks.manage'],
  admin: ['system.manage', 'content.manage', 'content.read', 'analytics.read', 'audit.read', 'tasks.manage'],
  editor: ['content.manage', 'content.read', 'analytics.read', 'tasks.manage'],
  analyst: ['content.read', 'analytics.read', 'audit.read'],
}

export type AuthenticatedAdmin = {
  id: string
  username: string
  displayName: string
  role: AdminRole
  permissions: Permission[]
  twoFactorEnabled: boolean
  sessionId: string
  csrfToken: string
}

export type AuthenticatedRequest = IncomingMessage & { admin?: AuthenticatedAdmin }

export function permissionsForRole(role: AdminRole) {
  return rolePermissions[role]
}

export function hasPermission(admin: AuthenticatedAdmin, permission: Permission) {
  return admin.permissions.includes(permission)
}

export function publicAdmin(admin: AuthenticatedAdmin) {
  return {
    id: admin.id,
    username: admin.username,
    displayName: admin.displayName,
    role: admin.role,
    permissions: admin.permissions,
    twoFactorEnabled: admin.twoFactorEnabled,
  }
}
