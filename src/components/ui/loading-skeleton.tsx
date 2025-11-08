import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export const CardSkeleton = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-4 w-1/2 mt-2" />
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
    </CardContent>
  </Card>
);

export const TableRowSkeleton = () => (
  <tr>
    <td className="p-4">
      <Skeleton className="h-4 w-full" />
    </td>
    <td className="p-4">
      <Skeleton className="h-4 w-full" />
    </td>
    <td className="p-4">
      <Skeleton className="h-4 w-full" />
    </td>
    <td className="p-4">
      <Skeleton className="h-4 w-full" />
    </td>
  </tr>
);

export const ListItemSkeleton = () => (
  <div className="flex items-center gap-4 p-4 border-b">
    <Skeleton className="h-12 w-12 rounded-full" />
    <div className="flex-1 space-y-2">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  </div>
);
