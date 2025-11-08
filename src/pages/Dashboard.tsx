const Dashboard = () => {
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Total Stories</h2>
          <p className="text-3xl font-bold text-primary">0</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Active Sources</h2>
          <p className="text-3xl font-bold text-primary">0</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-2 text-card-foreground">Total Prompts</h2>
          <p className="text-3xl font-bold text-primary">0</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
