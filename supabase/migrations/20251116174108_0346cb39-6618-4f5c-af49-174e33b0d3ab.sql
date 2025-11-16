-- Create journalism queue table for serial processing
CREATE TABLE public.journalism_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_history_id UUID NOT NULL REFERENCES public.query_history(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  position INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  story_id UUID REFERENCES public.stories(id) ON DELETE SET NULL,
  error_message TEXT,
  UNIQUE(query_history_id, artifact_id)
);

-- Enable RLS
ALTER TABLE public.journalism_queue ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Only admins can view journalism queue"
  ON public.journalism_queue FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can insert journalism queue"
  ON public.journalism_queue FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update journalism queue"
  ON public.journalism_queue FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete journalism queue"
  ON public.journalism_queue FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for efficient queue queries
CREATE INDEX idx_journalism_queue_status_position 
  ON public.journalism_queue(query_history_id, status, position);

-- Enable realtime for the queue table so frontend can subscribe to updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.journalism_queue;