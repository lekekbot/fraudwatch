"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import { cn } from "cn"

/** Base UI checkbox styled to the app's inputs: bordered box, filled when ticked, dash when mixed. */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[5px] border border-input bg-background text-primary-foreground shadow-xs transition-[color,border-color,background-color] outline-none",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "data-checked:border-primary data-checked:bg-primary",
        "data-indeterminate:border-primary data-indeterminate:bg-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center [&_svg:not([class*='size-'])]:size-3"
        render={(props, state) =>
          state.indeterminate ? <MinusIcon {...props} /> : <CheckIcon {...props} />
        }
      />
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
