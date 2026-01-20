import { useState, useEffect, useRef, useMemo } from 'react'
import { useThemeStore, useSettingsStore } from '../../stores'
import { fetchProject, fetchSuckerGroupBalance, type Project, type SuckerGroupBalance } from '../../services/bendystraw'
import { resolveIpfsUri, fetchIpfsMetadata, pinFile, type IpfsProjectMetadata } from '../../utils/ipfs'

// Import dynamic components that can be composed
import ProjectCard from './ProjectCard'
import ActivityFeed from './ActivityFeed'
import NFTGallery from './NFTGallery'

interface LandingPagePreviewProps {
  projectId: string
  chainId?: string
  layout?: string // 'hero' | 'minimal' | 'full'
  showComponents?: string // JSON array of component names to show
  title?: string
  subtitle?: string
}

type LayoutType = 'hero' | 'minimal' | 'full'
type ComponentType = 'project-card' | 'nft-gallery' | 'activity-feed' | 'hero-banner'
type PreviewMode = 'live' | 'html'

const DEFAULT_COMPONENTS: Record<LayoutType, ComponentType[]> = {
  hero: ['hero-banner', 'project-card'],
  minimal: ['project-card'],
  full: ['hero-banner', 'project-card', 'nft-gallery', 'activity-feed'],
}

export default function LandingPagePreview({
  projectId,
  chainId = '1',
  layout = 'hero',
  showComponents,
  title,
  subtitle,
}: LandingPagePreviewProps) {
  const { theme } = useThemeStore()
  const { pinataJwt } = useSettingsStore()
  const isDark = theme === 'dark'
  const previewRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [project, setProject] = useState<Project | null>(null)
  const [metadata, setMetadata] = useState<IpfsProjectMetadata | null>(null)
  const [balance, setBalance] = useState<SuckerGroupBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportedUrl, setExportedUrl] = useState<string | null>(null)
  const [exportedCid, setExportedCid] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('live')
  const [copied, setCopied] = useState(false)

  const chainIdNum = parseInt(chainId)
  const layoutType = (layout as LayoutType) || 'hero'

  // Parse showComponents
  const components: ComponentType[] = (() => {
    if (showComponents) {
      try {
        return JSON.parse(showComponents) as ComponentType[]
      } catch {
        return DEFAULT_COMPONENTS[layoutType]
      }
    }
    return DEFAULT_COMPONENTS[layoutType]
  })()

  useEffect(() => {
    async function loadProject() {
      setLoading(true)
      try {
        const [projectData, balanceData] = await Promise.all([
          fetchProject(projectId, chainIdNum),
          fetchSuckerGroupBalance(projectId, chainIdNum),
        ])

        setProject(projectData)
        setBalance(balanceData)

        if (projectData?.metadataUri) {
          const meta = await fetchIpfsMetadata(projectData.metadataUri)
          setMetadata(meta)
        }
      } catch (err) {
        console.error('Failed to load project for landing page:', err)
      } finally {
        setLoading(false)
      }
    }

    loadProject()
  }, [projectId, chainIdNum])

  // Generate static HTML - memoized so it updates when data changes
  const staticHtml = useMemo(() => {
    return generateStaticHtml(project, metadata, balance, components, layoutType, isDark)
  }, [project, metadata, balance, components, layoutType, isDark])

  // Update iframe when switching to HTML preview mode
  useEffect(() => {
    if (previewMode === 'html' && iframeRef.current) {
      const doc = iframeRef.current.contentDocument
      if (doc) {
        doc.open()
        doc.write(staticHtml)
        doc.close()
      }
    }
  }, [previewMode, staticHtml])

  const handleExport = async () => {
    if (!pinataJwt) {
      setExportError('Configure Pinata API key in settings to export')
      return
    }

    setExporting(true)
    setExportError(null)

    try {
      // Create HTML file as a Blob
      const htmlBlob = new Blob([staticHtml], { type: 'text/html' })
      const htmlFile = new File([htmlBlob], `${project?.name || 'landing-page'}.html`, { type: 'text/html' })

      // Pin the HTML file to IPFS
      const cid = await pinFile(
        htmlFile,
        pinataJwt,
        `landing-page-${project?.name || projectId}`
      )

      setExportedCid(cid)
      setExportedUrl(`https://gateway.pinata.cloud/ipfs/${cid}`)
    } catch (err) {
      console.error('Failed to export landing page:', err)
      setExportError('Failed to export. Check your Pinata API key.')
    } finally {
      setExporting(false)
    }
  }

  const handleCopyLink = async () => {
    if (exportedUrl) {
      await navigator.clipboard.writeText(exportedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const displayTitle = title || project?.name || 'Project'
  const displaySubtitle = subtitle || metadata?.tagline || metadata?.projectTagline || ''
  const logoUrl = project ? resolveIpfsUri(project.logoUri) : null

  if (loading) {
    return (
      <div className="w-full max-w-4xl">
        <div className={`border animate-pulse ${
          isDark ? 'bg-juice-dark-lighter border-gray-600' : 'bg-white border-gray-300'
        }`}>
          <div className={`h-48 ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
          <div className="p-6 space-y-4">
            <div className={`h-8 w-1/2 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
            <div className={`h-4 w-3/4 ${isDark ? 'bg-white/10' : 'bg-gray-200'}`} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-4xl">
      {/* Preview header */}
      <div className={`flex items-center justify-between mb-3 px-1`}>
        <div className="flex items-center gap-3">
          <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Landing Page ({layoutType})
          </span>
          {/* Preview mode toggle */}
          <div className={`flex text-xs border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
            <button
              onClick={() => setPreviewMode('live')}
              className={`px-2 py-1 transition-colors ${
                previewMode === 'live'
                  ? 'bg-juice-orange text-black'
                  : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Live
            </button>
            <button
              onClick={() => setPreviewMode('html')}
              className={`px-2 py-1 transition-colors ${
                previewMode === 'html'
                  ? 'bg-juice-orange text-black'
                  : isDark ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              HTML
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting || !pinataJwt}
            title={!pinataJwt ? 'Configure Pinata API key in settings' : undefined}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              exporting || !pinataJwt
                ? 'bg-gray-500/50 text-gray-400 cursor-not-allowed'
                : 'bg-juice-orange hover:bg-juice-orange/90 text-black'
            }`}
          >
            {exporting ? 'Publishing...' : 'Publish to IPFS'}
          </button>
        </div>
      </div>

      {/* Export result */}
      {exportedUrl && (
        <div className={`mb-3 p-4 border ${
          isDark ? 'bg-green-900/20 border-green-500/30' : 'bg-green-50 border-green-200'
        }`}>
          <div className={`font-medium mb-2 ${isDark ? 'text-green-400' : 'text-green-700'}`}>
            Published to IPFS
          </div>
          <div className="flex items-center gap-2 mb-2">
            <a
              href={exportedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex-1 text-sm underline break-all ${isDark ? 'text-green-300' : 'text-green-600'}`}
            >
              {exportedUrl}
            </a>
            <button
              onClick={handleCopyLink}
              className={`px-2 py-1 text-xs font-medium shrink-0 transition-colors ${
                copied
                  ? 'bg-green-500 text-white'
                  : isDark ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {exportedCid && (
            <div className={`text-xs font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              CID: {exportedCid}
            </div>
          )}
        </div>
      )}

      {exportError && (
        <div className={`mb-3 p-3 border text-sm ${
          isDark ? 'bg-red-900/20 border-red-500/30 text-red-400' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {exportError}
        </div>
      )}

      {/* Preview frame - Live mode */}
      {previewMode === 'live' && (
        <div
          ref={previewRef}
          className={`border overflow-hidden ${
            isDark ? 'bg-juice-dark border-gray-600' : 'bg-white border-gray-300'
          }`}
        >
          {/* Hero banner */}
          {components.includes('hero-banner') && (
            <div className={`relative overflow-hidden ${
              layoutType === 'full' ? 'h-64' : 'h-48'
            }`}>
              {/* Background */}
              <div className={`absolute inset-0 ${
                isDark ? 'bg-gradient-to-br from-juice-orange/20 to-purple-500/20' : 'bg-gradient-to-br from-juice-orange/10 to-purple-500/10'
              }`} />

              {/* Content */}
              <div className="relative z-10 h-full flex flex-col items-center justify-center p-6 text-center">
                {logoUrl && (
                  <img
                    src={logoUrl}
                    alt={displayTitle}
                    className="w-20 h-20 object-cover mb-4"
                  />
                )}
                <h1 className={`text-3xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                  {displayTitle}
                </h1>
                {displaySubtitle && (
                  <p className={`text-lg ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                    {displaySubtitle}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Content sections */}
          <div className={`p-6 space-y-8`}>
            {/* Project Card */}
            {components.includes('project-card') && (
              <div className="flex justify-center">
                <ProjectCard projectId={projectId} chainId={chainId} />
              </div>
            )}

            {/* NFT Gallery */}
            {components.includes('nft-gallery') && (
              <div>
                <NFTGallery projectId={projectId} chainId={chainId} columns="3" />
              </div>
            )}

            {/* Activity Feed */}
            {components.includes('activity-feed') && (
              <div className="flex justify-center">
                <ActivityFeed projectId={projectId} chainId={chainId} limit={5} />
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`px-6 py-4 border-t text-center ${
            isDark ? 'border-white/10 text-gray-500' : 'border-gray-100 text-gray-400'
          }`}>
            <p className="text-xs">
              Built with{' '}
              <a
                href="https://juicy.bot"
                target="_blank"
                rel="noopener noreferrer"
                className="text-juice-orange hover:underline"
              >
                Juicy
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Preview frame - HTML mode (iframe) */}
      {previewMode === 'html' && (
        <div className={`border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
          <iframe
            ref={iframeRef}
            title="Landing Page HTML Preview"
            className="w-full bg-white"
            style={{ height: '500px', border: 'none' }}
            sandbox="allow-same-origin"
          />
        </div>
      )}

      {/* Layout info */}
      <div className={`mt-3 text-xs flex items-center justify-between ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
        <span>Components: {components.join(', ')}</span>
        {previewMode === 'html' && (
          <span className={isDark ? 'text-gray-600' : 'text-gray-400'}>
            This is exactly what will be published
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Generate static HTML for IPFS export
 */
function generateStaticHtml(
  project: Project | null,
  metadata: IpfsProjectMetadata | null,
  balance: SuckerGroupBalance | null,
  components: ComponentType[],
  _layout: LayoutType,
  isDark: boolean
): string {
  const title = project?.name || 'Project'
  const subtitle = metadata?.tagline || metadata?.projectTagline || ''
  const logoUrl = project?.logoUri ? resolveIpfsUri(project.logoUri) : null

  // Format balance
  const balanceStr = balance?.totalBalance
    ? (parseFloat(balance.totalBalance) / Math.pow(10, balance.decimals || 18)).toFixed(4)
    : '0'
  const currency = balance?.currency === 2 ? 'USDC' : 'ETH'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${isDark ? '#0a0a0a' : '#ffffff'};
      color: ${isDark ? '#ffffff' : '#1a1a1a'};
      min-height: 100vh;
    }
    .hero {
      background: linear-gradient(135deg, ${isDark ? 'rgba(255,153,0,0.2)' : 'rgba(255,153,0,0.1)'}, ${isDark ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.1)'});
      padding: 4rem 2rem;
      text-center;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .logo { width: 80px; height: 80px; object-fit: cover; margin-bottom: 1rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { font-size: 1.25rem; color: ${isDark ? '#a0a0a0' : '#666'}; }
    .content { padding: 2rem; max-width: 600px; margin: 0 auto; }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin: 2rem 0;
    }
    .stat {
      background: ${isDark ? 'rgba(255,255,255,0.05)' : '#f5f5f5'};
      padding: 1rem;
      text-align: center;
    }
    .stat-value { font-size: 1.5rem; font-weight: bold; }
    .stat-label { font-size: 0.875rem; color: ${isDark ? '#888' : '#666'}; }
    .pay-btn {
      display: block;
      width: 100%;
      padding: 1rem;
      background: #22c55e;
      color: black;
      text-align: center;
      text-decoration: none;
      font-weight: bold;
      border: none;
      cursor: pointer;
    }
    .footer {
      text-align: center;
      padding: 2rem;
      color: ${isDark ? '#666' : '#999'};
      font-size: 0.75rem;
    }
    .footer a { color: #ff9900; }
  </style>
</head>
<body>
  ${components.includes('hero-banner') ? `
  <div class="hero">
    ${logoUrl ? `<img src="${logoUrl}" alt="${title}" class="logo">` : ''}
    <h1>${title}</h1>
    ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
  </div>
  ` : ''}

  <div class="content">
    ${components.includes('project-card') ? `
    <div class="stats">
      <div class="stat">
        <div class="stat-value">${balanceStr} ${currency}</div>
        <div class="stat-label">Balance</div>
      </div>
      <div class="stat">
        <div class="stat-value">${project?.paymentsCount || 0}</div>
        <div class="stat-label">Payments</div>
      </div>
    </div>
    <a href="https://juicebox.money/v5/p/${project?.projectId}" target="_blank" class="pay-btn">
      Support This Project
    </a>
    ` : ''}

    ${metadata?.description ? `
    <div style="margin-top: 2rem;">
      <h2 style="margin-bottom: 1rem;">About</h2>
      <p style="color: ${isDark ? '#a0a0a0' : '#666'}; line-height: 1.6;">${metadata.description}</p>
    </div>
    ` : ''}
  </div>

  <div class="footer">
    Built with <a href="https://juicy.bot" target="_blank">Juicy</a>
  </div>
</body>
</html>`
}
