import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import Dashboard from "./pages/Dashboard";
import Stories from "./pages/Stories";
import ManualQuery from "./pages/ManualQuery";
import AIJournalist from "./pages/AIJournalist";
import Artifacts from "./pages/Artifacts";
import Prompts from "./pages/Prompts";
import Sources from "./pages/Sources";
import Models from "./pages/Models";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <div className="min-h-screen bg-background">
          <Navigation />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/stories" element={<Stories />} />
            <Route path="/manual-query" element={<ManualQuery />} />
            <Route path="/ai-journalist" element={<AIJournalist />} />
            <Route path="/artifacts" element={<Artifacts />} />
            <Route path="/prompts" element={<Prompts />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/models" element={<Models />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
