import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Check, Loader2 } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

interface Model {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: number;
    completion: number;
  };
  context_length?: number;
}

const Models = () => {
  const queryClient = useQueryClient();
  const [selectedModel, setSelectedModel] = useState<string>("");

  // Fetch available models from OpenRouter
  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useQuery({
    queryKey: ["openrouter-models"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("fetch-openrouter-models");
      if (error) throw error;
      return data;
    },
  });

  // Fetch current model config from app_settings
  const { data: modelConfig, isLoading: configLoading } = useQuery({
    queryKey: ["ai-model-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "ai_model_config")
        .single();
      
      if (error) throw error;
      return data?.value as { model_name: string; model_provider: string };
    },
  });

  // Set selected model when config loads
  useEffect(() => {
    if (modelConfig?.model_name) {
      setSelectedModel(modelConfig.model_name);
    }
  }, [modelConfig]);

  // Update model mutation
  const updateModelMutation = useMutation({
    mutationFn: async (modelName: string) => {
      // Check if setting exists
      const { data: existing } = await supabase
        .from("app_settings")
        .select("id")
        .eq("key", "ai_model_config")
        .single();

      const newValue = {
        model_name: modelName,
        model_provider: "openrouter",
      };

      if (existing) {
        // Update existing setting
        const { error } = await supabase
          .from("app_settings")
          .update({ value: newValue })
          .eq("key", "ai_model_config");

        if (error) throw error;
      } else {
        // Insert new setting
        const { error } = await supabase
          .from("app_settings")
          .insert({
            key: "ai_model_config",
            value: newValue,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-model-config"] });
      toast.success("Model updated successfully");
    },
    onError: (error: any) => {
      console.error("Error updating model:", error);
      toast.error(error?.message || "Failed to update model");
    },
  });

  const handleSaveModel = () => {
    if (!selectedModel) {
      toast.error("Please select a model");
      return;
    }
    updateModelMutation.mutate(selectedModel);
  };

  const models = modelsData?.models || [];
  
  // Group models by provider
  const modelsByProvider = models.reduce((acc: any, model: Model) => {
    const provider = model.id.split('/')[0];
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});

  const getProviderName = (provider: string) => {
    const names: Record<string, string> = {
      'google': 'Google',
      'anthropic': 'Anthropic',
      'openai': 'OpenAI',
      'x-ai': 'xAI (Grok)',
    };
    return names[provider] || provider;
  };

  const formatPrice = (price: number) => {
    return `$${(price * 1000000).toFixed(2)}/M tokens`;
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">AI Model Selection</h1>
          <p className="text-muted-foreground">
            Choose the AI model for journalism story generation
          </p>
        </div>
        <Button 
          onClick={() => refetchModels()} 
          variant="outline"
          disabled={modelsLoading}
        >
          {modelsLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh Models
        </Button>
      </div>

      {configLoading || modelsLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Loading models...</p>
          </CardContent>
        </Card>
      ) : !modelsData?.success ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-destructive mb-4">Failed to load models from OpenRouter</p>
            <Button onClick={() => refetchModels()}>Try Again</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Current Active Model</CardTitle>
              <CardDescription>
                This model will be used for automated journalism runs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-sm">
                    {modelConfig?.model_name || "No model selected"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Provider: {modelConfig?.model_provider || "N/A"}
                  </p>
                </div>
                {selectedModel !== modelConfig?.model_name && (
                  <Button 
                    onClick={handleSaveModel}
                    disabled={updateModelMutation.isPending}
                  >
                    {updateModelMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="mr-2 h-4 w-4" />
                        Save Selection
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {Object.entries(modelsByProvider).map(([provider, providerModels]: [string, any]) => (
              <Card key={provider}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {getProviderName(provider)}
                    <Badge variant="outline">{providerModels.length} models</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <RadioGroup value={selectedModel} onValueChange={setSelectedModel}>
                    <div className="space-y-3">
                      {providerModels.map((model: Model) => (
                        <div
                          key={model.id}
                          className="flex items-start space-x-3 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                        >
                          <RadioGroupItem value={model.id} id={model.id} className="mt-1" />
                          <Label htmlFor={model.id} className="flex-1 cursor-pointer">
                            <div className="font-medium font-mono text-sm mb-1">
                              {model.id}
                            </div>
                            {model.name && (
                              <div className="text-sm text-muted-foreground mb-2">
                                {model.name}
                              </div>
                            )}
                            {model.description && (
                              <div className="text-xs text-muted-foreground mb-2">
                                {model.description}
                              </div>
                            )}
                            <div className="flex gap-4 text-xs text-muted-foreground">
                              {model.context_length && (
                                <span>Context: {model.context_length.toLocaleString()} tokens</span>
                              )}
                              {model.pricing && (
                                <>
                                  <span>Prompt: {formatPrice(model.pricing.prompt)}</span>
                                  <span>Completion: {formatPrice(model.pricing.completion)}</span>
                                </>
                              )}
                            </div>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default Models;
