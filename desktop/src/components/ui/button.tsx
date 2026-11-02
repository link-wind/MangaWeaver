import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
// shadcn/ui composition: owned locally, with workspace-specific visual tokens.
const variants = cva("button", {
  variants: {
    variant: {
      default: "primary",
      outline: "btn-outline",
      ghost: "ghost",
      destructive: "destructive",
    },
    size: { default: "normal", sm: "small", icon: "icon" },
  },
  defaultVariants: { variant: "outline", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={twMerge(clsx(variants({ variant, size }), className))}
      {...props}
    />
  );
}
