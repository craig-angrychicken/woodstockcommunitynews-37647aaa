const Sources = () => {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Sources</h1>
      </div>
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-muted-foreground">No sources configured. Add data sources to start importing content.</p>
      </div>
    </div>
  );
};

export default Sources;
