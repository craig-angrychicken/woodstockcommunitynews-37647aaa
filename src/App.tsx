import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Stories from "./pages/Stories";
import ManualQuery from "./pages/ManualQuery";
import AIJournalist from "./pages/AIJournalist";
import Artifacts from "./pages/Artifacts";
import Prompts from "./pages/Prompts";
import Sources from "./pages/Sources";
import Models from "./pages/Models";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route
            path="/*"
            element={
              <div className="min-h-screen bg-background">
                <Navigation />
                <Routes>
                  <Route path="/" element={<ProtectedRoute requireAdmin><Dashboard /></ProtectedRoute>} />
                  <Route path="/stories" element={<ProtectedRoute requireAdmin><Stories /></ProtectedRoute>} />
                  <Route path="/manual-query" element={<ProtectedRoute requireAdmin><ManualQuery /></ProtectedRoute>} />
                  <Route path="/ai-journalist" element={<ProtectedRoute requireAdmin><AIJournalist /></ProtectedRoute>} />
                  <Route path="/artifacts" element={<ProtectedRoute requireAdmin><Artifacts /></ProtectedRoute>} />
                  <Route path="/prompts" element={<ProtectedRoute requireAdmin><Prompts /></ProtectedRoute>} />
                  <Route path="/sources" element={<ProtectedRoute requireAdmin><Sources /></ProtectedRoute>} />
                  <Route path="/models" element={<ProtectedRoute requireAdmin><Models /></ProtectedRoute>} />
                  {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </div>
            }
          />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
