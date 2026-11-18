import { cva, type VariantProps } from "class-variance-authority";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", {
  variants: {
    variant: {
      info: "border-primary/15 bg-brand-soft text-primary",
      success: "border-success/15 bg-success-soft text-success",
      warning: "border-warning/20 bg-warning-soft text-warning",
      destructive: "border-destructive/20 bg-destructive-soft text-destructive",
    },
  },
  defaultVariants: { variant: "info" },
});

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, destructive: CircleAlert };

/** Message contextuel. Les erreurs sont annoncées immédiatement (role="alert"), le reste poliment. */
export function Alert({ className, variant = "info", children, ...props }: ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div
      data-slot="alert"
      data-variant={variant}
      role={variant === "destructive" ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden />
      <div className="min-w-0 flex-1 [&_strong]:font-semibold">{children}</div>
    </div>
  );
}
