import type { ReactNode } from 'react'
import type { RoleName } from '../lib/contract'

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
  return (
    <article className="asset-card">
      <div className="asset-card-top">
        <span className="asset-art" aria-hidden="true">▱</span>
        <span className="token-label">TOKEN #{asset.tokenId}</span>
      </div>
      <h3>{asset.name}</h3>
      <p className="asset-description">{asset.description || 'No description provided.'}</p>
      <div className="asset-created">
        Created {asset.createdAt ?? 'date unavailable'}
      </div>
    </article>
  )
}
