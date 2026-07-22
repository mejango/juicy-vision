const production = process.env.DEPLOY_ENV === 'production'

function exactHttpsUrl(name, value, { allowPath = false } = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid absolute URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS URL without credentials, query, or fragment`)
  }
  if (!allowPath && (url.pathname !== '/' || url.origin !== value.replace(/\/$/, ''))) {
    throw new Error(`${name} must be an origin, not a URL with a path`)
  }
  if (value.endsWith('/')) throw new Error(`${name} must not end with a slash`)
}

if (production) {
  const apiUrl = process.env.VITE_API_URL || ''
  const sameOrigin = process.env.ALLOW_SAME_ORIGIN_API === 'true'
  if (!apiUrl && !sameOrigin) {
    throw new Error(
      'Set VITE_API_URL to the production API origin, or explicitly set ALLOW_SAME_ORIGIN_API=true',
    )
  }
  if (apiUrl) exactHttpsUrl('VITE_API_URL', apiUrl)

  const walletConnectId = process.env.VITE_WALLETCONNECT_PROJECT_ID || ''
  if (!/^[a-f0-9]{32}$/i.test(walletConnectId)) {
    throw new Error('VITE_WALLETCONNECT_PROJECT_ID must be a 32-character WalletConnect project ID')
  }
}

console.log(`Release configuration is valid for ${production ? 'production' : 'development'}.`)
