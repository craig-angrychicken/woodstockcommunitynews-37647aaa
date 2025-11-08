const ManualQuery = () => {
  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Manual Query</h1>
      <div className="bg-card border border-border rounded-lg p-8">
        <p className="text-muted-foreground mb-4">Execute custom queries and operations.</p>
        <div className="space-y-4">
          <textarea 
            className="w-full min-h-[200px] p-4 bg-background border border-input rounded-md text-foreground"
            placeholder="Enter your query here..."
          />
          <button className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
            Execute Query
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManualQuery;
