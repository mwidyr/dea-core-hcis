import type { TaskRow, TaskStatus } from '../../types'

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To Do', in_progress: 'In Progress', review: 'Menunggu Approval', done: 'Selesai' }
export const STATUS_TONE: Record<TaskStatus, 'gray' | 'blue' | 'amber' | 'green'> = { todo: 'gray', in_progress: 'blue', review: 'amber', done: 'green' }
export const STATUS_BAR: Record<TaskStatus, string> = { todo: '#9aa3ad', in_progress: '#4f7fc6', review: '#c68a2a', done: '#2e9d65' }

export const err = (e: any, f: string) => e.response?.data?.error || f
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const day = (s: string | null) => (s ? s.slice(0, 10) : '')
export const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' }) : '–')
export const fmtShort = (s: string | null) => (s ? new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) : '–')
export const dt = (s?: string | null) => (s ? new Date(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–')
export const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
export const pct = (n: number) => `${Math.round(n * 10) / 10}%`

// local midnight of a yyyy-mm-dd (avoids timezone shifts when comparing / positioning dates)
export const dateOf = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00')
export const dayDiff = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 864e5)

export interface TreeNode { task: TaskRow; children: TreeNode[] }
// Builds the WBS tree from a flat list. A task whose parent is not in the list (filtered out) becomes a root.
export function buildTree(tasks: TaskRow[]): TreeNode[] {
  const byId = new Map(tasks.map((t) => [t.id, { task: t, children: [] as TreeNode[] }]))
  const roots: TreeNode[] = []
  tasks.forEach((t) => {
    const n = byId.get(t.id)!
    const parent = t.parent_id ? byId.get(t.parent_id) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  })
  const sort = (ns: TreeNode[]) => { ns.sort((a, b) => (a.task.start_date ?? a.task.due_date ?? '9999').localeCompare(b.task.start_date ?? b.task.due_date ?? '9999') || a.task.id - b.task.id); ns.forEach((n) => sort(n.children)) }
  sort(roots)
  return roots
}
export function flatten(nodes: TreeNode[], collapsed: Set<number>, depth = 0, out: { task: TaskRow; depth: number; hasKids: boolean }[] = []) {
  nodes.forEach((n) => { out.push({ task: n.task, depth, hasKids: n.children.length > 0 }); if (!collapsed.has(n.task.id)) flatten(n.children, collapsed, depth + 1, out) })
  return out
}
