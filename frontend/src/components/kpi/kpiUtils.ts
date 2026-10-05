import type { KpiStatus } from '../../types'

export const STATUS_TONE: Record<KpiStatus, 'green' | 'amber' | 'red'> = { Good: 'green', Attention: 'amber', Critical: 'red' }
export const STATUS_COLOR: Record<KpiStatus, string> = { Good: '#2e9d65', Attention: '#c68a2a', Critical: '#d84a4a' }
export const STATUS_LABEL: Record<KpiStatus, string> = { Good: 'Good', Attention: 'Attention', Critical: 'Critical' }
export const num = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '–' : `${Math.round(n * 10 ** digits) / 10 ** digits}`)
export const pctText = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${num(n)}%`)
export const scoreColor = (n: number | null | undefined, good = 90, attention = 70) => (n === null || n === undefined ? '#cbd0d6' : n >= good ? STATUS_COLOR.Good : n >= attention ? STATUS_COLOR.Attention : STATUS_COLOR.Critical)
