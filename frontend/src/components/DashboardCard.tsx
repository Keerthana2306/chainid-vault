import { useState, type ReactNode } from 'react'
import type { RoleName } from '../lib/contract'
import { cleanAssetDescription } from '../lib/documentFingerprint'

interface DashboardCardProps {
  title: string
  eyebrow: string
  icon: string
  trailing?: ReactNode
  children: ReactNode
}

interface AssetView {
  tokenId: string
  name: string
  description: string
  createdAt: string | null
  lifecycleStatus: 'Valid' | 'Expiring soon' | 'Expired' | 'Revoked'
  expiresAt: string | null
}

const roleDescriptions: Record<RoleName, string> = {
  Admin: 'Security Administrator',
  Manager: 'Unit Manager',
  Auditor: 'Quality & Vigilance Auditor',
  User: 'Engineer / Vendor',
}

export function RoleBadge({ role, showDescription = false }: { role: RoleName; showDescription?: boolean }) {
  return (
    <span className={`role-badge role-${role.toLowerCase()}`}>
      {role}
      {showDescription && <span className="role-description">{roleDescriptions[role]}</span>}
    </span>
  )
}

export function DashboardCard({
  title,
  eyebrow,
  icon,
  trailing,
  children,
}: DashboardCardProps) {
  return (
    <article className="dashboard-card">
      <div className="card-heading">
        <div className="card-title-group">
          <span className="card-icon" aria-hidden="true">{icon}</span>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
        </div>
        {trailing}
      </div>
      {children}
    </article>
  )
}

export function AssetCard({ asset }: { asset: AssetView }) {
  const [copyMessage, setCopyMessage] = useState('')
  const verifyUrl = `${window.location.origin}/#/verify/${asset.tokenId}`

  const copyVerifyLink = async () => {
    try {
      await navigator.clipboard.writeText(verifyUrl)
      setCopyMessage('Link copied')
    } catch {
      setCopyMessage('Could not copy link')
    }
  }

  return (
    <article className="asset-card">
      <div className="asset-card-top">
        <span className="asset-art" aria-hidden="true">▱</span>
        <span className="token-label">TOKEN #{asset.tokenId}</span>
      </div>
      <div className={`asset-lifecycle-badge lifecycle-${asset.lifecycleStatus.toLowerCase().replaceAll(' ', '-')}`}>
        {asset.lifecycleStatus}
      </div>
      <div className="asset-expiry-date">{asset.expiresAt ? `Expires ${asset.expiresAt}` : 'No expiry set'}</div>
      <h3>{asset.name}</h3>
      <p className="asset-description">{cleanAssetDescription(asset.description) || 'No description provided.'}</p>
      <div className="asset-created">
        Issued (local time) {asset.createdAt ?? 'date unavailable'}
      </div>
      <div className="asset-verification-actions">
        <button className="button button-small button-quiet" onClick={() => void copyVerifyLink()} type="button">
          Copy verify link
        </button>
        <a className="asset-verification-link" href={`#/verify/${asset.tokenId}`}>Open verification</a>
      </div>
      {copyMessage && <span className="copy-link-status" role="status">{copyMessage}</span>}
    </article>
  )
}
