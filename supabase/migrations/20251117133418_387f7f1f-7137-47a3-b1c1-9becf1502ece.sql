-- Create schedules table for managing recurring tasks
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_type text NOT NULL CHECK (schedule_type IN ('artifact_fetch', 'ai_journalism')),
  scheduled_times jsonb NOT NULL DEFAULT '[]',
  is_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(schedule_type)
);

-- Enable RLS
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

-- Allow admins to read schedules
CREATE POLICY "Only admins can view schedules"
  ON public.schedules FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow admins to manage schedules
CREATE POLICY "Only admins can insert schedules"
  ON public.schedules FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update schedules"
  ON public.schedules FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete schedules"
  ON public.schedules FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_schedules_updated_at
  BEFORE UPDATE ON public.schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();