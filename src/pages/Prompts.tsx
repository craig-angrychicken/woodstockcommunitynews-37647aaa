const Prompts = () => {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Prompts</h1>
      </div>
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-muted-foreground">No prompts configured. Add prompts to customize content generation.</p>
      </div>
    </div>
  );
};

export default Prompts;
