import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        brand: "border-transparent bg-brand-soft text-primary",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        destructive: "border-transparent bg-destructive-soft text-destructive",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
