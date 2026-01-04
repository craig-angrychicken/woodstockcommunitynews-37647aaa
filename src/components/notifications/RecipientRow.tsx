import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TableCell, TableRow } from "@/components/ui/table";
import { Pencil, Trash2, Phone, User } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";

type NotificationRecipient = Tables<"notification_recipients">;

interface RecipientRowProps {
  recipient: NotificationRecipient;
  onEdit: (recipient: NotificationRecipient) => void;
  onDelete: (id: string) => void;
  onToggleActive: (id: string, is_active: boolean) => void;
  isToggling: boolean;
}

export const RecipientRow = ({
  recipient,
  onEdit,
  onDelete,
  onToggleActive,
  isToggling,
}: RecipientRowProps) => {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span>{recipient.name || "—"}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <code className="text-sm bg-muted px-2 py-0.5 rounded">
            {recipient.phone_number}
          </code>
        </div>
      </TableCell>
      <TableCell>
        <Switch
          checked={recipient.is_active}
          onCheckedChange={(checked) => onToggleActive(recipient.id, checked)}
          disabled={isToggling}
        />
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {format(new Date(recipient.created_at), "MMM d, yyyy")}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(recipient)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(recipient.id)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};
