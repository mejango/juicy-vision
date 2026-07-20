/**
 * Subdomain detection utilities
 */

/**
 * Check if the current hostname is the admin dashboard subdomain (dash.*)
 */
function isDashboardSubdomain(): boolean {
  const hostname = window.location.hostname
  return hostname.startsWith('dash.')
}

/**
 * Check for ?admin=true query param (dev override)
 */
function hasAdminQueryParam(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('admin') === 'true'
}

/**
 * Check if admin dashboard should be shown
 * Either dash.* subdomain or ?admin=true query param
 */
export function shouldShowAdminDashboard(): boolean {
  return isDashboardSubdomain() || hasAdminQueryParam()
}
