'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Play, Pause } from 'lucide-react';
import Link from 'next/link';

type Workflow = {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  createdAt: string;
  executions?: { id: string; status: string; startedAt: string }[];
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  async function load() {
    const wf = await fetch(`/api/workflows/${id}`).then((r) => r.json());
    setWorkflow(wf);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [id]);

  async function publish() {
    setActionLoading(true);
    await fetch(`/api/workflows/${id}/publish`, { method: 'POST' });
    await load();
    setActionLoading(false);
  }

  async function deactivate() {
    setActionLoading(true);
    await fetch(`/api/workflows/${id}/deactivate`, { method: 'POST' });
    await load();
    setActionLoading(false);
  }

  async function remove() {
    if (!confirm('Delete this workflow?')) return;
    await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
    router.push('/dashboard/workflows');
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!workflow) return <div className="p-6 text-sm text-muted-foreground">Workflow not found.</div>;

  return (
    <div className="p-6">
      <Link href="/dashboard/workflows" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-3 h-3" /> Workflows
      </Link>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold">{workflow.name}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[workflow.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {workflow.status}
            </span>
            <span className="text-xs text-muted-foreground">Trigger: {workflow.triggerType}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {workflow.status === 'DRAFT' && (
            <Button size="sm" className="gap-1" onClick={publish} disabled={actionLoading}>
              <Play className="w-3 h-3" /> Publish
            </Button>
          )}
          {workflow.status === 'ACTIVE' && (
            <Button size="sm" variant="outline" className="gap-1" onClick={deactivate} disabled={actionLoading}>
              <Pause className="w-3 h-3" /> Pause
            </Button>
          )}
          {workflow.status !== 'ACTIVE' && (
            <Button size="sm" variant="destructive" onClick={remove}>Delete</Button>
          )}
        </div>
      </div>

      {workflow.executions && workflow.executions.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-3">Recent executions</h2>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {workflow.executions.map((ex) => (
                  <tr key={ex.id}>
                    <td className="px-4 py-2">{ex.status}</td>
                    <td className="px-4 py-2 text-muted-foreground">{new Date(ex.startedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
