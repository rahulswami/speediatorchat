export default function DashboardPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Overview</h1>
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Open Conversations', value: '—' },
          { label: 'Contacts', value: '—' },
          { label: 'Templates', value: '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-background border rounded-lg p-6">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
