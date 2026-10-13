import { HttpError } from '../http.js'
import { hasPermission, type AuthenticatedAdmin, type Permission } from '../securityTypes.js'

export function requirePermission(admin: AuthenticatedAdmin, permission: Permission) {
  if (!hasPermission(admin, permission)) throw new HttpError(403, '当前角色没有执行此操作的权限')
}

export function permissionForRequest(method: string, pathname: string): Permission {
  if (pathname === '/api/admin/account') return 'content.read'
  if (pathname.startsWith('/api/audit-logs')) return 'audit.read'
  if (pathname.startsWith('/api/analytics')) return 'analytics.read'
  if (pathname.startsWith('/api/tasks')) return method === 'GET' ? 'content.read' : 'tasks.manage'
  if (pathname.startsWith('/api/admin/system/update') || pathname.startsWith('/api/admin/backups') || pathname === '/api/admin/access' || pathname.startsWith('/api/settings') || pathname === '/api/alerts/test') {
    return method === 'GET' ? 'content.read' : 'system.manage'
  }
  return method === 'GET' ? 'content.read' : 'content.manage'
}
