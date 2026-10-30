'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Plus, GitBranch } from 'lucide-react';

type Workflow = {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  createdAt: string;
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
};

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/workflows')
      .then((r) => r.json())
      .then(setWorkflows)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">Automate messages and contact actions</p>
        </div>
        <Link href="/dashboard/workflows/new">
          <Button size="sm" className="gap-2">
            <Plus className="w-4 h-4" /> New Workflow
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <GitBranch className="w-10 h-10 text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">No workflows yet. Build your first automation.</p>
          <Link href="/dashboard/workflows/new" className="mt-4">
            <Button size="sm" variant="outline">Create workflow</Button>
          </Link>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Trigger</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {workflows.map((w) => (
                <tr key={w.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/workflows/${w.id}`} className="font-medium hover:underline">
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{w.triggerType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[w.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {w.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
