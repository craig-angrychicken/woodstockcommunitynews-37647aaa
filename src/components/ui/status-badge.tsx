import { Badge } from "@/components/ui/badge";
import { TestTube } from "lucide-react";

interface StatusBadgeProps {
  status: "active" | "inactive" | "testing" | "success" | "warning" | "error" | "paused";
  label?: string;
  showDot?: boolean;
}

export const StatusBadge = ({ status, label, showDot = true }: StatusBadgeProps) => {
  const variants = {
    active: { variant: "success" as const, text: "Active" },
    inactive: { variant: "secondary" as const, text: "Inactive" },
    testing: { variant: "warning" as const, text: "Testing" },
    success: { variant: "success" as const, text: "Success" },
    warning: { variant: "warning" as const, text: "Warning" },
    error: { variant: "destructive" as const, text: "Error" },
    paused: { variant: "secondary" as const, text: "Paused" },
  };

  const config = variants[status];

  return (
    <Badge variant={config.variant} showDot={showDot}>
      {label || config.text}
    </Badge>
  );
};

export const TestBadge = () => {
  return (
    <Badge variant="test">
      <TestTube className="h-3 w-3" />
      Test
    </Badge>
  );
};
